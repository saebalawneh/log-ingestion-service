import type { Pool } from "pg";
import { findLogs } from "../repositories/logs.repository.js";
import type {
  LogEntry,
  LogQuery,
} from "../types/logs.js";

export type GetLogsResult = {
  logs: LogEntry[];
  next_cursor: null;
};

export async function getLogs(
  pool: Pool,
  query: LogQuery,
): Promise<GetLogsResult> {
  const storedLogs = await findLogs(pool, query);

  const logs: LogEntry[] = storedLogs.map((log) => ({
    timestamp: log.timestamp.toISOString(),
    level: log.level,
    service: log.service,
    message: log.message,
    attributes: log.attributes,
  }));

  return {
    logs,
    next_cursor: null,
  };
}