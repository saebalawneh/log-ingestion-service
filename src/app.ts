import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import type { Pool } from "pg";

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

  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      _next: NextFunction,
    ): void => {
      console.error("Unhandled request error:", error);

      response.status(500).json({
        error: "internal server error",
      });
    },
  );

  return app;
}