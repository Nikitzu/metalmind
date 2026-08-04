import { describe, expect, it } from 'vitest';
import { findVersionClaimDrift } from './release-check.js';

describe('findVersionClaimDrift', () => {
  it('returns no drift when every claim matches the package version', () => {
    const text = 'Published on npm · current release `v0.10.1`.';
    expect(findVersionClaimDrift(text, '0.10.1')).toEqual([]);
  });

  it('flags a stale current-release claim', () => {
    const text = 'Published on npm · current release `v0.8.0`.';
    expect(findVersionClaimDrift(text, '0.10.1')).toEqual(['v0.8.0']);
  });

  it('flags every stale claim in a document with several', () => {
    const text = 'current release `v0.8.0` ... elsewhere current release `v0.9.0`';
    expect(findVersionClaimDrift(text, '0.10.1')).toEqual(['v0.8.0', 'v0.9.0']);
  });

  it('ignores version strings that are not current-release claims', () => {
    const text = 'shipped in v0.5.0, hardened in `v0.8.2`, current release `v0.10.1`';
    expect(findVersionClaimDrift(text, '0.10.1')).toEqual([]);
  });
});
