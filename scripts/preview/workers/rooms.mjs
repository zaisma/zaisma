// The rooms Worker as the preview runs it: unchanged, except database calls are tried again when
// another preview server has the database locked (retry-when-locked.mjs). Rooms write their rows
// as players come and go, so the Room Durable Object gets the retrying database too.
import rooms, { Room as LiveRoom } from "../../../apps/rooms/src/index.ts";
import { retryWhenLocked, workerRetryingWhenLocked } from "./retry-when-locked.mjs";

export * from "../../../apps/rooms/src/index.ts";
export default workerRetryingWhenLocked(rooms);

export class Room extends LiveRoom {
  constructor(context, environment) {
    super(context, retryWhenLocked(environment));
  }
}
