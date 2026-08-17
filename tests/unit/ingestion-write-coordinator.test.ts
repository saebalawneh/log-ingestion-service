import type { Pool } from "pg";

import {
  afterEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

import {
  createIngestionWriteCoordinator,
} from "../../src/services/ingestion-write-coordinator.js";
import type {
  LogEntry,
} from "../../src/types/logs.js";

function createLog(
  service: string,
): LogEntry {
  return {
    timestamp:
      "2026-08-17T20:00:00.000Z",
    level: "info",
    service,
    message: "test log",
    attributes: {},
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe(
  "ingestion write coordinator",
  () => {
    test(
      "coalesces concurrent writes into one database write",
      async () => {
        vi.useFakeTimers();

        const pool =
          {} as Pool;

        const writeLogs =
          vi.fn(
            async (
              _pool: Pool,
              _logs: LogEntry[],
            ): Promise<void> => {},
          );

        const enqueue =
          createIngestionWriteCoordinator(
            writeLogs,
            {
              windowMs: 2,
              maxBatchLogs: 1000,
            },
          );

        const first =
          enqueue(
            pool,
            [createLog("api")],
          );

        const second =
          enqueue(
            pool,
            [createLog("auth")],
          );

        expect(
          writeLogs,
        ).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(
          2,
        );

        await Promise.all([
          first,
          second,
        ]);

        expect(
          writeLogs,
        ).toHaveBeenCalledTimes(1);

        const mergedLogs =
          writeLogs.mock.calls[0]?.[1];

        expect(
          mergedLogs,
        ).toHaveLength(2);
      },
    );

    test(
      "does not resolve a request before the database write completes",
      async () => {
        vi.useFakeTimers();

        const pool =
          {} as Pool;

        let finishWrite:
          | (() => void)
          | undefined;

        const writeLogs =
          vi.fn(
            (
              _pool: Pool,
              _logs: LogEntry[],
            ) =>
              new Promise<void>(
                (resolve) => {
                  finishWrite =
                    resolve;
                },
              ),
          );

        const enqueue =
          createIngestionWriteCoordinator(
            writeLogs,
            {
              windowMs: 2,
            },
          );

        const pending =
          enqueue(
            pool,
            [createLog("api")],
          );

        await vi.advanceTimersByTimeAsync(
          2,
        );

        let resolved = false;

        void pending.then(() => {
          resolved = true;
        });

        await Promise.resolve();

        expect(
          resolved,
        ).toBe(false);

        if (
          finishWrite === undefined
        ) {
          throw new Error(
            "expected database write to start",
          );
        }

        finishWrite();

        await pending;

        expect(
          resolved,
        ).toBe(true);
      },
    );

    test(
      "rejects requests when the database write fails",
      async () => {
        vi.useFakeTimers();

        const pool =
          {} as Pool;

        const writeLogs =
          vi.fn(
            async (): Promise<void> => {
              throw new Error(
                "database write failed",
              );
            },
          );

        const enqueue =
          createIngestionWriteCoordinator(
            writeLogs,
            {
              windowMs: 2,
            },
          );

        const pending =
          enqueue(
            pool,
            [createLog("api")],
          );

        const expectation =
          expect(
            pending,
          ).rejects.toThrow(
            "database write failed",
          );

        await vi.advanceTimersByTimeAsync(
          2,
        );

        await expectation;
      },
    );

    test(
      "keeps batches under the configured log limit",
      async () => {
        vi.useFakeTimers();

        const pool =
          {} as Pool;

        const writeLogs =
          vi.fn(
            async (
              _pool: Pool,
              _logs: LogEntry[],
            ): Promise<void> => {},
          );

        const enqueue =
          createIngestionWriteCoordinator(
            writeLogs,
            {
              windowMs: 2,
              maxBatchLogs: 2,
            },
          );

        const writes = [
          enqueue(
            pool,
            [createLog("api")],
          ),
          enqueue(
            pool,
            [createLog("auth")],
          ),
          enqueue(
            pool,
            [createLog("worker")],
          ),
        ];

        await vi.advanceTimersByTimeAsync(
          4,
        );

        await Promise.all(writes);

        expect(
          writeLogs,
        ).toHaveBeenCalledTimes(2);

        expect(
          writeLogs.mock.calls[0]?.[1],
        ).toHaveLength(2);

        expect(
          writeLogs.mock.calls[1]?.[1],
        ).toHaveLength(1);
      },
    );
  },
);
