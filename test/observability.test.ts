import { afterEach, expect, test } from 'bun:test'
import { SpanKind, SpanStatusCode } from '@opentelemetry/api'
import { given } from './support/given.ts'
import {
  anObservedApplication,
  stopTelemetry,
} from './support/telemetry-fixture.ts'

afterEach(stopTelemetry)

test('requests are traced by route template, without recording credentials or raw URLs', () =>
  given(anObservedApplication)
    .when(({ app }) =>
      app.request('/events/private-id?token=private-token', {
        headers: { cookie: 'session=private-cookie' },
      }),
    )
    .then((response, { spans }) => {
      expect(response.status).toBe(200)
      expect(spans()).toHaveLength(1)
      expect(spans()[0]).toMatchObject({
        name: 'GET /events/:id',
        kind: SpanKind.SERVER,
        attributes: {
          'http.request.method': 'GET',
          'http.route': '/events/:id',
          'http.response.status_code': 200,
        },
      })
      expect(spans()[0]?.attributes).toEqual({
        'http.request.method': 'GET',
        'http.route': '/events/:id',
        'http.response.status_code': 200,
      })
    }))

test('an incoming trace continues through asynchronous work and its logs', () =>
  given(anObservedApplication)
    .when(({ app }) =>
      app.request('/events/42', {
        headers: {
          traceparent:
            '00-12345678901234567890123456789012-1234567890123456-01',
        },
      }),
    )
    .then((_response, { spans, logs }) => {
      const span = spans()[0]
      expect(span?.spanContext().traceId).toBe(
        '12345678901234567890123456789012',
      )
      expect(span?.parentSpanContext?.spanId).toBe('1234567890123456')
      expect(logs().map((record) => record.body)).toEqual([
        'event.read',
        'http.request.completed',
      ])
      for (const record of logs()) {
        expect(record.spanContext?.traceId).toBe(span?.spanContext().traceId)
        expect(record.spanContext?.spanId).toBe(span?.spanContext().spanId)
      }
    }))

test('handled server errors produce failed traces without exposing the error message', () =>
  given(anObservedApplication)
    .when(({ app }) => app.request('/failure'))
    .then((response, { spans, logs }) => {
      expect(response.status).toBe(500)
      expect(spans()[0]?.status.code).toBe(SpanStatusCode.ERROR)
      expect(spans()[0]?.events).toHaveLength(1)
      expect(spans()[0]?.events[0]?.attributes).toEqual({
        'exception.type': 'Error',
      })
      expect(logs()[0]).toMatchObject({
        body: 'http.request.completed',
        severityText: 'ERROR',
      })
    }))

test('rejected credentials are observable without marking the server as failed', () =>
  given(anObservedApplication)
    .when(({ app }) => app.request('/denied'))
    .then((response, { spans, logs }) => {
      expect(response.status).toBe(401)
      expect(spans()[0]?.status.code).toBe(SpanStatusCode.UNSET)
      expect(logs()[0]?.attributes['http.response.status_code']).toBe(401)
    }))

test('unknown paths share one telemetry route instead of creating a series per URL', () =>
  given(anObservedApplication)
    .when(({ app }) => app.request('/unknown-private-path'))
    .then((response, { spans, logs }) => {
      expect(response.status).toBe(404)
      expect(spans()[0]?.name).toBe('GET unmatched')
      expect(logs()[0]?.attributes['http.route']).toBe('unmatched')
    }))

test.each([
  { path: '/events/42', route: '/events/:id', status: 200 },
  { path: '/failure', route: '/failure', status: 500 },
  { path: '/denied', route: '/denied', status: 401 },
  { path: '/unknown', route: 'unmatched', status: 404 },
])(
  'each completed request is counted once with its outcome: $status',
  ({ path, route, status }) =>
    given(anObservedApplication)
      .when(({ app }) => app.request(path))
      .then(async (_response, { measurements }) => {
        const exported = await measurements()
        const count = exported.find(
          (metric) => metric.descriptor.name === 'http.server.request.count',
        )
        expect(count?.dataPoints).toEqual([
          expect.objectContaining({
            value: 1,
            attributes: {
              'http.request.method': 'GET',
              'http.route': route,
              'http.response.status_code': status,
            },
          }),
        ])
        const active = exported.find(
          (metric) => metric.descriptor.name === 'http.server.active_requests',
        )
        expect(active?.dataPoints).toEqual([
          expect.objectContaining({ value: 0 }),
        ])
        const duration = exported.find(
          (metric) => metric.descriptor.name === 'http.server.request.duration',
        )
        expect(duration?.descriptor.unit).toBe('s')
        expect(duration?.dataPoints).toEqual([
          expect.objectContaining({
            value: expect.objectContaining({
              count: 1,
              sum: expect.any(Number),
            }),
          }),
        ])
      }),
)
