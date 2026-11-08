import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { NodeSDK } from '@opentelemetry/sdk-node'
import * as v from 'valibot'

const EXPORTER_TIMEOUT_MILLIS = 3_000

const configurationSchema = v.object({
  OTEL_SDK_DISABLED: v.optional(v.picklist(['true', 'false']), 'false'),
  OTEL_SERVICE_NAME: v.optional(
    v.pipe(v.string(), v.minLength(1)),
    'events-group2',
  ),
  OTEL_EXPORTER_OTLP_ENDPOINT: v.optional(
    v.pipe(
      v.string(),
      v.url(),
      v.check(
        (value) => /^https?:\/\//.test(value),
        'Expected an HTTP(S) endpoint',
      ),
    ),
    'http://localhost:4318',
  ),
  OTEL_METRIC_EXPORT_INTERVAL: v.optional(
    v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1000)),
    '5000',
  ),
})

// Explicit instrumentation works with Bun, without Node HTTP/SQL patching.
export function startTelemetry(environment = process.env) {
  const configuration = v.parse(configurationSchema, environment)
  if (configuration.OTEL_SDK_DISABLED === 'true') {
    return { shutdown: async () => { } }
  }
  const base = configuration.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/+$/, '')
  const sdk = new NodeSDK({
    autoDetectResources: false,
    resource: resourceFromAttributes({
      'service.name': configuration.OTEL_SERVICE_NAME,
    }),
    traceExporter: new OTLPTraceExporter({
      url: `${base}/v1/traces`,
      timeoutMillis: EXPORTER_TIMEOUT_MILLIS,
    }),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: `${base}/v1/metrics`,
          timeoutMillis: EXPORTER_TIMEOUT_MILLIS,
        }),
        exportIntervalMillis: configuration.OTEL_METRIC_EXPORT_INTERVAL,
        exportTimeoutMillis: Math.min(
          EXPORTER_TIMEOUT_MILLIS,
          configuration.OTEL_METRIC_EXPORT_INTERVAL,
        ),
      }),
    ],
    logRecordProcessors: [
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({
          url: `${base}/v1/logs`,
          timeoutMillis: EXPORTER_TIMEOUT_MILLIS,
        }),
      }),
    ],
  })
  sdk.start()
  return { shutdown: () => sdk.shutdown() }
}
