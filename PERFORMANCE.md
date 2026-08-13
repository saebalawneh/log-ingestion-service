# Performance Report

## Overview

This document describes the performance methodology, experiments,
bottleneck analysis, optimizations, and final measured results for the
log ingestion and query service.

The main performance requirements evaluated were:

- Sustain at least 15,000 ingested logs per second.
- Reject no valid logs and avoid ingestion failures.
- Keep aggregate query p95 latency below 1 second during ingestion.
- Keep newly ingested logs queryable within 20 seconds.
- Run within the required application and PostgreSQL resource limits.

---

## Environment

### Application

- Runtime: Node.js 22
- Language: TypeScript
- CPU limit: 0.5 CPU
- Memory limit: 256 MB

### PostgreSQL

- PostgreSQL version: 17
- CPU limit: 1 CPU
- Memory limit: 1 GB

### Execution Environment

The service and PostgreSQL were run through Docker Compose.

The configured resource limits were verified using `docker inspect`.

---

## Load Test Methodology

The benchmark uses concurrent HTTP traffic against the running service.

During the final mixed workload it performs:

- Batched `POST /logs` ingestion.
- Filtered `GET /logs` requests every 250 ms.
- `GET /logs/aggregate` requests every 1 second.
- A post-test visibility check for a newly ingested log.

Final benchmark configuration:

- Duration: 60 seconds
- Ingestion concurrency: 4
- Batch size: 2,000 logs
- Query interval: 250 ms
- Aggregate interval: 1,000 ms

The benchmark records:

- attempted logs
- accepted logs
- rejected logs
- ingestion errors
- ingestion throughput
- ingestion p95 latency
- query p95 latency
- aggregate p95 latency
- visibility latency

---

# Initial Bottleneck Investigation

## Initial Mixed Workload

An early mixed workload used:

- Duration: 60 seconds
- Concurrency: 8
- Batch size: 500

Results:

- Accepted logs: 764,000
- Rejected logs: 0
- Ingestion errors: 0
- Throughput: 12,640.65 logs/sec
- Ingestion p95: 678.64 ms
- Query p95: 309.17 ms
- Aggregate p95: 1,908.41 ms
- Visibility latency: 543.51 ms

The workload failed both the ingestion throughput requirement and the
aggregate latency requirement.

Observed PostgreSQL CPU utilization was close to its 1 CPU limit.

---

## Query Plan Investigation

The normal filtered `GET /logs` query was inspected with:

`EXPLAIN (ANALYZE, BUFFERS)`

PostgreSQL used the existing:

`idx_logs_timestamp_id`

index.

A representative query completed in approximately:

- 0.869 ms database execution time

This indicated that the normal log query path was not the main
performance bottleneck.

The aggregate query behaved differently.

On a data set of approximately 764,000 recent logs, PostgreSQL chose a
parallel sequential scan.

Representative execution times while the database was otherwise idle
were approximately:

- grouped aggregation: 246 ms
- ungrouped aggregation: 157 ms

The sequential scan was reasonable because nearly the entire benchmark
data set fell inside the requested time window.

Under concurrent ingestion, however, repeated aggregation created heavy
PostgreSQL CPU contention.

---

# Diagnostic Experiments

## Ingestion-Focused Diagnostic Test

Configuration:

- Duration: 60 seconds
- Concurrency: 8
- Batch size: 1,000
- Query interval: 60 seconds
- Aggregate interval: 60 seconds

Results:

- Attempted logs: 1,422,000
- Accepted logs: 1,422,000
- Rejected logs: 0
- Ingestion errors: 0
- Throughput: 23,592.01 logs/sec
- Ingestion p95: 692.52 ms
- Query p95: 14.22 ms
- Aggregate p95: 165.74 ms
- Visibility latency: 909.38 ms

### Finding

The ingestion path exceeded the 15,000 logs/sec requirement when
frequent aggregation traffic was removed.

This showed that ingestion itself had sufficient capacity and that
mixed-workload contention was the primary problem.

---

## Aggregation Isolation Test

Configuration:

- Duration: 60 seconds
- Concurrency: 8
- Batch size: 1,000
- Query interval: 60 seconds
- Aggregate interval: 1 second

Results:

