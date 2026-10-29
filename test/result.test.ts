import { expect, test } from 'bun:test'
import { Result } from '#/shared-kernel/result.ts'

function parsePositive(value: number): Result<number, string> {
  if (value <= 0) {
    return Result.fail('Must be positive')
  }
  return Result.succeed(value)
}

test('Result predicates discriminate and narrow each branch', () => {
  const success = parsePositive(2)
  const failure = parsePositive(0)
  expect(Result.isSuccess(success)).toBe(true)
  expect(Result.isFailure(success)).toBe(false)
  expect(Result.isFailure(failure)).toBe(true)
  expect(Result.isSuccess(failure)).toBe(false)
  if (Result.isSuccess(success)) {
    expect(success.value).toBe(2)
  }
  if (Result.isFailure(failure)) {
    expect(failure.error).toBe('Must be positive')
  }
})

test('predicates filter results with different success and error types', () => {
  const results = [
    Result.succeed(2),
    Result.succeed('ready'),
    Result.fail('Invalid input'),
    Result.fail(new Error('Unavailable')),
  ]
  expect(
    results.filter(Result.isSuccess).map((result) => result.value),
  ).toEqual([2, 'ready'])
  expect(
    results.filter(Result.isFailure).map((result) => result.error),
  ).toEqual(['Invalid input', new Error('Unavailable')])
})

test('mapError transforms only the failure', () => {
  const failure = parsePositive(0)
  expect(Result.mapError(failure, (message) => ({ message }))).toEqual(
    Result.fail({ message: 'Must be positive' }),
  )
  const success = parsePositive(2)
  expect(
    Result.mapError(success, (): string => {
      throw new Error('Must not run for success')
    }),
  ).toBe(success)
})

test('flatMap continues on success and preserves the next failure', () => {
  expect(
    Result.flatMap(parsePositive(2), (value) => Result.succeed(value * 3)),
  ).toEqual(Result.succeed(6))
  const nextFailure = Result.fail({ reason: 'Next step rejected' })
  expect(Result.flatMap(parsePositive(2), () => nextFailure)).toBe(nextFailure)
})

test('flatMap returns the original failure without executing the next step', () => {
  const failure = parsePositive(0)
  expect(
    Result.flatMap(failure, () => {
      throw new Error('Must not run after failure')
    }),
  ).toBe(failure)
})

test('flatten removes one successful wrapper and preserves either failure', () => {
  const inner = parsePositive(2)
  expect(Result.flatten(Result.succeed(inner))).toBe(inner)
  const innerFailure = parsePositive(0)
  expect(Result.flatten(Result.succeed(innerFailure))).toBe(innerFailure)
  const outer: Result<Result<number, string>, Error> = Result.fail(
    new Error('Driver rejected'),
  )
  expect(Result.flatten(outer)).toBe(outer)
})

test('tryPromise and flatten distinguish operation failures from promise rejection', async () => {
  const domainFailure = Result.fail('Domain rejection')
  const completed = await Result.tryPromise(
    async () => domainFailure,
    () => 'Driver rejection',
  )
  expect(Result.flatten(completed)).toBe(domainFailure)

  const rejected = await Result.tryPromise(
    async (): Promise<Result<number, string>> => {
      throw new Error('Connection lost')
    },
    () => 'Driver rejection',
  )
  expect(Result.flatten(rejected)).toEqual(Result.fail('Driver rejection'))
})
