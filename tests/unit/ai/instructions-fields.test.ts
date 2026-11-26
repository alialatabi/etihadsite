import { describe, expect, it } from 'vitest';
import { AI_INSTRUCTIONS_MAX_CHARS } from '@/lib/ai/config';
import { capInstructions, instructionsFields, isInstructionsEdited } from '@/components/builder/ai/api';

const T = 'a'.repeat(64);
const O = 'ستيكر بيه ورد';

describe('instructionsFields', () => {
  it('an empty or blank field sends nothing (the server draws the signed description)', () => {
    expect(instructionsFields('', O, T)).toEqual({});
    expect(instructionsFields('  \n', O, T)).toEqual({});
  });

  it('unchanged text sends the brief\'s exact string and its token', () => {
    expect(instructionsFields(O, O, T)).toEqual({ instructions: O, instructionsToken: T });
    expect(instructionsFields(` ${O} `, O, T)).toEqual({ instructions: O, instructionsToken: T });
  });

  it('edited text sends the trimmed text (the token will not verify, so the server translates)', () => {
    expect(instructionsFields('نص جديد ', O, T)).toEqual({ instructions: 'نص جديد', instructionsToken: T });
  });

  it('a missing or malformed token is not sent', () => {
    expect(instructionsFields('نص', O, '')).toEqual({ instructions: 'نص' });
    expect(instructionsFields('نص', O, 'zz')).toEqual({ instructions: 'نص' });
  });
});

describe('isInstructionsEdited', () => {
  it('is false for the original, trailing spaces and an emptied field', () => {
    expect(isInstructionsEdited('', O)).toBe(false);
    expect(isInstructionsEdited(`${O} `, O)).toBe(false);
    expect(isInstructionsEdited('', '')).toBe(false);
  });

  it('is true for any other text', () => {
    expect(isInstructionsEdited('x', O)).toBe(true);
    expect(isInstructionsEdited('x', '')).toBe(true);
  });
});

describe('capInstructions', () => {
  it('cuts to the route limit', () => {
    expect(AI_INSTRUCTIONS_MAX_CHARS).toBe(600);
    expect(capInstructions('ا'.repeat(700))).toHaveLength(600);
    expect(capInstructions('قصير')).toBe('قصير');
  });
});
