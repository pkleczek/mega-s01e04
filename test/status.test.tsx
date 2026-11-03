import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReadNight } from '../src/digest/types.js';
import { createApp } from '../src/app.js';

const { readNight } = vi.hoisted(() => ({ readNight: vi.fn<ReadNight>() }));
vi.mock('../src/digest/readNight.js', () => ({ readNight }));

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' };

describe('status board', () => {
  let runsDir: string;

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-board-'));
    readNight.mockReset();
    readNight.mockReturnValue({ rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
    delete process.env.LANE_MARKER;
  });

  it('shows the lane banner and the nights on disk', async () => {
    process.env.LANE_MARKER = 'TEST-MARKER';
    const res = await createApp(config).request('/');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('TEST-MARKER');
    expect(html).toContain('2026-10-28');
  });

  it('health answers with the lane id', async () => {
    const res = await createApp(config).request('/health');
    expect(await res.json()).toEqual({ ok: true, lane: 'lane-07' });
  });

  it('links every night newest first with valid-event counts, including empty nights', async () => {
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), 'reader handles the contents');
    writeFileSync(join(runsDir, '2026-10-29.jsonl'), '');
    writeFileSync(join(runsDir, 'notes.txt'), 'not a night');
    mkdirSync(join(runsDir, '2026-10-30.jsonl'));
    readNight.mockImplementation((_dir, night) => ({
      rows: [], badLines: night === '2026-10-28' ? 1 : 0,
      counts: night === '2026-10-28' ? { ok: 7, retry: 4, fail: 2 } : { ok: 0, retry: 0, fail: 0 },
    }));

    const res = await createApp({ ...config, runsDir }).request('/');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a> · ok 7 / retry 4 / fail 2');
    expect(html).toContain('<a href="/digest/2026-10-29">2026-10-29</a> · ok 0 / retry 0 / fail 0');
    expect(html.indexOf('/digest/2026-10-29')).toBeLessThan(html.indexOf('/digest/2026-10-28'));
    expect(html).not.toContain('2026-10-30');
    expect(html).not.toContain('<script');
    expect(readNight.mock.calls).toEqual([[runsDir, '2026-10-29'], [runsDir, '2026-10-28']]);
  });

  it('renders an empty board when the runs directory is missing', async () => {
    const res = await createApp({ ...config, runsDir: join(runsDir, 'missing') }).request('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing in runs/');
    expect(readNight).not.toHaveBeenCalled();
  });

  it('shows missing counts if a file disappears after listing', async () => {
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), '');
    readNight.mockReturnValue(null);
    const res = await createApp({ ...config, runsDir }).request('/');
    expect(await res.text()).toContain('ok — / retry — / fail —');
  });
});
