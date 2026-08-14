import type { Pool } from "pg";

import {
  afterEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

const {
  runRetentionSweepMock,
} = vi.hoisted(() => ({
  runRetentionSweepMock: vi.fn(),
}));

vi.mock(
  "../../src/services/retention.service.js",
  () => ({
    runRetentionSweep:
      runRetentionSweepMock,
  }),
);

vi.mock(
  "../../src/config/env.js",
  () => ({
    env: {
      retentionDays: 30,
      retentionBatchSize: 1000,
      retentionSweepIntervalMs: 60_000,
    },
  }),
);

import {
  startRetentionWorker,
} from "../../src/workers/retention.worker.js";

afterEach(() => {
  vi.useRealTimers();

  runRetentionSweepMock.mockReset();
});

describe(
  "retention worker",
  () => {
    test(
      "waits for an active sweep before stopping",
      async () => {
        let resolveSweep:
          | ((
              result: {
                deleted: number;
                batches: number;
              },
            ) => void)
          | undefined;

        runRetentionSweepMock
          .mockImplementationOnce(
            () =>
              new Promise(
                (resolve) => {
                  resolveSweep =
                    resolve;
                },
              ),
          );

        const stopWorker =
          startRetentionWorker(
            {} as Pool,
          );

        expect(
          runRetentionSweepMock,
        ).toHaveBeenCalledTimes(1);

        let stopped = false;

        const stopPromise =
          stopWorker().then(() => {
            stopped = true;
          });

        await Promise.resolve();

        expect(stopped).toBe(false);

        if (
          resolveSweep === undefined
        ) {
          throw new Error(
            "expected active retention sweep",
          );
        }

        resolveSweep({
          deleted: 0,
          batches: 0,
        });

        await stopPromise;

        expect(stopped).toBe(true);
      },
    );

    test(
      "does not schedule another sweep after stopping",
      async () => {
        vi.useFakeTimers();

        runRetentionSweepMock
          .mockResolvedValue({
            deleted: 0,
            batches: 0,
          });

        const stopWorker =
          startRetentionWorker(
            {} as Pool,
          );

        await Promise.resolve();
        await Promise.resolve();

        expect(
          runRetentionSweepMock,
        ).toHaveBeenCalledTimes(1);

        await stopWorker();

        await vi.advanceTimersByTimeAsync(
          120_000,
        );

        expect(
          runRetentionSweepMock,
        ).toHaveBeenCalledTimes(1);
      },
    );
  },
);