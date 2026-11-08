import { context, metrics, propagation, trace } from '@opentelemetry/api'
import { logs } from '@opentelemetry/api-logs'
import { NodeSDK, tracing } from '@opentelemetry/sdk-node'
import {
  InMemoryLogRecordExporter,
  SimpleLogRecordProcessor,
} from '@opentelemetry/sdk-logs'
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics'
import { Hono } from 'hono'
import { httpObservability } from '#/platform/observability/http-middleware.ts'
import { logEvent } from '#/platform/observability/logging.ts'

// Tests flush explicitly. Keep periodic exports out of normal test execution.
const testMetricExportIntervalMillis = 60_000

let runningSdk: NodeSDK | undefined

export async function stopTelemetry() {
  try {
    await runningSdk?.shutdown()
  } finally {
    runningSdk = undefined
    trace.disable()
    metrics.disable()
    logs.disable()
    context.disable()
    propagation.disable()
  }
}

export function anObservedApplication() {
  const spans = new tracing.InMemorySpanExporter()
  const logRecords = new InMemoryLogRecordExporter()
  const measurements = new InMemoryMetricExporter(
    AggregationTemporality.CUMULATIVE,
  )
  const reader = new PeriodicExportingMetricReader({
    exporter: measurements,
    exportIntervalMillis: testMetricExportIntervalMillis,
  })
  runningSdk = new NodeSDK({
    autoDetectResources: false,
    spanProcessors: [new tracing.SimpleSpanProcessor(spans)],
    logRecordProcessors: [
      new SimpleLogRecordProcessor({ exporter: logRecords }),
    ],
    metricReaders: [reader],
  })
  runningSdk.start()

  const app = new Hono()
  app.use('*', httpObservability())
  app.get('/events/:id', async (c) => {
    await Promise.resolve()
    logEvent('info', 'event.read')
    return c.json({ ok: true })
  })
  app.get('/failure', () => {
    throw new Error('private-database-password')
  })
  app.get('/denied', (c) => c.text('Unauthorized', 401))
  app.onError((_error, c) => c.json({ error: 'internal' }, 500))

  return {
    app,
    spans: () => spans.getFinishedSpans(),
    logs: () => logRecords.getFinishedLogRecords(),
    async measurements() {
      await reader.forceFlush()
      return measurements
        .getMetrics()
        .flatMap((batch) =>
          batch.scopeMetrics.flatMap((scope) => scope.metrics),
        )
    },
  }
}
