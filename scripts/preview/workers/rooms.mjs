// The rooms Worker as the preview runs it: unchanged, except database calls are tried again when
// another preview server has the database locked (retry-when-locked.mjs), and a request at localhost gets the rooms'
// settings at localhost (addresses.mjs). Rooms write their rows
// as players come and go, and each game's object records requests and schedules, so the Room and
// GameServerObject Durable Objects get the retrying database too.
import rooms, { GameServerObject as LiveGameServerObject, Room as LiveRoom } from "../../../apps/rooms/src/index.ts";
import { environmentAt } from "./addresses.mjs";
import { retryWhenLocked, workerRetryingWhenLocked } from "./retry-when-locked.mjs";

export * from "../../../apps/rooms/src/index.ts";
export default workerRetryingWhenLocked({ ...rooms, fetch: (request, environment, context) => rooms.fetch(request, environmentAt(request, environment), context) });

export class Room extends LiveRoom {
  constructor(context, environment) {
    super(context, retryWhenLocked(environment));
  }
}

export class GameServerObject extends LiveGameServerObject {
  constructor(context, environment) {
    super(context, retryWhenLocked(environment));
  }
}
