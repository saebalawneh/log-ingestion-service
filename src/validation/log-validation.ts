import {
  LOG_LEVELS,
  type LogAttributes,
  type LogLevel,
  type ValidationResult,
} from "../types/logs.js";

const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

const ISO_8601_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLogLevel(value: unknown): value is LogLevel {
  return (
    typeof value === "string" &&
    (LOG_LEVELS as readonly string[]).includes(value)
  );
}

function validateAttributes(
  value: unknown,
): { attributes: LogAttributes } | { error: string } {
  if (value === undefined) {
    return {
      attributes: {},
    };
  }

  if (!isRecord(value)) {
    return {
      error: "attributes must be a flat object",
    };
  }

  const attributes: LogAttributes = {};

  for (const [key, attributeValue] of Object.entries(value)) {
    const isString = typeof attributeValue === "string";

    const isBoolean = typeof attributeValue === "boolean";

    const isNumber =
      typeof attributeValue === "number" && Number.isFinite(attributeValue);

    if (!isString && !isBoolean && !isNumber) {
      return {
        error: `attribute '${key}' must be a string, number, or boolean`,
      };
    }

    attributes[key] = attributeValue;
  }

  return {
    attributes,
  };
}

export function validateLog(
  input: unknown,
  index: number,
  nowMs: number = Date.now(),
): ValidationResult {
  if (!isRecord(input)) {
    return {
      ok: false,
      rejection: {
        index,
        reason: "log must be an object",
      },
    };
  }

  const timestamp = input.timestamp;
  const level = input.level;
  const service = input.service;
  const message = input.message;

  if (
    typeof timestamp !== "string" ||
    !ISO_8601_DATE_TIME.test(timestamp) ||
    Number.isNaN(Date.parse(timestamp))
  ) {
    return {
      ok: false,
      rejection: {
        index,
        reason: "timestamp must be a valid ISO 8601 date-time",
      },
    };
  }

  const timestampMs = Date.parse(timestamp);

  if (timestampMs > nowMs + MAX_FUTURE_SKEW_MS) {
    return {
      ok: false,
      rejection: {
        index,
        reason: "timestamp cannot be more than 5 minutes in the future",
      },
    };
  }

  if (!isLogLevel(level)) {
    return {
      ok: false,
      rejection: {
        index,
        reason: "level must be debug, info, warn, or error",
      },
    };
  }

  if (typeof service !== "string" || service.trim().length === 0) {
    return {
      ok: false,
      rejection: {
        index,
        reason: "service must be a non-empty string",
      },
    };
  }

  if (typeof message !== "string" || message.trim().length === 0) {
    return {
      ok: false,
      rejection: {
        index,
        reason: "message must be a non-empty string",
      },
    };
  }

  const attributesResult = validateAttributes(input.attributes);

  if ("error" in attributesResult) {
    return {
      ok: false,
      rejection: {
        index,
        reason: attributesResult.error,
      },
    };
  }

  return {
    ok: true,
    log: {
      timestamp,
      level,
      service,
      message,
      attributes: attributesResult.attributes,
    },
  };
}