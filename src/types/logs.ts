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

export type LogCursor = {
  timestamp: string;
  id: string;
};

export type LogQuery = {
  service?: string;
  level?: LogLevel;
  since?: string;
  until?: string;
  q?: string;
  attributes: Record<string, string>;
  limit: number;
  cursor?: LogCursor;
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


export const AGGREGATE_BUCKETS = [
  "1m",
  "5m",
  "1h",
  "1d",
] as const;

export type AggregateBucket =
  (typeof AGGREGATE_BUCKETS)[number];

export const AGGREGATE_GROUPS = [
  "service",
  "level",
] as const;

export type AggregateGroupBy =
  (typeof AGGREGATE_GROUPS)[number];

export type AggregateQuery = {
  since: string;
  until: string;
  bucket: AggregateBucket;
  groupBy?: AggregateGroupBy;

  service?: string;
  level?: LogLevel;
  q?: string;

  attributes: Record<string, string>;
};

export type AggregateQueryValidationResult =
  | {
      ok: true;
      query: AggregateQuery;
    }
  | {
      ok: false;
      error: string;
    };

export type AggregateBucketResult = {
  start: string;
  group: string | null;
  count: number;
};