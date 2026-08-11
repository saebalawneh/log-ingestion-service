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

export type LogQuery = {
  service?: string;
  level?: LogLevel;
  since?: string;
  until?: string;
  q?: string;
  attributes: Record<string, string>;
  limit: number;
};

export type LogQueryValidationResult =
  | {
      ok: true;
      query: LogQuery;
    }
  | {
      ok: false;
      error: string;
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

    export type StoredLog = {
  id: string;
  timestamp: Date;
  level: LogLevel;
  service: string;
  message: string;
  attributes: LogAttributes;
};