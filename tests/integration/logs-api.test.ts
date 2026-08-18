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

const testPool = new Pool({
  connectionString:
    "postgresql://postgres:postgres@localhost:5433/logs_test_db",
  max: 5,
});

const app = createApp(testPool);

describe("POST /logs", () => {
  beforeAll(async () => {
    await runMigrations(testPool);
  });

  beforeEach(async () => {
    await testPool.query(
      "TRUNCATE TABLE logs RESTART IDENTITY",
    );
  });

  test("stores a valid log", async () => {
    const response = await request(app)
      .post("/logs")
      .send({
        logs: [
          {
            timestamp: new Date().toISOString(),
            level: "error",
            service: "checkout",
            message: "payment declined",
            attributes: {
              user_id: "42",
            },
          },
        ],
      });

    expect(response.status).toBe(200);

    expect(response.body).toEqual({
      accepted: 1,
      rejected: [],
    });

    const databaseResult = await testPool.query(`
      SELECT level, service, message, attributes
      FROM logs
    `);

    expect(databaseResult.rowCount).toBe(1);

    expect(databaseResult.rows[0]).toMatchObject({
      level: "error",
      service: "checkout",
      message: "payment declined",
      attributes: {
        user_id: "42",
      },
    });
  });

  test(
    "accepts valid logs and rejects invalid logs in the same batch",
    async () => {
      const now = new Date().toISOString();

      const response = await request(app)
        .post("/logs")
        .send({
          logs: [
            {
              timestamp: now,
              level: "info",
              service: "auth",
              message: "login successful",
            },
            {
              timestamp: now,
              level: "critical",
              service: "checkout",
              message: "invalid level",
            },
            {
              timestamp: now,
              level: "error",
              service: "checkout",
              message: "payment declined",
            },
          ],
        });

      expect(response.status).toBe(200);

      expect(response.body.accepted).toBe(2);
      expect(response.body.rejected).toHaveLength(1);
      expect(response.body.rejected[0].index).toBe(1);

      const databaseResult = await testPool.query(
        "SELECT COUNT(*)::int AS count FROM logs",
      );

      expect(databaseResult.rows[0].count).toBe(2);
    },
  );

  test("returns 400 when every log is invalid", async () => {
    const response = await request(app)
      .post("/logs")
      .send({
        logs: [
          {
            timestamp: new Date().toISOString(),
            level: "banana",
            service: "api",
            message: "bad log",
          },
        ],
      });

    expect(response.status).toBe(400);
    expect(response.body.accepted).toBe(0);

    const databaseResult = await testPool.query(
      "SELECT COUNT(*)::int AS count FROM logs",
    );

    expect(databaseResult.rows[0].count).toBe(0);
  });

  test("returns 400 for an empty logs array", async () => {
    const response = await request(app)
      .post("/logs")
      .send({
        logs: [],
      });

    expect(response.status).toBe(400);

    expect(response.body).toEqual({
      error: "logs must be a non-empty array",
    });
  });

  test("returns 400 when logs is missing", async () => {
    const response = await request(app)
      .post("/logs")
      .send({
        hello: "world",
      });

    expect(response.status).toBe(400);
  });

  test(
    "health endpoint reports ready when the database is available",
    async () => {
      const response = await request(app).get("/health");

      expect(response.status).toBe(200);

      expect(response.body).toEqual({
        status: "ok",
      });
    },
  );

  afterAll(async () => {
    await testPool.end();
  });
});