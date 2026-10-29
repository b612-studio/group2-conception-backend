# AbortController and mutation deadlines

The [functional retry policy](valkey-event-repository-functional.ts) gives a
mutation one deadline. It uses `AbortController` to tell cooperating code to
stop and `Promise.race` to stop waiting when the deadline expires.

These are different mechanisms. Rejecting the caller's promise does not stop
all the work behind it.

## Controller and signal have different roles

`AbortController` owns the cancellation request. Calling `controller.abort(error)`
marks its signal as aborted and records the reason. An `AbortSignal` lets a task
observe that request without giving it the controller's authority to abort.

The wrapper passes `controller.signal` to the retry task. The task passes the
same signal to mutation attempts. `signal.throwIfAborted()` throws the stored
reason if cancellation has already been requested. Otherwise execution continues.

An abort is cooperative, not a thread kill. Code must check the signal or use an
API that supports it. The signal stays aborted once cancellation is requested.
The wrapper creates a fresh controller for each invocation so a later mutation
does not inherit an earlier mutation's cancellation.

## What withTimeout does

For each call, `withTimeout`:

1. Creates a controller and a promise representing deadline expiration.
2. Starts a timer.
3. Runs the task with the controller's signal and races it against expiration.
4. Clears the timer in `finally`, whether the task succeeds or rejects.

When the timer fires, it aborts the signal with a timeout error and rejects the
expiration promise. Both steps matter. Aborting asks cooperating work to stop;
rejecting ensures the caller stops waiting even if the task ignores the signal
or never settles.

If the task finishes before the deadline, its result or rejection wins the race.
The wrapper clears the timer so it will not later abort that completed task.
Like other JavaScript timers, this deadline depends on the event loop running.
It cannot interrupt synchronous code that blocks the event loop.

## Where this repository checks cancellation

`retry` checks the signal before starting an attempt. The mutation code also
checks before reading, after reading and before sending `EVAL`.

Those checks prevent another write attempt after cancellation has been observed.
They do not cancel an in-flight `client.get` or `client.send`. The code does not
pass a signal into those client calls.

The injected `sleep` accepts only a duration, so it is not abortable either. A
timeout rejects the caller while backoff may still be pending. When that wait
settles, the next retry checks the aborted signal before doing more work.
`Promise.race` does not cancel its losing task.

## A timeout does not prove that no write happened

Valkey may receive and commit `EVAL` before the timeout fires, even if the caller
has not received its response. Aborting cannot undo that write. The outcome is
then unknown to the caller.

Do not automatically repeat a timed-out reservation. It could create another
booking. Reconcile the stored state, or design an idempotent command with a
stable operation identifier before introducing that kind of retry. The current
policy retries only confirmed compare-and-set contention, not promise rejection.

This is also why a timeout remains an infrastructure exception rather than a
business `Conflict`. A business rejection means a rule rejected the operation;
a deadline expiration says we stopped waiting for its outcome.

## Scope and tests

The controller here belongs to the mutation deadline. It is not connected to an
HTTP client's disconnect, and the current wrapper accepts no caller signal.
Propagating request cancellation would require an explicit contract for which
signal owns cancellation and how the signals are combined.

The [retry tests](../../../test/integrations/valkey-retry.test.ts) cover aborting
a stalled task, stopping further attempts after a timeout during backoff and
refusing an attempt when its signal is already aborted.

Read [functional composition](functional-composition.md) for how the timeout
wraps the retry policy rather than each individual attempt.
