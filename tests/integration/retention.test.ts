import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";

import { Pool } from "pg";

import {
  insertLogs,
} from "../../src/repositories/logs.repository.js";

import { runMigrations } from "../../src/db/migrate.js";
import {
  runRetentionSweep,
} from "../../src/services/retention.service.js";

const retentionTestPool =
  new Pool({
    connectionString:
      "postgresql://postgres:postgres@localhost:5433/logs_test_db",
    max: 5,
  });

async function seedLog(
  timestamp: string,
  message: string,
): Promise<void> {
  await insertLogs(
    retentionTestPool,
    [
      {
        timestamp,
        level: "info",
        service:
          "retention-test",
        message,
        attributes: {},
      },
    ],
  );
}

beforeAll(async () => {
  await runMigrations(
    retentionTestPool,
  );
});

beforeEach(async () => {
  await retentionTestPool.query(`
    TRUNCATE TABLE
      logs,
      log_rollups_1m
    RESTART IDENTITY;
  `);
});

afterAll(async () => {
  await retentionTestPool.end();
});

describe("retention", () => {
  test(
    "deletes expired logs and keeps fresh logs",
    async () => {
      const now = new Date(
        "2026-08-12T12:00:00.000Z",
      );

      await seedLog(
        "2026-08-01T12:00:00.000Z",
        "very old",
      );

      await seedLog(
        "2026-08-04T12:00:00.000Z",
        "expired",
      );

      await seedLog(
        "2026-08-10T12:00:00.000Z",
        "fresh",
      );

      const result =
        await runRetentionSweep(
          retentionTestPool,
          {
            retentionDays: 7,
            batchSize: 100,
          },
          now,
        );

      expect(result.deleted).toBe(2);

      const remaining =
        await retentionTestPool.query<{
          message: string;
        }>(
          `
            SELECT message
            FROM logs
            ORDER BY id
          `,
        );

      expect(
        remaining.rows.map(
          (row) => row.message,
        ),
      ).toEqual([
        "fresh",
      ]);
    },
  );

  test(
    "keeps a log exactly at the retention cutoff",
    async () => {
      const now = new Date(
        "2026-08-12T12:00:00.000Z",
      );

      await seedLog(
        "2026-08-05T12:00:00.000Z",
        "exact boundary",
      );

      const result =
        await runRetentionSweep(
          retentionTestPool,
          {
            retentionDays: 7,
            batchSize: 100,
          },
          now,
        );

      expect(result.deleted).toBe(0);

      const count =
        await retentionTestPool.query<{
          count: string;
        }>(
          "SELECT COUNT(*) AS count FROM logs",
        );

      expect(
        Number(count.rows[0]?.count),
      ).toBe(1);
    },
  );

  test(
    "deletes expired logs across multiple batches",
    async () => {
      const now = new Date(
        "2026-08-12T12:00:00.000Z",
      );

      await seedLog(
        "2026-08-01T10:00:00.000Z",
        "old 1",
      );

      await seedLog(
        "2026-08-01T11:00:00.000Z",
        "old 2",
      );

      await seedLog(
        "2026-08-01T12:00:00.000Z",
        "old 3",
      );

      await seedLog(
        "2026-08-01T13:00:00.000Z",
        "old 4",
      );

      await seedLog(
        "2026-08-01T14:00:00.000Z",
        "old 5",
      );

      const result =
        await runRetentionSweep(
          retentionTestPool,
          {
            retentionDays: 7,
            batchSize: 2,
          },
          now,
        );

      expect(result.deleted).toBe(5);
      expect(result.batches).toBe(3);

      const count =
        await retentionTestPool.query<{
          count: string;
        }>(
          "SELECT COUNT(*) AS count FROM logs",
        );

      expect(
        Number(count.rows[0]?.count),
      ).toBe(0);
    },
  );

  test(
    "does nothing when there are no expired logs",
    async () => {
      const now = new Date(
        "2026-08-12T12:00:00.000Z",
      );

      await seedLog(
        "2026-08-11T12:00:00.000Z",
        "fresh",
      );

      const result =
        await runRetentionSweep(
          retentionTestPool,
          {
            retentionDays: 7,
            batchSize: 2,
          },
          now,
        );

      expect(result.deleted).toBe(0);
      expect(result.batches).toBe(0);
    },
  );

  test(
  "deletes only logs strictly older than the cutoff",
  async () => {
    const now = new Date(
      "2026-08-12T12:00:00.000Z",
    );

    await seedLog(
      "2026-08-05T11:59:59.999Z",
      "just expired",
    );

    await seedLog(
      "2026-08-05T12:00:00.000Z",
      "exact cutoff",
    );

    await seedLog(
      "2026-08-05T12:00:00.001Z",
      "just fresh",
    );

    const result =
      await runRetentionSweep(
        retentionTestPool,
        {
          retentionDays: 7,
          batchSize: 10,
        },
        now,
      );

    expect(result.deleted).toBe(1);

    const remaining =
      await retentionTestPool.query<{
        message: string;
      }>(
        `
          SELECT message
          FROM logs
          ORDER BY id
        `,
      );

    expect(
      remaining.rows.map(
        (row) => row.message,
      ),
    ).toEqual([
      "exact cutoff",
      "just fresh",
    ]);
  },
);

test(
  "decrements a rollup when only part of its minute is expired",
  async () => {
    const now = new Date(
      "2026-08-12T12:00:30.000Z",
    );

    await seedLog(
      "2026-08-05T12:00:10.000Z",
      "expired in minute",
    );

    await seedLog(
      "2026-08-05T12:00:40.000Z",
      "fresh in same minute",
    );

    const before =
      await retentionTestPool.query<{
        count: string;
      }>(
        `
          SELECT count
          FROM log_rollups_1m
          WHERE
            bucket_start =
              '2026-08-05T12:00:00.000Z'
              ::timestamptz
            AND service =
              'retention-test'
            AND level = 'info'
        `,
      );

    expect(
      Number(
        before.rows[0]?.count,
      ),
    ).toBe(2);

    const result =
      await runRetentionSweep(
        retentionTestPool,
        {
          retentionDays: 7,
          batchSize: 100,
        },
        now,
      );

    expect(result.deleted).toBe(1);

    const after =
      await retentionTestPool.query<{
        count: string;
      }>(
        `
          SELECT count
          FROM log_rollups_1m
          WHERE
            bucket_start =
              '2026-08-05T12:00:00.000Z'
              ::timestamptz
            AND service =
              'retention-test'
            AND level = 'info'
        `,
      );

    expect(
      Number(
        after.rows[0]?.count,
      ),
    ).toBe(1);

    const remaining =
      await retentionTestPool.query<{
        message: string;
      }>(
        `
          SELECT message
          FROM logs
          ORDER BY id
        `,
      );

    expect(
      remaining.rows.map(
        (row) => row.message,
      ),
    ).toEqual([
      "fresh in same minute",
    ]);
  },
);

test(
  "removes a rollup row when its final raw log expires",
  async () => {
    const now = new Date(
      "2026-08-12T12:00:30.000Z",
    );

    await seedLog(
      "2026-08-05T12:00:10.000Z",
      "only expired log",
    );

    const result =
      await runRetentionSweep(
        retentionTestPool,
        {
          retentionDays: 7,
          batchSize: 100,
        },
        now,
      );

    expect(result.deleted).toBe(1);

    const rawCount =
      await retentionTestPool.query<{
        count: string;
      }>(
        `
          SELECT COUNT(*) AS count
          FROM logs
        `,
      );

    expect(
      Number(
        rawCount.rows[0]?.count,
      ),
    ).toBe(0);

    const rollupCount =
      await retentionTestPool.query<{
        count: string;
      }>(
        `
          SELECT COUNT(*) AS count
          FROM log_rollups_1m
        `,
      );

    expect(
      Number(
        rollupCount.rows[0]?.count,
      ),
    ).toBe(0);
  },
);

test(
  "rolls back raw deletion when rollup consistency is broken",
  async () => {
    const now = new Date(
      "2026-08-12T12:00:00.000Z",
    );

    await seedLog(
      "2026-08-01T12:00:00.000Z",
      "must survive rollback",
    );

    await retentionTestPool.query(
      `
        DELETE FROM
          log_rollups_1m
      `,
    );

    await expect(
      runRetentionSweep(
        retentionTestPool,
        {
          retentionDays: 7,
          batchSize: 100,
        },
        now,
      ),
    ).rejects.toThrow(
      "retention rollup inconsistency",
    );

    const remaining =
      await retentionTestPool.query<{
        message: string;
      }>(
        `
          SELECT message
          FROM logs
        `,
      );

    expect(
      remaining.rows.map(
        (row) => row.message,
      ),
    ).toEqual([
      "must survive rollback",
    ]);
  },
);

test(
  "keeps raw and rollup counts consistent across retention batches",
  async () => {
    const now = new Date(
      "2026-08-12T12:00:30.000Z",
    );

    await seedLog(
      "2026-08-01T10:00:00.000Z",
      "old one",
    );

    await seedLog(
      "2026-08-01T11:00:00.000Z",
      "old two",
    );

    await seedLog(
      "2026-08-05T12:00:10.000Z",
      "old three",
    );

    await seedLog(
      "2026-08-05T12:00:40.000Z",
      "fresh one",
    );

    await seedLog(
      "2026-08-10T12:00:00.000Z",
      "fresh two",
    );

    const result =
      await runRetentionSweep(
        retentionTestPool,
        {
          retentionDays: 7,
          batchSize: 2,
        },
        now,
      );

    expect(result.deleted).toBe(3);
    expect(result.batches).toBe(2);

    const counts =
      await retentionTestPool.query<{
        raw_count: string;
        rollup_count: string;
      }>(
        `
          SELECT
            (
              SELECT COUNT(*)
              FROM logs
            ) AS raw_count,

            (
              SELECT
                COALESCE(
                  SUM(count),
                  0
                )
              FROM log_rollups_1m
            ) AS rollup_count
        `,
      );

    expect(
      Number(
        counts.rows[0]
          ?.raw_count,
      ),
    ).toBe(2);

    expect(
      Number(
        counts.rows[0]
          ?.rollup_count,
      ),
    ).toBe(2);
  },
);


});