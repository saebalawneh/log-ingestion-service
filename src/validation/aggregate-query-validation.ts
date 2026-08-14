import {
  AGGREGATE_BUCKETS,
  AGGREGATE_GROUPS,
  LOG_LEVELS,
  type AggregateBucket,
  type AggregateGroupBy,
  type AggregateQuery,
  type AggregateQueryValidationResult,
  type LogLevel,
} from "../types/logs.js";

const ISO_8601_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;

function getSingleQueryValue(
  value: unknown,
): string | undefined {
  return typeof value === "string"
    ? value
    : undefined;
}

function hasInvalidSingleValue(
  value: unknown,
): boolean {
  return (
    value !== undefined &&
    typeof value !== "string"
  );
}

function isValidDateTime(value: string): boolean {
  return (
    ISO_8601_DATE_TIME.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isLogLevel(
  value: string,
): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(
    value,
  );
}

function isAggregateBucket(
  value: string,
): value is AggregateBucket {
  return (
    AGGREGATE_BUCKETS as readonly string[]
  ).includes(value);
}

function isAggregateGroupBy(
  value: string,
): value is AggregateGroupBy {
  return (
    AGGREGATE_GROUPS as readonly string[]
  ).includes(value);
}

export function validateAggregateQuery(
  input: Record<string, unknown>,
): AggregateQueryValidationResult {
    const singleValueParameters = [
    "since",
    "until",
    "bucket",
    "group_by",
    "service",
    "level",
    "q",
  ] as const;

  for (const parameter of singleValueParameters) {
    if (
      hasInvalidSingleValue(
        input[parameter],
      )
    ) {
      return {
        ok: false,
        error: `${parameter} must be provided once`,
      };
    }
  }
  const since = getSingleQueryValue(input.since);
  const until = getSingleQueryValue(input.until);
  const bucket = getSingleQueryValue(input.bucket);

  const groupBy =
    getSingleQueryValue(input.group_by);

  const service =
    getSingleQueryValue(input.service);

  const level =
    getSingleQueryValue(input.level);

  const q =
    getSingleQueryValue(input.q);

  if (
    since === undefined ||
    !isValidDateTime(since)
  ) {
    return {
      ok: false,
      error: "since is required and must be a valid ISO 8601 date-time",
    };
  }

  if (
    until === undefined ||
    !isValidDateTime(until)
  ) {
    return {
      ok: false,
      error: "until is required and must be a valid ISO 8601 date-time",
    };
  }

  if (Date.parse(until) < Date.parse(since)) {
    return {
      ok: false,
      error: "until cannot be earlier than since",
    };
  }

  if (
    bucket === undefined ||
    !isAggregateBucket(bucket)
  ) {
    return {
      ok: false,
      error: "bucket must be 1m, 5m, 1h, or 1d",
    };
  }

  if (
    groupBy !== undefined &&
    !isAggregateGroupBy(groupBy)
  ) {
    return {
      ok: false,
      error: "group_by must be service or level",
    };
  }

  if (
    level !== undefined &&
    !isLogLevel(level)
  ) {
    return {
      ok: false,
      error: "level must be debug, info, warn, or error",
    };
  }

  const attributes: Record<string, string> = {};

  for (const [key, value] of Object.entries(input)) {
    if (!key.startsWith("attr.")) {
      continue;
    }

    const attributeName =
      key.slice("attr.".length);

    if (attributeName.length === 0) {
      return {
        ok: false,
        error: "attribute filter must include a key",
      };
    }

    const attributeValue =
      getSingleQueryValue(value);

    if (attributeValue === undefined) {
      return {
        ok: false,
        error: `invalid value for attribute '${attributeName}'`,
      };
    }

    attributes[attributeName] =
      attributeValue;
  }

  const query: AggregateQuery = {
    since,
    until,
    bucket,
    attributes,
  };

  if (groupBy !== undefined) {
    query.groupBy = groupBy;
  }

  if (service !== undefined) {
    query.service = service;
  }

  if (level !== undefined) {
    query.level = level;
  }

  if (q !== undefined) {
    query.q = q;
  }

  return {
    ok: true,
    query,
  };
}