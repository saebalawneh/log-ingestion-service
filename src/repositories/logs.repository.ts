import type { Pool, PoolClient } from "pg";
import type {
  LogEntry,
  LogQuery,
  StoredLog,
} from "../types/logs.js";

const INSERT_CHUNK_SIZE = 1000;

async function insertChunk(
  client: PoolClient,
  logs: LogEntry[],
): Promise<void> {
  if (logs.length === 0) {
    return;
  }

  const values: unknown[] = [];

  const placeholders = logs.map((log, index) => {
    const base = index * 5;

    values.push(
      log.timestamp,
      log.level,
      log.service,
      log.message,
      JSON.stringify(log.attributes),
    );

    return `(
      $${base + 1}::timestamptz,
      $${base + 2},
      $${base + 3},
      $${base + 4},
      $${base + 5}::jsonb
    )`;
  });

  const query = `
    INSERT INTO logs (
      "timestamp",
      level,
      service,
      message,
      attributes
    )
    VALUES ${placeholders.join(",")}
  `;

  await client.query(query, values);
}

export async function insertLogs(
  pool: Pool,
  logs: LogEntry[],
): Promise<void> {
  if (logs.length === 0) {
    return;
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (let start = 0; start < logs.length; start += INSERT_CHUNK_SIZE) {
      const chunk = logs.slice(start, start + INSERT_CHUNK_SIZE);

      await insertChunk(client, chunk);
    }

    await client.query("COMMIT");
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}


export async function findLogs(
  pool: Pool,
  query: LogQuery,
): Promise<StoredLog[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (query.service !== undefined) {
    values.push(query.service);

    conditions.push(
      `service = $${values.length}`,
    );
  }

  if (query.level !== undefined) {
    values.push(query.level);

    conditions.push(
      `level = $${values.length}`,
    );
  }

  if (query.since !== undefined) {
    values.push(query.since);

    conditions.push(
      `"timestamp" >= $${values.length}::timestamptz`,
    );
  }

  if (query.until !== undefined) {
    values.push(query.until);

    conditions.push(
      `"timestamp" < $${values.length}::timestamptz`,
    );
  }

  for (const [key, value] of Object.entries(query.attributes)) {
    values.push(key);

    const keyPlaceholder = `$${values.length}`;

    values.push(value);

    const valuePlaceholder = `$${values.length}`;

    conditions.push(
      `attributes ->> ${keyPlaceholder}::text = ${valuePlaceholder}`,
    );
  }

  if (query.q !== undefined) {
    values.push(query.q);

    conditions.push(
      `STRPOS(LOWER(message), LOWER($${values.length})) > 0`,
    );
  }

  const whereClause =
    conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

  values.push(query.limit);

  const limitPlaceholder = `$${values.length}`;

  const sql = `
    SELECT
      id,
      "timestamp",
      level,
      service,
      message,
      attributes
    FROM logs
    ${whereClause}
    ORDER BY "timestamp" DESC, id DESC
    LIMIT ${limitPlaceholder}
  `;

  const result = await pool.query<StoredLog>(
    sql,
    values,
  );

  return result.rows;
}

