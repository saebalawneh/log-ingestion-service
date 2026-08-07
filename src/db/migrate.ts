import type { Pool } from "pg";

export async function runMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS logs (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        timestamp TIMESTAMPTZ NOT NULL,
        level TEXT NOT NULL,
        service TEXT NOT NULL,
        message TEXT NOT NULL,
        attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_logs_timestamp_id
      ON logs (timestamp DESC, id DESC);
    `);

    await client.query("COMMIT");

    console.log("Database migrations completed successfully");
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}