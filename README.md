# Log Ingestion and Query Service

A high-performance log ingestion, querying, aggregation, and retention service built with TypeScript, Node.js, Express, and PostgreSQL.

The service is designed to ingest large batches of structured logs, support flexible filtered queries, provide time-bucketed aggregations, automatically remove expired data, and remain responsive while ingestion is under load.

PostgreSQL is the source of truth for all log data.

## Features

- Batch log ingestion with per-entry validation and partial success.
- Durable PostgreSQL-backed storage.
- Filtering by service, level, time range, attributes, and message text.
- Opaque cursor-based keyset pagination.
- Time-bucketed aggregation with optional grouping by service or level.
- One-minute rollups for efficient aggregation.
- Hybrid aggregation using rollups for complete minutes and raw logs for partial time boundaries.
- Configurable batched log retention.
- Transactional consistency between raw logs and rollup counts.
- Automatic database migrations and one-time rollup backfill.
- Health checks for database readiness.
- Graceful shutdown handling.
- Docker Compose setup with persistent PostgreSQL storage.
- Unit and integration tests.
- GitHub Actions continuous integration.
- Reproducible load and performance testing.

---

## Architecture

```text
                         ┌─────────────────────┐
                         │       Client        │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │   Express HTTP API  │
                         │                     │
                         │  POST /logs         │
                         │  GET  /logs         │
                         │  GET  /logs/aggregate
                         │  GET  /health       │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │      Services       │
                         │                     │
                         │  Validation         │
                         │  Ingestion          │
                         │  Queries            │
                         │  Aggregation        │
                         │  Retention          │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │    Repositories     │
                         │ Parameterized SQL   │
                         └──────────┬──────────┘
                                    │
                                    ▼
                    ┌──────────────────────────────┐
                    │          PostgreSQL          │
                    │                              │
                    │  logs                        │
                    │  log_rollups_1m              │
                    │  schema_migrations           │
                    └──────────────────────────────┘
```

### Ingestion Flow

### Ingestion Flow

```text
POST /logs
    ↓
Validate each entry independently
    ↓
Separate valid and rejected entries
    ↓
Micro-batching coordinator
    ↓
Coalesce nearby concurrent requests
    ↓
Raw log insert + rollup update
    ↓
PostgreSQL confirms durable write
    ↓
Resolve original requests
    ↓
Return accepted/rejected results
```

### Aggregation Flow

```text
GET /logs/aggregate
         ↓
Can the request use rollups?
         │
         ├── Yes
         │    ↓
         │  Raw partial boundary
         │       +
         │  Complete-minute rollups
         │       +
         │  Raw partial boundary
         │       ↓
         │   Combined result
         │
         └── No
              ↓
         Raw log aggregation
```

Requests containing `q` or `attr.<key>` filters fall back to raw-log aggregation because message text and arbitrary attributes are not stored in the rollup table.

---

## Technology Stack

- **Runtime:** Node.js 22
- **Language:** TypeScript
- **HTTP Framework:** Express 5
- **Database:** PostgreSQL 17
- **PostgreSQL Client:** `pg`
- **Testing:** Vitest and Supertest
- **Containers:** Docker and Docker Compose
- **CI:** GitHub Actions

---

# Getting Started

## Prerequisites

The recommended way to run the project is Docker Compose.

Required:

- Docker
- Docker Compose

For development outside Docker:

- Node.js 22
- npm
- PostgreSQL

---

## Run with Docker Compose

Build and start the complete application:

```bash
docker compose up --build
```

Or start it in the background:

```bash
docker compose up --build -d
```

Docker Compose starts:

- PostgreSQL 17.
- The application server.
- PostgreSQL health checking.
- Application health checking.
- Automatic database migrations.
- The retention worker.

The API is exposed at:

```text
http://localhost:8080
```

Check container status:

```bash
docker compose ps
```

Stop the application:

```bash
docker compose down
```

PostgreSQL data is stored in the named `postgres_data` volume.

A normal:

```bash
docker compose down
```

does not delete the stored database.

To remove the containers **and all PostgreSQL data**:

```bash
docker compose down -v
```

> **Warning:** `docker compose down -v` permanently removes the PostgreSQL volume for this Compose project.

---

# Configuration

Retention behavior can be customized using environment variables.

The example configuration is available in:

