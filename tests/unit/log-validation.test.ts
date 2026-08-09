import { describe, expect, test } from "vitest";
import { validateLog } from "../../src/validation/log-validation.js";

const NOW = Date.parse("2026-08-09T12:00:00.000Z");

describe("validateLog", () => {

test("rejects an invalid log level", () => {
  const result = validateLog(
    {
      timestamp: "2026-08-09T11:59:00.000Z",
      level: "critical",
      service: "checkout",
      message: "payment failed",
    },
    3,
    NOW,
  );

  expect(result.ok).toBe(false);

  if (result.ok) {
    throw new Error("expected invalid log");
  }

  expect(result.rejection).toEqual({
    index: 3,
    reason: "level must be debug, info, warn, or error",
  });
});


test("rejects timestamps more than five minutes in the future", () => {
  const result = validateLog(
    {
      timestamp: "2026-08-09T12:06:00.000Z",
      level: "info",
      service: "api",
      message: "future event",
    },
    0,
    NOW,
  );

  expect(result.ok).toBe(false);

  if (result.ok) {
    throw new Error("expected invalid log");
  }

  expect(result.rejection.reason).toBe(
    "timestamp cannot be more than 5 minutes in the future",
  );
});

test("accepts a timestamp exactly five minutes in the future", () => {
  const result = validateLog(
    {
      timestamp: "2026-08-09T12:05:00.000Z",
      level: "info",
      service: "api",
      message: "clock skew",
    },
    0,
    NOW,
  );

  expect(result.ok).toBe(true);
});

test("uses an empty object when attributes are omitted", () => {
  const result = validateLog(
    {
      timestamp: "2026-08-09T11:59:00.000Z",
      level: "debug",
      service: "api",
      message: "request started",
    },
    0,
    NOW,
  );

  expect(result.ok).toBe(true);

  if (!result.ok) {
    throw new Error("expected valid log");
  }

  expect(result.log.attributes).toEqual({});
});

test("rejects nested attribute objects", () => {
  const result = validateLog(
    {
      timestamp: "2026-08-09T11:59:00.000Z",
      level: "info",
      service: "api",
      message: "request",
      attributes: {
        user: {
          id: 42,
        },
      },
    },
    0,
    NOW,
  );

  expect(result.ok).toBe(false);

  if (result.ok) {
    throw new Error("expected invalid log");
  }

  expect(result.rejection.reason).toContain(
    "must be a string, number, or boolean",
  );
});

test("rejects arrays inside attributes", () => {
  const result = validateLog(
    {
      timestamp: "2026-08-09T11:59:00.000Z",
      level: "info",
      service: "api",
      message: "request",
      attributes: {
        tags: ["api", "important"],
      },
    },
    0,
    NOW,
  );

  expect(result.ok).toBe(false);
});
test("rejects an empty service", () => {
  const result = validateLog(
    {
      timestamp: "2026-08-09T11:59:00.000Z",
      level: "info",
      service: "   ",
      message: "hello",
    },
    0,
    NOW,
  );

  expect(result.ok).toBe(false);
});


test("rejects an empty message", () => {
  const result = validateLog(
    {
      timestamp: "2026-08-09T11:59:00.000Z",
      level: "info",
      service: "api",
      message: "    ",
    },
    0,
    NOW,
  );

  expect(result.ok).toBe(false);
});


  test("accepts a valid log", () => {
    const result = validateLog(
      {
        timestamp: "2026-08-09T11:59:00.000Z",
        level: "info",
        service: "checkout",
        message: "request completed",
        attributes: {
          user_id: "42",
          retries: 2,
          cached: false,
        },
      },
      0,
      NOW,
    );

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error("expected valid log");
    }

    expect(result.log.level).toBe("info");
    expect(result.log.service).toBe("checkout");
    expect(result.log.attributes).toEqual({
      user_id: "42",
      retries: 2,
      cached: false,
    });
  });
});