- Attempted logs: 963,000
- Accepted logs: 963,000
- Rejected logs: 0
- Ingestion errors: 0
- Throughput: 15,928.63 logs/sec
- Ingestion p95: 928.72 ms
- Query p95: 17.89 ms
- Aggregate p95: 1,628.43 ms
- Visibility latency: 642.58 ms

Observed resource usage:

- Application CPU: approximately 28–45%
- Application memory: approximately 38–52 MB
- PostgreSQL CPU: approximately 81–98%
- PostgreSQL memory: approximately 208–230 MB

### Finding

Running aggregation once per second reproduced the main performance
problem even when normal GET traffic was nearly removed.

Frequent aggregation was therefore identified as the primary source of
PostgreSQL CPU contention.

---

## Concurrency Tuning Experiment

Configuration:

- Duration: 60 seconds
- Concurrency: 6
- Batch size: 1,000
- Query interval: 60 seconds
- Aggregate interval: 1 second

Results:

- Attempted logs: 903,000
- Accepted logs: 903,000
- Rejected logs: 0
- Ingestion errors: 0
- Throughput: 14,994.25 logs/sec
- Ingestion p95: 798.87 ms
- Query p95: 19.39 ms
- Aggregate p95: 1,691.32 ms
- Visibility latency: 925.15 ms

### Finding

Reducing ingestion concurrency did not solve the aggregation latency
problem.

Throughput fell slightly below the requirement while aggregate p95
remained above one second.

Concurrency tuning alone was therefore rejected as the solution.

---

## PostgreSQL Parallelism Experiment

A single aggregate query was measured with and without PostgreSQL
parallel workers.

Results while isolated:

- Parallel enabled: 320.796 ms
- Parallel disabled: 230.730 ms

Although disabling parallel workers improved the isolated query, it
performed much worse under sustained mixed load.

### Mixed Load With Parallelism Disabled

Results:

- Accepted logs: 2,019,000
- Rejected logs: 0
- Ingestion errors: 0
- Throughput: 33,260.79 logs/sec
- Ingestion p95: 389.97 ms
- Query p95: 14.78 ms
- Aggregate p95: 3,872.59 ms
- Visibility latency: 1,111.99 ms

### Finding

The isolated microbenchmark was misleading.

Disabling parallel aggregation increased ingestion throughput but caused
aggregate latency to become significantly worse.

The configuration change was rejected and PostgreSQL's default
parallelism was restored.

---

## Large Batch / Lower Concurrency Experiment

Configuration:

- Duration: 60 seconds
- Concurrency: 4
- Batch size: 2,000
- Query interval: 60 seconds
- Aggregate interval: 1 second

Results:

- Attempted logs: 1,682,000
- Accepted logs: 1,682,000
- Rejected logs: 0
- Ingestion errors: 0
- Throughput: 28,002.30 logs/sec
- Ingestion p95: 487.91 ms
- Query p95: 9.18 ms
- Aggregate p95: 1,287.55 ms
- Visibility latency: 965.65 ms

### Finding

Increasing batch size while reducing ingestion concurrency substantially
improved ingestion throughput.

However, aggregate p95 still exceeded the one-second requirement.

Further configuration-only tuning was stopped in favor of optimizing
the aggregation architecture.

---

## Aggregate Covering Index Experiment

A covering index was tested for the aggregation workload:

`timestamp INCLUDE (service, level)`

With the normal PostgreSQL planner, the aggregate query continued to
use a parallel sequential scan.

Measured execution time:

- 458.817 ms

A diagnostic run with sequential scans disabled forced a parallel
index-only scan.

Measured result:

- Execution time: 494.182 ms
- Heap fetches: 82,089

### Finding

The forced index-only plan was slower.

The high percentage of recent rows also meant the aggregate query had
low selectivity, while active ingestion caused additional heap
visibility checks.

The covering index was therefore rejected and was not added to the
production schema.

---

# Aggregation Optimization

## Minute Rollups

Repeated aggregation over millions of raw rows was the primary
bottleneck.

A summary table was introduced:

`log_rollups_1m`

Each row stores a count grouped by:

- one-minute bucket
- service
- level

The raw `logs` table remains the source of truth.

Rollups exist only as a derived performance optimization.

---

## Atomic Dual Write

Accepted logs are now persisted to both:

- `logs`
- `log_rollups_1m`

inside the same PostgreSQL transaction.

This guarantees that a successful ingestion response cannot leave the
raw data and rollup data partially updated.

