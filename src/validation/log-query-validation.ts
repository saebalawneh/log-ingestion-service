import {
  LOG_LEVELS,
  type LogLevel,
  type LogQuery,
  type LogQueryValidationResult,
} from "../types/logs.js";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

function getSingleQueryValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  return undefined;
}

function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

function parseLimit(value: unknown): number | undefined {
  if (value === undefined) {
    return DEFAULT_LIMIT;
  }

  const rawValue = getSingleQueryValue(value);

  if (rawValue === undefined || rawValue.trim() === "") {
    return undefined;
  }

  const limit = Number(rawValue);

  if (
    !Number.isInteger(limit) ||
    limit <= 0 ||
    limit > MAX_LIMIT
  ) {
    return undefined;
  }

  return limit;
}

function isValidDateTime(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

export function validateLogQuery(
  input: Record<string, unknown>,
): LogQueryValidationResult {
  const service = getSingleQueryValue(input.service);
  const level = getSingleQueryValue(input.level);
  const since = getSingleQueryValue(input.since);
  const until = getSingleQueryValue(input.until);
  const q = getSingleQueryValue(input.q);

  const limit = parseLimit(input.limit);

  if (input.limit !== undefined && limit === undefined) {
    return {
      ok: false,
      error: "limit must be an integer between 1 and 1000",
    };
  }

  if (level !== undefined && !isLogLevel(level)) {
    return {
      ok: false,
      error: "level must be debug, info, warn, or error",
    };
  }

  if (since !== undefined && !isValidDateTime(since)) {
    return {
      ok: false,
      error: "since must be a valid date-time",
    };
  }

  if (until !== undefined && !isValidDateTime(until)) {
    return {
      ok: false,
      error: "until must be a valid date-time",
    };
  }

  if (
    since !== undefined &&
    until !== undefined &&
    Date.parse(until) < Date.parse(since)
  ) {
    return {
      ok: false,
      error: "until cannot be earlier than since",
    };
  }

  const attributes: Record<string, string> = {};

  for (const [key, value] of Object.entries(input)) {
    if (!key.startsWith("attr.")) {
      continue;
    }

    const attributeName = key.slice("attr.".length);

    if (attributeName.length === 0) {
      return {
        ok: false,
        error: "attribute filter must include a key",
      };
    }

    const attributeValue = getSingleQueryValue(value);

    if (attributeValue === undefined) {
      return {
        ok: false,
        error: `invalid value for attribute '${attributeName}'`,
      };
    }

    attributes[attributeName] = attributeValue;
  }

  const query: LogQuery = {
    attributes,
    limit: limit ?? DEFAULT_LIMIT,
  };

  if (service !== undefined) {
    query.service = service;
  }

  if (level !== undefined) {
    query.level = level;
  }

  if (since !== undefined) {
    query.since = since;
  }

  if (until !== undefined) {
    query.until = until;
  }

  if (q !== undefined) {
    query.q = q;
  }

  return {
    ok: true,
    query,
  };
}