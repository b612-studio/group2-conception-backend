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
if (result._tag === 'Failure') {
  return result
}
const capacity = result.value
```

This snippet assumes `Capacity` is imported and `input` is the caller's input.
`Result.map` transforms a success while preserving a failure. `Result.match`
handles both branches explicitly.

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
