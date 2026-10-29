# Errors as values

An expected rejection is part of an operation's return type. It does not need
to interrupt control flow with a thrown exception.

[Result](result.ts) represents either `Success<Value>` or `Failure<Error>`.
The `_tag` field tells TypeScript which branch is present. A success has `value`;
a failure has `error`.

For example, [Capacity.create](../domain/capacity.ts) returns
`Result<Capacity, InvalidInput>`. Zero seats produces a failure value. The caller
must inspect that result before using the capacity.

```ts
const result = Capacity.create(input.capacity)
if (Result.isFailure(result)) {
  return result
}
const capacity = result.value
```

This snippet assumes `Capacity` and `Result` are imported and `input` is the
caller's input. `Result.isFailure` is a type predicate. Inside the branch,
TypeScript knows `result` has an `error`; after the early return, it knows
`result` has a `value`. `Result.isSuccess` narrows in the other direction.

## Transform and compose results

The helpers in [result.ts](result.ts) each handle a different operation:

- `map` transforms a successful value and leaves a failure unchanged.
- `mapError` transforms an error and leaves a success unchanged.
- `flatMap` calls the next result-returning function only on success. Its return
  type includes the possible errors from either step.
- `flatten` removes one nested `Result` wrapper, preserving an outer or inner
  failure.
- `match` handles both cases to produce a final value.

For example, this replaces an explicit success check before the next validation:

```ts
const checked = Result.flatMap(Capacity.create(input.capacity), (capacity) => {
  if (!capacity.accommodates(reservedSeats)) {
    return Result.fail(new Conflict('Capacity is below reserved seats'))
  }
  return Result.succeed(capacity)
})
```

The callback never runs if capacity creation fails. These helpers are synchronous;
await an asynchronous operation before passing its result to them. `flatMap` is
not a promise adapter.

`mapError` changes the error value, not control flow. For example,
`Result.mapError(result, (error) => error.message)` converts an Error-valued
failure to a string-valued failure. Use it when crossing a boundary that requires
a different error representation, not just to discard useful details.

### Why the database write wrappers use flatten

[pgWrite](../infrastructure/pg-write.ts) calls `Result.tryPromise` around an
operation that already returns a `Result`. That produces a nested result:

```ts
Result<Result<Value, ApplicationError>, InvalidInput>
```

The inner result describes the operation's business outcome. The outer result
captures the mapped database rejection. `Result.flatten(result)` removes the
extra successful wrapper and preserves either kind of failure. It replaces:

```ts
if (Result.isFailure(result)) {
  return result
}
return result.value
```

Flattening a result is not the same as throwing its error. A driver fault that
the error mapper rethrows still rejects the promise.

## Can a helper return early from its caller?

An ordinary function cannot return from the function that called it. A helper
can return a failure value, but the caller must either branch on it or compose
its remaining work with something like `flatMap`. Replacing the branch with
`getOrThrow` would change expected failures into exceptions.

The explicit guard remains a good choice for handlers with several steps:

```ts
if (Result.isFailure(result)) {
  return result
}
// The remaining statements can now use result.value.
```

For short synchronous sequences, `flatMap` already provides short-circuiting
without changing the `Result` representation or every caller. Deep nesting is
a reason to keep explicit guards, not a reason to wrap every statement.

### A generator is an optional next step, not a required migration

A generator runner could make a sequence look like direct-style code. The
following is a possible API sketch, not an API implemented in this project:

```ts
Result.gen(function* () {
  const capacity = yield* Result.bind(Capacity.create(input.capacity))
  return capacity.value
})
```

Here `bind` would expose a result through an iterator. The runner would resume
the generator with a success value, or stop and return the first failure without
executing the remaining statements. JavaScript's `yield` does not do that on its
own; the runner defines this behavior. Generator cleanup through `finally` would
also need to work when the runner stops early.

This could be an additive helper used by one function at a time. Existing
constructors, result values and callers would not need to change. But correctly
inferring the error union, handling exceptions and defining asynchronous steps
adds implementation and teaching cost. An async runner needs a separate design;
the synchronous sketch does not automatically sequence promises.

For now we keep guards, `flatMap` and `flatten`. No generator runner or broad
control-flow rewrite is included.

## Errors do not have to be thrown

[Domain errors](../domain/errors.ts) extend JavaScript's `Error` class, but
`Result.fail(new Conflict('Not enough seats'))` returns an object. It does not
throw. Extending `Error` and throwing it are separate choices.

Handlers propagate these failures to the controller. The
[error presenter](../presentation/application-error.ts) maps conflicts to HTTP
409, missing records to 404, unauthorized requests to 401 and invalid input to 400. Domain code has no HTTP status codes.

## Where exceptions remain

The repository contract distinguishes expected failures from infrastructure
faults. An unavailable database rejects the promise. We do not disguise it as
invalid user input or a booking conflict.

`Result.tryPromise` can adapt a rejecting third-party operation when its caller
has a meaningful error mapping. It is not a reason to convert every exception
into a business rejection.

`Result.getOrThrow` deliberately leaves the value-based flow. Tests use it for
known-valid fixtures. Persistence mappings use it because an invalid stored
record violates a storage assumption. Do not use it to unwrap an expected
request rejection.

Missing data is a different question from failure. [Option](option.ts) represents
presence or absence; an application read can turn absence into `NotFound` when
that operation requires an event to exist.
