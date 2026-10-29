import { expect, test } from 'bun:test'
import { InvalidInput } from '#/domain/errors.ts'
import { EventId, VenueId } from '#/domain/ids.ts'
import { Result } from '#/shared-kernel/result.ts'
import { anApplication } from '../support/application-fixture.ts'
import { given } from '../support/given.ts'

test('creation generates an event ID and persists the supplied data', () =>
  given(anApplication)
    .when(({ services, eventInput }) => services.create.execute(eventInput))
    .then(async (result, { services, eventInput }) => {
      const event = Result.getOrThrow(result)
      expect(EventId.parse(event.data.id)).toEqual(
        Result.succeed(event.data.id),
      )
      expect({ ...event.data, capacity: event.data.capacity.value }).toEqual({
        ...eventInput,
        id: event.data.id,
      })
      const candidate = await services.read.get.execute(event.data.id)
      expect(candidate).toEqual(Result.succeed(event))
    }))

test.each([new Date('2029-12-31T23:59:59Z'), new Date('2030-01-01T00:00:00Z')])(
  'creation rejects a start at or before the clock: %s',
  (startsAt) =>
    given(anApplication)
      .when(({ services, eventInput }) =>
        services.create.execute({ ...eventInput, startsAt }),
      )
      .then(async (result, { services }) => {
        expect(result).toEqual(
          Result.fail(new InvalidInput('Event must start in the future')),
        )
        const candidate = await services.read.list.execute({})
        expect(candidate).toEqual([])
      }),
)

test.each([
  { title: '' },
  { category: '  ' },
  { capacity: 0 },
  { capacity: 1.5 },
  { startsAt: new Date('invalid') },
])('invalid event data is rejected without persistence: %j', (patch) =>
  given(anApplication)
    .when(({ services, eventInput }) =>
      services.create.execute({ ...eventInput, ...patch }),
    )
    .then(async (result, { services }) => {
      expect(result).toMatchObject({
        _tag: 'Failure',
        error: expect.any(InvalidInput),
      })
      const candidate = await services.read.list.execute({})
      expect(candidate).toEqual([])
    }),
)

test('an unknown venue rejects creation without persistence', () =>
  given(anApplication)
    .when(({ services, eventInput }) =>
      services.create.execute({ ...eventInput, venueId: VenueId.make() }),
    )
    .then(async (result, { services }) => {
      expect(result).toEqual(
        Result.fail(
          new InvalidInput('Referenced venue or user does not exist'),
        ),
      )
      const candidate = await services.read.list.execute({})
      expect(candidate).toEqual([])
    }))
