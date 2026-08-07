import { createServer, type Server } from "node:http";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { runMigrations } from "./db/migrate.js";
import { pool } from "./db/pool.js";

let server: Server | undefined;
let isShuttingDown = false;

async function startServer(): Promise<void> {
  try {
    console.log("Connecting to PostgreSQL...");

    await pool.query("SELECT 1");

    console.log("PostgreSQL connection established");

    await runMigrations(pool);

    const app = createApp(pool);

    server = createServer(app);

    server.listen(env.port, "0.0.0.0", () => {
      console.log(`Server listening on port ${env.port}`);
    });
  } catch (error: unknown) {
    console.error("Failed to start server:", error);
    await pool.end();
    process.exit(1);
  }
}

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;

  console.log(`${signal} received. Shutting down gracefully...`);

  const forceShutdownTimer = setTimeout(() => {
    console.error("Graceful shutdown timed out");
    process.exit(1);
  }, 10_000);

  forceShutdownTimer.unref();

  if (server) {
    await new Promise<void>((resolve, reject) => {
      server?.close((error?: Error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  await pool.end();

  console.log("Shutdown completed");
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

void startServer();