import { describe, expect, it } from 'vitest';
import { extractText } from './mcp-client.js';

describe('extractText', () => {
  it('concatenates text content parts', () => {
    const out = extractText({
      content: [
        { type: 'text', text: 'hello' },
        { type: 'text', text: 'world' },
      ],
    });
    expect(out).toBe('hello\nworld');
  });

  it('skips non-text parts', () => {
    const out = extractText({
      content: [
        { type: 'image', text: 'ignored' },
        { type: 'text', text: 'kept' },
      ],
    });
    expect(out).toBe('kept');
  });

  it('returns empty string for missing content', () => {
    expect(extractText({})).toBe('');
  });
});
