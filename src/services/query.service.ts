import { encodeLogCursor } from "../utils/log-cursor.js";
import type { Pool } from "pg";
import { findLogs } from "../repositories/logs.repository.js";
import type {
  LogEntry,
  LogQuery,
} from "../types/logs.js";

export type GetLogsResult = {
  logs: LogEntry[];
  next_cursor: string | null;
};
export async function getLogs(
  pool: Pool,
  query: LogQuery,
): Promise<GetLogsResult> {
  const storedLogs = await findLogs(pool, query);

  const hasMore =
    storedLogs.length > query.limit;

  const pageLogs = hasMore
    ? storedLogs.slice(0, query.limit)
    : storedLogs;

  const logs: LogEntry[] = pageLogs.map((log) => ({
    timestamp: log.timestamp.toISOString(),
    level: log.level,
    service: log.service,
    message: log.message,
    attributes: log.attributes,
  }));

  const lastLog = pageLogs.at(-1);

  const nextCursor =
    hasMore && lastLog !== undefined
      ? encodeLogCursor({
          timestamp: lastLog.timestamp.toISOString(),
          id: lastLog.id,
        })
      : null;

  return {
    logs,
    next_cursor: nextCursor,
  };
}