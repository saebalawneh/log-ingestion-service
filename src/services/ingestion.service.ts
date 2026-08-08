import type { Pool } from "pg";
import { insertLogs } from "../repositories/logs.repository.js";
import type { LogEntry, RejectedLog } from "../types/logs.js";
import { validateLog } from "../validation/log-validation.js";

export type IngestionResult = {
  accepted: number;
  rejected: RejectedLog[];
};

export async function ingestLogs(
  pool: Pool,
  inputs: unknown[],
): Promise<IngestionResult> {
  const validLogs: LogEntry[] = [];
  const rejected: RejectedLog[] = [];

  const nowMs = Date.now();

  for (const [index, input] of inputs.entries()) {
    const result = validateLog(input, index, nowMs);

    if (result.ok) {
      validLogs.push(result.log);
    } else {
      rejected.push(result.rejection);
    }
  }

  if (validLogs.length > 0) {
    await insertLogs(pool, validLogs);
  }

  return {
    accepted: validLogs.length,
    rejected,
  };
}