```text
.env.example
```

To create a local configuration file:

```bash
cp .env.example .env
```

## Retention Variables

| Variable | Default | Description |
|---|---:|---|
| `RETENTION_DAYS` | `30` | Logs older than this number of days are eligible for deletion. |
| `RETENTION_BATCH_SIZE` | `1000` | Maximum number of expired logs processed in each deletion batch. |
| `RETENTION_SWEEP_INTERVAL_MS` | `60000` | Delay between completed retention sweeps, in milliseconds. |

All retention settings must be positive integers.

Invalid values cause application startup to fail instead of silently using invalid configuration.

## Application Variables

When running the application outside Docker, these variables are also relevant:

| Variable | Default | Description |
|---|---:|---|
| `PORT` | `8080` | HTTP server port. |
| `DATABASE_URL` | Required | PostgreSQL connection string. |
| `NODE_ENV` | `development` | Node.js environment. |

Docker Compose configures `PORT`, `DATABASE_URL`, and `NODE_ENV` automatically.

---

# Startup and Readiness

The startup sequence is:

```text
Load and validate configuration
              ↓
Connect to PostgreSQL
              ↓
Run database migrations
              ↓
Create the Express application
              ↓
Start the HTTP server
              ↓
Start the retention worker
```

The HTTP server does not begin listening until the PostgreSQL connection and migrations complete successfully.

The retention worker performs its first sweep immediately after the HTTP server starts.

After each completed sweep, the next sweep is scheduled according to `RETENTION_SWEEP_INTERVAL_MS`.

---

# API Documentation

## Health Check

### `GET /health`

Checks PostgreSQL connectivity and application readiness.

Example:

```bash
curl -i http://localhost:8080/health
```

Healthy response:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"status":"ok"}
```

If PostgreSQL is unavailable:

```http
HTTP/1.1 503 Service Unavailable
Content-Type: application/json

{"status":"unavailable"}
```

---

# Log Ingestion

## `POST /logs`

Accepts a batch of log entries.

Example request:

```bash
curl -X POST http://localhost:8080/logs \
  -H "Content-Type: application/json" \
  -d '{
    "logs": [
      {
        "timestamp": "2026-08-14T20:30:00Z",
        "level": "info",
        "service": "api",
        "message": "request completed",
        "attributes": {
          "request_id": "req-100",
          "duration_ms": 42,
          "cached": false
        }
      },
      {
        "timestamp": "2026-08-14T20:30:01Z",
        "level": "error",
        "service": "auth",
        "message": "authentication failed",
        "attributes": {
          "region": "eu-west",
          "user_id": "42"
        }
      }
    ]
  }'
```

Successful response:

```json
{
  "accepted": 2,
  "rejected": []
}
```

---

## Log Validation Rules

Each log entry is validated independently.

### `timestamp`

Required.

Must be a valid ISO 8601 date-time containing a timezone.

Example:

```text
2026-08-14T20:30:00Z
```

A timestamp cannot be more than five minutes in the future.

### `level`

Required.

Allowed values:

```text
debug
info
warn
error
```

### `service`

Required non-empty string.

### `message`

Required non-empty string.

### `attributes`

Optional flat object.

Allowed attribute value types:

- string
- number
- boolean

Example:

```json
{
  "request_id": "req-123",
  "duration_ms": 75,
  "cached": true
}
```

Nested objects, arrays, `null`, and other unsupported values are rejected.

---

## Partial Batch Success

Invalid entries do not cause valid entries from the same batch to be discarded.

Example request containing one valid and one invalid entry:

```bash
curl -X POST http://localhost:8080/logs \
  -H "Content-Type: application/json" \
  -d '{
    "logs": [
      {
        "timestamp": "2026-08-14T20:30:00Z",
        "level": "info",
        "service": "api",
        "message": "valid log"
      },
      {
        "timestamp": "2026-08-14T20:30:01Z",
        "level": "critical",
        "service": "api",
        "message": "invalid level"
      }
    ]
  }'
