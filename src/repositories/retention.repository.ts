import type {
  Pool,
  PoolClient,
} from "pg";

type ExpiredLogRow = {
  id: string;
  timestamp: Date;
  service: string;
  level: string;
};

type RollupAdjustment = {
  bucketStart: string;
  service: string;
  level: string;
  decrement: number;
};

type LockedRollupRow = {
  bucket_start: Date;
  service: string;
  level: string;
  count: string;
};

function getMinuteBucket(
  timestamp: Date,
): string {
  const milliseconds =
    timestamp.getTime();

  const minuteStart =
    Math.floor(
      milliseconds / 60_000,
    ) * 60_000;

  return new Date(
    minuteStart,
  ).toISOString();
}

function getRollupKey(
  bucketStart: string,
  service: string,
  level: string,
): string {
  return JSON.stringify([
    bucketStart,
    service,
    level,
  ]);
}

function buildRollupAdjustments(
  rows: ExpiredLogRow[],
): RollupAdjustment[] {
  const adjustments =
    new Map<
      string,
      RollupAdjustment
    >();

  for (const row of rows) {
    const bucketStart =
      getMinuteBucket(
        row.timestamp,
      );

    const key =
      getRollupKey(
        bucketStart,
        row.service,
        row.level,
      );

    const existing =
      adjustments.get(key);

    if (existing !== undefined) {
      existing.decrement += 1;
      continue;
    }

    adjustments.set(key, {
      bucketStart,
      service: row.service,
      level: row.level,
      decrement: 1,
    });
  }

  const result =
    [...adjustments.values()];

  result.sort((a, b) => {
    if (
      a.bucketStart <
      b.bucketStart
    ) {
      return -1;
    }

    if (
      a.bucketStart >
      b.bucketStart
    ) {
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

  return result;
}

function buildAdjustmentValues(
  adjustments: RollupAdjustment[],
): {
  placeholders: string[];
  values: unknown[];
} {
  const values: unknown[] = [];

  const placeholders =
    adjustments.map(
      (adjustment, index) => {
        const base = index * 4;

        values.push(
          adjustment.bucketStart,
          adjustment.service,
          adjustment.level,
          adjustment.decrement,
        );

        return `(
          $${base + 1}::timestamptz,
          $${base + 2}::text,
          $${base + 3}::text,
          $${base + 4}::bigint
        )`;
      },
    );

  return {
    placeholders,
    values,
  };
}

async function selectExpiredLogs(
  client: PoolClient,
  cutoff: Date,
  batchSize: number,
): Promise<ExpiredLogRow[]> {
  const result =
    await client.query<ExpiredLogRow>(
      `
        SELECT
          id,
          "timestamp",
          service,
          level
        FROM logs
        WHERE
          "timestamp" <
          $1::timestamptz
        ORDER BY
          "timestamp" ASC,
          id ASC
        LIMIT $2
        FOR UPDATE
        SKIP LOCKED
      `,
      [
        cutoff.toISOString(),
        batchSize,
      ],
    );

  return result.rows;
}

async function lockAndValidateRollups(
  client: PoolClient,
  adjustments: RollupAdjustment[],
): Promise<void> {
  if (adjustments.length === 0) {
    return;
  }

  const {
    placeholders,
    values,
  } =
    buildAdjustmentValues(
      adjustments,
    );

  const result =
    await client.query<LockedRollupRow>(
      `
        WITH requested (
          bucket_start,
          service,
          level,
          decrement_by
        ) AS (
          VALUES
            ${placeholders.join(",")}
        )

        SELECT
          r.bucket_start,
          r.service,
          r.level,
          r.count
        FROM log_rollups_1m r
        INNER JOIN requested d
          ON
            r.bucket_start =
              d.bucket_start
            AND r.service =
              d.service
            AND r.level =
              d.level
        ORDER BY
          r.bucket_start ASC,
          r.service ASC,
          r.level ASC
        FOR UPDATE OF r
      `,
      values,
    );

  const locked =
    new Map<string, string>();

  for (const row of result.rows) {
    const key =
      getRollupKey(
        row.bucket_start.toISOString(),
        row.service,
        row.level,
      );

    locked.set(
      key,
      row.count,
    );
  }

  for (
    const adjustment
    of adjustments
  ) {
    const key =
      getRollupKey(
        adjustment.bucketStart,
        adjustment.service,
        adjustment.level,
      );

    const currentCount =
      locked.get(key);

    if (
      currentCount === undefined
    ) {
      throw new Error(
        "retention rollup inconsistency: missing rollup row",
      );
    }

    if (
      BigInt(currentCount) <
      BigInt(
        adjustment.decrement,
      )
    ) {
      throw new Error(
        "retention rollup inconsistency: decrement exceeds rollup count",
      );
    }
  }
}

async function deleteRawLogs(
  client: PoolClient,
  rows: ExpiredLogRow[],
): Promise<void> {
  const ids =
    rows.map(
      (row) => row.id,
    );

  const result =
    await client.query(
      `
        DELETE FROM logs
        WHERE id =
          ANY($1::bigint[])
      `,
      [ids],
    );

  if (
    (result.rowCount ?? 0) !==
    rows.length
  ) {
    throw new Error(
      "retention delete inconsistency: raw delete count mismatch",
    );
  }
}

async function decrementRollups(
  client: PoolClient,
  adjustments: RollupAdjustment[],
): Promise<void> {
  if (adjustments.length === 0) {
    return;
  }

  const {
    placeholders,
    values,
  } =
    buildAdjustmentValues(
      adjustments,
    );

  const result =
    await client.query(
      `
        WITH decrements (
          bucket_start,
          service,
          level,
          decrement_by
        ) AS (
          VALUES
            ${placeholders.join(",")}
        )

        UPDATE log_rollups_1m r
        SET
          count =
            r.count -
            d.decrement_by
        FROM decrements d
        WHERE
          r.bucket_start =
            d.bucket_start
          AND r.service =
            d.service
          AND r.level =
            d.level
      `,
      values,
    );

  if (
    (result.rowCount ?? 0) !==
    adjustments.length
  ) {
    throw new Error(
      "retention rollup inconsistency: update count mismatch",
    );
  }
}

async function deleteEmptyRollups(
  client: PoolClient,
  adjustments: RollupAdjustment[],
): Promise<void> {
  if (adjustments.length === 0) {
    return;
  }

  const {
    placeholders,
    values,
  } =
    buildAdjustmentValues(
      adjustments,
    );

  await client.query(
    `
      WITH affected (
        bucket_start,
        service,
        level,
        decrement_by
      ) AS (
        VALUES
          ${placeholders.join(",")}
      )

      DELETE FROM log_rollups_1m r
      USING affected a
      WHERE
        r.bucket_start =
          a.bucket_start
        AND r.service =
          a.service
        AND r.level =
          a.level
        AND r.count = 0
    `,
    values,
  );
}

export async function deleteLogsBefore(
  pool: Pool,
  cutoff: Date,
  batchSize: number,
): Promise<number> {
  const client =
    await pool.connect();

  try {
    await client.query("BEGIN");

    const expiredRows =
      await selectExpiredLogs(
        client,
        cutoff,
        batchSize,
      );

    if (expiredRows.length === 0) {
      await client.query(
        "COMMIT",
      );

      return 0;
    }

    const adjustments =
      buildRollupAdjustments(
        expiredRows,
      );

    await lockAndValidateRollups(
      client,
      adjustments,
    );

    await deleteRawLogs(
      client,
      expiredRows,
    );

    await decrementRollups(
      client,
      adjustments,
    );

    await deleteEmptyRollups(
      client,
      adjustments,
    );

    await client.query("COMMIT");

    return expiredRows.length;
  } catch (error: unknown) {
    await client.query(
      "ROLLBACK",
    );

    throw error;
  } finally {
    client.release();
  }
}