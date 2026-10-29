# Functions as values and execution policies

The [functional Valkey adapter](valkey-event-repository-functional.ts) reuses the
same storage operations as [the base adapter](valkey-event-repository.ts). It
changes how mutation attempts execute by supplying a retry policy.

## Functions are first-class values

In JavaScript, a function can be assigned to a variable, passed as an argument
and returned from another function. This is what "first-class" means here.
Functions are values, like strings and objects.

The adapter uses this directly:

- `attempt` is a function supplied to `retry`.
- `delay` and `sleep` are functions stored in `RetryOptions`.
- `retry` returns a function that accepts an `AbortSignal`.
- The repository receives a `RetryPolicy` function through its constructor.

A function does not execute just because we pass it somewhere. The policy calls
`attempt(signal)` when it is ready to perform an attempt. That distinction lets
it call the same operation again after contention.

## Higher-order functions, not components

A higher-order function receives a function or returns one. `retry` and
`withTimeout` both qualify. So does `Array.filter`, which receives a predicate.

A higher-order component is a React-specific use of this idea. It accepts a
component and returns a component with added behavior. There are no React
components in this backend. Here we wrap tasks, not UI components. "Higher-order
function" is the term to use for these execution policies.

## Compose one policy around another

The functional policy assembles this expression:

```ts
withTimeout(timeoutMs, retry(attempt, retryOptions))()
```

Read it from the inside out:

1. `retry` builds a task that repeats the supplied attempt after contention.
2. `withTimeout` wraps that task with one deadline.
3. The final `()` executes the assembled task.

The order matters. The timeout surrounds the whole retry sequence, including
reads and backoff. A separate timeout inside each attempt would give each
attempt a new deadline and allow the total mutation to take longer.

This is function composition, not the method chaining used by the
[given/when/then test helper](../../../../../test/bdd.md). Here one returned function
becomes an argument to another. In the test helper, each returned object exposes
the next method.

## Keep completion separate from success

An attempt returns `Promise<Option<Value>>`. For repository mutations, `Value`
is itself a `Result`:

- `Some(Success(event))` means the operation completed and saved its value.
- `Some(Failure(error))` means an expected rejection completed without a write.
- `None` means another writer changed the snapshot. Read it again and retry.
- A rejected promise means an infrastructure fault. Do not retry it here.

A completed business rejection must not become another attempt. Neither should
a lost connection. The write might already have committed before the connection
failed.

The compare-and-set response is kept explicit in the base adapter:

```ts
if (saved === 1) {
  return Option.some(result)
}
return Option.none()
```

`1` is the Lua script's confirmation that it replaced the snapshot. The branch
translates the storage protocol into the attempt protocol. It is not checking
whether the domain result succeeded.

## Name predicates instead of repeating conditions

A predicate is a function returning a boolean. Our
[event predicate](event-predicates.ts) captures the filter and returns a function
that checks one decoded event:

```ts
.filter(matchesEventFilter(filter))
```

`matchesEventFilter` is higher-order because it returns the predicate. Memory
and Valkey share it. An absent category accepts every category; an absent date
accepts every start time. A supplied date is an exclusive lower bound.

SQL adapters keep these conditions in their queries. Loading every row merely
to reuse a JavaScript predicate would change where filtering happens and add
unnecessary database work.

## Functional does not mean effect-free

The predicate computes a boolean without writing storage. A retry task performs
I/O and waits on timers. Passing it as a function does not make it pure.

The benefit here is separating the storage operation from its execution policy.
Tests can inject a no-wait `sleep`, record backoff delays and control when an
attempt succeeds. See the [retry tests](../../../../../test/integrations/valkey-retry.test.ts).

Mutation callbacks still must avoid external effects, since contention may run
them again. An email sent inside a callback cannot be rolled back by Valkey.
See [cancellation and deadlines](abort-controller.md) for the limits of stopping
an operation that has already started.
