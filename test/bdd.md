# BDD, given/when/then and fluent APIs

Behavior-driven development, or BDD, starts with examples of how the system
should behave. Developers and people who understand the business use those
examples to clarify the rules before implementing them.

For this API, "an event cannot shrink below its occupied seats" is a behavior.
"The handler calls a repository method" describes implementation. The first
remains useful even if we change the handler or storage library.

Our tests use BDD-style scenarios. The test syntax alone does not establish a
full BDD process, and we do not use a Gherkin parser or Cucumber here. Bun runs
ordinary TypeScript tests with a small [given helper](support/given.ts).

## Given, when, then

Each scenario separates context, action and observable outcome:

- **Given** prepares the starting state, such as an event with a reservation.
- **When** performs the operation under test, such as reducing its capacity.
- **Then** checks the result and any relevant persisted state.

This example follows [the update tests](application/update-event.test.ts):

```ts
import { expect, test } from 'bun:test'
import { Conflict } from '#/domain/errors.ts'
import { Result } from '#/shared-kernel/result.ts'
import { anEventWithReservation } from './support/application-fixture.ts'
import { given } from './support/given.ts'

test('capacity cannot drop below reserved seats', () =>
  given(anEventWithReservation)
    .when(({ services, event }) =>
      services.update.execute(event.data.id, { capacity: 1 }),
    )
    .then(async (result, { services, event }) => {
      expect(result).toEqual(
        Result.fail(
          new Conflict(
            'Capacity cannot be lower than the number of reserved seats',
          ),
        ),
      )
      expect(await services.read.get(event.data.id)).toEqual(
        Result.succeed(event),
      )
    }))
```

The fixture contains two occupied seats. The scenario checks both the rejection
and the fact that a failed edit saves nothing. Checking only the error would miss
an implementation that rejects the request after already changing storage.

## How the helper executes

`given(setup)` captures a setup function. `.when(act)` captures an action and
returns the next stage. Neither runs the scenario yet.

Calling `.then(assert)` executes the scenario in order:

1. Await setup to obtain the fixture.
2. Await the action, passing it that fixture.
3. Await the assertions, passing them both the action result and the fixture.

Each callback may be synchronous or asynchronous. TypeScript infers the fixture
type from setup and the result type from the action. The assertion callback can
therefore inspect the result and query the same fixture without casts or outer
mutable variables.

The helper does not catch exceptions or reinterpret failed assertions. A thrown
assertion or rejected promise fails the test. A domain `Result.Failure`, however,
is an ordinary returned value that the test must inspect.

Return the chain from the Bun test callback, as the example does, or await it in
an async callback. Otherwise Bun may finish the test before assertions complete.
This helper's `.then` is an explicit assertion stage, not `Promise.then`; the
call returns a `Promise<void>` that Bun can await.

## Method chaining and fluent APIs

Method chaining means calling another method on the value returned by the
previous call. In `given(setup).when(act).then(assert)`, each stage returns an
object exposing the next method.

A fluent API uses those calls to express an operation in a readable vocabulary.
Here the chain reads like the scenario itself. Chaining is the technique;
"given, when, then" is the language we chose for this testing API. Chaining
alone does not make an API fluent or a test behavior-driven.

A chain does not have to return `this`. Our helper returns different objects:
the result of `given` exposes `when`, and the result of `when` exposes `then`.
The final call returns a promise. These staged types prevent calling `then`
before `when` or appending another `when` after it in normal typed code.

This is not a mutable builder that accumulates arbitrary steps. The helper
supports one setup, one action and one assertion callback. Keep it small rather
than adding a method for every possible testing need.

## Write scenarios worth keeping

Name the rule or outcome, not the function being called. Put preparation in
`given`, the operation under test in `when`, and verification in `then`.
Assertions can check several facts when they describe one behavior, such as a
failed update returning a conflict and leaving storage unchanged.

Fixtures use an injected clock and controlled dependencies so boundary scenarios
do not depend on the real date. See [dependency injection](../src/application/dependency-injection.md)
for the application wiring that makes this possible.

Use plain tests when the chain adds no clarity. The
[capacity tests](capacity.test.ts) and [repository contract tests](event-repository.test.ts)
need no conversion just to share this syntax. BDD is about agreeing on and
verifying behavior, not requiring every test to begin with `given`.
