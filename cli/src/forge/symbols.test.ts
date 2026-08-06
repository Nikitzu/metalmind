import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  extractSymbols,
  isInterestingName,
  parseJavaSymbols,
  parseJsSymbols,
  parsePySymbols,
} from './symbols.js';

describe('parseJsSymbols', () => {
  it('captures exported declarations of every kind', () => {
    const src = [
      'export function createBooking() {}',
      'export class BookingService {}',
      'export interface BookingDto {}',
      'export type BookingStatus = string;',
      'export enum BookingKind {}',
      'export const BOOKING_LIMIT = 5;',
    ].join('\n');
    const got = parseJsSymbols(src, 'a.ts', '/repo');
    expect(got.map((s) => [s.name, s.kind])).toEqual([
      ['createBooking', 'function'],
      ['BookingService', 'class'],
      ['BookingDto', 'interface'],
      ['BookingStatus', 'type'],
      ['BookingKind', 'enum'],
      ['BOOKING_LIMIT', 'const'],
    ]);
  });

  it('handles async, default, abstract and declare modifiers', () => {
    const src = [
      'export async function fetchBooking() {}',
      'export default class BookingPage {}',
      'export abstract class BookingBase {}',
      'export declare function ambientBooking(): void;',
    ].join('\n');
    expect(parseJsSymbols(src, 'a.ts', '/repo').map((s) => s.name)).toEqual([
      'fetchBooking',
      'BookingPage',
      'BookingBase',
      'ambientBooking',
    ]);
  });

  it('ignores non-exported declarations', () => {
    const src = 'function internalBooking() {}\nclass PrivateThing {}';
    expect(parseJsSymbols(src, 'a.ts', '/repo')).toEqual([]);
  });

  it('records a 1-indexed line number', () => {
    const src = '\n\nexport function createBooking() {}';
    expect(parseJsSymbols(src, 'a.ts', '/repo')[0]?.line).toBe(3);
  });
});

describe('parsePySymbols', () => {
  it('captures top-level def and class only', () => {
    const src = [
      'class BookingService:',
      '    def method_inside(self):',
      '        pass',
      'def create_booking():',
      '    pass',
    ].join('\n');
    expect(parsePySymbols(src, 'a.py', '/repo').map((s) => [s.name, s.kind])).toEqual([
      ['BookingService', 'class'],
      ['create_booking', 'function'],
    ]);
  });

  it('skips underscore-prefixed private names', () => {
    expect(parsePySymbols('def _private_booking():\n    pass', 'a.py', '/repo')).toEqual([]);
  });
});

describe('parseJavaSymbols', () => {
  it('captures Java and Kotlin declarations', () => {
    const src = [
      'public class BookingService {}',
      'public interface BookingRepo {}',
      'public enum BookingState {}',
      'public record BookingDto(String id) {}',
      'data class BookingModel(val id: String)',
      'fun createBooking() {}',
    ].join('\n');
    expect(parseJavaSymbols(src, 'A.java', '/repo').map((s) => [s.name, s.kind])).toEqual([
      ['BookingService', 'class'],
      ['BookingRepo', 'interface'],
      ['BookingState', 'enum'],
      ['BookingDto', 'record'],
      ['BookingModel', 'class'],
      ['createBooking', 'function'],
    ]);
  });
});

describe('isInterestingName', () => {
  it('rejects names too short to be a meaningful cross-repo match', () => {
    expect(isInterestingName('id')).toBe(false);
    expect(isInterestingName('Job')).toBe(false);
    expect(isInterestingName('Booking')).toBe(true);
  });

  it('rejects generic names that would match across unrelated repos', () => {
    for (const name of ['config', 'Config', 'handler', 'Response', 'utils', 'index']) {
      expect(isInterestingName(name), name).toBe(false);
    }
  });

  it('rejects private underscore names', () => {
    expect(isInterestingName('_internalBooking')).toBe(false);
  });
});

describe('extractSymbols', () => {
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'mm-symbols-'));
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('walks the tree across languages', async () => {
    await writeFile(join(repo, 'svc.ts'), 'export class BookingService {}', 'utf8');
    await mkdir(join(repo, 'api'), { recursive: true });
    await writeFile(join(repo, 'api', 'models.py'), 'class BookingModel:\n    pass', 'utf8');
    const got = await extractSymbols(repo);
    expect(got.map((s) => s.name).sort()).toEqual(['BookingModel', 'BookingService']);
  });

  it('never descends into build output or a stale graphify-out directory', async () => {
    for (const dir of ['node_modules', 'dist', 'graphify-out', '.codegraph']) {
      await mkdir(join(repo, dir), { recursive: true });
      await writeFile(join(repo, dir, 'vendor.ts'), 'export class VendoredThing {}', 'utf8');
    }
    expect(await extractSymbols(repo)).toEqual([]);
  });
});