```

Response:

```json
{
  "accepted": 1,
  "rejected": [
    {
      "index": 1,
      "reason": "level must be debug, info, warn, or error"
    }
  ]
}
```

If at least one entry is accepted, the endpoint returns HTTP `200`.

If all entries are rejected, the endpoint returns HTTP `400`.

---

## Invalid Top-Level Requests

The request body must be a JSON object containing a non-empty `logs` array.

Example error:

```json
{
  "error": "logs must be a non-empty array"
}
```

Malformed JSON returns:

```json
{
  "error": "invalid JSON"
}
```

The JSON request body is limited to `10 MB`.

Requests exceeding the limit return HTTP `413`:

```json
{
  "error": "request body too large"
}
```

---

# Query Logs

## `GET /logs`

Returns logs ordered by:

```text
timestamp DESC
id DESC
```

The internal ID is used for deterministic pagination but is not returned in the public log representation.

Example:

```bash
curl "http://localhost:8080/logs?service=api&level=info&limit=100"
```

Example response:

```json
{
  "logs": [
    {
      "timestamp": "2026-08-14T20:30:00.000Z",
      "level": "info",
      "service": "api",
      "message": "request completed",
      "attributes": {
        "request_id": "req-100",
        "duration_ms": 42
      }
    }
  ],
  "next_cursor": null
}
```

---

## Query Parameters

| Parameter | Required | Description |
|---|---|---|
| `service` | No | Exact service-name filter. |
| `level` | No | `debug`, `info`, `warn`, or `error`. |
| `since` | No | Inclusive start timestamp. |
| `until` | No | Exclusive end timestamp. |
| `q` | No | Case-insensitive substring search in the message. |
| `attr.<key>` | No | Attribute equality filter. |
| `limit` | No | Page size. Default `100`, maximum `1000`. |
| `cursor` | No | Opaque cursor returned by the previous page. |

All supplied filters are combined using logical `AND`.

Example:

```bash
curl "http://localhost:8080/logs?service=api&level=error&attr.region=eu-west&limit=50"
```

This returns logs that satisfy all supplied filters.

---

## Time Filtering

Example:

```bash
curl "http://localhost:8080/logs?since=2026-08-14T20:00:00Z&until=2026-08-14T21:00:00Z"
```

Time-range semantics are:

```text
timestamp >= since
timestamp < until
```

Therefore:

- `since` is inclusive.
- `until` is exclusive.

---

## Attribute Filtering

Attributes can be queried using the `attr.<key>` syntax.

Example:

```bash
curl "http://localhost:8080/logs?attr.region=eu-west"
```

Multiple attribute filters can be combined:

```bash
curl "http://localhost:8080/logs?attr.region=eu-west&attr.request_id=req-100"
```

Attribute filter values are compared using their string representation.

---

## Message Search

Use `q` for a case-insensitive substring search of log messages.

Example:

```bash
curl "http://localhost:8080/logs?q=timeout"
```

---

# Cursor Pagination

The service uses keyset pagination rather than SQL `OFFSET`.

The ordering key is:

```text
(timestamp DESC, id DESC)
```

When another page is available, the response contains an opaque `next_cursor`:

```json
{
  "logs": [
    {
      "timestamp": "2026-08-14T20:30:00.000Z",
      "level": "info",
      "service": "api",
      "message": "request completed",
      "attributes": {}
    }
  ],
  "next_cursor": "eyJ0aW1lc3RhbXAiOi..."
}
```

Use the returned cursor without modifying or decoding it:

```bash
curl "http://localhost:8080/logs?limit=100&cursor=eyJ0aW1lc3RhbXAiOi..."
```

Invalid cursors return HTTP `400`:

```json
{
  "error": "invalid cursor"
}
```

Keyset pagination avoids increasingly expensive database offsets and provides stable pagination while new logs are being ingested.

---

# Aggregate Logs

## `GET /logs/aggregate`

Returns time-bucketed log counts.

The following parameters are required:

- `since`
- `until`
- `bucket`

Supported bucket sizes:

```text
1m
5m
1h
1d
```

Optional grouping:

```text
group_by=service
group_by=level
```

The endpoint also supports:

- `service`
- `level`
- `q`
- `attr.<key>`

---

## Aggregate Example

```bash
curl "http://localhost:8080/logs/aggregate?since=2026-08-14T20:00:00Z&until=2026-08-14T21:00:00Z&bucket=5m&group_by=service"
```

Example response:

```json
{
  "buckets": [
    {
      "start": "2026-08-14T20:00:00.000Z",
      "group": "api",
      "count": 1250
    },
    {
      "start": "2026-08-14T20:00:00.000Z",
      "group": "auth",
      "count": 320
    }
  ]
}
```

Without `group_by`, `group` is `null`:

```json
{
  "buckets": [
    {
      "start": "2026-08-14T20:00:00.000Z",
      "group": null,
      "count": 1570
    }
  ]
}
```

Results are returned in ascending bucket order.

Empty buckets may be omitted.

---

# Aggregation Strategy

Aggregation uses two execution paths.

## Rollup Fast Path

Requests that can be answered from:

- time range
- service
- level
- grouping

can use the `log_rollups_1m` summary table.

Instead of repeatedly scanning every raw log, the database can aggregate a much smaller set of one-minute summary rows.

Larger buckets such as:

```text
5m
1h
1d
```

are created by re-binning and summing the one-minute rollups.

## Partial Time Boundaries

A one-minute rollup represents a complete minute.

For a request such as:

```text
since = 10:00:30
until = 10:03:20
```

the service uses:

```text
10:00:30 → 10:01:00    raw logs
10:01:00 → 10:03:00    rollups
10:03:00 → 10:03:20    raw logs
```

The raw boundary results and rollup results are then combined.

This preserves exact `since` inclusive and `until` exclusive semantics.

## Raw Aggregation Fallback

The rollup table does not contain the raw message or arbitrary attributes.

Therefore requests containing:

```text
q
```

or:

```text
attr.<key>
```

are aggregated from the raw `logs` table to preserve correctness.

---

# Database Design

## Raw Logs

The main `logs` table stores the canonical raw log records.

Simplified schema:

```sql
CREATE TABLE logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL,
  level TEXT NOT NULL,
  service TEXT NOT NULL,
  message TEXT NOT NULL,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

