import {
  context,
  metrics,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  type Span,
} from '@opentelemetry/api'
import type { Context, MiddlewareHandler } from 'hono'
import { routePath } from 'hono/route'
import { logEvent } from '#/platform/observability/logging.ts'
import { startStopwatch, type ElapsedTime } from './timing.ts'

const serverErrorStatus = 500

function requestRoute(c: Context): string {
  const matchedRoute = routePath(c, -1)
  if (!matchedRoute || matchedRoute === '*' || matchedRoute === '/*') {
    return 'unmatched'
  }
  return matchedRoute
}

function completeRequestSpan(span: Span, c: Context) {
  // Hono handles exceptions in onError, so inspect c.error as well as status.
  if (c.res.status < serverErrorStatus) {
    return
  }

  span.setStatus({ code: SpanStatusCode.ERROR })
  // Error messages/stacks can contain SQL, credentials, or user input.
  if (c.error) {
    span.recordException({ name: c.error.name })
  }
}

const methods = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
])
const headerGetter = {
  get: (headers: Headers, key: string) => headers.get(key) ?? undefined,
  keys: (headers: Headers) => {
    const keys: string[] = []
    headers.forEach((_value, key) => keys.push(key))
    return keys
  },
}

export function httpObservability(): MiddlewareHandler {
  const tracer = trace.getTracer('events-http')
  const meter = metrics.getMeter('events-http')
  const count = meter.createCounter('http.server.request.count', {
    unit: '{request}',
  })
  const duration = meter.createHistogram('http.server.request.duration', {
    unit: 's',
  })
  const active = meter.createUpDownCounter('http.server.active_requests', {
    unit: '{request}',
  })

  function recordCompletion(
    c: Context,
    method: string,
    span: Span,
    elapsed: ElapsedTime,
  ) {
    const route = requestRoute(c)
    const attributes = {
      'http.request.method': method,
      'http.route': route,
      'http.response.status_code': c.res.status,
    }
    span.updateName(`${method} ${route}`)
    span.setAttributes(attributes)
    completeRequestSpan(span, c)
    count.add(1, attributes)
    duration.record(elapsed.seconds, attributes)
    logEvent(
      c.res.status >= serverErrorStatus ? 'error' : 'info',
      'http.request.completed',
      { ...attributes, duration_ms: elapsed.milliseconds },
    )
  }

  return async (c, next) => {
    const method = methods.has(c.req.method) ? c.req.method : 'OTHER'
    const methodAttributes = { 'http.request.method': method }
    const parent = propagation.extract(
      ROOT_CONTEXT,
      c.req.raw.headers,
      headerGetter,
    )
    return context.with(parent, () =>
      tracer.startActiveSpan(
        `HTTP ${method}`,
        {
          kind: SpanKind.SERVER,
          attributes: methodAttributes,
        },
        async (span) => {
          const stopwatch = startStopwatch()
          active.add(1, methodAttributes)
          try {
            await next()
          } finally {
            try {
              recordCompletion(c, method, span, stopwatch.elapsed())
            } finally {
              active.add(-1, methodAttributes)
              span.end()
            }
          }
        },
      ),
    )
  }
}
