import type { Context } from 'hono'
import type { ListEventsUseCase } from '#/features/events/application/queries/list-events.ts'
import type { GetEventUseCase } from '#/features/events/application/queries/get-event.ts'
import type { EventFilter } from '#/features/events/application/ports.ts'
import type { EventId } from '#/features/events/domain/ids.ts'
import { httpResult } from '#/features/events/controllers/http-result.ts'
import { presentEvent } from '#/features/events/presentation/event-presenter.ts'

export function createEventQueryController({
  list,
  get,
}: {
  list: ListEventsUseCase
  get: GetEventUseCase
}) {
  return {
    list: async (context: Context, query: EventFilter) =>
      context.json((await list.execute(query)).map(presentEvent)),

    get: async (context: Context, id: EventId) =>
      httpResult(context, await get.execute(id), presentEvent),
  }
}

export type EventQueryController = ReturnType<typeof createEventQueryController>
