import { afterEach, expect, test } from 'bun:test'
import { SpanStatusCode } from '@opentelemetry/api'
import { given } from './support/given.ts'
import {
  anObservedApplication,
  stopTelemetry,
} from './support/telemetry-fixture.ts'
import { inSpan, postgresQuery } from '#/platform/observability/spans.ts'
import { Result } from '#/shared-kernel/result.ts'

const aRejectedQuery = () => ({
  ...anObservedApplication(),
  fault: new Error('postgres://private-password@private-host'),
})
afterEach(stopTelemetry)

test('query instrumentation preserves the original failure and exports only its exception type', () =>
  given(aRejectedQuery)
    .when(({ fault }) =>
      Result.tryPromise(
        () =>
          postgresQuery('SELECT', 'events.events', () => Promise.reject(fault)),
        (cause) => cause,
      ),
    )
    .then((result, { fault, spans }) => {
      expect(result).toEqual(Result.fail(fault))
      expect(spans()).toHaveLength(1)
      expect(spans()[0]).toMatchObject({
        name: 'SELECT events.events',
        status: { code: SpanStatusCode.ERROR },
        events: [
          { name: 'exception', attributes: { 'exception.type': 'Error' } },
        ],
      })
      expect(spans()[0]?.status.message).toBeUndefined()
      expect(JSON.stringify(spans()[0]?.events)).not.toContain(fault.message)
    }))

test('a rejected query contributes one failed database duration measurement', () =>
  given(aRejectedQuery)
    .when(({ fault }) =>
      Result.tryPromise(
        () =>
          postgresQuery('SELECT', 'events.events', () => Promise.reject(fault)),
        (cause) => cause,
      ),
    )
    .then(async (_result, { measurements }) => {
      const duration = (await measurements()).find(
        ({ descriptor }) => descriptor.name === 'db.client.operation.duration',
      )
      expect(duration).toMatchObject({
        descriptor: { unit: 's' },
        dataPoints: [
          {
            attributes: {
              'db.system.name': 'postgresql',
              'db.operation.name': 'SELECT',
              'db.collection.name': 'events.events',
              outcome: 'failed',
            },
            value: { count: 1, sum: expect.any(Number) },
          },
        ],
      })
    }))

test('span instrumentation returns the original value and finishes before resolving', () =>
  given(() => ({ ...anObservedApplication(), value: { accepted: true } }))
    .when(({ value }) => inSpan('operation', () => Promise.resolve(value)))
    .then((result, { value, spans }) => {
      expect(result).toBe(value)
      expect(spans()).toHaveLength(1)
      expect(spans()[0]).toMatchObject({
        name: 'operation',
        status: { code: SpanStatusCode.UNSET },
      })
    }))
