import type { Pool } from "pg";

import type {
  AggregateQuery,
} from "../types/logs.js";

type AggregateDatabaseRow = {
  bucket_start: Date;
  group_value: string | null;
  count: string;
};

const BUCKET_INTERVALS = {
  "1m": "1 minute",
  "5m": "5 minutes",
  "1h": "1 hour",
  "1d": "1 day",
} as const;

export async function aggregateLogs(
  pool: Pool,
  query: AggregateQuery,
): Promise<AggregateDatabaseRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  values.push(query.since);
  conditions.push(
    `"timestamp" >= $${values.length}::timestamptz`,
  );

  values.push(query.until);
  conditions.push(
    `"timestamp" < $${values.length}::timestamptz`,
  );

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

  const interval =
    BUCKET_INTERVALS[query.bucket];

  const bucketExpression = `
    date_bin(
      INTERVAL '${interval}',
      "timestamp",
      TIMESTAMPTZ '1970-01-01 00:00:00+00'
    )
  `;

  const groupExpression =
    query.groupBy === undefined
      ? "NULL::text"
      : query.groupBy;

  const groupByClause =
    query.groupBy === undefined
      ? "bucket_start"
      : `bucket_start, ${query.groupBy}`;

  const orderByClause =
    query.groupBy === undefined
      ? "bucket_start ASC"
      : `bucket_start ASC, ${query.groupBy} ASC`;

  const sql = `
    SELECT
      ${bucketExpression} AS bucket_start,
      ${groupExpression} AS group_value,
      COUNT(*) AS count
    FROM logs
    WHERE ${conditions.join(" AND ")}
    GROUP BY ${groupByClause}
    ORDER BY ${orderByClause}
  `;

  const result =
    await pool.query<AggregateDatabaseRow>(
      sql,
      values,
    );

  return result.rows;
}