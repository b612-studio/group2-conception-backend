import { measureOperation } from './operation-metrics.ts'
import {
  SpanKind,
  SpanStatusCode,
  trace,
  type Span,
  type SpanOptions,
} from '@opentelemetry/api'

// Resolve the tracer at call time so importing an adapter before SDK startup is safe.
// Error messages and stacks can contain SQL parameters or credentials.
export function inSpan<Value>(
  name: string,
  work: (span: Span) => PromiseLike<Value> | Value,
  options: SpanOptions = {},
): Promise<Value> {
  return trace
    .getTracer('events-infrastructure')
    .startActiveSpan(name, options, async (span) => {
      try {
        return await work(span)
      } catch (cause) {
        span.setStatus({ code: SpanStatusCode.ERROR })
        span.recordException({
          name: cause instanceof Error ? cause.name : 'Error',
        })
        throw cause
      } finally {
        span.end()
      }
    })
}

// These intervals include client/pool waits and the network, not just server execution.
// Only static operation/table names enter metrics. loggedSql adds parameterized
// SQL text to logs and spans separately, never to metric dimensions.
export function postgresQuery<Value>(
  operation: string,
  collection: string,
  work: () => PromiseLike<Value>,
): Promise<Value> {
  const attributes = {
    'db.system.name': 'postgresql',
    'db.operation.name': operation,
    'db.collection.name': collection,
  }
  return inSpan(
    `${operation} ${collection}`,
    () => measureOperation('db.client.operation.duration', attributes, work),
    {
      kind: SpanKind.CLIENT,
      attributes,
    },
  )
}

export function valkeyCommand<Value>(
  operation: 'GET' | 'SET' | 'EVAL',
  work: () => PromiseLike<Value>,
): Promise<Value> {
  const attributes = {
    'db.system.name': 'redis',
    'db.operation.name': operation,
  }
  return inSpan(
    operation,
    () => measureOperation('db.client.operation.duration', attributes, work),
    {
      kind: SpanKind.CLIENT,
      attributes,
    },
  )
}

export function repositorySpan<Value>(
  name: string,
  work: () => PromiseLike<Value> | Value,
): Promise<Value> {
  return inSpan(name, () =>
    measureOperation(
      'events.repository.operation.duration',
      { 'operation.name': name },
      work,
    ),
  )
}
