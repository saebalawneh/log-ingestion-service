const BASE_URL =
  process.env.BASE_URL ??
  "http://localhost:8081";

const DURATION_SECONDS =
  Number(
    process.env.DURATION_SECONDS ?? 30,
  );

const CONCURRENCY =
  Number(
    process.env.CONCURRENCY ?? 8,
  );

const BATCH_SIZE =
  Number(
    process.env.BATCH_SIZE ?? 500,
  );

const QUERY_INTERVAL_MS =
  Number(
    process.env.QUERY_INTERVAL_MS ?? 250,
  );

const AGGREGATE_INTERVAL_MS =
  Number(
    process.env.AGGREGATE_INTERVAL_MS ??
      1000,
  );

const services = [
  "api",
  "auth",
  "billing",
  "worker",
];

const levels = [
  "debug",
  "info",
  "warn",
  "error",
];

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function percentile95(values) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort(
    (a, b) => a - b,
  );

  const index = Math.max(
    0,
    Math.ceil(
      sorted.length * 0.95,
    ) - 1,
  );

  return sorted[index];
}

function formatMs(value) {
  return `${value.toFixed(2)} ms`;
}

function buildBatch(
  workerId,
  sequence,
) {
  const timestamp =
    new Date().toISOString();

  return Array.from(
    {
      length: BATCH_SIZE,
    },
    (_, index) => ({
      timestamp,

      level:
        levels[
          (sequence + index) %
            levels.length
        ],

      service:
        services[
          (workerId + index) %
            services.length
        ],

      message:
        `performance test worker=${workerId} sequence=${sequence} item=${index}`,

      attributes: {
        environment: "performance",
        worker: workerId,
        synthetic: true,
      },
    }),
  );
}

const stats = {
  attemptedLogs: 0,
  acceptedLogs: 0,
  rejectedLogs: 0,

  ingestionRequests: 0,
  ingestionErrors: 0,
  ingestionLatencies: [],

  queryRequests: 0,
  queryErrors: 0,
  queryLatencies: [],

  aggregateRequests: 0,
  aggregateErrors: 0,
  aggregateLatencies: [],
};

async function ingestWorker(
  workerId,
  endTime,
) {
  let sequence = 0;

  while (
    performance.now() < endTime
  ) {
    const logs = buildBatch(
      workerId,
      sequence,
    );

    stats.attemptedLogs +=
      logs.length;

    stats.ingestionRequests += 1;

    const started =
      performance.now();

    try {
      const response = await fetch(
        `${BASE_URL}/logs`,
        {
          method: "POST",

          headers: {
            "content-type":
              "application/json",
          },

          body: JSON.stringify({
            logs,
          }),
        },
      );

      if (!response.ok) {
        stats.ingestionErrors += 1;

        const body =
          await response.text();

        const latency =
          performance.now() -
          started;

        stats.ingestionLatencies.push(
          latency,
        );

        console.error(
          `Ingestion HTTP ${response.status}: ${body}`,
        );

        sequence += 1;
        continue;
      }

      const body =
        await response.json();

      const latency =
        performance.now() -
        started;

      stats.ingestionLatencies.push(
        latency,
      );

      stats.acceptedLogs +=
        body.accepted ?? 0;

      stats.rejectedLogs +=
        body.rejected?.length ?? 0;
    } catch (error) {
      stats.ingestionErrors += 1;

      console.error(
        "Ingestion request failed:",
        error.message,
      );
    }

    sequence += 1;
  }
}

async function queryLoop(
  endTime,
) {
  while (
    performance.now() < endTime
  ) {
    const started =
      performance.now();

    stats.queryRequests += 1;

    try {
      const response = await fetch(
        `${BASE_URL}/logs?service=api&level=info&limit=100`,
      );

      if (!response.ok) {
        stats.queryErrors += 1;

        await response.text();
      } else {
        await response.json();
      }

      const latency =
        performance.now() -
        started;

      stats.queryLatencies.push(
        latency,
      );
    } catch (error) {
      stats.queryErrors += 1;

      console.error(
        "Query request failed:",
        error.message,
      );
    }

    const elapsed =
      performance.now() -
      started;

    const wait = Math.max(
      0,
      QUERY_INTERVAL_MS -
        elapsed,
    );

    const remaining =
      endTime -
      performance.now();

    if (remaining <= 0) {
      break;
    }

    await sleep(
      Math.min(
        wait,
        remaining,
      ),
    );
  }
}

