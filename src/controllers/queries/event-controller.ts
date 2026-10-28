import type { Context } from 'hono'
import type { Services } from '#/application/services.ts'
import type { EventFilter } from '#/application/ports.ts'
import type { EventId } from '#/domain/ids.ts'
import { httpResult } from '#/controllers/http-result.ts'
import { presentEvent } from '#/presentation/event-presenter.ts'

export function createEventQueryController({ read }: Pick<Services, 'read'>) {
  return {
    list: async (context: Context, query: EventFilter) =>
      context.json((await read.list.execute(query)).map(presentEvent)),

    get: async (context: Context, id: EventId) =>
      httpResult(context, await read.get.execute(id), presentEvent),
  }
}

export type EventQueryController = ReturnType<typeof createEventQueryController>