`attributes` uses PostgreSQL `JSONB` to support arbitrary flat log attributes while keeping PostgreSQL as the durable source of truth.

---

## Query Index

The main query index is:

```sql
CREATE INDEX idx_logs_timestamp_id
ON logs (
  timestamp DESC,
  id DESC
);
```

This index matches the primary log ordering:

```text
timestamp DESC
id DESC
```

and supports keyset pagination.

Additional indexes were not added blindly.

Query plans were measured using PostgreSQL `EXPLAIN ANALYZE`, and an experimental aggregate covering index did not improve the target workload, so it was not kept.

---

# One-Minute Rollups

Aggregation performance is improved using:

```text
log_rollups_1m
```

Simplified structure:

```sql
CREATE TABLE log_rollups_1m (
  bucket_start TIMESTAMPTZ NOT NULL,
  service TEXT NOT NULL,
  level TEXT NOT NULL,
  count BIGINT NOT NULL CHECK (count >= 0),

  PRIMARY KEY (
    bucket_start,
    service,
    level
  )
);
```

Each row stores a count for one combination of:

```text
minute
service
level
```

Example:

```text
bucket_start          service    level    count
------------------------------------------------
20:00                 api        info      500
20:00                 api        error      20
20:00                 auth       info      300
20:01                 api        info      480
```

---

# Atomic Raw + Rollup Writes

# Atomic Raw + Rollup Writes

For normal batches, ingestion combines raw-log insertion and rollup updates
inside one PostgreSQL statement using a writable CTE.

Conceptually:

```text
Raw log INSERT
       +
Rollup UPSERT
       ↓
Single PostgreSQL statement
       ↓
Success

---

# Migrations and Rollup Backfill

Database schema initialization runs automatically during application startup.

The migration process creates:

```text
logs
log_rollups_1m
schema_migrations
```

and the query index if they do not already exist.

The rollup backfill migration is recorded as:

```text
001_backfill_log_rollups_1m
```

On its first execution, existing raw logs are grouped into one-minute rollups.

After the migration succeeds, it is recorded in `schema_migrations`.

This prevents the backfill from running again on every application restart and avoids double-counting existing logs.

The migration and backfill execute transactionally.

---

# Retention

Expired logs are removed automatically by the retention worker.

The cutoff is determined from:

```text
RETENTION_DAYS
```

Deletion is performed in batches to avoid a single large delete transaction.

Conceptually:

```text
Find expired raw logs
        ↓
Lock affected rows
        ↓
Calculate affected rollup counts
        ↓
Delete raw logs
        ↓