async function aggregateLoop(
  endTime,
) {
  while (
    performance.now() < endTime
  ) {
    const now =
      Date.now();

    const since =
      new Date(
        now -
          15 * 60 * 1000,
      ).toISOString();

    const until =
      new Date(
        now +
          60 * 1000,
      ).toISOString();

    const params =
      new URLSearchParams({
        since,
        until,
        bucket: "1m",
        group_by: "service",
      });

    const started =
      performance.now();

    stats.aggregateRequests += 1;

    try {
      const response = await fetch(
        `${BASE_URL}/logs/aggregate?${params}`,
      );

      if (!response.ok) {
        stats.aggregateErrors += 1;

        await response.text();
      } else {
        await response.json();
      }

      const latency =
        performance.now() -
        started;

      stats.aggregateLatencies.push(
        latency,
      );
    } catch (error) {
      stats.aggregateErrors += 1;

      console.error(
        "Aggregate request failed:",
        error.message,
      );
    }

    const elapsed =
      performance.now() -
      started;

    const wait = Math.max(
      0,
      AGGREGATE_INTERVAL_MS -
        elapsed,
    );

    const remaining =
      endTime -
      performance.now();

    if (remaining <= 0) {
      break;
    }

    await sleep(
      Math.min(
        wait,
        remaining,
      ),
    );
  }
}

