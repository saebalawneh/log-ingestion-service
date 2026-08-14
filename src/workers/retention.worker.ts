import type { Pool } from "pg";

import { env } from "../config/env.js";
import {
  runRetentionSweep,
} from "../services/retention.service.js";

export function startRetentionWorker(
  pool: Pool,
): () => Promise<void> {
  let stopped = false;

  let timer:
    | NodeJS.Timeout
    | undefined;

  let activeRun:
    | Promise<void>
    | undefined;

  async function run(): Promise<void> {
    if (stopped) {
      return;
    }

    try {
      const result =
        await runRetentionSweep(pool, {
          retentionDays:
            env.retentionDays,
          batchSize:
            env.retentionBatchSize,
        });

      if (result.deleted > 0) {
        console.log(
          `Retention sweep deleted ${result.deleted} logs in ${result.batches} batch(es)`,
        );
      }
    } catch (error: unknown) {
      console.error(
        "Retention sweep failed",
        error,
      );
    } finally {
      if (!stopped) {
        timer = setTimeout(
          () => {
            activeRun = run();
          },
          env.retentionSweepIntervalMs,
        );
      }
    }
  }

  activeRun = run();

  return async (): Promise<void> => {
    stopped = true;

    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }

    if (activeRun !== undefined) {
      await activeRun;
    }
  };
}