import type {
  Pool,
  PoolClient,
} from "pg";

import type {
  LogEntry,
  LogQuery,
  StoredLog,
} from "../types/logs.js";

const INSERT_CHUNK_SIZE = 1000;
const ROLLUP_CHUNK_SIZE = 1000;

type RollupRow = {
  bucketStart: string;
  service: string;
  level: string;
  count: number;
};

function getMinuteBucket(
  timestamp: string,
): string {
  const milliseconds =
    new Date(timestamp).getTime();

  const minuteStart =
    Math.floor(
      milliseconds / 60_000,
    ) * 60_000;

  return new Date(
    minuteStart,
  ).toISOString();
}

function buildRollupRows(
  logs: LogEntry[],
): RollupRow[] {
  const counts =
    new Map<string, RollupRow>();

  for (const log of logs) {
    const bucketStart =
      getMinuteBucket(
        log.timestamp,
      );

    const key = JSON.stringify([
      bucketStart,
      log.service,
      log.level,
    ]);

    const existing =
      counts.get(key);

    if (existing !== undefined) {
      existing.count += 1;
      continue;
    }

    counts.set(key, {
      bucketStart,
      service: log.service,
      level: log.level,
      count: 1,
    });
  }

  const rows =
    [...counts.values()];

  rows.sort((a, b) => {
    if (a.bucketStart < b.bucketStart) {
      return -1;
    }

    if (a.bucketStart > b.bucketStart) {
      return 1;
    }

    if (a.service < b.service) {
      return -1;
    }

    if (a.service > b.service) {
      return 1;
    }

    if (a.level < b.level) {
      return -1;
    }

    if (a.level > b.level) {
      return 1;
    }

    return 0;
  });

  return rows;
}
async function insertChunk(
  client: PoolClient,
  logs: LogEntry[],
): Promise<void> {
  if (logs.length === 0) {
    return;
  }

  const values: unknown[] = [];

  const placeholders =
    logs.map((log, index) => {
      const base = index * 5;

      values.push(
        log.timestamp,
        log.level,
        log.service,
        log.message,
        JSON.stringify(
          log.attributes,
        ),
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

  await client.query(
    query,
    values,
  );
}

async function upsertRollupChunk(
  client: PoolClient,
  rows: RollupRow[],
): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const values: unknown[] = [];

  const placeholders =
    rows.map((row, index) => {
      const base = index * 4;

      values.push(
        row.bucketStart,
        row.service,
        row.level,
        row.count,
      );

      return `(
        $${base + 1}::timestamptz,
        $${base + 2},
        $${base + 3},
        $${base + 4}::bigint
      )`;
    });

  const query = `
    INSERT INTO log_rollups_1m (
      bucket_start,
      service,
      level,
      count
    )
    VALUES ${placeholders.join(",")}
    ON CONFLICT (
      bucket_start,
      service,
      level
    )
    DO UPDATE
    SET count =
      log_rollups_1m.count +
      EXCLUDED.count
  `;

  await client.query(
    query,
    values,
  );
}

async function insertLogsAndRollups(
  pool: Pool,
  logs: LogEntry[],
  rollupRows: RollupRow[],
): Promise<void> {
  const values: unknown[] = [];

  const logPlaceholders =
    logs.map((log) => {
      const base = values.length;

      values.push(
        log.timestamp,
        log.level,
        log.service,
        log.message,
        JSON.stringify(
          log.attributes,
        ),
      );

      return `(
        $${base + 1}::timestamptz,
        $${base + 2},
        $${base + 3},
        $${base + 4},
        $${base + 5}::jsonb
      )`;
    });

  const rollupPlaceholders =
    rollupRows.map((row) => {
      const base = values.length;

      values.push(
        row.bucketStart,
        row.service,
        row.level,
        row.count,
      );

      return `(
        $${base + 1}::timestamptz,
        $${base + 2},
        $${base + 3},
        $${base + 4}::bigint
      )`;
    });

  const query = `
    WITH inserted_logs AS (
      INSERT INTO logs (
        "timestamp",
        level,
        service,
        message,
        attributes
      )
      VALUES
        ${logPlaceholders.join(",")}
      RETURNING id
    ),

    updated_rollups AS (
      INSERT INTO log_rollups_1m (
        bucket_start,
        service,
        level,
        count
      )
      VALUES
        ${rollupPlaceholders.join(",")}

      ON CONFLICT (
        bucket_start,
        service,
        level
      )
      DO UPDATE
      SET count =
        log_rollups_1m.count +
        EXCLUDED.count

      RETURNING bucket_start
    )

    SELECT
      (SELECT COUNT(*)
       FROM inserted_logs)
        AS inserted_count,

      (SELECT COUNT(*)
       FROM updated_rollups)
        AS rollup_count
  `;

  await pool.query(
    query,
    values,
  );
}

export async function insertLogs(
  pool: Pool,
  logs: LogEntry[],
): Promise<void> {
  if (logs.length === 0) {
    return;
  }

  const rollupRows =
    buildRollupRows(logs);

    if (
    logs.length <= INSERT_CHUNK_SIZE &&
    rollupRows.length <=
      ROLLUP_CHUNK_SIZE
  ) {
    await insertLogsAndRollups(
      pool,
      logs,
      rollupRows,
    );

    return;
  }
  
  const client =
    await pool.connect();

  try {
    await client.query("BEGIN");

    for (
      let start = 0;
      start < logs.length;
      start += INSERT_CHUNK_SIZE
    ) {
      const chunk = logs.slice(
        start,
        start + INSERT_CHUNK_SIZE,
      );

      await insertChunk(
        client,
        chunk,
      );
    }

    for (
      let start = 0;
      start < rollupRows.length;
      start += ROLLUP_CHUNK_SIZE
    ) {
      const chunk =
        rollupRows.slice(
          start,
          start +
            ROLLUP_CHUNK_SIZE,
        );

      await upsertRollupChunk(
        client,
        chunk,
      );
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

  for (
    const [key, value] of
    Object.entries(query.attributes)
  ) {
    values.push(key);

    const keyPlaceholder =
      `$${values.length}`;

    values.push(value);

    const valuePlaceholder =
      `$${values.length}`;

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

  if (query.cursor !== undefined) {
    values.push(
      query.cursor.timestamp,
    );

    const timestampPlaceholder =
      `$${values.length}`;

    values.push(
      query.cursor.id,
    );

    const idPlaceholder =
      `$${values.length}`;

    conditions.push(`
      (
        "timestamp" < ${timestampPlaceholder}::timestamptz
        OR (
          "timestamp" = ${timestampPlaceholder}::timestamptz
          AND id < ${idPlaceholder}::bigint
        )
      )
    `);
  }

  const whereClause =
    conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

  values.push(
    query.limit + 1,
  );

  const limitPlaceholder =
    `$${values.length}`;

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

  const result =
    await pool.query<StoredLog>(
      sql,
      values,
    );

  return result.rows;
}