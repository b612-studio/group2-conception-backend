import { Option } from "#/shared-kernel/option.ts";
import { EventFilter, EventReadRepository } from "../../application/ports";
import { Event } from "../../domain/event";
import { EventId } from "../../domain/ids";

export class MongoDBEventReadRepository implements EventReadRepository {
  listEvents(filter: EventFilter): Promise<Event[]> {
    throw new Error("Method not implemented.");
  }
  findEvent(id: EventId): Promise<Option<Event>> {
    throw new Error("Method not implemented.");
  }

}
