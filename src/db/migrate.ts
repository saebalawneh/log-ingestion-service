import type { Pool } from "pg";

const ROLLUP_BACKFILL_MIGRATION =
  "001_backfill_log_rollups_1m";

export async function runMigrations(
  pool: Pool,
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS logs (
        id BIGINT
          GENERATED ALWAYS AS IDENTITY
          PRIMARY KEY,

        timestamp TIMESTAMPTZ NOT NULL,
        level TEXT NOT NULL,
        service TEXT NOT NULL,
        message TEXT NOT NULL,

        attributes JSONB
          NOT NULL
          DEFAULT '{}'::jsonb,

        created_at TIMESTAMPTZ
          NOT NULL
          DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS
        idx_logs_timestamp_id
      ON logs (
        timestamp DESC,
        id DESC
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS
        log_rollups_1m (
          bucket_start TIMESTAMPTZ
            NOT NULL,

          service TEXT NOT NULL,
          level TEXT NOT NULL,

          count BIGINT
            NOT NULL
            CHECK (count >= 0),

          PRIMARY KEY (
            bucket_start,
            service,
            level
          )
        );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS
        schema_migrations (
          name TEXT PRIMARY KEY,

          applied_at TIMESTAMPTZ
            NOT NULL
            DEFAULT NOW()
        );
    `);

    const migrationResult =
      await client.query<{
        exists: boolean;
      }>(
        `
          SELECT EXISTS (
            SELECT 1
            FROM schema_migrations
            WHERE name = $1
          ) AS exists;
        `,
        [ROLLUP_BACKFILL_MIGRATION],
      );

    const alreadyBackfilled =
      migrationResult.rows[0]?.exists ??
      false;

    if (!alreadyBackfilled) {
      await client.query(`
        TRUNCATE TABLE
          log_rollups_1m;
      `);

      await client.query(`
        INSERT INTO log_rollups_1m (
          bucket_start,
          service,
          level,
          count
        )
        SELECT
          date_bin(
            INTERVAL '1 minute',
            "timestamp",
            TIMESTAMPTZ
              '1970-01-01 00:00:00+00'
          ) AS bucket_start,

          service,
          level,
          COUNT(*) AS count

        FROM logs

        GROUP BY
          bucket_start,
          service,
          level;
      `);

      await client.query(
        `
          INSERT INTO schema_migrations (
            name
          )
          VALUES ($1);
        `,
        [ROLLUP_BACKFILL_MIGRATION],
      );
    }

    await client.query("COMMIT");

    console.log(
      "Database migrations completed successfully",
    );
  } catch (error: unknown) {
    await client.query("ROLLBACK");

    throw error;
  } finally {
    client.release();
  }
}