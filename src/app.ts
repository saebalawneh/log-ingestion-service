import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import type { Pool } from "pg";
import { createLogsRouter } from "./routes/logs.routes.js";

function getHttpErrorStatus(error: unknown): number | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error
  ) {
    const status = (error as { status?: unknown }).status;

    if (typeof status === "number") {
      return status;
    }
  }

  return undefined;
}

export function createApp(pool: Pool) {
  const app = express();

  app.disable("x-powered-by");

  app.use(
    express.json({
      limit: "10mb",
    }),
  );

  app.get(
    "/health",
    async (_request: Request, response: Response): Promise<void> => {
      try {
        await pool.query("SELECT 1");

        response.status(200).json({
          status: "ok",
        });
      } catch (error: unknown) {
        console.error("Health check failed:", error);

        response.status(503).json({
          status: "unavailable",
        });
      }
    },
  );

  app.use(createLogsRouter(pool));

  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      _next: NextFunction,
    ): void => {
      const status = getHttpErrorStatus(error);

      if (error instanceof SyntaxError && status === 400) {
        response.status(400).json({
          error: "invalid JSON",
        });

        return;
      }

      if (status === 413) {
        response.status(413).json({
          error: "request body too large",
        });

        return;
      }

      console.error("Unhandled request error:", error);

      response.status(500).json({
        error: "internal server error",
      });
    },
  );

  return app;
}