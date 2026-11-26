/**
 * `busySince` of the real useAiDesign hook: set when a brief / image request starts, cleared when it settles.
 * The environment is node (no DOM, no hook renderer), so React's state hooks are replaced by a small slot store.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ slots: [] as unknown[], i: 0 }));

vi.mock('react', async (orig) => {
  const real = await orig<typeof import('react')>();
  return {
    ...real,
    useState: (init: unknown) => {
      const k = h.i++;
      if (!(k in h.slots)) h.slots[k] = typeof init === 'function' ? (init as () => unknown)() : init;
      return [
        h.slots[k],
        (v: unknown) => {
          h.slots[k] = typeof v === 'function' ? (v as (p: unknown) => unknown)(h.slots[k]) : v;
        },
      ];
    },
    useRef: (init: unknown) => {
      const k = h.i++;
      if (!(k in h.slots)) h.slots[k] = { current: init };
      return h.slots[k];
    },
    useCallback: (fn: unknown) => fn,
    useMemo: (fn: () => unknown) => fn(),
    useEffect: () => {},
  };
});

import { DEFAULT_SETTINGS } from '@/config/defaults';
import { TEAM_AI_ENDPOINTS, teamHost } from '@/components/team/team-logic';
import { useAiDesign } from '@/components/builder/ai/useAiDesign';

const callHook = useAiDesign; // an alias: the rules of hooks flag a use* call inside a plain function

const host = teamHost({
  shape: 'circle',
  corners: 'rounded',
  spec: { shape: 'circle', widthUm: 50_000, heightUm: 50_000 },
  sizeOk: true,
  idea: 'ستيكر قهوة',
  setIdea: () => {},
  settings: DEFAULT_SETTINGS,
});
const render = () => {
  h.i = 0;
  return callHook(host, true, TEAM_AI_ENDPOINTS);
};

type Answer = { json: () => Promise<unknown> };
let resolveFetch: (a: Answer) => void = () => {};
const answer = (body: unknown) => resolveFetch({ json: async () => body });
const briefOk = {
  ok: true,
  lines: ['قهوة'],
  fixes: [],
  visualDescription: 'v',
  briefToken: 'a'.repeat(64),
  instructions: 'i',
  instructionsToken: 'b'.repeat(64),
};

beforeEach(() => {
  h.slots = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Answer>((r) => (resolveFetch = r))),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useAiDesign busySince', () => {
  it('a brief: set when it starts, cleared when the answer comes', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    expect(render().busySince).toBeNull();
    const p = render().review();
    const running = render();
    expect(running.busySince).toBe(1000);
    expect(running.briefing).toBe(true);
    expect(fetch).toHaveBeenCalledWith('/api/team/design/brief', expect.anything());
    answer(briefOk);
    await p;
    const done = render();
    expect(done.busySince).toBeNull();
    expect(done.phase).toBe('reviewing');
  });

  it('a failed brief clears it too', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const p = render().review();
    expect(render().busySince).toBe(1000);
    answer({ ok: false, error: 'failed' });
    await p;
    const done = render();
    expect(done.busySince).toBeNull();
    expect(done.error).toBe('failed');
  });

  it('an image: set at once (before the references upload), cleared when the answer comes', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const b = render().review();
    answer(briefOk);
    await b;

    vi.spyOn(Date, 'now').mockReturnValue(2000);
    const g = render().generate();
    const running = render();
    expect(running.busySince).toBe(2000);
    expect(running.phase).toBe('generating');
    await vi.waitFor(() => expect(fetch).toHaveBeenLastCalledWith('/api/team/design/generate', expect.anything()));
    answer({ ok: false, error: 'failed' });
    await g;
    const done = render();
    expect(done.busySince).toBeNull();
    expect(done.phase).toBe('error');
  });
});