Decrement rollups
        ↓
Remove zero-count rollup rows
        ↓
COMMIT
```

Raw deletion and rollup adjustment happen in the same transaction.

If rollup consistency validation fails, the transaction is rolled back rather than deleting the raw logs and leaving incorrect aggregate counts.

The retention implementation also uses bounded batches so large expiration events do not require deleting all expired data in one transaction.

---

# Reliability

## Transactional Ingestion

Raw logs and derived rollups are updated atomically.

## Transactional Retention

Raw log deletion and rollup decrements are performed atomically.

## Partial Batch Validation

An invalid entry does not discard valid entries in the same ingestion batch.

## Deterministic Lock Ordering

Rollup rows are updated in a consistent order to avoid concurrent transaction deadlocks.

## Readiness Checks

The application verifies PostgreSQL during startup and through `GET /health`.

## Graceful Shutdown

The application handles:

```text
SIGTERM
SIGINT
```

Shutdown sequence:

```text
Stop retention scheduling
        ↓
Stop HTTP server
        ↓
Close PostgreSQL pool
        ↓
Exit
```

A 10-second safety timeout prevents the process from hanging indefinitely during shutdown.

---

# Security Considerations

The service includes several defensive measures:

- SQL queries are parameterized.
- User-controlled values are not directly interpolated into SQL.
- Dynamic aggregation/grouping choices are validated against explicit allowlists.
- Log levels are validated against an explicit allowlist.
- Cursor contents are validated before use.
- Malformed JSON is rejected.
- JSON request bodies are limited to `10 MB`.
- Express `X-Powered-By` is disabled.
- Internal server errors are not returned to clients as stack traces.
- The production Docker container runs as the non-root `node` user.
- Only production dependencies are installed in the final Docker image.

Authentication is not enabled in the current core implementation.

For an internet-facing production deployment, authentication and authorization should typically be added at the service or gateway layer.

---

# Testing

The project contains both unit and integration tests.

Current automated test suite:

```text
Test Files: 9 passed
Tests:      92 passed
```

Coverage includes:

- ingestion validation
- partial batch success
- malformed requests
- query validation
- cursor validation
- keyset pagination
- filtering
- aggregation validation
- grouping
- hybrid rollup boundaries
- one-minute aggregation
- one-hour aggregation
- one-day aggregation
- raw fallback for `q`
- raw fallback for attribute filtering
- retention cutoff behavior
- batched retention
- raw/rollup consistency
- rollback behavior when rollup consistency is invalid
- repeated scalar query-parameter rejection
- retention-worker shutdown synchronization
- ingestion micro-batching
- durability of coalesced writes
- database failure propagation
- maximum micro-batch sizing
---

## Run Tests Locally

Start the test PostgreSQL container:

```bash
docker compose -f compose.test.yaml up -d
```

Check that it is healthy:

```bash
docker compose -f compose.test.yaml ps
```

Install dependencies:

```bash
npm ci
```

Run the TypeScript type check:

```bash
npm run typecheck
```

Build:

```bash
npm run build
```

Run all tests:

```bash
npm test
```

Stop the test database when finished:

```bash
docker compose -f compose.test.yaml down
```

---

# Continuous Integration

GitHub Actions runs the CI workflow on:

```text
push
pull_request
```

The CI job:

```text
Checkout repository
        ↓
Start PostgreSQL 17 service
        ↓
Setup Node.js 22
        ↓
npm ci
        ↓
npm run typecheck
        ↓
npm run build
        ↓
npm test
```

The workflow is located at:

```text
.github/workflows/ci.yml
```

The PostgreSQL CI service uses the same database name and local port expected by the integration tests.

The performance benchmark is intentionally not used as a normal CI pass/fail test because performance measurements depend on machine resources and workload contention.

---

# Performance Testing

A separate performance environment is provided in:

```text
compose.perf.yaml
```

The benchmark harness is:

```text
scripts/perf.mjs
```

and can be started with:

```bash
npm run perf
```

The full benchmark methodology, investigation, query plans, rejected optimizations, and final measurements are documented in:

[PERFORMANCE.md](./PERFORMANCE.md)

---

## Performance Resource Limits

The measured workload used the project resource limits:

| Component | CPU | Memory |
|---|---:|---:|
| Application | `0.5 CPU` | `256 MB` |
| PostgreSQL | `1 CPU` | `1 GB` |

PostgreSQL remained the source of truth throughout the benchmark.

---

# Final Mixed-Load Benchmark

# Final Foothill Benchmark

The final implementation was tested three consecutive times with the provided
Foothill benchmark CLI:

```bash
npx --yes github:Ahmad-Abbas-Foothill/logs-benchmark-cli \
  --compose ./compose.yaml \
  --full \
  --seed 6122026 \
  --runner docker \
  --generator-cpus 4

