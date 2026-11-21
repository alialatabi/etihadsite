/**
 * A tiny stand-in for the OpenAI API, started by global-setup.ts. The dev server reaches it through
 * OPENAI_BASE_URL (playwright.config.ts). It answers the brief call (POST /v1/responses) with a fixed
 * brief and the image calls (POST /v1/images/generations and /v1/images/edits) with a fixed PNG.
 */
import http from 'node:http';
import sharp from 'sharp';

export const OPENAI_MOCK_PORT = 3197;

/** What the mock brief returns: one printed line (with one spelling fix) and an English description. */
export const MOCK_BRIEF = {
  printed_text: ['مقهى الورد'],
  visual_description: 'A steaming coffee cup with a few rose petals, bright colours.',
  spelling_fixes: [{ from: 'مقهي', to: 'مقهى' }],
};

async function mockPng(): Promise<string> {
  const base = { create: { width: 1024, height: 1024, channels: 3 as const, background: { r: 250, g: 200, b: 60 } } };
  const cup = await sharp({ create: { width: 512, height: 512, channels: 3, background: { r: 120, g: 60, b: 200 } } }).png().toBuffer();
  const png = await sharp(base).composite([{ input: cup, left: 256, top: 256 }]).png().toBuffer();
  return png.toString('base64');
}

export async function startOpenAiMock(): Promise<() => Promise<void>> {
  const b64 = await mockPng();
  const server = http.createServer((req, res) => {
    // Drain the body (JSON or multipart) before answering.
    req.on('data', () => {});
    req.on('end', () => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.method !== 'POST') return send(405, { error: { code: 'method_not_allowed' } });
      if (req.url === '/v1/responses') {
        return send(200, { output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(MOCK_BRIEF) }] }] });
      }
      if (req.url === '/v1/images/generations' || req.url === '/v1/images/edits') {
        return send(200, { data: [{ b64_json: b64 }] });
      }
      return send(404, { error: { code: 'not_found' } });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(OPENAI_MOCK_PORT, '127.0.0.1', () => resolve());
  });
  return () => new Promise<void>((resolve) => server.close(() => resolve()));
}
