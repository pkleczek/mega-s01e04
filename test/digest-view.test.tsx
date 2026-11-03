import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { DigestRow, NightDigest } from '../src/digest/types.js';
import { Digest } from '../src/views/digest.js';

const row: DigestRow = {
  job: 'alpha', owner: null, runs: 4, retries: 3, lastStatus: 'ok', lastError: null,
  firstAt: '2026-10-28T01:00:00+02:00', lastAt: '2026-10-28T03:00:00+01:00', hasFailed: false,
};

async function render(digest: NightDigest) {
  const app = new Hono();
  app.get('/', (c) => c.html(<Digest night="2026-10-28" digest={digest} />));
  return (await app.request('/')).text();
}

describe('digest view', () => {
  it('shows all fields, missing values, original offsets and sorted, highlighted jobs', async () => {
    const html = await render({
      rows: [
        { ...row, job: 'zeta', retries: 0, hasFailed: true, lastError: '<failed>' },
        row,
        { ...row, job: 'beta', retries: 2 },
      ],
      counts: { ok: 3, retry: 5, fail: 1 }, badLines: 2,
    });
    expect(html.indexOf('alpha')).toBeLessThan(html.indexOf('beta'));
    expect(html.indexOf('beta')).toBeLessThan(html.indexOf('zeta'));
    expect(html.match(/<tr class="warn">/g)).toHaveLength(2);
    expect(html).toContain('<td>—</td>');
    expect(html).toContain('<td>4</td><td>3</td><td>ok</td>');
    expect(html).toContain(row.firstAt);
    expect(html).toContain(row.lastAt);
    expect(html).toContain('&lt;failed&gt;');
    expect(html).toContain('<td>yes</td>');
    expect(html).toContain('bad lines: 2');
    expect(html).toContain('ok: 3 · retry: 5 · fail: 1');
  });

  it('shows an empty night without dropping its counts', async () => {
    const html = await render({ rows: [], counts: { ok: 0, retry: 0, fail: 0 }, badLines: 0 });
    expect(html).toContain('nothing ran');
    expect(html).toContain('bad lines: 0');
    expect(html).not.toContain('<table>');
  });
});