Before opening the database transaction, logs in the request are
grouped into their rollup dimensions so that only aggregate counts need
to be written.

---

## Deadlock Investigation

The first concurrent dual-write benchmark exposed PostgreSQL deadlocks
during rollup UPSERT operations.

Different concurrent transactions could attempt to lock the same
rollup rows in different orders.

The issue was fixed by sorting rollup updates deterministically by:

1. `bucket_start`
2. `service`
3. `level`

All ingestion transactions therefore acquire overlapping rollup locks
in the same order.

After this change:

- no ingestion deadlocks were observed
- no ingestion errors occurred
- raw and rollup counts remained equal under sustained load

---

## Dual-Write Throughput

A 30-second ingestion-focused benchmark was used after adding rollup
writes.

Configuration:

- Concurrency: 4
- Batch size: 2,000
- Query interval: 60 seconds
- Aggregate interval: 60 seconds

Results:

- Attempted logs: 942,000
- Accepted logs: 942,000
- Rejected logs: 0
- Ingestion errors: 0
- Throughput: 31,337.70 logs/sec
- Ingestion p95: 411.59 ms
- Query p95: 21.21 ms
- Visibility latency: 1,103.55 ms

The dual-write design therefore remained comfortably above the
15,000 logs/sec requirement.

---

# Hybrid Aggregate Fast Path

The aggregate endpoint uses two execution strategies.

## Rollup Fast Path

Requests without `q` or attribute filters use the rollup table for all
fully covered minute intervals.

Service and level filters are supported directly from the rollup
dimensions.

Rollup data can also be re-bucketed for:

- 1 minute
- 5 minutes
- 1 hour
- 1 day

using PostgreSQL `date_bin` and `SUM`.

---

## Raw Boundary Handling

Using a full one-minute rollup for a partially covered minute would
over-count data.

For example:

- `since = 10:00:30`
- `until = 10:03:20`

is evaluated as:

- `10:00:30 -> 10:01:00`: raw logs
- `10:01:00 -> 10:03:00`: minute rollups
- `10:03:00 -> 10:03:20`: raw logs

The raw and rollup results are combined and grouped into the requested
bucket interval.

This preserves:

- inclusive `since`
- exclusive `until`

without double counting.

---

## Raw Aggregation Fallback

The rollup table does not contain:

- message text
- arbitrary attributes

Therefore aggregate queries using:

- `q`
- attribute filters

fall back to aggregation over the raw `logs` table.

This preserves exact query semantics instead of returning approximate
results.

---

## Rollup Query Plan Verification

After the final mixed-load benchmark, the rollup summary query was
inspected using `EXPLAIN (ANALYZE, BUFFERS)`.

The tested time window contained only 33 rollup rows.

PostgreSQL selected a sequential scan of `log_rollups_1m`, which is
appropriate for such a small relation.

Measured plan details:

- Rollup rows scanned: 33
- Hash aggregate memory: 24 kB
- Sort method: quicksort
- Sort memory: 25 kB
- Shared buffer hits: 7
- Planning time: 0.642 ms
- Execution time: 0.159 ms

This demonstrates the reduction in aggregation work achieved by the
summary table. Instead of repeatedly aggregating over a large raw-log
data set, common aggregate requests operate primarily on a very small
set of pre-aggregated rows.

The 0.159 ms result represents the database execution of the isolated
rollup query, not the end-to-end HTTP aggregate latency. The final
mixed-load benchmark measured an aggregate endpoint p95 of 773.66 ms.

# Rollup Migration and Backfill

A migration tracking table is used to perform the rollup backfill only
once.

For an existing database:

1. the rollup table is created
2. existing raw logs are grouped into minute/service/level counts
3. the rollup table is rebuilt from those raw logs
4. the backfill migration is recorded

Subsequent application restarts do not repeat the backfill.

Restart testing verified that rollup counts were not duplicated.

---

# Retention and Rollup Consistency

Retention originally deleted only from the raw `logs` table.

After introducing rollups, doing so would leave stale aggregate counts.

Retention batches now run transactionally.

For every expired batch the system:

1. selects and locks the expired raw logs
2. groups them by minute, service, and level
3. locks the corresponding rollup rows in deterministic order
4. validates that the rollup counts can be decremented safely
5. deletes the raw rows
6. decrements the corresponding rollup counts
7. removes rollup rows whose count becomes zero
8. commits the transaction

