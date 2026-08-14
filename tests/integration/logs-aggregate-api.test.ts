import request from "supertest";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { Pool } from "pg";

import { createApp } from "../../src/app.js";
import { runMigrations } from "../../src/db/migrate.js";

import {
  insertLogs,
} from "../../src/repositories/logs.repository.js";

import type {
  LogEntry,
} from "../../src/types/logs.js";

const aggregateTestPool = new Pool({
  connectionString:
    "postgresql://postgres:postgres@localhost:5433/logs_test_db",
  max: 5,
});

const app = createApp(aggregateTestPool);

async function seedLog(
  timestamp: string,
  level: LogEntry["level"],
  service: string,
  message: string,
  attributes: LogEntry["attributes"] = {},
): Promise<void> {
  await insertLogs(
    aggregateTestPool,
    [
      {
        timestamp,
        level,
        service,
        message,
        attributes,
      },
    ],
  );
}

beforeAll(async () => {
  await runMigrations(
    aggregateTestPool,
  );
});

beforeEach(async () => {
  await aggregateTestPool.query(`
    TRUNCATE TABLE
      logs,
      log_rollups_1m
    RESTART IDENTITY;
  `);
});

afterAll(async () => {
  await aggregateTestPool.end();
});

describe("GET /logs/aggregate", () => {

test("groups aggregation by level", async () => {
  await seedLog(
    "2026-08-11T10:01:00.000Z",
    "info",
    "api",
    "info log",
  );

  await seedLog(
    "2026-08-11T10:02:00.000Z",
    "error",
    "api",
    "error log one",
  );

  await seedLog(
    "2026-08-11T10:03:00.000Z",
    "error",
    "payment",
    "error log two",
  );

  const response = await request(app)
    .get("/logs/aggregate")
    .query({
      since:
        "2026-08-11T10:00:00.000Z",
      until:
        "2026-08-11T10:05:00.000Z",
      bucket: "5m",
      group_by: "level",
    });

  expect(response.status).toBe(200);

  expect(response.body.buckets).toEqual([
    {
      start:
        "2026-08-11T10:00:00.000Z",
      group: "error",
      count: 2,
    },
    {
      start:
        "2026-08-11T10:00:00.000Z",
      group: "info",
      count: 1,
    },
  ]);
});

test("returns an empty buckets array when no logs match", async () => {
  const response = await request(app)
    .get("/logs/aggregate")
    .query({
      since:
        "2026-08-11T10:00:00.000Z",
      until:
        "2026-08-11T11:00:00.000Z",
      bucket: "5m",
    });

  expect(response.status).toBe(200);

  expect(response.body).toEqual({
    buckets: [],
  });
});


  test("aggregates logs into time buckets", async () => {
    await seedLog(
      "2026-08-11T10:01:00.000Z",
      "info",
      "api",
      "first",
    );

    await seedLog(
      "2026-08-11T10:03:00.000Z",
      "error",
      "api",
      "second",
    );

    await seedLog(
      "2026-08-11T10:07:00.000Z",
      "info",
      "api",
      "third",
    );

    const response = await request(app)
      .get("/logs/aggregate")
      .query({
        since:
          "2026-08-11T10:00:00.000Z",
        until:
          "2026-08-11T10:10:00.000Z",
        bucket: "5m",
      });

    expect(response.status).toBe(200);

    expect(response.body.buckets).toEqual([
      {
        start:
          "2026-08-11T10:00:00.000Z",
        group: null,
        count: 2,
      },
      {
        start:
          "2026-08-11T10:05:00.000Z",
        group: null,
        count: 1,
      },
    ]);


  });

  test("groups aggregation by service", async () => {
    await seedLog(
      "2026-08-11T10:01:00.000Z",
      "info",
      "api",
      "api log",
    );

    await seedLog(
      "2026-08-11T10:02:00.000Z",
      "info",
      "payment",
      "payment log",
    );

    await seedLog(
      "2026-08-11T10:03:00.000Z",
      "error",
      "api",
      "another api log",
    );

    const response = await request(app)
      .get("/logs/aggregate")
      .query({
        since:
          "2026-08-11T10:00:00.000Z",
        until:
          "2026-08-11T10:05:00.000Z",
        bucket: "5m",
        group_by: "service",
      });

    expect(response.status).toBe(200);

    expect(response.body.buckets).toEqual([
      {
        start:
          "2026-08-11T10:00:00.000Z",
        group: "api",
        count: 2,
      },
      {
        start:
          "2026-08-11T10:00:00.000Z",
        group: "payment",
        count: 1,
      },
    ]);
  });

  test("supports filters during aggregation", async () => {
    await seedLog(
      "2026-08-11T10:01:00.000Z",
      "error",
      "payment",
      "Payment failed",
      {
        region: "eu-west",
      },
    );

    await seedLog(
      "2026-08-11T10:02:00.000Z",
      "info",
      "payment",
      "Payment succeeded",
      {
        region: "eu-west",
      },
    );

    await seedLog(
      "2026-08-11T10:03:00.000Z",
      "error",
      "payment",
      "Payment failed",
      {
        region: "us-east",
      },
    );

    const response = await request(app)
      .get("/logs/aggregate")
      .query({
        since:
          "2026-08-11T10:00:00.000Z",
        until:
          "2026-08-11T10:05:00.000Z",
        bucket: "5m",
        service: "payment",
        level: "error",
        q: "failed",
        "attr.region": "eu-west",
      });

    expect(response.status).toBe(200);

    expect(response.body.buckets).toEqual([
      {
        start:
          "2026-08-11T10:00:00.000Z",
        group: null,
        count: 1,
      },
    ]);
  });

  test("returns 400 when bucket is invalid", async () => {
    const response = await request(app)
      .get("/logs/aggregate")
      .query({
        since:
          "2026-08-11T10:00:00.000Z",
        until:
          "2026-08-11T11:00:00.000Z",
        bucket: "10m",
      });

    expect(response.status).toBe(400);
  });

  test("returns 400 when since is missing", async () => {
    const response = await request(app)
      .get("/logs/aggregate")
      .query({
        until:
          "2026-08-11T11:00:00.000Z",
        bucket: "5m",
      });

    expect(response.status).toBe(400);
  });

  test("correctly combines raw boundary logs with full-minute rollups", async () => {
  await seedLog(
    "2026-08-11T10:00:10.000Z",
    "info",
    "api",
    "before since",
  );

  await seedLog(
    "2026-08-11T10:00:40.000Z",
    "info",
    "api",
    "first partial minute",
  );

  await seedLog(
    "2026-08-11T10:01:10.000Z",
    "info",
    "api",
    "full minute one",
  );

  await seedLog(
    "2026-08-11T10:02:10.000Z",
    "info",
    "api",
    "full minute two",
  );

  await seedLog(
    "2026-08-11T10:03:10.000Z",
    "info",
    "api",
    "last partial minute",
  );

  await seedLog(
    "2026-08-11T10:03:30.000Z",
    "info",
    "api",
    "after until",
  );

  const response = await request(app)
    .get("/logs/aggregate")
    .query({
      since:
        "2026-08-11T10:00:30.000Z",
      until:
        "2026-08-11T10:03:20.000Z",
      bucket: "5m",
    });

  expect(response.status).toBe(200);

  expect(response.body.buckets).toEqual([
    {
      start:
        "2026-08-11T10:00:00.000Z",
      group: null,
      count: 4,
    },
  ]);
});

test("uses raw logs when the entire range is inside one minute", async () => {
  await seedLog(
    "2026-08-11T10:00:05.000Z",
    "info",
    "api",
    "before since",
  );

  await seedLog(
    "2026-08-11T10:00:20.000Z",
    "info",
    "api",
    "inside one",
  );

  await seedLog(
    "2026-08-11T10:00:49.999Z",
    "info",
    "api",
    "inside two",
  );

  await seedLog(
    "2026-08-11T10:00:50.000Z",
    "info",
    "api",
    "exact until",
  );

  const response = await request(app)
    .get("/logs/aggregate")
    .query({
      since:
        "2026-08-11T10:00:10.000Z",
      until:
        "2026-08-11T10:00:50.000Z",
      bucket: "1m",
    });

  expect(response.status).toBe(200);

  expect(response.body.buckets).toEqual([
    {
      start:
        "2026-08-11T10:00:00.000Z",
      group: null,
      count: 2,
    },
  ]);
});

test("supports service and level filters on the rollup fast path", async () => {
  await seedLog(
    "2026-08-11T10:01:00.000Z",
    "info",
    "api",
    "api info",
  );

  await seedLog(
    "2026-08-11T10:02:00.000Z",
    "error",
    "api",
    "api error",
  );

  await seedLog(
    "2026-08-11T10:03:00.000Z",
    "error",
    "payment",
    "payment error",
  );

  const response = await request(app)
    .get("/logs/aggregate")
    .query({
      since:
        "2026-08-11T10:00:00.000Z",
      until:
        "2026-08-11T10:05:00.000Z",
      bucket: "5m",
      service: "api",
      level: "error",
    });

  expect(response.status).toBe(200);

  expect(response.body.buckets).toEqual([
    {
      start:
        "2026-08-11T10:00:00.000Z",
      group: null,
      count: 1,
    },
  ]);
});

test("rebins minute rollups into one-hour buckets", async () => {
  await seedLog(
    "2026-08-11T10:01:00.000Z",
    "info",
    "api",
    "first",
  );

  await seedLog(
    "2026-08-11T10:40:00.000Z",
    "info",
    "api",
    "second",
  );

  await seedLog(
    "2026-08-11T11:05:00.000Z",
    "info",
    "api",
    "third",
  );

  const response = await request(app)
    .get("/logs/aggregate")
    .query({
      since:
        "2026-08-11T10:00:00.000Z",
      until:
        "2026-08-11T12:00:00.000Z",
      bucket: "1h",
    });

  expect(response.status).toBe(200);

  expect(response.body.buckets).toEqual([
    {
      start:
        "2026-08-11T10:00:00.000Z",
      group: null,
      count: 2,
    },
    {
      start:
        "2026-08-11T11:00:00.000Z",
      group: null,
      count: 1,
    },
  ]);
});

test("rebins minute rollups into one-day buckets", async () => {
  await seedLog(
    "2026-08-11T01:00:00.000Z",
    "info",
    "api",
    "day one first",
  );

  await seedLog(
    "2026-08-11T22:00:00.000Z",
    "error",
    "api",
    "day one second",
  );

  await seedLog(
    "2026-08-12T05:00:00.000Z",
    "info",
    "api",
    "day two",
  );

  const response = await request(app)
    .get("/logs/aggregate")
    .query({
      since:
        "2026-08-11T00:00:00.000Z",
      until:
        "2026-08-13T00:00:00.000Z",
      bucket: "1d",
    });

  expect(response.status).toBe(200);

  expect(response.body.buckets).toEqual([
    {
      start:
        "2026-08-11T00:00:00.000Z",
      group: null,
      count: 2,
    },
    {
      start:
        "2026-08-12T00:00:00.000Z",
      group: null,
      count: 1,
    },
  ]);
});

test("falls back to raw aggregation when q is used", async () => {
  await seedLog(
    "2026-08-11T10:01:00.000Z",
    "error",
    "api",
    "database timeout",
  );

  await seedLog(
    "2026-08-11T10:02:00.000Z",
    "error",
    "api",
    "connection refused",
  );

  const response = await request(app)
    .get("/logs/aggregate")
    .query({
      since:
        "2026-08-11T10:00:00.000Z",
      until:
        "2026-08-11T10:05:00.000Z",
      bucket: "5m",
      q: "timeout",
    });

  expect(response.status).toBe(200);

  expect(response.body.buckets).toEqual([
    {
      start:
        "2026-08-11T10:00:00.000Z",
      group: null,
      count: 1,
    },
  ]);
});

test("falls back to raw aggregation when an attribute filter is used", async () => {
  await seedLog(
    "2026-08-11T10:01:00.000Z",
    "info",
    "api",
    "europe",
    {
      region: "eu-west",
    },
  );

  await seedLog(
    "2026-08-11T10:02:00.000Z",
    "info",
    "api",
    "america",
    {
      region: "us-east",
    },
  );

  const response = await request(app)
    .get("/logs/aggregate")
    .query({
      since:
        "2026-08-11T10:00:00.000Z",
      until:
        "2026-08-11T10:05:00.000Z",
      bucket: "5m",
      "attr.region": "eu-west",
    });

  expect(response.status).toBe(200);

  expect(response.body.buckets).toEqual([
    {
      start:
        "2026-08-11T10:00:00.000Z",
      group: null,
      count: 1,
    },
  ]);
});
test("returns 400 for repeated scalar aggregate parameters", async () => {
  const response = await request(app).get(
    "/logs/aggregate" +
      "?since=2026-08-11T10%3A00%3A00.000Z" +
      "&until=2026-08-11T11%3A00%3A00.000Z" +
      "&bucket=1m" +
      "&bucket=5m",
  );

  expect(response.status).toBe(400);

  expect(response.body).toEqual({
    error: "bucket must be provided once",
  });
});
});