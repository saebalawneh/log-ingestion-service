import type { Pool } from "pg";

import {
  deleteLogsBefore,
} from "../repositories/retention.repository.js";

const DAY_MS =
  24 * 60 * 60 * 1000;

export type RetentionConfig = {
  retentionDays: number;
  batchSize: number;
};

export type RetentionSweepResult = {
  cutoff: string;
  deleted: number;
  batches: number;
};

export async function runRetentionSweep(
  pool: Pool,
  config: RetentionConfig,
  now: Date = new Date(),
): Promise<RetentionSweepResult> {
  const cutoff = new Date(
    now.getTime() -
      config.retentionDays * DAY_MS,
  );

  let deleted = 0;
  let batches = 0;

  while (true) {
    const deletedInBatch =
      await deleteLogsBefore(
        pool,
        cutoff,
        config.batchSize,
      );

    if (deletedInBatch === 0) {
      break;
    }

    deleted += deletedInBatch;
    batches += 1;

    if (deletedInBatch < config.batchSize) {
      break;
    }
  }

  return {
    cutoff: cutoff.toISOString(),
    deleted,
    batches,
  };
}