If rollup consistency validation fails, the complete batch is rolled
back.

This prevents silent divergence between raw logs and aggregate data.

---

# Correctness Verification

The final automated test suite contains:

- 7 test files
- 68 passing tests

Coverage includes:

- ingestion validation
- partial ingestion success
- filtered log queries
- keyset pagination
- aggregate validation
- service grouping
- level grouping
- minute rollups
- raw/rollup hybrid boundaries
- same-minute aggregate ranges
- 1m, 5m, 1h, and 1d re-bucketing
- raw fallback for `q`
- raw fallback for attribute filters
- retention cutoff semantics
- multi-batch retention
- partial rollup decrements
- zero-count rollup cleanup
- retention rollback on inconsistency
- raw/rollup consistency after retention

---

# Final Mixed-Load Benchmark

Configuration:

- Duration: 60 seconds
- Ingestion concurrency: 4
- Batch size: 2,000
- Query interval: 250 ms
- Aggregate interval: 1 second

Results:

- Attempted logs: 1,858,000
- Accepted logs: 1,858,000
- Rejected logs: 0
- Ingestion errors: 0
- Throughput: 30,958.22 logs/sec
- Ingestion p95: 399.56 ms
- Query requests: 239
- Query errors: 0
- Query p95: 158.88 ms
- Aggregate requests: 60
- Aggregate errors: 0
- Aggregate p95: 773.66 ms
- Visibility latency: 978.90 ms

After the visibility test:

- Raw log count: 1,858,001
- Rollup count total: 1,858,001

No application errors or PostgreSQL deadlocks were observed.
---

# Requirement Results

| Requirement | Result |
| --- | --- |
| Ingestion >= 15,000 logs/sec | PASS - 30,958.22 logs/sec |
| Zero rejected valid logs | PASS - 0 rejected |
| Zero ingestion errors | PASS - 0 errors |
| Zero query errors | PASS - 0 errors |
| Zero aggregate errors | PASS - 0 errors |
| All attempted logs accepted | PASS - 1,858,000 / 1,858,000 |
| Aggregate p95 < 1 second | PASS - 773.66 ms |
| Newly ingested logs visible < 20 seconds | PASS - 978.90 ms |
| Application <= 0.5 CPU / 256 MB | PASS - Docker limit enforced |
| PostgreSQL <= 1 CPU / 1 GB | PASS - Docker limit enforced |

The measured ingestion throughput was slightly more than twice the
required minimum while aggregate latency remained below one second.

---

# Bottlenecks and Tradeoffs

The largest observed bottleneck was repeated aggregation over a large
set of recent raw rows while PostgreSQL was simultaneously processing
high-volume writes.

Simple configuration tuning and an additional covering index did not
solve this problem.

The minute-rollup architecture substantially reduces the amount of raw
data scanned by common aggregate queries.

The main tradeoff is additional work during ingestion because every
accepted log also contributes to a rollup counter.

Measured dual-write throughput showed that this additional work still
left significant headroom above the required ingestion rate.

---

# Limitations

Performance numbers are specific to the benchmark host and Docker
environment and should not be interpreted as universal hardware
performance.

Aggregate requests using `q` or arbitrary attribute filters cannot use
the minute rollup fast path because those dimensions are not represented
in the rollup table.

Those requests fall back to raw aggregation and may therefore be slower
on very large matching data sets.

The current rollup design is optimized for the required aggregate
dimensions:

- time
- service
- level

Further dimensions would require additional indexing, specialized
rollups, or another analytical storage strategy depending on workload
requirements.

---

# Conclusion

The original raw aggregation approach caused PostgreSQL CPU contention
and could not consistently satisfy the aggregate p95 requirement during
heavy ingestion.

Testing showed that concurrency tuning, PostgreSQL parallelism changes,
and a covering index were not sufficient.

A one-minute rollup table with atomic ingestion updates and a hybrid
raw/rollup aggregation strategy resolved the bottleneck while preserving
exact query semantics.

The final mixed workload achieved:

The final mixed workload achieved:

- 30,958.22 logs/sec
- 0 rejected logs
- 0 ingestion errors
- 0 query errors
- 0 aggregate errors
- 158.88 ms query p95
- 773.66 ms aggregate p95
- 978.90 ms visibility latency

under the required Docker CPU and memory limits.

The optimized implementation therefore satisfies the measured core
performance requirements.