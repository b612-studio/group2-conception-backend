export type Result<Value, Error> = Success<Value> | Failure<Error>

export interface Success<Value> {
  readonly _tag: 'Success'
  readonly value: Value
}
export interface Failure<Error> {
  readonly _tag: 'Failure'
  readonly error: Error
}

export const Result = {
  succeed: <Value>(value: Value): Success<Value> => ({
    _tag: 'Success',
    value,
  }),
  fail: <Error>(error: Error): Failure<Error> => ({ _tag: 'Failure', error }),
  isSuccess: <Current extends Result<unknown, unknown>>(
    result: Current,
  ): result is Extract<Current, Success<unknown>> => result._tag === 'Success',
  isFailure: <Current extends Result<unknown, unknown>>(
    result: Current,
  ): result is Extract<Current, Failure<unknown>> => result._tag === 'Failure',
  map: <Value, Error, Next>(
    result: Result<Value, Error>,
    mapper: (value: Value) => Next,
  ): Result<Next, Error> => {
    if (Result.isFailure(result)) {
      return result
    }
    return Result.succeed(mapper(result.value))
  },
  mapError: <Value, Error, NextError>(
    result: Result<Value, Error>,
    mapper: (error: Error) => NextError,
  ): Result<Value, NextError> => {
    if (Result.isFailure(result)) {
      return Result.fail(mapper(result.error))
    }
    return result
  },
  flatMap: <Value, Error, Next, NextError>(
    result: Result<Value, Error>,
    mapper: (value: Value) => Result<Next, NextError>,
  ): Result<Next, Error | NextError> => {
    if (Result.isFailure(result)) {
      return result
    }
    return mapper(result.value)
  },
  flatten: <Value, Error, OuterError>(
    result: Result<Result<Value, Error>, OuterError>,
  ): Result<Value, Error | OuterError> => {
    if (Result.isFailure(result)) {
      return result
    }
    return result.value
  },
  match: <Value, Error, Next>(
    result: Result<Value, Error>,
    cases: {
      onSuccess: (value: Value) => Next
      onFailure: (error: Error) => Next
    },
  ): Next => {
    if (Result.isFailure(result)) {
      return cases.onFailure(result.error)
    }
    return cases.onSuccess(result.value)
  },
  // Adapt rejecting third-party/driver APIs once at their integration boundary.
  tryPromise: async <Value, Failure>(
    task: () => Promise<Value>,
    onError: (cause: unknown) => Failure,
  ): Promise<Result<Value, Failure>> => {
    try {
      return Result.succeed(await task())
    } catch (cause) {
      return Result.fail(onError(cause))
    }
  },
  // Unsafe constructors and persistence invariants only; never unwrap expected request failures.
  getOrThrow: <Value, Error>(result: Result<Value, Error>): Value => {
    if (Result.isFailure(result)) {
      throw result.error
    }
    return result.value
  },
} as const