---

# Performance Requirements

# Performance Requirements

| Requirement | Result | Status |
|---|---:|---|
| Correctness | `15/15` | PASS |
| Zero ingestion errors | `0%` | PASS |
| Ingestion throughput | `14,866–14,999 logs/sec` | ENVIRONMENT DEPENDENT |
| Aggregate p95 < `1 second` | `65–75 ms` | PASS |
| Eventual consistency | `4/4` | PASS |
| Reliability | `20/20` | PASS |
| Application <= `0.5 CPU / 256 MB` | Verified | PASS |
| PostgreSQL <= `1 CPU / 1 GB` | Verified | PASS |

Dedicated local ingestion testing also exceeded the required `15,000
logs/sec` target.

The Foothill benchmark reported the test machine at approximately `0.55x`
of the reference machine.

---

# Performance Investigation

The first mixed workload did not meet all target requirements.

Initial results were approximately:

```text
Throughput:      12.6K logs/sec
Aggregate p95:   1.9 seconds
```

Investigation showed that raw aggregation over a large active log set was the primary source of database contention.

Several approaches were measured before changing the architecture.

These included:

- ingestion concurrency tuning
- larger ingestion batches
- PostgreSQL parallelism changes
- aggregate covering-index experiments

Not all experiments improved the complete system.

For example, an experimental covering index was slower than the planner-selected sequential scan for the tested aggregation workload, so the index was removed.

The final optimization introduced one-minute rollups with a hybrid raw/rollup aggregate path.

This reduced repeated aggregation work while preserving exact query semantics.

Detailed measurements are available in [PERFORMANCE.md](./PERFORMANCE.md).
## Raw Boundary Scan Optimization

Profiling showed that the rollup lookup itself was already extremely fast.

A representative isolated rollup query completed in approximately:

