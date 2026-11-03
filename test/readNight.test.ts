import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/readNight.js';

const night = '2026-10-28';
const event = {
  at: '2026-10-28T23:00:02+01:00', job: 'job', status: 'ok', owner: 'rook',
};
let dir: string;
const write = (events: unknown[]) => writeFileSync(join(dir, `${night}.jsonl`), events.map(value => JSON.stringify(value)).join('\n'));

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rig-reader-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('readNight', () => {
  it('reads the real fixture without changing it: five jobs and one bad line', () => {
    const digest = readNight(resolve('runs'), night)!;
    expect(digest.badLines).toBe(1);
    expect(digest.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(digest.rows.map(row => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(digest.rows[0]).toMatchObject({ owner: null, runs: 1 });
    expect(digest.rows[1]).toEqual({
      job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3,
      lastStatus: 'ok', lastError: 'upstream 503', hasFailed: false,
      firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
    });
    expect(digest.rows[2]).toMatchObject({ runs: 8, retries: 1, lastError: 'lock held' });
    expect(digest.rows[3]).toMatchObject({ hasFailed: true, lastStatus: 'fail', lastError: 'quota exceeded' });
    expect(digest.rows.reduce((sum, row) => sum + row.runs, 0)).toBe(15);
  });

  it('distinguishes missing files from empty and blank files', () => {
    expect(readNight(dir, night)).toBeNull();
    for (const contents of ['', ' \r\n\t\n']) {
      writeFileSync(join(dir, `${night}.jsonl`), contents);
      expect(readNight(dir, night)).toEqual({ rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
    }
  });

  it.each(['../2026-10-28', '/2026-10-28', '2026-1-01', '2026-10-28.jsonl', '2026-10-28\n', ''])('rejects unsafe or malformed night %j before reading', value => {
    expect(() => readNight(join(dir, 'missing'), value)).toThrow(RangeError);
  });

  it('propagates I/O errors other than ENOENT', () => {
    mkdirSync(join(dir, `${night}.jsonl`));
    expect(() => readNight(dir, night)).toThrow();
  });

  it('counts malformed events and JSON without changing valid totals', () => {
    const invalid = [null, [], true, 1, 'text', {},
      { ...event, at: null }, { ...event, at: 'yesterday' },
      { ...event, at: '2026-10-28T23:00:02' },
      { ...event, at: '2026-02-30T23:00:02Z' },
      { ...event, at: '2026-10-28T24:00:00Z' },
      { ...event, job: '' }, { ...event, job: 2 },
      { ...event, status: 'unknown' }, { ...event, owner: undefined },
      { ...event, owner: 1 }, { ...event, error: null }, { ...event, error: 2 },
    ];
    writeFileSync(join(dir, `${night}.jsonl`), '\n{broken\r\n' + invalid.map(value => JSON.stringify(value)).join('\n') + '\n' + JSON.stringify({ ...event, extra: true }) + '\n');
    const digest = readNight(dir, night)!;
    expect(digest.badLines).toBe(invalid.length + 1);
    expect(digest.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
    expect(digest.rows).toHaveLength(1);
  });

  it('uses file order, retains failures and errors, and takes the last owner including null', () => {
    write([
      { ...event, status: 'fail', error: 'first' },
      { ...event, at: '2026-10-27T01:00:00-05:00', status: 'retry', error: '' },
      { ...event, at: '2026-10-26T01:00:00Z', owner: null },
    ]);
    expect(readNight(dir, night)).toEqual({
      rows: [{ job: 'job', owner: null, runs: 3, retries: 1, lastStatus: 'ok',
        lastError: '', hasFailed: true, firstAt: event.at, lastAt: '2026-10-26T01:00:00Z' }],
      badLines: 0, counts: { ok: 1, retry: 1, fail: 1 },
    });
  });

  it('sorts by string comparison and safely handles object-like job names', () => {
    write(['__proto__', 'a', 'Z', 'constructor'].map(job => ({ ...event, job })));
    expect(readNight(dir, night)!.rows.map(row => row.job)).toEqual(['Z', '__proto__', 'a', 'constructor']);
  });
});