async function testVisibility() {
  const marker =
    `visibility-${Date.now()}`;

  const timestamp =
    new Date().toISOString();

  const started =
    performance.now();

  const response = await fetch(
    `${BASE_URL}/logs`,
    {
      method: "POST",

      headers: {
        "content-type":
          "application/json",
      },

      body: JSON.stringify({
        logs: [
          {
            timestamp,
            level: "info",

            service:
              "visibility-test",

            message: marker,

            attributes: {
              environment:
                "performance",
            },
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    const body =
      await response.text();

    throw new Error(
      `Visibility test ingestion failed: ${response.status} ${body}`,
    );
  }

  const ingestionResult =
    await response.json();

  if (
    ingestionResult.accepted !== 1
  ) {
    throw new Error(
      "Visibility test log was not accepted",
    );
  }

  while (
    performance.now() - started <
    20_000
  ) {
    const queryResponse =
      await fetch(
        `${BASE_URL}/logs?q=${encodeURIComponent(
          marker,
        )}&limit=1`,
      );

    if (queryResponse.ok) {
      const body =
        await queryResponse.json();

      if (
        Array.isArray(body.logs) &&
        body.logs.length > 0
      ) {
        return (
          performance.now() -
          started
        );
      }
    } else {
      await queryResponse.text();
    }

    await sleep(100);
  }

  return null;
}

async function main() {
  console.log(
    "Checking service health...",
  );

  const healthResponse =
    await fetch(
      `${BASE_URL}/health`,
    );

  if (!healthResponse.ok) {
    throw new Error(
      `Health check failed with ${healthResponse.status}`,
    );
  }

  await healthResponse.text();

  console.log(
    "Service is healthy.",
  );

  console.log("");

  console.log(
    "Starting performance test...",
  );

  console.log(
    `URL: ${BASE_URL}`,
  );

  console.log(
    `Duration: ${DURATION_SECONDS}s`,
  );

  console.log(
    `Concurrency: ${CONCURRENCY}`,
  );

  console.log(
    `Batch size: ${BATCH_SIZE}`,
  );

  console.log("");

  const started =
    performance.now();

  const endTime =
    started +
    DURATION_SECONDS * 1000;

  const ingestionWorkers =
    Array.from(
      {
        length: CONCURRENCY,
      },
      (_, workerId) =>
        ingestWorker(
          workerId,
          endTime,
        ),
    );

  await Promise.all([
    ...ingestionWorkers,
    queryLoop(endTime),
    aggregateLoop(endTime),
  ]);

  const elapsedSeconds =
    (
      performance.now() -
      started
    ) / 1000;

  const throughput =
    stats.acceptedLogs /
    elapsedSeconds;

  const ingestionP95 =
    percentile95(
      stats.ingestionLatencies,
    );

  const queryP95 =
    percentile95(
      stats.queryLatencies,
    );

  const aggregateP95 =
    percentile95(
      stats.aggregateLatencies,
    );

  console.log("");

  console.log(
    "=== Performance Results ===",
  );

  console.log(
    `Elapsed: ${elapsedSeconds.toFixed(
      2,
    )} seconds`,
  );

  console.log(
    `Attempted logs: ${stats.attemptedLogs}`,
  );

  console.log(
    `Accepted logs: ${stats.acceptedLogs}`,
  );

  console.log(
    `Rejected logs: ${stats.rejectedLogs}`,
  );

  console.log(
    `Ingestion errors: ${stats.ingestionErrors}`,
  );

  console.log(
    `Throughput: ${throughput.toFixed(
      2,
    )} logs/sec`,
  );

  console.log(
    `Ingestion p95: ${formatMs(
      ingestionP95,
    )}`,
  );

  console.log("");

  console.log(
    `Query requests: ${stats.queryRequests}`,
  );

  console.log(
    `Query errors: ${stats.queryErrors}`,
  );

  console.log(
    `Query p95: ${formatMs(
      queryP95,
    )}`,
  );

  console.log("");

  console.log(
    `Aggregate requests: ${stats.aggregateRequests}`,
  );

  console.log(
    `Aggregate errors: ${stats.aggregateErrors}`,
  );

  console.log(
    `Aggregate p95: ${formatMs(
      aggregateP95,
    )}`,
  );

  console.log("");

  console.log(
    "Testing query visibility...",
  );

  const visibilityMs =
    await testVisibility();

  if (visibilityMs === null) {
    console.log(
      "Visibility: FAILED (> 20 seconds)",
    );
  } else {
    console.log(
      `Visibility: ${formatMs(
        visibilityMs,
      )}`,
    );
  }

  const requirements = {
    ingestionThroughput:
      throughput >= 15_000,

    zeroRejectedLogs:
      stats.rejectedLogs === 0,

    zeroIngestionErrors:
      stats.ingestionErrors === 0,

    zeroQueryErrors:
      stats.queryErrors === 0,

    zeroAggregateErrors:
      stats.aggregateErrors === 0,

    allAttemptedLogsAccepted:
      stats.acceptedLogs ===
      stats.attemptedLogs,

    aggregateLatency:
      aggregateP95 < 1000,

    visibility:
      visibilityMs !== null &&
      visibilityMs < 20_000,
  };

  console.log("");

  console.log(
    "=== Requirement Checks ===",
  );

  console.log(
    `Ingestion >= 15000 logs/sec: ${
      requirements.ingestionThroughput
        ? "PASS"
        : "FAIL"
    }`,
  );

  console.log(
    `Zero rejected logs: ${
      requirements.zeroRejectedLogs
        ? "PASS"
        : "FAIL"
    }`,
  );

  console.log(
    `Zero ingestion errors: ${
      requirements.zeroIngestionErrors
        ? "PASS"
        : "FAIL"
    }`,
  );

  console.log(
    `Zero query errors: ${
      requirements.zeroQueryErrors
        ? "PASS"
        : "FAIL"
    }`,
  );

  console.log(
    `Zero aggregate errors: ${
      requirements.zeroAggregateErrors
        ? "PASS"
        : "FAIL"
    }`,
  );

  console.log(
    `All attempted logs accepted: ${
      requirements.allAttemptedLogsAccepted
        ? "PASS"
        : "FAIL"
    }`,
  );

  console.log(
    `Aggregate p95 < 1000 ms: ${
      requirements.aggregateLatency
        ? "PASS"
        : "FAIL"
    }`,
  );

  console.log(
    `Visibility < 20 seconds: ${
      requirements.visibility
        ? "PASS"
        : "FAIL"
    }`,
  );

  const allRequirementsPassed =
    Object.values(
      requirements,
    ).every(Boolean);

  if (!allRequirementsPassed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    "Performance test failed:",
    error,
  );

  process.exit(1);
});