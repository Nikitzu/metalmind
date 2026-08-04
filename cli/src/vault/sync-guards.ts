export type ChangeStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U' | 'X';

export interface StagedChange {
  status: ChangeStatus;
  srcSha: string;
  dstSha: string;
  path: string;
  origPath: string | null;
}

export type GuardName = 'unexplained-deletion' | 'delete-only' | 'incomplete-staging';

export interface GuardViolation {
  guard: GuardName;
  message: string;
  paths: string[];
}

export interface GuardReport {
  safe: boolean;
  violations: GuardViolation[];
  movedNotes: string[];
  counts: { added: number; modified: number; deleted: number; renamed: number };
}

const NOTE_EXTENSION = '.md';

export function isNote(path: string): boolean {
  return path.toLowerCase().endsWith(NOTE_EXTENSION);
}

export function parseRawDiffZ(stdout: string): StagedChange[] {
  const fields = stdout.split('\0').filter((f) => f.length > 0);
  const changes: StagedChange[] = [];
  let i = 0;
  while (i < fields.length) {
    const meta = fields[i];
    if (!meta.startsWith(':')) {
      i += 1;
      continue;
    }
    const parts = meta.slice(1).split(' ');
    const srcSha = parts[2] ?? '';
    const dstSha = parts[3] ?? '';
    const status = (parts[4] ?? '').charAt(0) as ChangeStatus;
    if (status === 'R' || status === 'C') {
      changes.push({
        status,
        srcSha,
        dstSha,
        path: fields[i + 2] ?? '',
        origPath: fields[i + 1] ?? null,
      });
      i += 3;
    } else {
      changes.push({ status, srcSha, dstSha, path: fields[i + 1] ?? '', origPath: null });
      i += 2;
    }
  }
  return changes;
}

export function analyzeStagedChanges(changes: StagedChange[]): GuardReport {
  const counts = {
    added: changes.filter((c) => c.status === 'A').length,
    modified: changes.filter((c) => c.status === 'M').length,
    deleted: changes.filter((c) => c.status === 'D').length,
    renamed: changes.filter((c) => c.status === 'R' || c.status === 'C').length,
  };

  const survivingShas = new Set(
    changes.filter((c) => c.status === 'A' || c.status === 'M').map((c) => c.dstSha),
  );
  const deletedNotes = changes.filter((c) => c.status === 'D' && isNote(c.path));
  const movedNotes = deletedNotes.filter((c) => survivingShas.has(c.srcSha)).map((c) => c.path);
  const unexplained = deletedNotes
    .filter((c) => !survivingShas.has(c.srcSha))
    .map((c) => c.path)
    .sort();

  const violations: GuardViolation[] = [];
  if (unexplained.length > 0) {
    violations.push({
      guard: 'unexplained-deletion',
      message:
        `${unexplained.length} note(s) would be deleted with no matching addition in this commit. ` +
        'If this is a move, the destination is missing from the index.',
      paths: unexplained,
    });
  }

  const noteChanges = changes.filter((c) => isNote(c.path) || (c.origPath && isNote(c.origPath)));
  if (noteChanges.length > 0 && noteChanges.every((c) => c.status === 'D')) {
    violations.push({
      guard: 'delete-only',
      message: 'This commit only removes notes. Treated as suspicious by default.',
      paths: noteChanges.map((c) => c.path).sort(),
    });
  }

  return { safe: violations.length === 0, violations, movedNotes, counts };
}

export function findUnstagedEntries(porcelain: string): string[] {
  return porcelain
    .split('\n')
    .filter((line) => line.length > 2)
    .filter((line) => line.startsWith('??') || line.charAt(1) !== ' ')
    .map((line) => line.slice(3).trim())
    .sort();
}
