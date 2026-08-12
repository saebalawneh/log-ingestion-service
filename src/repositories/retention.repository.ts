import type { Pool } from "pg";

export async function deleteLogsBefore(
  pool: Pool,
  cutoff: Date,
  batchSize: number,
): Promise<number> {
  const result = await pool.query(
    `
      WITH expired_logs AS (
        SELECT id
        FROM logs
        WHERE "timestamp" < $1::timestamptz
        ORDER BY "timestamp" ASC, id ASC
        LIMIT $2
      )
      DELETE FROM logs
      USING expired_logs
      WHERE logs.id = expired_logs.id
    `,
    [
      cutoff.toISOString(),
      batchSize,
    ],
  );

  return result.rowCount ?? 0;
}