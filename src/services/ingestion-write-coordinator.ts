import type { Pool } from "pg";

import {
  insertLogs,
} from "../repositories/logs.repository.js";
import type {
  LogEntry,
} from "../types/logs.js";

const DEFAULT_WINDOW_MS = 2;
const DEFAULT_MAX_BATCH_LOGS = 1000;

type PendingWrite = {
  logs: LogEntry[];
  resolve: () => void;
  reject: (error: unknown) => void;
};

type PoolWriteState = {
  pending: PendingWrite[];
  timer: NodeJS.Timeout | undefined;
  flushing: boolean;
};

type LogWriter = (
  pool: Pool,
  logs: LogEntry[],
) => Promise<void>;

type CoordinatorOptions = {
  windowMs?: number;
  maxBatchLogs?: number;
};

export function createIngestionWriteCoordinator(
  writeLogs: LogWriter = insertLogs,
  options: CoordinatorOptions = {},
): (
  pool: Pool,
  logs: LogEntry[],
) => Promise<void> {
  const windowMs =
    options.windowMs ??
    DEFAULT_WINDOW_MS;

  const maxBatchLogs =
    options.maxBatchLogs ??
    DEFAULT_MAX_BATCH_LOGS;

  const states =
    new WeakMap<
      Pool,
      PoolWriteState
    >();

  function getState(
    pool: Pool,
  ): PoolWriteState {
    const existing =
      states.get(pool);

    if (existing !== undefined) {
      return existing;
    }

    const state: PoolWriteState = {
      pending: [],
      timer: undefined,
      flushing: false,
    };

    states.set(
      pool,
      state,
    );

    return state;
  }

  function takeNextBatch(
    state: PoolWriteState,
  ): PendingWrite[] {
    const batch: PendingWrite[] = [];

    let logCount = 0;

    while (
      state.pending.length > 0
    ) {
      const next =
        state.pending[0];

      if (next === undefined) {
        break;
      }

      if (
        batch.length > 0 &&
        logCount +
          next.logs.length >
          maxBatchLogs
      ) {
        break;
      }

      state.pending.shift();

      batch.push(next);

      logCount +=
        next.logs.length;

      if (
        logCount >=
        maxBatchLogs
      ) {
        break;
      }
    }

    return batch;
  }

  function scheduleFlush(
    pool: Pool,
    state: PoolWriteState,
  ): void {
    if (
      state.flushing ||
      state.timer !== undefined ||
      state.pending.length === 0
    ) {
      return;
    }

    state.timer =
      setTimeout(() => {
        state.timer = undefined;

        void flush(
          pool,
          state,
        );
      }, windowMs);
  }

  async function flush(
    pool: Pool,
    state: PoolWriteState,
  ): Promise<void> {
    if (
      state.flushing ||
      state.pending.length === 0
    ) {
      return;
    }

    const batch =
      takeNextBatch(state);

    if (batch.length === 0) {
      return;
    }

    const logs =
      batch.flatMap(
        (entry) =>
          entry.logs,
      );

    state.flushing = true;

    try {
      await writeLogs(
        pool,
        logs,
      );

      for (const entry of batch) {
        entry.resolve();
      }
    } catch (error: unknown) {
      for (const entry of batch) {
        entry.reject(error);
      }
    } finally {
      state.flushing = false;

      scheduleFlush(
        pool,
        state,
      );
    }
  }

  return (
    pool: Pool,
    logs: LogEntry[],
  ): Promise<void> => {
    if (logs.length === 0) {
      return Promise.resolve();
    }

    const state =
      getState(pool);

    return new Promise<void>(
      (resolve, reject) => {
        state.pending.push({
          logs,
          resolve,
          reject,
        });

        scheduleFlush(
          pool,
          state,
        );
      },
    );
  };
}

export const enqueueLogWrite =
  createIngestionWriteCoordinator();
