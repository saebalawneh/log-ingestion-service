import type { Pool } from "pg";

import {
  aggregateLogs,
} from "../repositories/aggregate.repository.js";

import type {
  AggregateBucketResult,
  AggregateQuery,
} from "../types/logs.js";

export async function getLogAggregation(
  pool: Pool,
  query: AggregateQuery,
): Promise<{
  buckets: AggregateBucketResult[];
}> {
  const rows =
    await aggregateLogs(pool, query);

  const buckets: AggregateBucketResult[] =
    rows.map((row) => ({
      start:
        row.bucket_start.toISOString(),
      group: row.group_value,
      count: Number(row.count),
    }));

  return {
    buckets,
  };
}