import { describe, expect, it } from 'vitest';
import { noteContext } from './context.js';

describe('noteContext', () => {
  it('lifts kind, project, tags and dates out of the frontmatter and clips the body', () => {
    const raw =
      '---\nkind: learning\ntitle: "T"\nproject: tzmem\ntags: ["a", "b"]\ncreated: 2026-09-17\nupdated: 2026-09-18\n---\nBody text';
    expect(noteContext(raw, 'Learnings/t.md')).toEqual({
      file: 'Learnings/t.md',
      title: 'T',
      kind: 'learning',
      project: 'tzmem',
      tags: ['a', 'b'],
      created: '2026-09-17',
      updated: '2026-09-18',
      body: 'Body text',
    });
  });
  it('tolerates a body with no frontmatter', () => {
    expect(noteContext('plain')).toMatchObject({ title: '', kind: '', tags: [], body: 'plain' });
  });
});
