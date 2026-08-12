import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";

import { Pool } from "pg";

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
  await retentionTestPool.query(
    `
      INSERT INTO logs (
        "timestamp",
        level,
        service,
        message,
        attributes
      )
      VALUES (
        $1::timestamptz,
        'info',
        'retention-test',
        $2,
        '{}'::jsonb
      )
    `,
    [
      timestamp,
      message,
    ],
  );
}

beforeAll(async () => {
  await runMigrations(
    retentionTestPool,
  );
});

beforeEach(async () => {
  await retentionTestPool.query(
    "TRUNCATE TABLE logs RESTART IDENTITY",
  );
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

});