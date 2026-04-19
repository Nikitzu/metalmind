import { describe, expect, it } from 'vitest';
import { extractFirstFile } from './recall.js';

describe('extractFirstFile', () => {
  it('parses filename:score rendering', () => {
    const input = 'auth-flow.md: 0.87\nother-note.md: 0.62\n';
    expect(extractFirstFile(input)).toBe('auth-flow.md');
  });

  it('parses ### heading rendering', () => {
    const input = '### auth-flow.md\n\nexcerpt...';
    expect(extractFirstFile(input)).toBe('auth-flow.md');
  });

  it('returns null when no markdown file found', () => {
    expect(extractFirstFile('no matches')).toBeNull();
  });
});