```text
0.267 ms

---

# Query Plan Verification

PostgreSQL `EXPLAIN ANALYZE` was used during performance investigation.

The normal log query was able to use:

```text
idx_logs_timestamp_id
```

while the original raw aggregation workload frequently required scanning a large portion of the active log dataset.

After the rollup optimization, a representative rollup query operated on only a small summary relation.

One measured plan used:

```text
33 rollup rows
24 kB aggregate memory
7 shared buffer hits
0.159 ms execution time
```

This isolated database execution time is different from full HTTP endpoint latency under mixed ingestion load.

The final measured aggregate endpoint p95 under load was:

```text
65–75 ms across three consecutive final full benchmark runs
```

---

# Trade-offs and Known Limitations

## Raw Fallback for Message Search

One-minute rollups do not store full message text.

Therefore aggregate queries using:

```text
q
```

must scan raw logs.

This preserves correctness but may be slower than the rollup fast path.

## Raw Fallback for Arbitrary Attributes

The rollup table stores:

```text
bucket_start
service
level
count
```

It does not store every arbitrary JSON attribute.

Aggregate queries using:

```text
attr.<key>
```

therefore use raw logs.

Pre-aggregating every possible attribute would significantly increase storage and write amplification.

## One-Time Backfill Cost

The first deployment of the rollup migration rebuilds rollups from existing raw logs.

For a very large existing database, this one-time startup migration may take longer than a normal restart.

A larger production system could move heavy backfills to an offline or separately controlled migration process.

## Authentication

Authentication and authorization are not part of the current core implementation.

A public production deployment should add an appropriate authentication layer.

## Rollup Design

Only one-minute rollups are persisted.

Larger buckets are calculated from the one-minute summaries instead of maintaining separate tables for `5m`, `1h`, and `1d`.

This keeps the storage model simpler while still reducing raw aggregation work.

---

# Project Structure

```text
.
├── .github/
│   └── workflows/
│       └── ci.yml
│
├── scripts/
│   └── perf.mjs
│
├── src/
│   ├── config/
│   │   └── env.ts
│   │
│   ├── db/
│   │   ├── migrate.ts
│   │   └── pool.ts
│   │
│   ├── repositories/
│   │   ├── aggregate.repository.ts
│   │   ├── logs.repository.ts
│   │   └── retention.repository.ts
│   │
│   ├── routes/
│   │   └── logs.routes.ts
│   │
│   ├── services/
│   │   ├── aggregate.service.ts
│   │   ├── ingestion.service.ts
│   │   ├── query.service.ts
│   │   └── retention.service.ts
│   │
│   ├── types/
│   │   └── logs.ts
│   │
│   ├── utils/
│   │   └── log-cursor.ts
│   │
│   ├── validation/
│   │   ├── aggregate-query-validation.ts
│   │   ├── log-query-validation.ts
│   │   └── log-validation.ts
│   │
│   ├── workers/
│   │   └── retention.worker.ts
│   │
│   ├── app.ts
│   └── server.ts
│
├── tests/
│   ├── integration/
│   │   ├── logs-aggregate-api.test.ts
│   │   ├── logs-api.test.ts
│   │   ├── logs-query-api.test.ts
│   │   └── retention.test.ts
│   │
│   └── unit/
│       ├── aggregate-query-validation.test.ts
│       ├── log-query-validation.test.ts
│       └── log-validation.test.ts
│
├── .dockerignore
├── .env.example
├── .gitignore
├── compose.perf.yaml
├── compose.test.yaml
├── compose.yaml
├── Dockerfile
├── package.json
├── package-lock.json
├── PERFORMANCE.md
├── tsconfig.json
└── vitest.config.ts
```

---

# Development Commands

Install dependencies:

```bash
npm ci
```

Start the development server with file watching:

```bash
npm run dev
```

Type-check the project:

```bash
npm run typecheck
```

Create the production JavaScript build:

```bash
npm run build
```

Run the compiled application:

```bash
npm start
```

Run tests:

```bash
npm test
```

Run tests in watch mode:

```bash
npm run test:watch
```

Run the performance harness:

```bash
npm run perf
```

---

# Docker Image Design

The Dockerfile uses a multi-stage build.

## Builder Stage

The builder:

```text
Node.js 22
    ↓
npm ci
    ↓
TypeScript compilation
    ↓
dist/
```

## Production Stage

The production image:

- installs production dependencies only
- copies the compiled `dist` directory
- exposes port `8080`
- runs as the non-root `node` user

This keeps development-only dependencies out of the final runtime image.

---

# Graceful Shutdown

The application listens for:

```text
SIGTERM
SIGINT
```

The shutdown sequence is:

```text
Stop retention worker scheduling
             ↓
Close HTTP server
             ↓
Close PostgreSQL connection pool
             ↓
Exit successfully
```

A 10-second forced-shutdown timer prevents indefinite shutdown hangs.

---

# Error Responses

Validation errors return HTTP `400` with a descriptive message:

```json
{
  "error": "level must be debug, info, warn, or error"
}
```

Malformed JSON:

```json
{
  "error": "invalid JSON"
}
```

Request body too large:

```json
{
  "error": "request body too large"
}
```

Invalid cursor:

```json
{
  "error": "invalid cursor"
}
```

Unexpected server-side errors return:

```json
{
  "error": "internal server error"
}
```

Internal exception details and stack traces are not exposed to API clients.

---

# Design Summary

The main design goals of the project are:

1. **Correctness**
   - strict input validation
   - exact time-boundary semantics
   - transactional raw/rollup consistency

2. **Performance**
   - multi-row ingestion
   - keyset pagination
   - one-minute aggregation rollups
   - batched retention

3. **Reliability**
   - PostgreSQL as the durable source of truth
   - automatic migrations
   - health checks
   - graceful shutdown that waits for any active retention sweep before closing HTTP and PostgreSQL connections
   - rollback on inconsistent operations

4. **Maintainability**
   - route, service, repository, validation, and worker separation
   - strict TypeScript
   - automated testing
   - automated CI

5. **Measured Optimization**
   - bottlenecks were identified using load tests and query plans
   - unsuccessful optimizations were rejected rather than kept without evidence
   - final performance results were measured under explicit CPU and memory limits