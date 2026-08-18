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

const DATE_BIN_ORIGIN =
  "TIMESTAMPTZ '1970-01-01 00:00:00+00'";

function getGroupExpression(
  query: AggregateQuery,
  tableAlias: string,
): string {
  if (query.groupBy === "service") {
    return `${tableAlias}.service`;
  }

  if (query.groupBy === "level") {
    return `${tableAlias}.level`;
  }

  return "NULL::text";
}

async function aggregateRawLogs(
  pool: Pool,
  query: AggregateQuery,
): Promise<AggregateDatabaseRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  values.push(query.since);

  conditions.push(
    `l."timestamp" >= $${values.length}::timestamptz`,
  );

  values.push(query.until);

  conditions.push(
    `l."timestamp" < $${values.length}::timestamptz`,
  );

  if (query.service !== undefined) {
    values.push(query.service);

    conditions.push(
      `l.service = $${values.length}`,
    );
  }

  if (query.level !== undefined) {
    values.push(query.level);

    conditions.push(
      `l.level = $${values.length}`,
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
      `l.attributes ->> ${keyPlaceholder}::text = ${valuePlaceholder}`,
    );
  }

  if (query.q !== undefined) {
    values.push(query.q);

    conditions.push(
      `STRPOS(
        LOWER(l.message),
        LOWER($${values.length})
      ) > 0`,
    );
  }

  const interval =
    BUCKET_INTERVALS[query.bucket];

  const bucketExpression = `
    date_bin(
      INTERVAL '${interval}',
      l."timestamp",
      ${DATE_BIN_ORIGIN}
    )
  `;

  const groupExpression =
    getGroupExpression(
      query,
      "l",
    );

  const sql = `
    SELECT
      ${bucketExpression}
        AS bucket_start,

      ${groupExpression}
        AS group_value,

      COUNT(*)::bigint
        AS count

    FROM logs l

    WHERE
      ${conditions.join(" AND ")}

    GROUP BY
      bucket_start,
      group_value

    ORDER BY
      bucket_start ASC,
      group_value ASC NULLS FIRST
  `;

  const result =
    await pool.query<AggregateDatabaseRow>(
      sql,
      values,
    );

  return result.rows;
}

function canUseRollup(
  query: AggregateQuery,
): boolean {
  if (query.q !== undefined) {
    return false;
  }

  if (
    Object.keys(
      query.attributes,
    ).length > 0
  ) {
    return false;
  }

  return true;
}

async function aggregateUsingRollup(
  pool: Pool,
  query: AggregateQuery,
): Promise<AggregateDatabaseRow[]> {
  const values: unknown[] = [
    query.since,
    query.until,
  ];

  const rollupConditions: string[] = [];
  const rawConditions: string[] = [];

  if (query.service !== undefined) {
    values.push(query.service);

    const placeholder =
      `$${values.length}`;

    rollupConditions.push(
      `r.service = ${placeholder}`,
    );

    rawConditions.push(
      `l.service = ${placeholder}`,
    );
  }

  if (query.level !== undefined) {
    values.push(query.level);

    const placeholder =
      `$${values.length}`;

    rollupConditions.push(
      `r.level = ${placeholder}`,
    );

    rawConditions.push(
      `l.level = ${placeholder}`,
    );
  }

  const rollupFilter =
    rollupConditions.length > 0
      ? `AND ${rollupConditions.join(
          " AND ",
        )}`
      : "";

  const rawFilter =
    rawConditions.length > 0
      ? `AND ${rawConditions.join(
          " AND ",
        )}`
      : "";

  const interval =
    BUCKET_INTERVALS[query.bucket];

  const rollupGroupExpression =
    getGroupExpression(
      query,
      "r",
    );

  const rawGroupExpression =
    getGroupExpression(
      query,
      "l",
    );

  const sql = `
    WITH bounds AS (
      SELECT
        $1::timestamptz
          AS since_ts,

        $2::timestamptz
          AS until_ts,

        CASE
          WHEN
            $1::timestamptz =
            date_trunc(
              'minute',
              $1::timestamptz
            )
          THEN
            date_trunc(
              'minute',
              $1::timestamptz
            )

          ELSE
            date_trunc(
              'minute',
              $1::timestamptz
            )
            + INTERVAL '1 minute'
        END
          AS full_start,

        date_trunc(
          'minute',
          $2::timestamptz
        )
          AS full_end
    ),

    rollup_source AS (
      SELECT
        date_bin(
          INTERVAL '${interval}',
          r.bucket_start,
          ${DATE_BIN_ORIGIN}
        )
          AS bucket_start,

        ${rollupGroupExpression}
          AS group_value,

        SUM(r.count)::bigint
          AS count

      FROM
        log_rollups_1m r

      CROSS JOIN bounds b

      WHERE
        b.full_start < b.full_end

        AND r.bucket_start >=
          b.full_start

        AND r.bucket_start <
          b.full_end

        ${rollupFilter}

      GROUP BY
        bucket_start,
        group_value
    ),

    raw_boundary_rows AS (
      SELECT
        l."timestamp",
        l.service,
        l.level
      FROM logs l
      CROSS JOIN bounds b
      WHERE
        b.full_start >= b.full_end
        AND l."timestamp" >= b.since_ts
        AND l."timestamp" < b.until_ts
        ${rawFilter}

      UNION ALL

      SELECT
        l."timestamp",
        l.service,
        l.level
      FROM logs l
      CROSS JOIN bounds b
      WHERE
        b.full_start < b.full_end
        AND l."timestamp" >= b.since_ts
        AND l."timestamp" < b.full_start
        ${rawFilter}

      UNION ALL

      SELECT
        l."timestamp",
        l.service,
        l.level
      FROM logs l
      CROSS JOIN bounds b
      WHERE
        b.full_start < b.full_end
        AND l."timestamp" >= b.full_end
        AND l."timestamp" < b.until_ts
        ${rawFilter}
    ),

    raw_boundary_source AS (
      SELECT
        date_bin(
          INTERVAL '${interval}',
          l."timestamp",
          ${DATE_BIN_ORIGIN}
        )
          AS bucket_start,

        ${rawGroupExpression}
          AS group_value,

        COUNT(*)::bigint
          AS count

      FROM raw_boundary_rows l

      GROUP BY
        bucket_start,
        group_value
    ),

    combined AS (
      SELECT
        bucket_start,
        group_value,
        count
      FROM rollup_source

      UNION ALL

      SELECT
        bucket_start,
        group_value,
        count
      FROM raw_boundary_source
    )

    SELECT
      bucket_start,
      group_value,
      SUM(count)::bigint
        AS count

    FROM combined

    GROUP BY
      bucket_start,
      group_value

    ORDER BY
      bucket_start ASC,
      group_value ASC NULLS FIRST
  `;

  const result =
    await pool.query<AggregateDatabaseRow>(
      sql,
      values,
    );

  return result.rows;
}

export async function aggregateLogs(
  pool: Pool,
  query: AggregateQuery,
): Promise<AggregateDatabaseRow[]> {
  if (!canUseRollup(query)) {
    return aggregateRawLogs(
      pool,
      query,
    );
  }

  return aggregateUsingRollup(
    pool,
    query,
  );
}