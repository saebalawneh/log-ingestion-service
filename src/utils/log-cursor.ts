import type { LogCursor } from "../types/logs.js";

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

export function encodeLogCursor(
  cursor: LogCursor,
): string {
  const json = JSON.stringify(cursor);

  return Buffer.from(
    json,
    "utf8",
  ).toString("base64url");
}

export function decodeLogCursor(
  value: string,
): LogCursor | null {
  try {
    const json = Buffer.from(
      value,
      "base64url",
    ).toString("utf8");

    const parsed: unknown = JSON.parse(json);

    if (!isRecord(parsed)) {
      return null;
    }

    if (
      typeof parsed.timestamp !== "string" ||
      !Number.isFinite(Date.parse(parsed.timestamp))
    ) {
      return null;
    }

    if (
      typeof parsed.id !== "string" ||
      !/^[1-9]\d*$/.test(parsed.id)
    ) {
      return null;
    }

    return {
      timestamp: parsed.timestamp,
      id: parsed.id,
    };
  } catch {
    return null;
  }
}