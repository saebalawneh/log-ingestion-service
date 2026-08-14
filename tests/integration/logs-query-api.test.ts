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
import type {
  LogAttributes,
  LogLevel,
} from "../../src/types/logs.js";

const queryTestPool = new Pool({
  connectionString:
    "postgresql://postgres:postgres@localhost:5433/logs_test_db",
  max: 5,
});

const app = createApp(queryTestPool);

type SeedLog = {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  attributes?: LogAttributes;
};

async function seedLog(log: SeedLog): Promise<void> {
  await queryTestPool.query(
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
      log.timestamp,
      log.level,
      log.service,
      log.message,
      JSON.stringify(log.attributes ?? {}),
    ],
  );
}

beforeAll(async () => {
  await runMigrations(queryTestPool);
});

beforeEach(async () => {
  await queryTestPool.query(
    "TRUNCATE TABLE logs RESTART IDENTITY",
  );
});

afterAll(async () => {
  await queryTestPool.end();
});

describe("GET /logs", () => {
  test("returns logs newest first", async () => {
    await seedLog({
      timestamp: "2026-08-10T10:00:00.000Z",
      level: "info",
      service: "api",
      message: "older log",
    });

    await seedLog({
      timestamp: "2026-08-10T11:00:00.000Z",
      level: "error",
      service: "checkout",
      message: "newer log",
    });

    const response = await request(app).get("/logs");

    expect(response.status).toBe(200);
    expect(response.body.logs).toHaveLength(2);

    expect(response.body.logs[0].message).toBe(
      "newer log",
    );

    expect(response.body.logs[1].message).toBe(
      "older log",
    );

    expect(response.body.next_cursor).toBe(null);
  });

  test("filters by service and level using AND", async () => {
    await seedLog({
      timestamp: "2026-08-10T10:00:00.000Z",
      level: "error",
      service: "checkout",
      message: "wanted",
    });

    await seedLog({
      timestamp: "2026-08-10T10:01:00.000Z",
      level: "info",
      service: "checkout",
      message: "wrong level",
    });

    await seedLog({
      timestamp: "2026-08-10T10:02:00.000Z",
      level: "error",
      service: "auth",
      message: "wrong service",
    });

    const response = await request(app)
      .get("/logs")
      .query({
        service: "checkout",
        level: "error",
      });

    expect(response.status).toBe(200);
    expect(response.body.logs).toHaveLength(1);

    expect(response.body.logs[0].message).toBe(
      "wanted",
    );
  });

  test("uses inclusive since and exclusive until", async () => {
    await seedLog({
      timestamp: "2026-08-10T10:00:00.000Z",
      level: "info",
      service: "api",
      message: "at since",
    });

    await seedLog({
      timestamp: "2026-08-10T10:30:00.000Z",
      level: "info",
      service: "api",
      message: "inside",
    });

    await seedLog({
      timestamp: "2026-08-10T11:00:00.000Z",
      level: "info",
      service: "api",
      message: "at until",
    });

    const response = await request(app)
      .get("/logs")
      .query({
        since: "2026-08-10T10:00:00.000Z",
        until: "2026-08-10T11:00:00.000Z",
      });

    expect(response.status).toBe(200);

    expect(
      response.body.logs.map(
        (log: { message: string }) => log.message,
      ),
    ).toEqual([
      "inside",
      "at since",
    ]);
  });

  test(
    "filters message using case-insensitive substring search",
    async () => {
      await seedLog({
        timestamp: "2026-08-10T10:00:00.000Z",
        level: "error",
        service: "payment",
        message: "Payment Declined",
      });

      await seedLog({
        timestamp: "2026-08-10T10:01:00.000Z",
        level: "info",
        service: "auth",
        message: "user logged in",
      });

      const response = await request(app)
        .get("/logs")
        .query({
          q: "payment",
        });

      expect(response.status).toBe(200);
      expect(response.body.logs).toHaveLength(1);

      expect(response.body.logs[0].message).toBe(
        "Payment Declined",
      );
    },
  );

  test("filters by attribute value", async () => {
    await seedLog({
      timestamp: "2026-08-10T10:00:00.000Z",
      level: "info",
      service: "api",
      message: "europe request",
      attributes: {
        region: "eu-west",
      },
    });

    await seedLog({
      timestamp: "2026-08-10T10:01:00.000Z",
      level: "info",
      service: "api",
      message: "us request",
      attributes: {
        region: "us-east",
      },
    });

    const response = await request(app)
      .get("/logs")
      .query({
        "attr.region": "eu-west",
      });

    expect(response.status).toBe(200);
    expect(response.body.logs).toHaveLength(1);

    expect(response.body.logs[0].message).toBe(
      "europe request",
    );
  });

  test("returns 400 for an invalid limit", async () => {
    const response = await request(app)
      .get("/logs")
      .query({
        limit: "1001",
      });

    expect(response.status).toBe(400);
  });

  test("paginates with a cursor without duplicates", async () => {
    await seedLog({
      timestamp: "2026-08-11T09:59:00.000Z",
      level: "info",
      service: "api",
      message: "older",
    });

    await seedLog({
      timestamp: "2026-08-11T10:00:00.000Z",
      level: "info",
      service: "api",
      message: "same timestamp first",
    });

    await seedLog({
      timestamp: "2026-08-11T10:00:00.000Z",
      level: "info",
      service: "api",
      message: "same timestamp second",
    });

    await seedLog({
      timestamp: "2026-08-11T10:00:00.000Z",
      level: "info",
      service: "api",
      message: "same timestamp third",
    });

    const firstPage = await request(app)
      .get("/logs")
      .query({
        limit: "2",
      });

    expect(firstPage.status).toBe(200);
    expect(firstPage.body.logs).toHaveLength(2);

    expect(
      firstPage.body.logs.map(
        (log: { message: string }) => log.message,
      ),
    ).toEqual([
      "same timestamp third",
      "same timestamp second",
    ]);

    expect(firstPage.body.next_cursor).toEqual(
      expect.any(String),
    );

    const secondPage = await request(app)
      .get("/logs")
      .query({
        limit: "2",
        cursor: firstPage.body.next_cursor,
      });

    expect(secondPage.status).toBe(200);
    expect(secondPage.body.logs).toHaveLength(2);

    expect(
      secondPage.body.logs.map(
        (log: { message: string }) => log.message,
      ),
    ).toEqual([
      "same timestamp first",
      "older",
    ]);

    expect(secondPage.body.next_cursor).toBe(null);
  });

  test("returns 400 for an invalid cursor", async () => {
    const response = await request(app)
      .get("/logs")
      .query({
        cursor: "this-is-not-a-valid-cursor",
      });

    expect(response.status).toBe(400);

    expect(response.body).toEqual({
      error: "invalid cursor",
    });
  });
  test("returns 400 for repeated scalar query parameters", async () => {
  const response = await request(app).get(
    "/logs?service=api&service=auth",
  );

  expect(response.status).toBe(400);

  expect(response.body).toEqual({
    error: "service must be provided once",
  });
});
});