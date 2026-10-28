# Shared kernel

This directory contains small types that several layers need without depending
on HTTP, persistence or a specific business operation.

[Result](result.ts) models success or failure. [Option](option.ts) models presence
or absence. Domain rules, application handlers and infrastructure adapters use
the same definitions, so they do not need translations between competing
representations at every call.

## Why keep it separate

Putting `Result` in a controller module would force domain code to import from
the HTTP layer. Putting it inside a repository adapter would make application
code depend on infrastructure. A separate module avoids both dependencies.

The dependency direction is one way. Other layers may import the shared kernel;
the shared kernel must not import handlers, controllers or database clients.

## Keep the boundary small

Shared does not mean "anything used twice". Capacity belongs to the event
[domain](../domain/domain.md), and response DTOs belong to
[presentation](../presentation/dto-and-presenter.md). Neither belongs here just
because several files use it.

In domain-driven design, a shared kernel can also mean a jointly maintained
subset of models shared by bounded contexts. This lesson has one application
and uses the name for these common foundational types. It does not demonstrate
coordination between separate teams or bounded contexts.

See [errors as values](errors-as-values.md) for the conventions around `Result`,
exceptions and missing records.
