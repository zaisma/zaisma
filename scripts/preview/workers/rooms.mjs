// The rooms Worker as the preview runs it: unchanged, except database calls are tried again when
// another preview server has the database locked (retry-when-locked.mjs). Rooms write their rows
// as players come and go, and each game's object records requests and schedules, so the Room and
// GameServerObject Durable Objects get the retrying database too.
import rooms, { GameServerObject as LiveGameServerObject, Room as LiveRoom } from "../../../apps/rooms/src/index.ts";
import { retryWhenLocked, workerRetryingWhenLocked } from "./retry-when-locked.mjs";

export * from "../../../apps/rooms/src/index.ts";
export default workerRetryingWhenLocked(rooms);

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
