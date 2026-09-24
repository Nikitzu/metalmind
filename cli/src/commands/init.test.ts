import { describe, expect, it } from 'vitest';
import { resolveBool } from './init.js';

describe('resolveBool', () => {
  it('reads commander --no-x (x: false) as off', () => {
    expect(resolveBool(false, undefined)).toBe(false);
  });

  it('reads --x as on', () => {
    expect(resolveBool(true, undefined)).toBe(true);
  });

  it('leaves an absent flag undecided so the wizard can ask', () => {
    expect(resolveBool(undefined, undefined)).toBeUndefined();
  });

  it('still honours an explicit negative option', () => {
    expect(resolveBool(undefined, true)).toBe(false);
  });
});
