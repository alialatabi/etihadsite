/** Pure helpers of the staff designer page: size texts, the AI host, the file name, the usage count and the error copy. */
import { Fragment, createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { generateBlock } from '@/components/builder/logic';
import {
  TEAM_AI_ENDPOINTS,
  remainingFromUsage,
  teamErrorText,
  teamFullSettings,
  teamHost,
  teamPngName,
  teamShapeTexts,
  teamSizeEdit,
  teamSizeState,
} from '@/components/team/team-logic';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { builder, team } from '@/content/ar';
import { safeFormatCm } from '@/components/builder/safe';
import type { AiUsageRow } from '@/lib/types';

const layout = DEFAULT_SETTINGS.layout;
const html = (n: ReactNode) => renderToStaticMarkup(createElement(Fragment, null, n));

describe('teamSizeState', () => {
  it('a circle takes the diameter for both sides', () => {
    const s = teamSizeState('circle', 'rounded', '5', '', layout);
    expect(s.spec).toEqual({ shape: 'circle', widthUm: 50_000, heightUm: 50_000 });
    expect(s.sizeOk).toBe(true);
    expect(s.error).toBeNull();
  });

  it('a rectangle carries its corners; a custom shape does not', () => {
    const rect = teamSizeState('rect', 'rounded', '7.5', '3', layout);
    expect(rect.spec).toEqual({ shape: 'rect', corners: 'rounded', widthUm: 75_000, heightUm: 30_000 });
    expect(rect.sizeOk).toBe(true);
    const custom = teamSizeState('custom', 'sharp', '4', '4', layout);
    expect(custom.spec).toEqual({ shape: 'custom', widthUm: 40_000, heightUm: 40_000 });
  });

  it('reads Arabic digits and the Arabic decimal mark', () => {
    expect(teamSizeState('circle', 'rounded', '٣٫٢٥', '', layout).size?.widthUm).toBe(32_500);
  });

  it('nothing typed: no spec and no error', () => {
    const s = teamSizeState('rect', 'rounded', '', '', layout);
    expect(s.spec).toBeNull();
    expect(s.sizeOk).toBe(false);
    expect(s.error).toBeNull();
  });

  it('no shape: no spec', () => {
    expect(teamSizeState(null, 'rounded', '5', '5', layout).spec).toBeNull();
  });

  it('an unreadable number is the invalid error', () => {
    expect(teamSizeState('rect', 'rounded', 'abc', '3', layout).error).toBe(builder.size.errors.invalid);
    expect(teamSizeState('rect', 'rounded', '3', 'x', layout).error).toBe(builder.size.errors.invalid);
    // A circle has no height: a stale height text is not an error.
    expect(teamSizeState('circle', 'rounded', '3', 'x', layout).error).toBeNull();
  });

  it('too small and too big read as the builder copy', () => {
    const small = teamSizeState('circle', 'rounded', '0.3', '', layout);
    expect(small.sizeOk).toBe(false);
    expect(html(small.error)).toContain(builder.size.errors.too_small);
    const big = teamSizeState('rect', 'rounded', '25', '25', layout);
    expect(big.sizeOk).toBe(false);
    const text = html(big.error);
    expect(text).toContain(builder.size.errors.too_big_for_page.split('{max}')[0]);
    expect(text).toMatch(/\d/);
  });

  it('a 10 x 3 cm rectangle fits the sheet and the AI may generate it (no ratio limit)', () => {
    const s = teamSizeState('rect', 'rounded', '10', '3', layout);
    expect(s.sizeOk).toBe(true);
    expect(generateBlock({ shape: 'rect', size: s.size, sizeOk: s.sizeOk, idea: 'x', unavailable: false, busy: false })).toBeNull();
  });
});

describe('teamSizeEdit / teamShapeTexts', () => {
  const cur = { widthText: '5', heightText: '8' };
  it('a custom shape stays square: the other side follows', () => {
    expect(teamSizeEdit('custom', 'width', '4', cur)).toEqual({ widthText: '4', heightText: '4' });
    expect(teamSizeEdit('custom', 'height', '6', cur)).toEqual({ widthText: '6', heightText: '6' });
  });
  it('a custom shape with 3 decimals stays an exact square whichever side was typed', () => {
    for (const side of ['width', 'height'] as const) {
      const t = teamSizeEdit('custom', side, '5.555', cur);
      expect(t).toEqual({ widthText: '5.555', heightText: '5.555' });
      expect(teamSizeState('custom', 'sharp', t.widthText, t.heightText, layout).spec).toEqual({
        shape: 'custom',
        widthUm: 55_550,
        heightUm: 55_550,
      });
    }
    expect(teamShapeTexts('custom', { widthText: '3.333', heightText: '' })).toEqual({ widthText: '3.333', heightText: '3.333' });
  });
  it('a custom shape: an unreadable text keeps the other side, an empty one clears it', () => {
    expect(teamSizeEdit('custom', 'width', 'ab', cur)).toEqual({ widthText: 'ab', heightText: '8' });
    expect(teamSizeEdit('custom', 'width', '', cur)).toEqual({ widthText: '', heightText: '' });
  });
  it('a rectangle changes only the edited side', () => {
    expect(teamSizeEdit('rect', 'width', '7', cur)).toEqual({ widthText: '7', heightText: '8' });
    expect(teamSizeEdit('rect', 'height', '2', cur)).toEqual({ widthText: '5', heightText: '2' });
    expect(teamSizeEdit(null, 'width', '7', cur)).toEqual({ widthText: '7', heightText: '8' });
  });
  it('a circle has only the diameter', () => {
    expect(teamSizeEdit('circle', 'width', '6', cur)).toEqual({ widthText: '6', heightText: '' });
  });
  it('switching shape: custom squares the height, circle clears it, rect keeps both', () => {
    expect(teamShapeTexts('custom', cur)).toEqual({ widthText: '5', heightText: '5' });
    expect(teamShapeTexts('custom', { widthText: 'zz', heightText: '8' })).toEqual({ widthText: 'zz', heightText: '8' });
    expect(teamShapeTexts('circle', cur)).toEqual({ widthText: '5', heightText: '' });
    expect(teamShapeTexts('rect', cur)).toEqual(cur);
  });
});

describe('teamHost', () => {
  const settings = teamFullSettings({ maxUploadBytes: DEFAULT_SETTINGS.maxUploadBytes, layout, quality: DEFAULT_SETTINGS.quality, ai: DEFAULT_SETTINGS.ai });
  const setIdea = () => {};
  const spec = { shape: 'circle' as const, widthUm: 50_000, heightUm: 50_000 };
  const host = teamHost({ shape: 'circle', corners: 'rounded', spec, sizeOk: true, idea: 'x', setIdea, settings });

  it('carries the inputs as they are', () => {
    expect(host.shape).toBe('circle');
    expect(host.spec).toBe(spec);
    expect(host.sizeOk).toBe(true);
    expect(host.idea).toBe('x');
    expect(host.setIdea).toBe(setIdea);
    expect(host.settings).toBe(settings);
  });
  it('has no steps and no order: those members do nothing', async () => {
    expect(() => host.startAi()).not.toThrow();
    expect(() => host.showDesignStep()).not.toThrow();
    expect(host.goTo(1)).toBe(false);
    await expect(host.acceptAi(new File([], 'a.png'), 'u', { shape: 'circle', widthUm: 1, heightUm: 1 }, [])).resolves.toBe(true);
  });
  it('the full settings keep the page subset over the defaults', () => {
    expect(settings.layout).toEqual(layout);
    expect(settings.maxUploadBytes).toBe(DEFAULT_SETTINGS.maxUploadBytes);
    expect(settings.deliveryFeeIqd).toBe(DEFAULT_SETTINGS.deliveryFeeIqd);
  });
});

describe('teamPngName', () => {
  it('Western digits, in cm, from what the image was made for', () => {
    expect(teamPngName({ shape: 'circle', widthUm: 50_000, heightUm: 50_000 })).toBe('softy-circle-5x5.png');
    expect(teamPngName({ shape: 'rect', widthUm: 75_000, heightUm: 30_000 })).toBe('softy-rect-7.5x3.png');
    expect(teamPngName({ shape: 'custom', widthUm: 50_000, heightUm: 50_000 })).toBe(`softy-custom-${safeFormatCm(50_000)}x${safeFormatCm(50_000)}.png`);
  });
});

describe('remainingFromUsage', () => {
  const row = (over: Partial<AiUsageRow>): AiUsageRow => ({ day: '2026-11-26', ipKey: 'staff:st_1', ip: '', kind: 'staff_image', count: 1, lastAt: '', ...over });
  const today = '2026-11-26';
  it('unknown (no method, failed read) is null', () => {
    expect(remainingFromUsage(null, 'st_1', today)).toBeNull();
  });
  it('no row: the full limit', () => {
    expect(remainingFromUsage([], 'st_1', today)).toBe(50);
  });
  it('counts only this account, today and the staff image kind', () => {
    const rows = [
      row({ count: 3 }),
      row({ ipKey: 'staff:other', count: 9 }),
      row({ day: '2026-11-25', count: 7 }),
      row({ kind: 'staff_brief', count: 5 }),
    ];
    expect(remainingFromUsage(rows, 'st_1', today)).toBe(47);
  });
  it('never below zero', () => {
    expect(remainingFromUsage([row({ count: 60 })], 'st_1', today)).toBe(0);
  });
});

describe('teamErrorText', () => {
  it('the daily limit names the limit', () => {
    expect(html(teamErrorText('ip_limit'))).toContain('50');
  });
  it('the staff rate limit does not say "upload your design"', () => {
    expect(teamErrorText('rate_limited')).toBe(team.login.rateLimited);
  });
  it('an ended session', () => {
    expect(teamErrorText('unauthorized')).toBe(team.sessionEnded);
  });
  it('anything else reads as the builder copy', () => {
    expect(teamErrorText('failed')).toBe(builder.ai.errors.failed);
    expect(teamErrorText('something_new')).toBe(builder.ai.errors.failed);
  });
});

describe('TEAM_AI_ENDPOINTS', () => {
  it('points at the staff routes', () => {
    expect(TEAM_AI_ENDPOINTS).toEqual({
      brief: '/api/team/design/brief',
      generate: '/api/team/design/generate',
      upload: { start: '/api/team/upload/direct', commit: '/api/team/upload/direct/commit', server: '/api/team/upload' },
    });
  });
});
