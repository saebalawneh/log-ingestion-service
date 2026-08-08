import type { Pool, PoolClient } from "pg";
import type { LogEntry } from "../types/logs.js";

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