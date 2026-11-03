export type RunStatus = 'ok' | 'retry' | 'fail';

/** Counts of valid log events, not jobs grouped by their final status. */
export type DigestCounts = Record<RunStatus, number>;

/** One job, aggregated in log-file order (not sorted by timestamp). */
export type DigestRow = {
  job: string;
  /** Owner on the last valid event, including an explicit null. */
  owner: string | null;
  /** All valid events for this job, including retries and failures. */
  runs: number;
  /** Number of events with status retry. */
  retries: number;
  lastStatus: RunStatus;
  /** Most recent supplied error; later events without an error do not clear it. */
  lastError: string | null;
  /** Original timestamp strings, preserving their offsets. */
  firstAt: string;
  lastAt: string;
  /** True if any event failed, even if the last status is ok. */
  hasFailed: boolean;
};

export type NightDigest = {
  /** One row per job, sorted ascending by job using string comparison. */
  rows: DigestRow[];
  /** Nonblank lines rejected by JSON parsing or event validation. */
  badLines: number;
  /** Totals across all valid events; sum equals the sum of row.runs. */
  counts: DigestCounts;
};

/**
 * Contract for the future reader export in src/digest/readNight.ts:
 *   export const readNight: ReadNight = ...
 *
 * Read runsDir/<night>.jsonl synchronously. A night is a YYYY-MM-DD basename;
 * reject other input with RangeError before accessing the filesystem.
 * Return null only for a missing file (ENOENT); propagate other I/O errors.
 * An empty/blank file returns { rows: [], badLines: 0,
 * counts: { ok: 0, retry: 0, fail: 0 } }, not null.
 *
 * A valid event is an object with a parseable, offset-bearing ISO timestamp
 * `at`, a nonempty string `job`, a RunStatus `status`, a string or null `owner`,
 * and an optional string `error`. Unknown fields are ignored. Invalid events
 * contribute only to badLines; blank lines (including a final newline) do not.
 * Row first/last values follow valid event order in the file. Mark a row when
 * retries >= 3 or hasFailed; do not infer failure only from lastStatus.
 *
 * This module exports types only, not a runtime reader implementation.
 */
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
