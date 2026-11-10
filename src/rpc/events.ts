import type { ServiceImpl } from "@connectrpc/connect";
import { eventHub } from "../events/eventHub";
import type { EventService } from "../gen/euler/v1/events_pb";
import { ownerOf } from "./context";

export const eventService: ServiceImpl<typeof EventService> = {
  async *subscribe(request, context) {
    const owner = ownerOf(context);
    for await (const event of eventHub.subscribe(
      owner,
      Number(request.afterSequence),
      context.signal,
    ))
      yield { event };
  },
};
