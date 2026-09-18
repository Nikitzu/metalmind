import { frontmatterList, frontmatterString, parseFrontmatter } from '../scribe/frontmatter.js';
import { clipForState } from './client.js';

/** What the judge is told about a note besides its text: the facts a reader
 *  would glance at before deciding whether two notes say the same thing. */
export interface NoteContext {
  file?: string;
  title: string;
  kind: string;
  project: string | null;
  tags: string[];
  created: string | null;
  updated: string | null;
  body: string;
}

export function noteContext(raw: string, file?: string): NoteContext {
  const { fm } = parseFrontmatter(raw);
  const created = fm.created;
  const updated = fm.updated;
  return {
    file,
    title: frontmatterString(fm, 'title') ?? '',
    kind: frontmatterString(fm, 'kind') ?? '',
    project: frontmatterString(fm, 'project'),
    tags: frontmatterList(fm, 'tags'),
    created:
      created instanceof Date
        ? created.toISOString().slice(0, 10)
        : frontmatterString(fm, 'created'),
    updated:
      updated instanceof Date
        ? updated.toISOString().slice(0, 10)
        : frontmatterString(fm, 'updated'),
    body: clipForState(raw),
  };
}
