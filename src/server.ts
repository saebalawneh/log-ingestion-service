import {
  createServer,
  type Server,
} from "node:http";

import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { runMigrations } from "./db/migrate.js";
import { pool } from "./db/pool.js";
import {
  startRetentionWorker,
} from "./workers/retention.worker.js";

let server: Server | undefined;

let stopRetentionWorker:
  | (() => Promise<void>)
  | undefined;

let isShuttingDown = false;

async function startServer(): Promise<void> {
  try {
    console.log(
      "Connecting to PostgreSQL...",
    );

    await pool.query("SELECT 1");

    console.log(
      "PostgreSQL connection established",
    );

    await runMigrations(pool);

    const app = createApp(pool);

    const httpServer =
      createServer(app);

    server = httpServer;

    await new Promise<void>(
      (resolve, reject) => {
        const handleError = (
          error: Error,
        ): void => {
          httpServer.off(
            "listening",
            handleListening,
          );

          reject(error);
        };

        const handleListening =
          (): void => {
            httpServer.off(
              "error",
              handleError,
            );

            resolve();
          };

        httpServer.once(
          "error",
          handleError,
        );

        httpServer.once(
          "listening",
          handleListening,
        );

        httpServer.listen(
          env.port,
          "0.0.0.0",
        );
      },
    );

    console.log(
      `Server listening on port ${env.port}`,
    );

    stopRetentionWorker =
      startRetentionWorker(pool);

    console.log(
      "Retention worker started",
    );
  } catch (error: unknown) {
    console.error(
      "Failed to start server:",
      error,
    );

    if (
      stopRetentionWorker !== undefined
    ) {
      await stopRetentionWorker();

      stopRetentionWorker =
        undefined;
    }

    try {
      await pool.end();
    } catch (poolError: unknown) {
      console.error(
        "Failed to close PostgreSQL pool:",
        poolError,
      );
    }

    process.exit(1);
  }
}

async function shutdown(
  signal: string,
): Promise<void> {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;

  console.log(
    `${signal} received. Shutting down gracefully...`,
  );

  const forceShutdownTimer =
    setTimeout(() => {
      console.error(
        "Graceful shutdown timed out",
      );

      process.exit(1);
    }, 10_000);

  forceShutdownTimer.unref();

  try {
    // 1. Stop retention worker first
    if (
      stopRetentionWorker !== undefined
    ) {
      const stopWorker =
        stopRetentionWorker;

      stopRetentionWorker =
        undefined;

      await stopWorker();

      console.log(
        "Retention worker stopped",
      );
    }

    // 2. Stop HTTP server
    if (
      server !== undefined &&
      server.listening
    ) {
      await new Promise<void>(
        (resolve, reject) => {
          server?.close(
            (error?: Error) => {
              if (error) {
                reject(error);
                return;
              }

              resolve();
            },
          );
        },
      );

      console.log(
        "HTTP server stopped",
      );
    }

    // 3. Close PostgreSQL connections
    await pool.end();

    clearTimeout(
      forceShutdownTimer,
    );

    console.log(
      "Shutdown completed",
    );

    process.exit(0);
  } catch (error: unknown) {
    clearTimeout(
      forceShutdownTimer,
    );

    console.error(
      "Error during graceful shutdown:",
      error,
    );

    process.exit(1);
  }
}

process.on(
  "SIGTERM",
  () => {
    void shutdown("SIGTERM");
  },
);

process.on(
  "SIGINT",
  () => {
    void shutdown("SIGINT");
  },
);

void startServer();