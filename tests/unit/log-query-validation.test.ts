import { describe, expect, test } from "vitest";
import { validateLogQuery } from "../../src/validation/log-query-validation.js";
import { encodeLogCursor } from "../../src/utils/log-cursor.js";

describe("validateLogQuery", () => {

    test("accepts and decodes a valid cursor", () => {
  const cursor = encodeLogCursor({
    timestamp: "2026-08-11T10:00:00.000Z",
    id: "25",
  });

  const result = validateLogQuery({
    cursor,
  });

  expect(result.ok).toBe(true);

  if (result.ok) {
    expect(result.query.cursor).toEqual({
      timestamp: "2026-08-11T10:00:00.000Z",
      id: "25",
    });
  }
});

test("rejects an invalid cursor", () => {
  const result = validateLogQuery({
    cursor: "not-a-valid-cursor",
  });

  expect(result).toEqual({
    ok: false,
    error: "invalid cursor",
  });
});

test("rejects a non-ISO date even if Date.parse could understand it", () => {
  const result = validateLogQuery({
    since: "August 11, 2026",
  });

  expect(result.ok).toBe(false);
});


  test("uses the default limit when limit is omitted", () => {
    const result = validateLogQuery({});

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error("expected valid query");
    }

    expect(result.query.limit).toBe(100);
  });

  test("accepts a valid custom limit", () => {
    const result = validateLogQuery({
      limit: "50",
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error("expected valid query");
    }

    expect(result.query.limit).toBe(50);
  });

  test("rejects a limit of zero", () => {
    const result = validateLogQuery({
      limit: "0",
    });

    expect(result.ok).toBe(false);
  });

  test("rejects a limit greater than 1000", () => {
    const result = validateLogQuery({
      limit: "1001",
    });

    expect(result.ok).toBe(false);
  });

  test("rejects a non-integer limit", () => {
    const result = validateLogQuery({
      limit: "10.5",
    });

    expect(result.ok).toBe(false);
  });

  test("accepts a valid level", () => {
    const result = validateLogQuery({
      level: "error",
    });

    expect(result.ok).toBe(true);
  });

  test("rejects an invalid level", () => {
    const result = validateLogQuery({
      level: "critical",
    });

    expect(result.ok).toBe(false);
  });

  test("rejects an invalid since value", () => {
    const result = validateLogQuery({
      since: "hello",
    });

    expect(result.ok).toBe(false);
  });

  test("rejects until when it is earlier than since", () => {
    const result = validateLogQuery({
      since: "2026-08-10T12:00:00.000Z",
      until: "2026-08-10T11:00:00.000Z",
    });

    expect(result.ok).toBe(false);
  });

  test("parses attribute filters", () => {
    const result = validateLogQuery({
      "attr.region": "eu-west",
      "attr.user_id": "42",
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error("expected valid query");
    }

    expect(result.query.attributes).toEqual({
      region: "eu-west",
      user_id: "42",
    });
  });

  test("accepts combined filters", () => {
    const result = validateLogQuery({
      service: "checkout",
      level: "error",
      since: "2026-08-10T10:00:00.000Z",
      until: "2026-08-10T11:00:00.000Z",
      q: "payment",
      limit: "50",
      "attr.region": "eu-west",
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error("expected valid query");
    }

    expect(result.query).toEqual({
      service: "checkout",
      level: "error",
      since: "2026-08-10T10:00:00.000Z",
      until: "2026-08-10T11:00:00.000Z",
      q: "payment",
      attributes: {
        region: "eu-west",
      },
      limit: 50,
    });
  });
  test.each([
  "cursor",
  "service",
  "level",
  "since",
  "until",
  "q",
  "limit",
])(
  "rejects repeated %s parameters",
  (parameter) => {
    const result = validateLogQuery({
      [parameter]: ["first", "second"],
    });

    expect(result).toEqual({
      ok: false,
      error: `${parameter} must be provided once`,
    });
  },
);

test("rejects repeated values for the same attribute filter", () => {
  const result = validateLogQuery({
    "attr.region": [
      "eu-west",
      "us-east",
    ],
  });

  expect(result).toEqual({
    ok: false,
    error: "invalid value for attribute 'region'",
  });
});
});