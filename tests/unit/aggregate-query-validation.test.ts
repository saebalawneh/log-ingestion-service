import {
  describe,
  expect,
  test,
} from "vitest";

import {
  validateAggregateQuery,
} from "../../src/validation/aggregate-query-validation.js";

describe("validateAggregateQuery", () => {
  test("accepts a valid aggregate query", () => {
    const result = validateAggregateQuery({
      since: "2026-08-11T10:00:00.000Z",
      until: "2026-08-11T11:00:00.000Z",
      bucket: "5m",
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.query.bucket).toBe("5m");
      expect(result.query.attributes).toEqual({});
    }
  });

  test("requires since", () => {
    const result = validateAggregateQuery({
      until: "2026-08-11T11:00:00.000Z",
      bucket: "5m",
    });

    expect(result.ok).toBe(false);
  });

  test("requires until", () => {
    const result = validateAggregateQuery({
      since: "2026-08-11T10:00:00.000Z",
      bucket: "5m",
    });

    expect(result.ok).toBe(false);
  });

  test("rejects an invalid bucket", () => {
    const result = validateAggregateQuery({
      since: "2026-08-11T10:00:00.000Z",
      until: "2026-08-11T11:00:00.000Z",
      bucket: "10m",
    });

    expect(result.ok).toBe(false);
  });

  test("accepts service grouping", () => {
    const result = validateAggregateQuery({
      since: "2026-08-11T10:00:00.000Z",
      until: "2026-08-11T11:00:00.000Z",
      bucket: "1m",
      group_by: "service",
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.query.groupBy).toBe(
        "service",
      );
    }
  });

  test("rejects invalid group_by", () => {
    const result = validateAggregateQuery({
      since: "2026-08-11T10:00:00.000Z",
      until: "2026-08-11T11:00:00.000Z",
      bucket: "1m",
      group_by: "message",
    });

    expect(result.ok).toBe(false);
  });

  test("rejects until earlier than since", () => {
    const result = validateAggregateQuery({
      since: "2026-08-11T12:00:00.000Z",
      until: "2026-08-11T11:00:00.000Z",
      bucket: "1h",
    });

    expect(result.ok).toBe(false);
  });

  test("parses attribute filters", () => {
    const result = validateAggregateQuery({
      since: "2026-08-11T10:00:00.000Z",
      until: "2026-08-11T11:00:00.000Z",
      bucket: "5m",
      "attr.region": "eu-west",
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.query.attributes).toEqual({
        region: "eu-west",
      });
    }
  });
  test.each([
  "since",
  "until",
  "bucket",
  "group_by",
  "service",
  "level",
  "q",
])(
  "rejects repeated %s parameters",
  (parameter) => {
    const result = validateAggregateQuery({
      [parameter]: ["first", "second"],
    });

    expect(result).toEqual({
      ok: false,
      error: `${parameter} must be provided once`,
    });
  },
);

test("rejects repeated values for the same attribute filter", () => {
  const result = validateAggregateQuery({
    since: "2026-08-11T10:00:00.000Z",
    until: "2026-08-11T11:00:00.000Z",
    bucket: "5m",
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