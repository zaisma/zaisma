// Chat Test's game server: rooms for up to 8, and onChat letting every message on to Zaisma's filter,
// except "/stop", which shows a game server stopping a message (stopped_by_game).
export default {
  maximumPlayerCount: 8,
  setup: () => ({}),
  onChat(state, player, room, chatInfo) {
    return chatInfo.text.trim() !== "/stop";
  },
};
