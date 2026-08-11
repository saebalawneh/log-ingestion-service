import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import type { Pool } from "pg";

import { getLogs } from "../services/query.service.js";
import { ingestLogs } from "../services/ingestion.service.js";
import { validateLogQuery } from "../validation/log-query-validation.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

export function createLogsRouter(pool: Pool): Router {
  const router = Router();

  router.post(
    "/logs",
    async (
      request: Request,
      response: Response,
      next: NextFunction,
    ): Promise<void> => {
      try {
        const body: unknown = request.body;

        if (!isRecord(body)) {
          response.status(400).json({
            error: "request body must be an object",
          });

          return;
        }

        if (!Array.isArray(body.logs) || body.logs.length === 0) {
          response.status(400).json({
            error: "logs must be a non-empty array",
          });

          return;
        }

        const result = await ingestLogs(pool, body.logs);

        const statusCode =
          result.accepted > 0 ? 200 : 400;

        response.status(statusCode).json(result);
      } catch (error: unknown) {
        next(error);
      }
    },
  );

  router.get(
    "/logs",
    async (
      request: Request,
      response: Response,
      next: NextFunction,
    ): Promise<void> => {
      try {
        const validationResult = validateLogQuery(
          request.query as Record<string, unknown>,
        );

        if (!validationResult.ok) {
          response.status(400).json({
            error: validationResult.error,
          });

          return;
        }

        const result = await getLogs(
          pool,
          validationResult.query,
        );

        response.status(200).json(result);
      } catch (error: unknown) {
        next(error);
      }
    },
  );

  return router;
}