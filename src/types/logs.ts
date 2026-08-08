export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogAttributeValue = string | number | boolean;

export type LogAttributes = Record<string, LogAttributeValue>;

export type LogEntry = {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  attributes: LogAttributes;
};

export type RejectedLog = {
  index: number;
  reason: string;
};

export type ValidationResult =
  | {
      ok: true;
      log: LogEntry;
    }
  | {
      ok: false;
      rejection: RejectedLog;
    };