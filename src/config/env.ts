import "dotenv/config";

function getRequiredEnvironmentVariable(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? "8080");

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT value: ${value}`);
  }

  return port;
}

function parsePositiveInteger(
  name: string,
  value: string | undefined,
  defaultValue: number,
): number {
  if (value === undefined) {
    return defaultValue;
  }

  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed <= 0
  ) {
    throw new Error(
      `${name} must be a positive integer`,
    );
  }

  return parsed;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: parsePort(process.env.PORT),
  databaseUrl: getRequiredEnvironmentVariable("DATABASE_URL"),

  retentionDays: parsePositiveInteger(
  "RETENTION_DAYS",
  process.env.RETENTION_DAYS,
  30,
),

retentionBatchSize: parsePositiveInteger(
  "RETENTION_BATCH_SIZE",
  process.env.RETENTION_BATCH_SIZE,
  1000,
),

retentionSweepIntervalMs: parsePositiveInteger(
  "RETENTION_SWEEP_INTERVAL_MS",
  process.env.RETENTION_SWEEP_INTERVAL_MS,
  60_000,
),

} as const;