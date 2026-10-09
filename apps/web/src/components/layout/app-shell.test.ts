import { describe, expect, it } from 'vitest';

import { mapPaddingForBreakpoint } from './app-shell';

describe('mapPaddingForBreakpoint', () => {
  it('keeps fitted geometry visible on phones, tablets and desktop panels', () => {
    expect(mapPaddingForBreakpoint('mobile', false)).toEqual({
      top: 16,
      right: 64,
      bottom: 16,
      left: 16,
    });
    expect(mapPaddingForBreakpoint('tablet', true)).toEqual({
      top: 16,
      right: 16,
      bottom: 16,
      left: 16,
    });
    expect(mapPaddingForBreakpoint('standard', true)).toEqual({
      top: 72,
      right: 404,
      bottom: 24,
      left: 72,
    });
  });
});
