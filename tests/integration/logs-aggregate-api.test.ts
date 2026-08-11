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

const aggregateTestPool = new Pool({
  connectionString:
    "postgresql://postgres:postgres@localhost:5433/logs_test_db",
  max: 5,
});

const app = createApp(aggregateTestPool);

async function seedLog(
  timestamp: string,
  level: string,
  service: string,
  message: string,
  attributes: Record<string, unknown> = {},
): Promise<void> {
  await aggregateTestPool.query(
    `
      INSERT INTO logs (
        "timestamp",
        level,
        service,
        message,
        attributes
      )
      VALUES (
        $1::timestamptz,
        $2,
        $3,
        $4,
        $5::jsonb
      )
    `,
    [
      timestamp,
      level,
      service,
      message,
      JSON.stringify(attributes),
    ],
  );
}

beforeAll(async () => {
  await runMigrations(
    aggregateTestPool,
  );
});

beforeEach(async () => {
  await aggregateTestPool.query(
    "TRUNCATE TABLE logs RESTART IDENTITY",
  );
});

afterAll(async () => {
  await aggregateTestPool.end();
});

describe("GET /logs/aggregate", () => {
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
});