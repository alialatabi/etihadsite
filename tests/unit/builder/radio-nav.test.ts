import { describe, expect, it } from 'vitest';
import { nextRadioIndex, radioTabIndex } from '@/components/builder/radio-nav';

describe('nextRadioIndex (RTL radio group)', () => {
  it('ArrowLeft and ArrowDown go to the next option, wrapping at the end', () => {
    expect(nextRadioIndex('ArrowLeft', 0, 3)).toBe(1);
    expect(nextRadioIndex('ArrowDown', 1, 3)).toBe(2);
    expect(nextRadioIndex('ArrowLeft', 2, 3)).toBe(0);
  });
  it('ArrowRight and ArrowUp go to the previous option, wrapping at the start', () => {
    expect(nextRadioIndex('ArrowRight', 2, 3)).toBe(1);
    expect(nextRadioIndex('ArrowUp', 1, 3)).toBe(0);
    expect(nextRadioIndex('ArrowRight', 0, 3)).toBe(2);
  });
  it('leaves every other key alone', () => {
    for (const k of ['Tab', 'Enter', ' ', 'Home', 'a']) expect(nextRadioIndex(k, 0, 3)).toBeNull();
    expect(nextRadioIndex('ArrowLeft', 0, 0)).toBeNull();
  });
});

describe('radioTabIndex', () => {
  it('makes only the selected option a Tab stop', () => {
    expect([0, 1, 2].map((i) => radioTabIndex(i, 1))).toEqual([-1, 0, -1]);
  });
  it('makes the first option the Tab stop while nothing is selected', () => {
    expect([0, 1, 2].map((i) => radioTabIndex(i, -1))).toEqual([0, -1, -1]);
  });
});
