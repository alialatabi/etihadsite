import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/monitoring/report', () => ({ reportError: () => {} }));

import { extractBrief } from '@/lib/ai/brief';
import { AI_BRIEF_MODEL, AI_MAX_LINES } from '@/lib/ai/config';
import type { OpenAiConfig } from '@/lib/ai/openai';

const cfg: OpenAiConfig = { apiKey: 'sk-test-SECRET', baseUrl: 'https://api.test/v1' };
const CAFE = 'ستيكر مستطيل لكافيه گلبهار، مكتوب عليه كافيه گلبهار وجوة منها چاي وقهوة وپيتزا، وبي كوب چاي عراقي استكان وورد';

/** A /v1/responses body as the live API returns it: a reasoning item first, then the message. */
function responsesBody(json: string | object): object {
  const text = typeof json === 'string' ? json : JSON.stringify(json);
  return {
    id: 'resp_1',
    status: 'completed',
    output: [
      { type: 'reasoning', id: 'rs_1', summary: [] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] },
    ],
  };
}

function ok(body: object): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('extractBrief', () => {
  it('maps printed_text/visual_description/spelling_fixes', async () => {
    fetchMock.mockResolvedValue(
      ok(
        responsesBody({
          printed_text: ['أهلاً وسهلاً', ' رمضان كريم ', ''],
          visual_description: 'A lantern and a crescent moon',
          spelling_fixes: [{ from: 'اهلا', to: 'أهلاً' }],
        }),
      ),
    );
    const r = await extractBrief(cfg, 'اكتب اهلا وسهلا');
    expect(r).toEqual({
      ok: true,
      brief: {
        lines: ['أهلاً وسهلاً', 'رمضان كريم'],
        visualDescription: 'A lantern and a crescent moon',
        fixes: [{ from: 'اهلا', to: 'أهلاً' }],
      },
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/v1/responses');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(AI_BRIEF_MODEL);
    expect(body.input).toBe('اكتب اهلا وسهلا');
    expect(body.store).toBe(false);
    expect(body.instructions).not.toContain('اكتب اهلا وسهلا');
    expect(body.text.format.type).toBe('json_schema');
    expect(body.text.format.name).toBe('brief');
    expect(body.text.format.strict).toBe(true);
    const schema = body.text.format.schema;
    expect(schema.additionalProperties).toBe(false);
    expect([...schema.required].sort()).toEqual(['printed_text', 'spelling_fixes', 'visual_description']);
    const fixItem = schema.properties.spelling_fixes.items;
    expect(fixItem.additionalProperties).toBe(false);
    expect([...fixItem.required].sort()).toEqual(['from', 'to']);
  });

  it('caps lines at 8', async () => {
    const many = Array.from({ length: 12 }, (_, i) => `سطر ${i + 1}`);
    fetchMock.mockResolvedValue(ok(responsesBody({ printed_text: many, visual_description: 'x', spelling_fixes: [] })));
    const r = await extractBrief(cfg, 'idea');
    expect(AI_MAX_LINES).toBe(8);
    expect(r.ok && r.brief.lines).toEqual(many.slice(0, 8));
  });

  it('bad JSON → error', async () => {
    fetchMock.mockResolvedValue(ok(responsesBody('{"printed_text": ["a"')));
    expect(await extractBrief(cfg, 'idea')).toEqual({ ok: false, reason: 'error' });
  });

  it('JSON of the wrong shape → error', async () => {
    fetchMock.mockResolvedValue(ok(responsesBody({ printed_text: 'not an array', visual_description: 'x', spelling_fixes: [] })));
    expect(await extractBrief(cfg, 'idea')).toEqual({ ok: false, reason: 'error' });
  });

  it('no output_text → error', async () => {
    fetchMock.mockResolvedValue(ok({ status: 'completed', output: [{ type: 'reasoning', summary: [] }] }));
    expect(await extractBrief(cfg, 'idea')).toEqual({ ok: false, reason: 'error' });
  });

  it('a refusal item → refused', async () => {
    fetchMock.mockResolvedValue(
      ok({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'I cannot help with that.' }] }] }),
    );
    expect(await extractBrief(cfg, 'idea')).toEqual({ ok: false, reason: 'refused' });
  });

  it('timeout → timeout', async () => {
    fetchMock.mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    expect(await extractBrief(cfg, 'idea')).toEqual({ ok: false, reason: 'timeout' });
  });

  it('request carries the café example in the instructions', async () => {
    fetchMock.mockResolvedValue(ok(responsesBody({ printed_text: [], visual_description: 'x', spelling_fixes: [] })));
    await extractBrief(cfg, 'idea');
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.instructions).toContain(CAFE);
    expect(body.instructions).toContain('"printed_text":["كافيه گلبهار"]');
    expect(body.instructions).toContain('WRITTEN');
    expect(body.instructions).toContain('NEVER printed text');
    // Only the Answer JSON per example: no duplicated `printed_text: [...]` line.
    expect(body.instructions).not.toMatch(/^printed_text:/m);
  });

  it('instructions keep tanween/hamza and resolve name references (live findings)', async () => {
    fetchMock.mockResolvedValue(ok(responsesBody({ printed_text: [], visual_description: 'x', spelling_fixes: [] })));
    await extractBrief(cfg, 'idea');
    const instructions: string = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string).instructions;

    // Rules.
    expect(instructions).toContain('«اهلا» → «أهلاً»');
    expect(instructions).toContain('«ابو حسين» → «أبو حسين»');
    expect(instructions).toContain('handles (@...)');
    expect(instructions).toContain('«اسم المحل»');

    // Worked examples (at most 6), each with its expected answer.
    const examples = instructions.match(/^Example \d+$/gm) ?? [];
    expect(examples.length).toBeGreaterThanOrEqual(5);
    expect(examples.length).toBeLessThanOrEqual(6);
    expect(instructions).toContain('اهلا وسهلا وبالسطر الثاني شكرا لطلبكم منا');
    expect(instructions).toContain('"printed_text":["أهلاً وسهلاً","شكراً لطلبكم منا"]');
    expect(instructions).toContain('شعار لمطعم البيك العراقي، بيه دجاجة مشوية وصحن تمن، اكتبوا المطعم بخط كبير وتحته توصيل مجاني');
    expect(instructions).toContain('"printed_text":["مطعم البيك العراقي","توصيل مجاني"]');
  });
});
