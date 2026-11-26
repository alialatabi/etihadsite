/**
 * The staff designer's server-rendered markup, with the AI hook stubbed (effects never run here). The hook's own
 * behaviour is covered by tests/unit/builder/ai-flow.test.ts and ai-busy-since.test.ts. No JSX (the glob is *.test.ts).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiDesignApi } from '@/components/builder/ai/useAiDesign';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { builder, team } from '@/content/ar';

const h = vi.hoisted(() => ({
  calls: [] as { host: Record<string, unknown>; ready: boolean; endpoints: unknown }[],
  stub: {} as Record<string, unknown>,
}));

vi.mock('@/components/builder/ai/useAiDesign', () => ({
  useAiDesign: vi.fn((host: Record<string, unknown>, ready: boolean, endpoints: unknown) => {
    h.calls.push({ host, ready, endpoints });
    return h.stub;
  }),
}));

import { TeamDesigner } from '@/components/team/TeamDesigner';
import { TEAM_AI_ENDPOINTS, teamErrorText } from '@/components/team/team-logic';

const noop = () => {};
const stubAi = (over: Record<string, unknown> = {}): AiDesignApi =>
  ({
    phase: 'idle',
    lines: [],
    fixes: [],
    textWarning: null,
    error: undefined,
    result: undefined,
    remainingToday: null,
    off: false,
    briefing: false,
    busySince: null,
    block: 'shape',
    instructions: '',
    setInstructions: noop,
    instructionsEdited: false,
    refs: [],
    refRejected: false,
    review: noop,
    setLines: noop,
    onIdeaChange: noop,
    generate: noop,
    accept: noop,
    retry: noop,
    editIdea: noop,
    addRefFiles: noop,
    removeRef: noop,
    ...over,
  }) as unknown as AiDesignApi;

const settings = { maxUploadBytes: DEFAULT_SETTINGS.maxUploadBytes, layout: DEFAULT_SETTINGS.layout, quality: DEFAULT_SETTINGS.quality, ai: DEFAULT_SETTINGS.ai };
const render = (over: Record<string, unknown> = {}, props: { ready?: boolean; remainingToday?: number | null } = {}) => {
  h.stub = stubAi(over) as unknown as Record<string, unknown>;
  return renderToStaticMarkup(createElement(TeamDesigner, { settings, ready: props.ready ?? true, remainingToday: props.remainingToday === undefined ? 50 : props.remainingToday }));
};
const result = {
  previewUrl: 'blob:x',
  madeFor: { shape: 'circle', widthUm: 50_000, heightUm: 50_000 },
  lines: ['هلا'],
  pxWidth: 1024,
  pxHeight: 1024,
  uploadId: 'u',
  file: new File([], 'a.png'),
};

beforeEach(() => {
  h.calls.length = 0;
});

describe('TeamDesigner markup', () => {
  it('idle: the shape picker, the idea field and the generate button; the hook talks to the staff routes', () => {
    const html = render();
    expect(html).toContain('id="team-idea"');
    expect(html).toContain(builder.ai.ideaLabel);
    expect(html).toContain(builder.ai.generate);
    for (const label of [builder.shape.circle, builder.shape.rect, builder.shape.custom]) expect(html).toContain(label);
    const call = h.calls[h.calls.length - 1];
    expect(call.endpoints).toEqual(TEAM_AI_ENDPOINTS);
    expect(call.ready).toBe(true);
    expect((call.host.settings as { layout: unknown }).layout).toEqual(DEFAULT_SETTINGS.layout);
    expect(call.host.spec).toBeNull();
    expect(call.host.sizeOk).toBe(false);
    expect(html).not.toMatch(/class="[^"]*\b(left|right)\b[^"]*"/);
  });

  it('off: the notice replaces the idea field', () => {
    const html = render({ off: true });
    expect(html).toContain(team.login.unavailable);
    expect(html).not.toContain('team-idea');
  });

  it('reviewing: the text review box', () => {
    expect(render({ phase: 'reviewing', lines: ['هلا'] })).toContain(builder.ai.reviewTitle);
  });

  it('generating: the progress bar and the waiting text', () => {
    const html = render({ phase: 'generating', busySince: 1000 });
    expect(html).toContain('role="progressbar"');
    expect(html).toContain(builder.ai.generating);
  });

  it('a result: preview, download link with a Western-digit name, retry, new design, the tries left', () => {
    const html = render({ phase: 'result', result, remainingToday: 49 });
    expect(html).toContain('href="blob:x"');
    expect(html).toContain('download="softy-circle-5x5.png"');
    expect(html).toContain(team.download);
    expect(html).toContain(builder.ai.retry);
    expect(html).toContain(team.newDesign);
    expect(html).toContain('rounded-full');
    expect(html).toContain('49');
  });

  it('a rectangle result is not clipped to a circle', () => {
    const rect = { ...result, madeFor: { shape: 'rect', widthUm: 50_000, heightUm: 30_000 } };
    expect(render({ phase: 'result', result: rect, remainingToday: 49 })).not.toContain('rounded-full');
  });

  it('the first heading can take focus, so a new design can move it there after the old buttons are gone', () => {
    expect(render()).toMatch(/<h2 id="team-shape"[^>]*tabindex="-1"/);
  });

  it('the daily limit with no result: the limit text and no retry button', () => {
    const html = render({ phase: 'error', error: 'ip_limit', remainingToday: 0 });
    // The whole filled sentence, with the number in its Ltr wrapper ('50' alone also appears in the radio buttons' ring class).
    const sentence = renderToStaticMarkup(createElement('span', null, teamErrorText('ip_limit'))).replace(/^<span>|<\/span>$/g, '');
    expect(sentence).toMatch(/dir="ltr"[^>]*>50</);
    expect(html).toContain(sentence);
    expect(html).toContain(team.limitReached.split('{n}')[0]);
    expect(html).not.toContain(builder.ai.retry);
  });

  it('an ended session: its text and the way back to the login page', () => {
    const html = render({ phase: 'error', error: 'unauthorized' });
    expect(html).toContain(team.sessionEnded);
    expect(html).toContain('href="/team/login"');
  });
});
