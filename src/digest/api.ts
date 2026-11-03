import { Hono } from 'hono';
import { readNight } from './readNight.js';
import type { NightDigest } from './types.js';

export function createDigestApi(runsDir: string) {
  const app = new Hono();

  app.get('/:night', (c) => {
    let digest: NightDigest | null;
    try {
      digest = readNight(runsDir, c.req.param('night'));
    } catch (error) {
      if (error instanceof RangeError) return c.notFound();
      throw error;
    }

    if (digest === null) return c.notFound();
    return c.json(digest);
  });

  return app;
}
