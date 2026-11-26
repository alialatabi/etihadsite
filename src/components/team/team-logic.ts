import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { builder, team } from '@/content/ar';
import { aiErrorMessage, maxWidthAtSize, type AiErrorCode } from '@/components/builder/ai/ai-logic';
import type { AiEndpoints } from '@/components/builder/ai/api';
import type { AiHost } from '@/components/builder/ai/useAiDesign';
import { fillLtr } from '@/components/fill-ltr';
import { safeFormatCm, safeLayout, safeParseCm } from '@/components/builder/safe';
import type { SizeIds } from '@/components/builder/steps/SizeFields';
import { STAFF_IMAGE_DAILY_LIMIT } from '@/lib/ai/config';
import type { AiUsageRow, Corners, LayoutOutcome, LayoutSettings, Shape, ShopSettings, StickerSpec } from '@/lib/types';

/**
 * Pure helpers of the staff designer page (/team): the size texts, the host the AI hook runs on, the file name and the
 * error copy. They live here (not in page.tsx, which may export only default / metadata / dynamic) so tests reach them.
 */

/** The staff routes the shared AI hook talks to. */
export const TEAM_AI_ENDPOINTS: AiEndpoints = { brief: '/api/team/design/brief', generate: '/api/team/design/generate' };

/** The part of the shop settings the page sends to the browser. */
export type TeamSettings = Pick<ShopSettings, 'maxUploadBytes' | 'layout' | 'quality' | 'ai'>;

/** The full settings object AiHost needs: the page's public subset over the defaults (the hook reads only ai, layout, maxUploadBytes). */
export function teamFullSettings(s: TeamSettings): ShopSettings {
  return { ...DEFAULT_SETTINGS, ...s };
}

export const TEAM_SIZE_IDS: SizeIds = { width: 'team-width', height: 'team-height', msg: 'team-size-msg' };

export interface SizeTexts {
  widthText: string;
  heightText: string;
}

/**
 * One side typed. Mirrors useBuilder's onWidthChange / onHeightChange on page 1 before a design exists:
 * a rectangle is free, a custom shape stays a square, a circle has only the diameter.
 */
export function teamSizeEdit(shape: Shape | null, side: 'width' | 'height', text: string, current: SizeTexts): SizeTexts {
  if (shape === 'circle') return { widthText: side === 'width' ? text : current.widthText, heightText: '' };
  if (shape === 'custom') {
    const um = safeParseCm(text);
    const other = um ? safeFormatCm(um) : text.trim() ? (side === 'width' ? current.heightText : current.widthText) : '';
    return side === 'width' ? { widthText: text, heightText: other } : { widthText: other, heightText: text };
  }
  return side === 'width' ? { ...current, widthText: text } : { ...current, heightText: text };
}

/** On a shape change: a custom shape squares the height to the width (when it parses); the others keep the texts. */
export function teamShapeTexts(shape: Shape, t: SizeTexts): SizeTexts {
  if (shape === 'circle') return { widthText: t.widthText, heightText: '' };
  if (shape === 'custom') {
    const um = safeParseCm(t.widthText);
    return um ? { widthText: t.widthText, heightText: safeFormatCm(um) } : t;
  }
  return t;
}

export interface TeamSizeState {
  size: { widthUm: number; heightUm: number } | null;
  spec: StickerSpec | null;
  outcome: LayoutOutcome | null;
  sizeOk: boolean;
  error: ReactNode | null;
}

/** The typed texts → size, spec, layout outcome and the size error. Same rules and copy as the builder's size step. */
export function teamSizeState(shape: Shape | null, corners: Corners, widthText: string, heightText: string, layout: LayoutSettings): TeamSizeState {
  const w = safeParseCm(widthText);
  const h = shape === 'circle' ? w : safeParseCm(heightText);
  const size = shape && w && h ? { widthUm: w, heightUm: h } : null;
  const spec: StickerSpec | null =
    shape && size
      ? { shape, ...(shape === 'rect' ? { corners } : {}), widthUm: size.widthUm, heightUm: shape === 'circle' ? size.widthUm : size.heightUm }
      : null;
  const outcome = spec ? safeLayout(spec, layout) : null;

  const widthBad = widthText.trim() !== '' && w === null;
  const heightBad = shape !== 'circle' && heightText.trim() !== '' && safeParseCm(heightText) === null;
  let error: ReactNode | null = null;
  if (widthBad || heightBad) error = builder.size.errors.invalid;
  else if (outcome && !outcome.ok) {
    const m = maxWidthAtSize(shape, corners, size, layout);
    error = fillLtr(builder.size.errors[outcome.reason], { max: m ? safeFormatCm(m) : '—' });
  }
  return { size, spec, outcome, sizeOk: !!outcome?.ok, error };
}

/** The host the shared AI hook runs on. The staff page has no steps and no order: those members do nothing. */
export function teamHost(p: {
  shape: Shape | null;
  corners: Corners;
  spec: StickerSpec | null;
  sizeOk: boolean;
  idea: string;
  setIdea: Dispatch<SetStateAction<string>>;
  settings: ShopSettings;
}): AiHost {
  return { ...p, startAi: () => {}, showDesignStep: () => {}, goTo: () => false, acceptAi: async () => true };
}

/** Western digits, cm: softy-circle-5x5.png, softy-rect-7.5x3.png. From what the image was made for, never from the controls. */
export function teamPngName(m: { shape: Shape; widthUm: number; heightUm: number }): string {
  return `softy-${m.shape}-${safeFormatCm(m.widthUm)}x${safeFormatCm(m.heightUm)}.png`;
}

/** Images left today: no row = the full limit; a missing method or failed read (rows === null) = unknown (null). */
export function remainingFromUsage(rows: AiUsageRow[] | null, staffId: string, today: string, limit: number = STAFF_IMAGE_DAILY_LIMIT): number | null {
  if (rows === null) return null;
  let used = 0;
  for (const r of rows) if (r.day === today && r.kind === 'staff_image' && r.ipKey === `staff:${staffId}`) used += r.count;
  return Math.max(0, limit - used);
}

/** The error text on the staff page. */
export function teamErrorText(code: string): ReactNode {
  if (code === 'ip_limit') return fillLtr(team.limitReached, { n: STAFF_IMAGE_DAILY_LIMIT });
  if (code === 'rate_limited') return team.login.rateLimited;
  if (code === 'unauthorized') return team.sessionEnded;
  return aiErrorMessage(code as AiErrorCode);
}
