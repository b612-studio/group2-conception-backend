import type { Context } from 'hono'
import type { ListEventsUseCase } from '#/application/queries/list-events.ts'
import type { GetEventUseCase } from '#/application/queries/get-event.ts'
import type { EventFilter } from '#/application/ports.ts'
import type { EventId } from '#/domain/ids.ts'
import { httpResult } from '#/controllers/http-result.ts'
import { presentEvent } from '#/presentation/event-presenter.ts'

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
