import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { NightDigest, RunStatus } from '../src/digest/types.js';

const night = '2026-10-28';
const firstAt = '2026-10-28T22:15:00+05:30';
const lastAt = '2026-10-29T03:45:00-04:00';

function event(job: string, status: RunStatus = 'ok', owner: string | null = 'reader', at = firstAt) {
  return JSON.stringify({ at, job, status, owner });
}

// Read server-rendered table rows, without requiring a browser or client JS.
function jobRow(html: string, job: string): string {
  const row = [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)]
    .map(([match]) => match)
    .find((match) => new RegExp(`<(?:td|th)\\b[^>]*>\\s*${job}\\s*</(?:td|th)>`).test(match));
  expect(row, `table row for ${job}`).toBeDefined();
  return row!;
}

describe('digest routes', () => {
  let runsDir: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
    app = createApp({ adapter: 'shim', installed: firstAt, beatEverySeconds: 60, runsDir });
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  function log(lines: string[]) {
    writeFileSync(join(runsDir, `${night}.jsonl`), lines.join('\n'));
  }

  it('serves HTML and the complete NightDigest JSON object for an existing night', async () => {
    log([event('alpha')]);
    const htmlResponse = await app.request(`/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    expect(htmlResponse.headers.get('content-type')).toContain('text/html');
    const html = await htmlResponse.text();
    expect(html).toContain('<!doctype html>');
    expect(html).toContain(night);
    expect(jobRow(html, 'alpha')).toContain('reader');
    expect(html).not.toMatch(/<script\b/i);

    const jsonResponse = await app.request(`/api/digest/${night}`);
    expect(jsonResponse.status).toBe(200);
    expect(jsonResponse.headers.get('content-type')).toContain('application/json');
    expect(await jsonResponse.json()).toEqual({
      rows: [{ job: 'alpha', owner: 'reader', runs: 1, retries: 0, lastStatus: 'ok',
        lastError: null, firstAt, lastAt: firstAt, hasFailed: false }],
      badLines: 0,
      counts: { ok: 1, retry: 0, fail: 0 },
    } satisfies NightDigest);
  });

  it.each(['/digest', '/api/digest'])('%s returns 404 for a missing night', async (route) => {
    expect((await app.request(`${route}/${night}`)).status).toBe(404);
  });

  it.each(['not-a-night', '2026-1-28', '2026-10-28.jsonl', '2026-10-28%2Fextra'])
    ('returns 404 for invalid night %s on both routes', async (invalid) => {
      for (const route of ['/digest', '/api/digest']) {
        expect((await app.request(`${route}/${invalid}`)).status).toBe(404);
      }
    });

  it.each(['', '\n  \n'])('renders nothing ran and an empty rows array for an empty/blank log (%j)', async (contents) => {
    log([contents]);
    const htmlResponse = await app.request(`/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    expect(await htmlResponse.text()).toMatch(/nothing ran/i);
    const jsonResponse = await app.request(`/api/digest/${night}`);
    expect(jsonResponse.status).toBe(200);
    expect(await jsonResponse.json()).toEqual({
      rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    } satisfies NightDigest);
  });

  it('counts malformed and invalid events without losing valid rows or counting blank lines', async () => {
    log([event('zulu'), '{broken', '', '  ', JSON.stringify({ job: 'invalid' }), event('alpha', 'retry'), '']);
    const response = await app.request(`/api/digest/${night}`);
    expect(response.status).toBe(200);
    const digest = await response.json() as NightDigest;
    expect(digest.badLines).toBe(2);
    expect(digest.counts).toEqual({ ok: 1, retry: 1, fail: 0 });
    expect(digest.rows.map((row) => row.job)).toEqual(['alpha', 'zulu']);
    const htmlResponse = await app.request(`/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    const html = await htmlResponse.text();
    jobRow(html, 'alpha');
    jobRow(html, 'zulu');
    expect(html).not.toContain('nothing ran');
  });

  it('keeps the same ascending job order in HTML and JSON, independently of log order', async () => {
    log([event('zulu'), event('middle'), event('alpha'), event('middle', 'retry')]);
    const jsonResponse = await app.request(`/api/digest/${night}`);
    expect(jsonResponse.status).toBe(200);
    const digest = await jsonResponse.json() as NightDigest;
    expect(digest.rows.map((row) => row.job)).toEqual(['alpha', 'middle', 'zulu']);
    const htmlResponse = await app.request(`/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    const html = await htmlResponse.text();
    const positions = digest.rows.map(({ job }) => html.indexOf(jobRow(html, job)));
    expect(positions[0]).toBeLessThan(positions[1]);
    expect(positions[1]).toBeLessThan(positions[2]);
  });

  it('retains a null owner and original timestamp offsets in both representations', async () => {
    log([event('alpha', 'retry'), event('alpha', 'ok', null, lastAt)]);
    const jsonResponse = await app.request(`/api/digest/${night}`);
    expect(jsonResponse.status).toBe(200);
    const digest = await jsonResponse.json() as NightDigest;
    expect(digest.rows).toHaveLength(1);
    expect(digest.rows[0]).toMatchObject({ owner: null, firstAt, lastAt, runs: 2, retries: 1 });
    const htmlResponse = await app.request(`/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    const row = jobRow(await htmlResponse.text(), 'alpha');
    expect(row).toMatch(/<td\b[^>]*>\s*—\s*<\/td>/);
    expect(row).toContain(firstAt);
    expect(row).toContain(lastAt);
  });

  it('highlights historical failures and three or more retries, even after recovery', async () => {
    log([
      event('recovered', 'fail'), event('recovered'),
      ...Array.from({ length: 3 }, () => event('three-retries', 'retry')), event('three-retries'),
      ...Array.from({ length: 4 }, () => event('four-retries', 'retry')), event('four-retries'),
      event('two-retries', 'retry'), event('two-retries', 'retry'), event('two-retries'),
      event('healthy'),
    ]);
    const jsonResponse = await app.request(`/api/digest/${night}`);
    expect(jsonResponse.status).toBe(200);
    const digest = await jsonResponse.json() as NightDigest;
    expect(digest.counts).toEqual({ ok: 5, retry: 9, fail: 1 });
    expect(digest.rows.find(({ job }) => job === 'recovered')).toMatchObject({ lastStatus: 'ok', hasFailed: true });
    const htmlResponse = await app.request(`/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    const html = await htmlResponse.text();
    // The shared layout's .warn class is the existing visual warning treatment.
    for (const job of ['recovered', 'three-retries', 'four-retries']) {
      expect(jobRow(html, job)).toMatch(/class="[^"]*\bwarn\b[^"]*"/);
    }
    for (const job of ['healthy', 'two-retries']) {
      expect(jobRow(html, job)).not.toMatch(/class="[^"]*\bwarn\b[^"]*"/);
    }
  });
});
