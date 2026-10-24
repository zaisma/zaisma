/**
 * The Zaisma SDK, typed: this file is its reference. One script tag, from the game's top folder,
 * gives a browser game its players (Zaisma accounts and guests) and multiplayer rooms:
 *
 *   <script src="_zaisma/v1.js"></script>
 *
 * Plain JavaScript, no dependencies, MIT licensed, and every part is optional.
 *
 * For editor and compiler checks, save this file beside your game's folder, not in it, since uploads
 * take no .ts files. On Zaisma it's served beside the SDK as _zaisma/v1.d.ts; in Zaisma's repository
 * it's packages/sdk/zaisma.d.ts. Then put `/// <reference path="../zaisma.d.ts" />` (and in JavaScript,
 * `// @ts-check`) at the top of your script, or list it in jsconfig.json or tsconfig.json. The
 * global `Zaisma` is then typed, and its types are `Zaisma.Room`, `Zaisma.JoinOptions` and so on (in
 * JavaScript, give `let room = null` a JSDoc `@type {Zaisma.Room | null}`, as the example games do).
 *
 * Names follow Zaisma's naming guide: whole words, the unit in the name (`idleTimeoutSec`), and is, has
 * or can for yes or no. An option or event the SDK doesn't take is refused with the list of the ones it
 * does (`error.code` "unknown_option" or "unknown_event"), so a misspelled or old one never goes
 * quietly unused. Errors carry `error.code` ({@link Zaisma.ErrorCode}).
 *
 * Player passes, for rooms and your own servers, need the game played on its zaisma.com page, which
 * checks the browser on Play: joining fails with `error.code` "unchecked" when it couldn't, or when the
 * game was opened anywhere else, and "not_on_zaisma" when the game isn't hosted on Zaisma at all.
 *
 * @example
 * const room = await Zaisma.joinRoom();         // joins ?room=CODE if the link has one, else makes a room
 * room.me; room.players; room.roomCode; room.inviteUrl;
 * room.on("message", (message) => {});          // from the game server
 * room.on("players", (players) => {});
 * room.on("connectionStatus", (connectionStatus) => {});
 * room.on("ended", (message) => {});
 * room.send({ move: "left" });
 * room.leave();
 * await Zaisma.invite(room);                    // share sheet on phones, copies the link elsewhere
 */
declare namespace Zaisma {
  /** The SDK's version: 1 for _zaisma/v1.js. */
  const sdkVersionNumber: 1;

  /** The game's slug, as in zaisma.com/g/<slug>, or null outside Zaisma. */
  const gameSlug: string | null;

  /**
   * This tab's player, with their player pass: the signed-in Zaisma account, with the same player ID in
   * every game, or a guest. joinRoom gets one by itself; call this to let the player into a server of
   * your own. Kept for the tab, so a guest who reloads stays the same guest, and renewed when it has
   * under 10 minutes left or the player signed in or out. Fails with error.code "unchecked" when the
   * game isn't played on its zaisma.com page, "not_on_zaisma" when it isn't hosted on Zaisma, and
   * "account_needed" for a guest when the game needs an account for multiplayer or the whole game
   * (its account_requirement setting): ask them to sign in with {@link player.signIn}.
   */
  function player(): Promise<PlayerWithPass>;

  namespace player {
    /**
     * An account's public profile by player ID, what anyone sees of it, like a name for a leaderboard
     * row. Fails with error.code "no_player" for a guest's ID or a deleted account's, and
     * "bad_player_id" for anything that isn't a player ID.
     *
     * @example
     * const profile = await Zaisma.player.getProfile("player_8f3k2m");
     * scoreRow.textContent = profile.name; // the username: nobody can pass as someone else
     */
    function getProfile(playerId: string): Promise<PlayerProfile>;

    /**
     * Ask a guest to sign in with their Zaisma account, without leaving the game. Zaisma's page shows a
     * small card beside the game ("Sign in" or make a free account, and "Not now"); signing in opens a
     * new tab, so the game keeps running. Resolves with the account once the player has signed in, and
     * at once when they already are. From then on {@link player} and joinRoom give the account's pass;
     * rooms the player is already in keep them as the guest they joined as, so join again to play as
     * the account. Call it when the player presses something that needs an account, like Play online
     * in a game whose multiplayer needs one (joinRoom failed with "account_needed"), or Save to
     * leaderboard. A second call while the card is up waits for the same answer. Fails with error.code
     * "sign_in_declined" when the player chose Not now, and "not_on_zaisma" when the game isn't played
     * on its zaisma.com page. There's no time limit: the player may take a few minutes.
     *
     * @example
     * try {
     *   room = await Zaisma.joinRoom();
     * } catch (error) {
     *   if (error.code !== "account_needed") throw error;
     *   await Zaisma.player.signIn(); // { id, name, kind: "account" }
     *   room = await Zaisma.joinRoom();
     * }
     */
    function signIn(): Promise<Player>;

    /**
     * Show Zaisma's "Keep your progress" card at the moment the game picks, like right after the player
     * beat a level or found something rare. It's the same card a guest gets by itself after 5 minutes of
     * play (account_offer_enabled; turn that off to pick every moment yourself): it offers a free account
     * so their progress is kept, beside the game, and making one opens a new tab, so the game keeps
     * running. Because it's Zaisma's card, Zaisma's rule on how often holds, however the game asks: at
     * most once a visit, and not for 3 days after the player chose Not now. Resolves with the account
     * once the player has one, and at once when they're signed in already. A second call while the card
     * is up waits for the same answer. There's no time limit: the player may take a few minutes.
     *
     * Fails with error.code "account_offer_too_soon" when the card already showed this visit or the
     * player chose Not now in the last 3 days (the game can't see the card, so it hears it here; show your
     * own message if you like), "sign_in_declined" when the player chose Not now, "cloud_saves_off" when
     * the game has cloud saves off (no progress for the card to keep: ask with {@link player.signIn}
     * instead), and "not_on_zaisma" when the game isn't played on its zaisma.com page.
     *
     * @example
     * async function levelBeaten() {
     *   try {
     *     const account = await Zaisma.player.offerAccount(); // { id, name, kind: "account" }
     *     showNote("Your progress follows you now, " + account.name + ".");
     *   } catch (error) {
     *     if (error.code !== "account_offer_too_soon" && error.code !== "sign_in_declined") throw error;
     *   }
     * }
     */
    function offerAccount(): Promise<Player>;
  }

  /**
   * Join a room: the one joinOptions.roomCode names, else the one the page's link points to
   * (?room=CODE, on the same server: {@link Rooms.linkedServerUrl}), else a new room. Resolves once the
   * room has let the player in, so room.me and room.players are set. On your own servers (serverUrl),
   * it also tells Zaisma which room a signed-in player is in, and that they left it, so their friends'
   * Join works there too ({@link Friends.setRoom}).
   *
   * Fails with an error whose code says why and whose message says it in words. The room won't take
   * the player: full, closed (to new players), ended, kept_out (removed for the rest of the match),
   * refused (the game server's canJoin said no; the message is its refusalMessage), hosting_paused (the
   * game's hosting is paused this month: its free allowance or its developer's budget or credit is used). No player pass: unchecked, or account_needed for a
   * guest when the game needs accounts (see {@link player}). The
   * call is set up wrong: unknown_option, bad_room_code, bad_server_url, not_on_zaisma (no serverUrl
   * outside Zaisma). Or connection_closed (the connection closed first, say the game left or the player
   * joined from another tab) and request_failed (Zaisma didn't answer). {@link ErrorCode} has them all.
   *
   * @example
   * const room = await Zaisma.joinRoom();
   * Zaisma.joinRoom({ joinData: { character: "knight" } });   // for the game server's canJoin and onJoin
   * Zaisma.joinRoom({ isListed: false });                       // a new room that's never listed: a private match
   * Zaisma.joinRoom({ name: "Ana's castle", labels: { Mode: "Classic", Map: "Docks" } });
   * Zaisma.joinRoom({ idleTimeoutSec: 300 });                   // ask "Still there?" after 5 minutes without input
   * Zaisma.joinRoom({ serverUrl: "wss://play.example.com" });  // your own game server
   */
  function joinRoom(joinOptions?: JoinOptions): Promise<Room>;

  /** Room browsing: the game's listed rooms, which show on its Zaisma page and to the game itself. */
  const rooms: Rooms;

  /** The game's own game server outside any room: requests to its onRequest. */
  const server: Server;

  /**
   * Invite friends. On Zaisma it opens the page's Share, the same as the game bar's Share button: the
   * room's QR code, link and code, Copy and the share sheet ("opened"). On your own site it opens the
   * share sheet on phones, otherwise copies the room's invite link (the game's page without a room).
   * Call it from a button in your game, like on a "waiting for players" screen.
   *
   * @example
   * if ((await Zaisma.invite(room)) === "copied") inviteButton.textContent = "Link copied";
   */
  function invite(room?: Room | null): Promise<InviteStatus>;

  /**
   * Zaisma's chat filter: the same check Zaisma runs on its side on every chat message to or from an
   * under-18 account. It stops contact details in any disguise, moving to another app or meeting up,
   * personal details, slurs and sexual content, and answers with the words to show the sender. Swearing
   * is flagged (hasSwearing) but allowed: blocking it is your game's call. Use it to show the sender why
   * at once; Zaisma checks again when the message is delivered, so it can't be skipped. Checks the whole
   * text, up to 2000 characters; a longer one is refused (too_long), never cut.
   *
   * @example
   * const check = await Zaisma.filterText(typedMessage);
   * if (!check.isAllowed) showError(check.message);
   * else if (check.hasSwearing) showError("No swearing in this game."); // your call
   * else send(check.text);
   */
  function filterText(text: string): Promise<FilteredText>;

  /**
   * The Players panel, where a player can mute, block and report the others and see their friends. On
   * Zaisma it opens the game bar's own Players, the same as its button (leaving full screen if the
   * game is in it), so a Players button in your game, in your game's style, does exactly what the bar's
   * does. On your own site, where there's no bar, it draws Zaisma's ready-made panel; restyle it with CSS
   * on #zaisma-safety. A game with its own netcode offers them in its own menu. Or build your own panel
   * with room.mute, room.block and room.report.
   */
  function openSafetyPanel(room: Room): void;

  /**
   * The signed-in player's Zaisma friends who are playing this game right now, for your own list of
   * them: to join a friend's match, watch it or invite them ({@link Friends.list}). A game never sees
   * friends who aren't playing it, or who's online.
   */
  const friends: Friends;

  /** The player's friends playing this game ({@link friends}). */
  interface Friends {
    /**
     * The player's friends playing this game right now, in any of its rooms or none, as each friend's
     * settings let the player see them: someone who hides what they're playing or appears offline isn't
     * listed. Each comes with the room to join them in when the player could join it, and otherwise why
     * not, the same reasons Join gives on zaisma.com/friends. Kept for 10 seconds, so call it whenever
     * your list opens. Fails with error.code "account_needed" for a guest (ask them to sign in with
     * {@link player.signIn}), and "not_on_zaisma" when the game isn't hosted on Zaisma.
     *
     * @example
     * const { friends } = await Zaisma.friends.list();
     * for (const friend of friends) {
     *   if (friend.roomCode) addRow(friend.name, () => Zaisma.joinRoom({ roomCode: friend.roomCode, serverUrl: friend.serverUrl ?? undefined }));
     *   else addRow(friend.name, null, friend.joinRefusal); // like "room_full" or "no_room": see FriendJoinRefusal
     * }
     */
    list(): Promise<FriendList>;
    /**
     * Say which room on your own servers the player is in, or null when they left it, so their friends'
     * Join on Zaisma takes them there: a link to your game's page with ?room=CODE&server=… that joinRoom
     * and quickJoin follow (see {@link Rooms.linkedServerUrl}). joinRoom({ serverUrl }) does this by
     * itself, so call it only when your game has its own netcode. The server must be one of the game's
     * own servers, own_server_urls (error.code "unlisted_server" otherwise), and Zaisma rooms need
     * none of this. The SDK says it again every 2 minutes while the page is open, and a room it stops
     * saying drops off after 5. For a guest it does nothing: guests have no friends. Your server keeps
     * its own door: a friend's Join is only a room link.
     *
     * @example
     * await Zaisma.friends.setRoom({ serverUrl: "wss://play.example.com", roomCode: "K7Q2MX" });
     * await Zaisma.friends.setRoom(null);   // left the match
     */
    setRoom(room: OwnServerRoom | null): Promise<void>;
  }

  /** The player's friends playing this game ({@link Friends.list}). */
  interface FriendList {
    /** By name. Empty when none of them are playing it. */
    friends: FriendInGame[];
  }

  /** A friend playing this game. */
  interface FriendInGame {
    /** Their player ID, the same in every game, as in room.players. */
    id: string;
    /** The name to show for them: their username. */
    name: string;
    username: string;
    /** The room to join them in, when the player could join it; null otherwise, with joinRefusal. */
    roomCode: string | null;
    /** Your own server that room is on, for joinRoom's serverUrl; null for a Zaisma room, or with no room. */
    serverUrl: string | null;
    /** Why the player can't join them, or null when they can. */
    joinRefusal: FriendJoinRefusal | null;
  }

  /**
   * Why the player can't join a friend, the same reasons Join gives on zaisma.com/friends, in this order:
   * - game_not_taking_joins: your game turned Join off (friend_joins_enabled false in its settings).
   * - friend_not_taking_joins: the friend's own setting doesn't let this player join them.
   * - private_room: your game turned Join off for their room ({@link Room.setFriendJoinsEnabled}).
   * - match_in_progress: their room is closed to new players.
   * - room_full: their room has no space (players and held seats).
   * - no_room: they're playing, but not in a room your game told Zaisma of (a Zaisma room, or one on your own servers through {@link Friends.setRoom}).
   */
  type FriendJoinRefusal = "game_not_taking_joins" | "friend_not_taking_joins" | "private_room" | "match_in_progress" | "room_full" | "no_room";

  /** A room on the game's own servers ({@link Friends.setRoom}). */
  interface OwnServerRoom {
    /** The server, starting with wss:// or https://, like "wss://play.example.com": one of the game's own servers (own_server_urls). */
    serverUrl: string;
    /** Its room code: six characters like "K7Q2MX", from 2 to 9 and A to Z without I or O. */
    roomCode: string;
    /** false: friends' Join shows grayed as "Private room" instead of taking them there. Default true. */
    friendJoinsEnabled?: boolean;
  }

  /**
   * The game's registered links: the sites on its details that it opens, like its store, Patreon,
   * Steam page or Discord ({@link Links.open}). The game can open no other sites.
   */
  const links: Links;

  /** The game's registered links ({@link links}). */
  interface Links {
    /**
     * Open one of the links registered on the game's details, by its link_name, in a new tab. Call it
     * from the player's tap or key press, like a Support us button: links open only right after one, so
     * nothing ever opens by itself (error.code "needs_player_tap" otherwise). On Zaisma, the page shows a
     * card over the game's top corner: "You're leaving Zaisma", your game's name, the full address, Open
     * and Stay. The game keeps running behind it. Resolves with "opened" when a new tab opened, and
     * "stayed" when the player chose Stay or the link can't open for them: guests and under-18 accounts
     * open only links on trusted store, payment and video sites, never chat apps like Discord, and see
     * "This link can't be opened here." instead. The game hears the same "stayed" either way, so it never
     * learns why. Your dashboard and get_game say who each link opens for (who_can_open).
     *
     * Add a path and query under the link's address, so a store can tell what was bought and by whom:
     * the link https://kit.itch.io/sky-hopper with path "/buy" opens https://kit.itch.io/sky-hopper/buy.
     * Another site, or a path outside the link's, never opens.
     *
     * On your own site there's no Zaisma page to look the link up, so give its address there as
     * ownSiteUrl, and it opens straight away. On Zaisma, the registered address opens, whatever
     * ownSiteUrl says.
     *
     * Fails with error.code: unknown_link (no link by that name on the game), bad_link_path,
     * bad_link_query (also when the link's own address already sets that name), bad_own_site_url,
     * needs_player_tap, not_on_zaisma (outside Zaisma without ownSiteUrl), unknown_option, slow_down and
     * request_failed.
     *
     * @example
     * supportButton.onclick = () => Zaisma.links.open("patreon");
     * buyButton.onclick = async () => {
     *   const linkStatus = await Zaisma.links.open("store", { path: "/buy", queryParameters: { item: "sword", player: playerId } });
     *   if (linkStatus === "opened") showNote("Finish buying in the new tab.");
     * };
     * Zaisma.links.open("store", { ownSiteUrl: "https://kit.itch.io/sky-hopper" }); // also works on your own site
     */
    open(linkName: string, linkOptions?: LinkOptions): Promise<LinkStatus>;
  }

  /**
   * The game's items: what the player owns (from their player pass, so it matches what the game's server
   * sees) and what the game sells, priced in the player's currency. Developers set items with set_item;
   * buying comes with Zaisma's buy sheet.
   */
  const items: Items;

  /** The game's items ({@link items}). */
  interface Items {
    /**
     * Whether the player owns a permanent item (bought or granted, not refunded), by its item_name, as their
     * player pass says: a new pass (at most a day old) brings new items. false for guests, who own nothing.
     * Fails with error.code bad_item_name, not_on_zaisma, unchecked, account_needed and request_failed, as
     * Zaisma.player() does.
     *
     * @example
     * if (await Zaisma.items.owns("skin_red-dragon")) unlockSkin("red-dragon");
     */
    owns(itemName: string): Promise<boolean>;
    /** Every permanent item the player owns, by item_name; [] for guests. Fails as {@link Items.owns} does. */
    owned(): Promise<string[]>;
    /**
     * The items the game sells, at the price this player pays: in their currency when the game set a price
     * for it (picked by the player's country), else the main price. Show priceText beside anything sold for
     * coins or gems too: real prices are always shown. Fails with error.code not_on_zaisma, bad_origin,
     * game_unavailable and request_failed.
     *
     * @example
     * for (const item of await Zaisma.items.list()) addShopRow(item.title, item.priceText, item.isOwned);
     */
    list(): Promise<ItemForSale[]>;
  }

  /** One item the game sells, for this player ({@link Items.list}). */
  interface ItemForSale {
    itemName: string;
    title: string;
    /** "" for none. */
    description: string;
    /** permanent: owned for good, on every device. consumable: delivered once, then the game keeps count. */
    itemKind: "permanent" | "consumable";
    itemCategory: "cosmetic" | "gameplay" | "content" | "currency";
    /** The price this player pays, in the currency's smallest unit (cents; yen are whole), tax included. */
    priceMinorUnits: number;
    /** Lowercase ISO 4217, like "usd" or "brl". */
    currencyCode: string;
    /** The price as the player reads it, like "$1.99" or "R$ 59,90". */
    priceText: string;
    /** The player owns it (a permanent item), by their pass. */
    isOwned: boolean;
  }

  /**
   * The player's cloud saves, for games that draw their own save screens. With cloud saves on, Zaisma
   * copies the game's own browser saves (localStorage and IndexedDB) to a signed-in player's account
   * with no code, and keeps 5 earlier versions. When two devices played on, the progress played most
   * recently wins and the other is kept as an earlier version: listen for "conflict" to offer the
   * player the other one. When you change a player's save through the API or MCP, the game reloads with
   * it, unless it listens for "developerChange" and rereads its storage instead. Guests' progress stays
   * in their browser, so the calls fail with "account_needed" for them.
   *
   * Every call fails with error.code "account_needed" for a guest, "cloud_saves_off" when the game has
   * cloud saves off (or plays from a tester link), "not_on_zaisma" when the game isn't played on its
   * zaisma.com page, "slow_down" and "request_failed".
   */
  const saves: Saves;

  /**
   * A version the developer published with match_update_mode "now", for a game that isn't in a match
   * (single-player, or in a menu): it's never forced on the player. Listen for "update" and call
   * update.apply() when it suits the game, like at a checkpoint or back at the main menu: the page
   * reloads the game at the new version, with its save. Without a listener, Zaisma offers Update beside
   * the game, and the player gets it then, or the next time they open the game. Matches hear theirs from
   * the room instead (the room's "versionUpdate" event).
   * @example
   * Zaisma.versions.on("update", (update) => {
   *   if (isAtMainMenu()) update.apply();
   *   else pendingUpdate = update; // apply it when the player is back at the menu
   * });
   */
  const versions: Versions;

  /** A version published "now" ({@link versions}). */
  interface Versions {
    /** Listen for "update". A wrong name fails with error.code "unknown_event". */
    on(event: "update", listener: (update: PendingUpdate) => void): Versions;
    off(event: "update", listener: (update: PendingUpdate) => void): Versions;
  }

  /** A newer version is out ({@link versions}): apply() reloads the game at it, keeping the save. */
  interface PendingUpdate {
    /** The new version, like "version_k2v9q4x7m1p3w8r5t6y0". */
    versionId: string;
    apply(): void;
  }

  /** The player's cloud saves ({@link saves}). */
  interface Saves {
    /**
     * Listen for an event (the {@link SavesEvents}). A wrong name fails with error.code "unknown_event".
     * Listen as the game starts: a conflict settled while the game was opening waits for the game to
     * listen, then arrives at once.
     *
     * @example
     * Zaisma.saves.on("conflict", (conflict) => {});
     * Zaisma.saves.on("developerChange", (change) => {});
     */
    on<EventName extends keyof SavesEvents>(event: EventName, listener: SavesEvents[EventName]): this;
    /** Stop listening. */
    off<EventName extends keyof SavesEvents>(event: EventName, listener: SavesEvents[EventName]): this;
    /**
     * The player's earlier versions in this game, newest first: up to 5, with the one the save is now
     * marked isCurrentSave. Each says why it was kept ({@link SaveCopyReason}).
     *
     * @example
     * const copies = await Zaisma.saves.listCopies();
     * for (const copy of copies) addRow(new Date(copy.savedAt).toLocaleString(), copy.copyReason);
     */
    listCopies(): Promise<SaveCopy[]>;
    /**
     * One earlier version with what it holds: its localStorage items and IndexedDB databases, so the game
     * can show what's in it ("Level 7, 1,200 coins"). Writing its localStorageItems into localStorage
     * puts that progress in place without a reload, and the next save copies it to the account, but
     * keeps no earlier version of the progress it replaced: {@link Saves.restoreCopy} does. Fails with
     * error.code "bad_save_copy_id" for anything that isn't a save copy ID, and "no_save_copy" when the
     * player has no such copy (copies past the newest 5 are gone).
     *
     * @example
     * const copy = await Zaisma.saves.getCopy(copyId);
     * levelText.textContent = "Level " + (copy.localStorageItems.level ?? "1");
     */
    getCopy(saveCopyId: string): Promise<SaveCopyContents>;
    /**
     * Make an earlier version the player's save again, as the player's own change. The save it replaces
     * is kept first as an earlier version (copyReason "restore"), so going back can be undone. It
     * reloads the game with the restored progress, the way a game that keeps its state in memory needs:
     * resolves just before the reload. Fails with error.code "bad_save_copy_id", "no_save_copy" and the
     * errors every saves call has.
     *
     * @example
     * useOtherButton.onclick = () => Zaisma.saves.restoreCopy(conflict.keptSaveCopy.id);
     */
    restoreCopy(saveCopyId: string): Promise<void>;
  }

  /** The events of {@link saves}, each with what its listener gets. */
  interface SavesEvents {
    /**
     * Two progresses differed (two devices, or a guest who signed in to an account with progress of its
     * own), and Zaisma settled it: the progress played most recently won and is what the game opened
     * with, and the other was kept as an earlier version. Offer the player the other one if you like.
     * It fires on the device whose save was kept or refused, where the choice happened, never on a
     * device that only takes up newer progress (like coming back to a tab after another device played
     * on): that device's earlier save is still in {@link Saves.listCopies}.
     *
     * @example
     * Zaisma.saves.on("conflict", async (conflict) => {
     *   const other = await Zaisma.saves.getCopy(conflict.keptSaveCopy.id);
     *   const where = conflict.winningProgress === "this_device" ? "another device" : "this device";
     *   if (confirm("Use your progress from " + where + " instead (level " + other.localStorageItems.level + ")?")) {
     *     await Zaisma.saves.restoreCopy(conflict.keptSaveCopy.id); // the game reloads with it
     *   }
     * });
     */
    conflict: (conflict: SaveConflict) => void;
    /**
     * You changed the player's save through the API or MCP while they played. Listening means the game
     * takes it in place: Zaisma has already written it into the game's localStorage and IndexedDB, so
     * reread your state from there (without listening, the game reloads instead). The player's progress
     * since their last save is kept as an earlier version.
     *
     * @example
     * Zaisma.saves.on("developerChange", () => {
     *   state.coins = Number(localStorage.getItem("coins") ?? 0);
     *   state.level = Number(localStorage.getItem("level") ?? 1);
     *   redraw();
     * });
     */
    developerChange: (change: DeveloperChange) => void;
  }

  /** One of the player's earlier versions ({@link Saves.listCopies}). */
  interface SaveCopy {
    /** Its ID, like "save_copy_k2v9q4x7m1p3w8r5t6y0": what getCopy and restoreCopy take. */
    id: string;
    /** When this progress was saved, as an ISO time in UTC. */
    savedAt: string;
    /** Why it was kept. */
    copyReason: SaveCopyReason;
    /** How big it is, in bytes. */
    sizeBytes: number;
    /** It's the same progress as the save now. */
    isCurrentSave: boolean;
  }

  /** An earlier version with what it holds ({@link Saves.getCopy}). */
  interface SaveCopyContents extends SaveCopy {
    /** The game's localStorage as it was: every key with its text. */
    localStorageItems: Record<string, string>;
    /**
     * The game's IndexedDB databases as it was ([] when it keeps none), in Zaisma's save format: each
     * { name, version, stores }, with records whose binary data and dates are tagged values. Treat them as
     * opaque; restoreCopy puts them back.
     */
    indexeddbDatabases: IndexeddbDatabase[];
  }

  /**
   * One IndexedDB database in a save, in Zaisma's save format: { name, version, stores }, the same as
   * the developer API's get_save_copy answers. Opaque: restoreCopy puts it back.
   */
  type IndexeddbDatabase = { readonly [field: string]: unknown };

  /**
   * Why an earlier version was kept: hourly (a routine copy while playing, at most one an hour),
   * replaced (another device's progress, played more recently, replaced it), smaller (the save shrank to
   * under half, usually a reset), restore (the player went back to an earlier version: restoreCopy),
   * device (a device's progress lost to the account's, played more recently) or developer (you changed,
   * reset or restored the save through the API or MCP).
   */
  type SaveCopyReason = "hourly" | "replaced" | "smaller" | "restore" | "device" | "developer";

  /** A conflict Zaisma settled ({@link SavesEvents.conflict}). */
  interface SaveConflict {
    /** Whose progress won: this device's, played more recently, or another's (the account's), which the game opened with. */
    winningProgress: "this_device" | "other_device";
    /** Where the other progress is kept. */
    keptSaveCopy: SaveCopy;
  }

  /** A change you made to the player's save ({@link SavesEvents.developerChange}). */
  interface DeveloperChange {
    /** When you changed it, as an ISO time in UTC. */
    changedAt: string;
    /** Where the player's progress since their last save is kept, or null when there was none to keep. */
    keptSaveCopy: SaveCopy | null;
  }

  /** What {@link Links.open} takes. Every option is optional. */
  interface LinkOptions {
    /** A path added under the link's address: starts with /, like "/buy", with no ?, #, . or .. parts. Up to 500 characters. */
    path?: string;
    /**
     * Query parameters added to the link's address, like { item: "sword", player: "player_8f3k2m" }:
     * up to 20, each text of up to 500 characters (numbers as String(3)). Never one the link's own address sets.
     */
    queryParameters?: Record<string, string>;
    /**
     * The link's whole address when the game runs on your own site, like "https://kit.itch.io/sky-hopper",
     * where it opens straight away. On Zaisma the address registered for the link opens instead, so keep the two the same.
     */
    ownSiteUrl?: string;
  }

  /** What happened when the game opened a link: opened (in a new tab), or stayed (the player chose Stay, or the link can't open for them). */
  type LinkStatus = "opened" | "stayed";

  /** What {@link joinRoom} takes. Every option is optional. */
  interface JoinOptions {
    /** A room's code: six characters, like "K7Q2MX". By default, the code in the page's link (?room=), else a new room. */
    roomCode?: string;
    /**
     * Your own game server's full address, like "wss://play.example.com" (wss://, ws://, https:// or
     * http://), instead of Zaisma rooms. Add it to the game's own servers on Zaisma first, so the game
     * is allowed to connect to it.
     */
    serverUrl?: string;
    /** false: a new room that never shows in room lists, like a private match. Counts only when this player makes the room. */
    isListed?: boolean;
    /**
     * false: a new room friends can't Join from Zaisma, shown grayed as "Private room" (codes and links
     * still work). Counts only when this player makes the room.
     */
    friendJoinsEnabled?: boolean;
    /** A new room's name, like "Ana's castle": up to 40 characters. Counts only when this player makes the room. */
    name?: string;
    /**
     * A new room's labels, which players can filter rooms by, like { Mode: "Classic", Map: "Docks" }: up
     * to 4, names up to 16 characters and values up to 24. Counts only when this player makes the room.
     */
    labels?: Record<string, string>;
    /**
     * What the player brings into the room, for the game server's canJoin and onJoin, like the character
     * they picked: plain JSON, up to 4 KB. It comes from the player's browser, so check it like any message.
     */
    joinData?: unknown;
    /**
     * Seconds without input before the player is asked "Still there?", from 30 to 86400. By default, the
     * game server's idleTimeoutSec (600, 10 minutes).
     */
    idleTimeoutSec?: number;
    /**
     * false: never ask "Still there?" in this game. The room's own check still applies, except where the
     * game server's idleCheck is "client", as with the relay.
     */
    idleCheckEnabled?: boolean;
    /**
     * true: watch the room instead of playing, where the game server takes spectators (its
     * maximumSpectatorCount). A spectator gets what the room sends everyone, sends nothing ({@link Room.send}
     * throws error.code "spectator_cannot_send"), doesn't count as playing and is never asked "Still there?".
     * A closed or full room can still be watched; a room with nobody playing can't (error.code "no_room"),
     * and nor can one whose spectators are all there (error.code "watching_full"). Zaisma's Watch opens
     * the game with {@link Rooms.isLinkedAsSpectator} true.
     *
     * @example
     * const room = await Zaisma.joinRoom({ isSpectator: Zaisma.rooms.isLinkedAsSpectator });
     */
    isSpectator?: boolean;
  }

  /** What {@link Rooms.quickJoin} takes: joinRoom's options but roomCode and isSpectator, and region. */
  interface QuickJoinOptions extends Omit<JoinOptions, "roomCode" | "isSpectator"> {
    /** Look for a room in this region only: a continent code, like "EU", as in {@link RoomList.regions}. */
    region?: string;
    /** Look for a room with these labels, like { Mode: "Classic" }; a new room gets them. */
    labels?: Record<string, string>;
  }

  /** What {@link Rooms.list} takes. */
  interface ListOptions {
    /** Rooms in this region only: a continent code, like "EU", as in {@link RoomList.regions}. */
    region?: string;
    /** Rooms with these labels only, like { Mode: "Classic" }. */
    labels?: Record<string, string>;
  }

  /** What {@link Move.join} takes: joinRoom's options but roomCode and serverUrl, which are the move's own, and isSpectator (moves are for players). */
  interface MoveJoinOptions extends Omit<JoinOptions, "roomCode" | "serverUrl" | "isSpectator"> {}

  /** What {@link Room.kick} takes. */
  interface KickOptions {
    /** Keep them out for the rest of the match. */
    keepOut?: boolean;
  }

  /** What {@link Room.setInfo} takes. Leave a field out to keep it; null clears it. */
  interface RoomInfo {
    /** The room's name, like "Ana's castle": up to 40 characters. */
    name?: string | null;
    /** The room's labels, like { Mode: "Classic", Map: "Docks" }: up to 4, names up to 16 characters and values up to 24. */
    labels?: Record<string, string> | null;
  }

  /** Room browsing: the game's listed rooms, which show on its Zaisma page and to the game itself. */
  interface Rooms {
    /**
     * The room code the player's link points to (?room=CODE), or null. Check it to show a menu or a
     * character picker first, then join with what the player picked: joinRoom and quickJoin both follow the link.
     */
    readonly linkedRoomCode: string | null;
    /**
     * The game's own server the player's link points to (?server=, beside ?room=), or null: a friend's
     * Join into a room on your own servers ({@link Friends.setRoom}). joinRoom({ serverUrl }) and quickJoin
     * follow a linked room when the link names no server or the same one, and a Zaisma room only when
     * it names none. Zaisma passes it on only when it's one of the game's own servers (own_server_urls).
     */
    readonly linkedServerUrl: string | null;
    /**
     * true when the player's link is a Watch (?watch=1 beside ?room=), from Zaisma's Watch beside Join: they
     * came to watch the linked room, not to play. Join it with joinRoom({ isSpectator: true }).
     */
    readonly isLinkedAsSpectator: boolean;
    /**
     * The game's listed rooms on Zaisma, for a game's own lobby or server browser: rooms with space
     * first (the player's country, then region, then the busiest), up to 50. Never who's in them.
     * Fails with error.code "not_on_zaisma" in a game that isn't hosted on Zaisma.
     *
     * @example
     * const { rooms, playing, regions } = await Zaisma.rooms.list();
     * Zaisma.rooms.list({ region: "EU", labels: { Mode: "Classic" } });   // one region, or rooms with these labels
     */
    list(listOptions?: ListOptions): Promise<RoomList>;
    /**
     * Drop the player into a match: the room their link points to if it has space, otherwise a listed
     * room with space (nearby and busy first), otherwise a new room. Rooms with someone the player
     * blocked come after the others, and before a new room; the linked room is the player's own choice.
     *
     * @example
     * const room = await Zaisma.rooms.quickJoin();
     * Zaisma.rooms.quickJoin({ region: "EU", labels: { Mode: "Classic" } });   // a room like that with space, else a new one with those labels
     */
    quickJoin(quickJoinOptions?: QuickJoinOptions): Promise<Room>;
  }

  /** The game's own game server outside any room ({@link server}). */
  interface Server {
    /**
     * Send a request to the game's own game server, its onRequest(player, request, server), outside
     * any room, and get back what it answers: for a leaderboard, a shop or a daily reward, in
     * single-player games too. The player's pass goes with it, so the server knows who's asking and
     * the player can't pretend to be someone else. The request is plain JSON, up to 16 KB; say what
     * it's for in its type, like a room message. On Zaisma, the game server is the one in your
     * upload's zaisma-server/ folder (or zaisma-server.js); give serverUrl for your own.
     *
     * Fails with error.code: no_request_handler (the game server has no onRequest), game_server_error
     * (onRequest threw, answered something that isn't plain JSON or over 1 MB, or took over 10
     * seconds; you see why with the game server's errors), hosting_paused (the game's hosting
     * on Zaisma is paused this month: its free allowance or its developer's budget or credit is used), too_big, bad_request (not plain JSON), slow_down
     * (over about 120 a minute from one address), bad_pass, account_needed, unchecked,
     * game_unavailable, bad_origin, busy, bad_server_url, not_on_zaisma (no serverUrl outside
     * Zaisma), unknown_option and request_failed.
     *
     * @example
     * const top = await Zaisma.server.request({ type: "leaderboard" });
     * const { coinCount } = await Zaisma.server.request({ type: "claimDailyReward" });
     * Zaisma.server.request({ type: "buy", itemId: "sword" }, { serverUrl: "https://play.example.com" }); // your own server
     */
    request(request: unknown, requestOptions?: RequestOptions): Promise<unknown>;
  }

  /** How {@link Room.send} and {@link Room.sendBytes} send. */
  interface SendOptions {
    /**
     * "reliable" (the default) reaches the game server in order. "latest_only" may be dropped: while
     * this player's connection is backed up, a newer send with the same latestKey replaces it, and the
     * newest goes once it catches up. For input sent every frame, like where the player aims. Anything
     * else throws error.code "bad_send_option".
     */
    delivery?: "reliable" | "latest_only";
    /**
     * For "latest_only": which sends replace each other, up to 40 characters, like "aim". Defaults to
     * the message's type field when it's text, else "" (bytes too).
     */
    latestKey?: string;
  }

  /**
   * One change in a state update: [path, value] sets what's at path to value, [path] removes it, and an
   * empty path replaces the whole state. path is keys of objects and indexes of arrays, from the top.
   */
  type StateChange = [path: (string | number)[]] | [path: (string | number)[], value: unknown];

  /** Options for {@link Server.request}. */
  interface RequestOptions {
    /** Your own game server's address, like "https://play.example.com", instead of Zaisma's. The Node runner answers requests on the same port as its rooms. */
    serverUrl?: string;
  }

  /** A room the player is in: one live match, running one copy of the game server. */
  interface Room {
    /** The room's code, six characters like "K7Q2MX". It changes when the game server moves the player (the "moved" event). */
    readonly roomCode: string;
    /** This player. */
    readonly me: Player;
    /**
     * Players in the room right now, in join order, this player included, each with why they aren't
     * playing (awayReason), like a player whose connection dropped and who has a few seconds to come back.
     */
    readonly players: readonly ListedPlayer[];
    /** The host's player ID, when the game server gives the host controls (the relay does), else null. */
    readonly hostPlayerId: string | null;
    /** This player is watching, not playing ({@link JoinOptions.isSpectator}): they're never in players. */
    readonly isSpectator: boolean;
    /** How many are watching the room; the "room" event says when it changes. */
    readonly spectatorCount: number;
    /** Where the connection stands; the "connectionStatus" event says when it changes. */
    readonly connectionStatus: ConnectionStatus;
    /** The room's link on Zaisma, like "https://zaisma.com/g/sky-hopper?room=K7Q2MX", or null outside Zaisma. */
    readonly inviteUrl: string | null;
    /** Shown in room lists. A room that isn't still works by code and link. */
    readonly isListed: boolean;
    /** Taking new players. A closed room lets back only players who were in it. */
    readonly isOpen: boolean;
    /** Zaisma's Join (friends on zaisma.com, Zaisma.friends) offers this room; when false it's grayed as "Private room". */
    readonly friendJoinsEnabled: boolean;
    /** The room's name, like "Ana's castle", or null. */
    readonly name: string | null;
    /** The room's labels, like { Mode: "Classic", Map: "Docks" }. */
    readonly labels: Readonly<Record<string, string>>;
    /**
     * When Zaisma will end this match, an ISO time, or null: set once the game's hosting pauses for the
     * month, an hour after the pause (the "ending" event). Never set in a room on your own server.
     */
    readonly endsAt: string | null;
    /**
     * This player's round trip to the room in milliseconds, smoothed and measured by the room; null until
     * the first measurement, right after joining. The game server reads the same number with
     * room.pingDurationMs(playerId).
     *
     * @example
     * // A ping readout in the corner
     * pingText.textContent = room.pingDurationMs === null ? "" : room.pingDurationMs + " ms";
     */
    readonly pingDurationMs: number | null;
    /**
     * This player's view of the game server's state, when it has stateSyncEnabled: the game server's
     * state, or what its stateView answers for this player. null until the first update, which comes as
     * the player joins; after that it changes with each update (the "state" event). Read it, don't change it.
     *
     * @example
     * function draw() {
     *   const world = room.state;
     *   if (world) for (const [id, body] of Object.entries(world.bodies)) drawBody(id, body);
     *   requestAnimationFrame(draw);
     * }
     */
    readonly state: unknown | null;
    /**
     * The state as it was delayMs behind the room's clock (100 unless you say, up to 1000), between the
     * two updates around then: numbers in between, anything else as the older update had it, and what's in
     * only one of them as it is. So positions and angles move evenly however the updates arrive, a moment
     * behind. A copy, yours to keep; null until the first update. Anything else for delayMs throws
     * error.code "bad_delay". Predicting this player's own moves stays your game's.
     *
     * @example
     * function draw() {
     *   const world = room.smoothedState();
     *   if (world) for (const body of Object.values(world.bodies)) drawBody(body.x, body.y);
     *   requestAnimationFrame(draw);
     * }
     */
    smoothedState(delayMs?: number): unknown | null;

    /**
     * The room's clock now, in epoch milliseconds, estimated from the room's probes (Date.now() until the
     * first one): the same clock as the game server's room.serverTimeMs(), so a time it sends means the
     * same moment for every player.
     *
     * @example
     * // The game server sent { type: "countdown", startsAtMs: room.serverTimeMs() + 3000 }
     * room.on("message", (message) => {
     *   if (message.type === "countdown") startsInMs = message.startsAtMs - room.serverTimeMs();
     * });
     */
    serverTimeMs(): number;
    /**
     * Send a message to the game server: plain JSON, up to 16 KB, about 30 a second at most. Send input
     * when it changes, not every frame. Nothing is sent while the player is away. With
     * { delivery: "latest_only" }, a message may be dropped for a newer one (SendOptions). A spectator
     * can't send: it throws error.code "spectator_cannot_send".
     *
     * @example
     * // Where the player aims, as it changes: only the newest matters.
     * room.send({ type: "aim", angle }, { delivery: "latest_only" });
     */
    send(message: unknown, sendOptions?: SendOptions): void;
    /**
     * Send bytes to the game server (its onBytes), like a compact input: an ArrayBuffer or any typed
     * array, up to 16 KB, counted with messages (about 30 a second at most). Anything else throws
     * error.code "bad_bytes", and a spectator's throws "spectator_cannot_send". Nothing is sent while the
     * player is away. Takes the same sendOptions as room.send.
     */
    sendBytes(bytes: ArrayBuffer | ArrayBufferView, sendOptions?: SendOptions): void;
    /** Leave the room for good. */
    leave(): void;
    /**
     * Show or hide the room in room lists. From the room's host when the game uses the relay; with a
     * game server of your own, the server decides (its room.setListed). The "room" event says when it changed.
     */
    setListed(isListed: boolean): void;
    /**
     * Open or close the room to new players; players who were in it can still come back. From the
     * room's host when the game uses the relay; with a game server of your own, the server decides (its
     * room.setOpen). The "room" event says when it changed.
     */
    setOpen(isOpen: boolean): void;
    /**
     * Turn Zaisma's Join on or off for this room: off, a player's friends see Join grayed as "Private
     * room" on zaisma.com and in {@link Friends.list}. It isn't a lock: a code or link still reaches the
     * room, so close it (setOpen) or answer false from canJoin to keep players out. From the room's host
     * when the game uses the relay; with a game server of your own, the server decides (its
     * room.setFriendJoinsEnabled). The "room" event says when it changed.
     */
    setFriendJoinsEnabled(isEnabled: boolean): void;
    /**
     * Name and label the room. From the room's host when the game uses the relay; with a game server of
     * your own, the server decides (its room.setInfo). Names and labels players type show on Zaisma's
     * pages only if they pass Zaisma's filter for its pages, which blocks swearing too.
     */
    setInfo(nameAndLabels: RoomInfo): void;
    /**
     * The host removes a player, when the game server gives the host controls (the relay does). They're
     * told the host removed them; keepOut keeps them out for the rest of the match.
     */
    kick(playerId: string, kickOptions?: KickOptions): void;
    /**
     * Whether to hide a player's emotes and phrases: this player muted or blocked them, or there's a
     * block between them either way (never which one made it, so a blocked player is never told).
     */
    isMuted(playerId: string): boolean;
    /** Mute a player for this room. The "muted" event says the list changed. */
    mute(playerId: string): void;
    /**
     * Unmute a player, and lift a block this session made. A block between two accounts is undone only
     * on zaisma.com/friends, never from a game.
     */
    unmute(playerId: string): void;
    /**
     * Block a player in the room: a wall both ways, so neither one's emotes and phrases reach the other,
     * and the game server's room.hasBlockBetween says so. When both are Zaisma accounts, Zaisma asks the
     * player beside the game first, and the block then lasts in every game until they undo it on
     * zaisma.com/friends; it ends a friendship, and the blocked player isn't told. Any other block (a
     * guest's, or of a guest) lasts for the session. Resolves true once they're blocked, or false if the
     * player changed their mind. A block never removes anyone from the room.
     */
    block(playerId: string): Promise<boolean>;
    /** Report a player to Zaisma, with what happened in the player's own words if they gave any (details). Nothing about the reporting player is sent. */
    report(playerId: string, reason: ReportReason, details?: string): Promise<ReportAnswer>;

    /**
     * Listen for an event. Listening is optional: without "move" and "back" listeners, the SDK follows
     * a move and rejoins by itself; with one, your game decides when.
     *
     * @example
     * room.on("message", (message) => {});
     * room.on("players", (players) => {});
     * room.on("move", (move) => { showLoading(); move.follow(); });
     */
    on<EventName extends keyof RoomEvents>(event: EventName, listener: RoomEvents[EventName]): this;
    /** Stop listening. */
    off<EventName extends keyof RoomEvents>(event: EventName, listener: RoomEvents[EventName]): this;
  }

  /** A room's events, each with what its listener gets. */
  interface RoomEvents {
    /** A message from the game server: the game's own, as it sent it. With the relay, { fromPlayerId, data }. */
    message: (message: any) => void;
    /**
     * Bytes from the game server (its room.broadcastBytes or room.sendBytes): fromPlayerId is the player
     * they came from when the game server passed one player's bytes on (the relay always does), or null.
     */
    bytes: (bytes: Uint8Array, fromPlayerId: string | null) => void;
    /**
     * A state update, when the game server has stateSyncEnabled: state is room.state now, and changes
     * what changed since the last update, or null after a full copy (as the player joins, and after their
     * connection was backed up). Most games read room.state or room.smoothedState() as they draw instead.
     * @example
     * room.on("state", (state, changes) => { scoreText.textContent = String(state.scores[room.me.id]); });
     */
    state: (state: any, changes: StateChange[] | null) => void;
    /**
     * Players joined, left, walked away or came back, or their connection dropped or came back; the same
     * list as room.players.
     * @example
     * // Freeze a player whose connection dropped, and show them reconnecting, until they're back.
     * room.on("players", (players) => {
     *   for (const player of players) {
     *     const body = bodies.get(player.id);
     *     if (body) body.isFrozen = player.awayReason === "lost";
     *   }
     * });
     */
    players: (players: readonly ListedPlayer[]) => void;
    /** Where the connection stands, as room.connectionStatus. "away" while the player is out of the match. */
    connectionStatus: (connectionStatus: ConnectionStatus) => void;
    /** The match ended (the game server's room.end), with its message. The connection closes. */
    ended: (message: string) => void;
    /**
     * Zaisma will end this match at endsAt (an ISO time, also room.endsAt), because the game's hosting on
     * Zaisma rooms paused for the month: tell your players and save what should last.
     * "ended" follows then.
     */
    ending: (endsAt: string) => void;
    /** The game server or the host removed the player from the room. The connection closes. */
    kicked: (kicked: Kicked) => void;
    /** The room's listing, Join switch, name or labels changed, or how many watch: room.isListed, room.isOpen, room.friendJoinsEnabled, room.name, room.labels and room.spectatorCount have the new ones. */
    room: (settings: RoomSettings) => void;
    /**
     * The game server is sending the player to another room (its room.reserve or room.moveTo). Without
     * a listener the room follows by itself; with one, call move.follow() when your game is ready, or
     * leave and move.join() it as a new room object.
     */
    move: (move: Move) => void;
    /** This room object moved to another room: same object, new code. A "players" event with the new list follows. */
    moved: (roomCode: string) => void;
    /**
     * "Still there?": true when it's time to ask, after idleTimeoutSec without input. Listening replaces
     * Zaisma's small "Still there?" plate (restyle the plate with CSS on #zaisma-still-there instead, if you
     * like). false: they answered, or the 30 seconds are up and the room is told they walked away.
     */
    idle: (isAsking: boolean) => void;
    /**
     * The player walked away: out of the match, with their seat held for seatHoldDurationSec, unless the
     * game server decides (its onAway). Any input brings them back.
     */
    away: (away: Away) => void;
    /**
     * The player came back after their held seat ran out. Listening turns off rejoining by itself:
     * call back.rejoin() to rejoin their old room (it fails if the room is full or over).
     */
    back: (back: Back) => void;
    /** Whose emotes and phrases to hide changed: every player ID room.isMuted is true for. */
    muted: (playerIds: string[]) => void;
    /** The room sent an error, like too_fast. Joining fails with the same code when the room won't take the player. */
    error: (error: RoomError) => void;
    /**
     * The developer published a version with match_update_mode "now", and this match moves to it at
     * versionUpdate.appliesAt at the latest (sooner if the game server switches at a good moment). Show a
     * countdown or save; when it switches, this room object reconnects by itself, or, when the game's
     * files changed (isReloading), the page reloads the game at the new version and joinRoom() with no
     * code brings the player back into this room.
     * @example
     * room.on("versionUpdate", ({ appliesAt }) => showBanner(`Updating at ${new Date(appliesAt).toLocaleTimeString()}`));
     */
    versionUpdate: (versionUpdate: VersionUpdate) => void;
  }

  /** A match moving to a version published "now" (the room's "versionUpdate" event). */
  interface VersionUpdate {
    /** The version it moves to, like "version_k2v9q4x7m1p3w8r5t6y0". */
    versionId: string;
    /** When it switches at the latest, an ISO time. */
    appliesAt: string;
    /** The game's own files changed, so the page reloads the game at the new version; false: it only reconnects. */
    isReloading: boolean;
  }

  /** A player, as the room shows them to everyone. */
  interface Player {
    /** Their player ID, like "player_8f3k2m". An account's is the same in every game; a guest's is temporary. */
    id: string;
    /** The name shown for them: the account's name, or a guest's like "Swift Otter 42". */
    name: string;
    /** A signed-in Zaisma account, or a guest. */
    kind: PlayerKind;
  }

  /** A player in the room's list (room.players): who they are, and why they aren't playing. */
  interface ListedPlayer extends Player {
    /**
     * Why this player isn't playing: "idle" or "hidden" (the game server kept them, onAway), or "lost"
     * (their connection dropped and they have reconnectTimeoutSec to come back); null while they play.
     */
    awayReason: "idle" | "hidden" | "lost" | null;
  }

  /** A signed-in Zaisma account, or a guest. */
  type PlayerKind = "guest" | "account";

  /** What anyone sees of an account on its profile, zaisma.com/@username ({@link player.getProfile}). */
  interface PlayerProfile {
    /** The account's player ID, the same in every game. */
    id: string;
    /** The name to show for them in games: their username, so nobody can pass as someone else. */
    name: string;
    /** Their username: unique ignoring case, 3 to 20 letters, numbers and underscores. It can change; the ID never does. */
    username: string;
    /** The name they chose to show beside @username on their profile, once checked; null when none. */
    displayName: string | null;
    /** What they wrote about themselves, once checked; null when none or when their profile is private. */
    bio: string | null;
    /** Links they chose to show (only adults can), up to 3; [] otherwise or when their profile is private. */
    linkUrls: string[];
    /** Their profile page. */
    profileUrl: string;
    /** True when they show their profile to friends only: strangers then see only the name, username and published games. */
    isProfilePrivate: boolean;
    /** Games they made that anyone can find, newest first. */
    publishedGames: ProfileGame[];
    /** Games they played lately, newest first, when they show those to anyone; [] otherwise. */
    playedGames: (ProfileGame & { playedPeriod: PlayedPeriod })[];
    /** The game they're playing right now, when they show that to anyone; null when they aren't, don't show it, appear offline, or the game isn't out yet. */
    playingNow: ProfileGame | null;
  }

  /** A game on a profile. */
  interface ProfileGame {
    slug: string;
    title: string;
    /** The game's page on Zaisma. */
    pageUrl: string;
  }

  /** Roughly when a player last played a game: a profile never shows a time. */
  type PlayedPeriod = "today" | "this_week" | "this_month" | "earlier";

  /** This tab's player and their player pass ({@link player}). */
  interface PlayerWithPass extends Player {
    /**
     * The player pass: a standard EdDSA JWT any server can check against the keys at
     * https://rooms.zaisma.com/.well-known/jwks.json. It proves only who the player is: its sub is the
     * player's ID, kind says guest or account, aud is the game. A guest's pass also carries their name;
     * an account's name comes from its profile (https://rooms.zaisma.com/v1/players/<id>). An account's
     * pass says who it can chat with, never its age: who_can_chat (nobody, friends or anyone, the
     * player's own setting), when anyone an opaque chat_group (chat_group_…) that differs in every
     * game. It carries its friends and blocks, never as a list of players anyone can read: player_tag,
     * its own opaque tag in this game (player_tag_…), friend_tag_ids, its friends' tags (up to 200), and
     * block_tag_ids, the tags of the accounts it has a block with, either way (up to 100). Your own server
     * checks two players with areFriends(first, second), canChat(first, second) before passing chat
     * between them, and hasBlockBetween(first, second) before matching them together, all from
     * @zaisma/game-server; guests never chat and are never anyone's friend.
     */
    pass: string;
    /** When the pass runs out, as an ISO time in UTC. */
    expiresAt: string;
  }

  /** Where a room's connection stands. "away": the player walked away and is out of the match until they're back. */
  type ConnectionStatus = "connecting" | "open" | "reconnecting" | "away" | "closed";

  /** Whether a room shows in room lists, takes new players and is offered by Zaisma's Join, and its name and labels. */
  interface RoomSettings {
    isListed: boolean;
    isOpen: boolean;
    friendJoinsEnabled: boolean;
    name: string | null;
    labels: Record<string, string>;
  }

  /** Why the player was removed from the room, and whether they're kept out for the rest of the match. */
  interface Kicked {
    /** Why, in words to show the player. */
    message: string;
    isKeptOut: boolean;
  }

  /** The game server is sending the player to another room ({@link RoomEvents.move}). */
  interface Move {
    /** The room they're being sent to. */
    roomCode: string;
    /** Move this room object there: the old connection closes and the new one opens. */
    follow(): void;
    /** Join it as a new room object instead, on the same server as this one: leave this one first. */
    join(moveJoinOptions?: MoveJoinOptions): Promise<Room>;
  }

  /** The player walked away ({@link RoomEvents.away}). */
  interface Away {
    /** "idle": no input and no answer to "Still there?". "hidden": the game was hidden for 2 minutes in a real-time room. */
    reason: "idle" | "hidden";
    /** How long the room holds their seat, in seconds. */
    seatHoldDurationSec: number;
  }

  /** The player is back after their held seat ran out ({@link RoomEvents.back}). */
  interface Back {
    /** Their old room. */
    roomCode: string;
    /** Rejoin it. Fails if it's full or over. */
    rejoin(): void;
  }

  /** An error the room sent. */
  interface RoomError {
    code: RoomErrorCode;
    /** What happened, in words. */
    message: string;
  }

  /**
   * The codes a room's errors have, in its "error" event and when joining fails:
   * - full: the room has no space.
   * - closed: the room is closed to new players.
   * - ended: the match is over.
   * - kept_out: the player was removed for the rest of the match.
   * - refused: the game server's canJoin turned them away.
   * - hosting_paused: the game's hosting on Zaisma is paused this month (its free allowance, or its developer's budget or credit, is used); new rooms open again when the month resets (UTC) or its developer adds credit, and a running match takes no new players and ends within the hour.
   * - account_needed: the player is a guest, and the game needs a Zaisma account for multiplayer or the whole game.
   * - game_not_open_to_player: the account is younger than the game's minimum age (set on the dashboard); the game never learns its age.
   * - game_unavailable: the game can't be played right now.
   * - bad_pass: the player pass wasn't accepted (the SDK gets a new one and tries once more).
   * - too_big: a message over 16 KB, or joinData over 4 KB.
   * - too_fast: more messages than the room takes (about 30 a second).
   * - bad_message, no_hello, not_allowed: a message the room couldn't read, didn't expect, or doesn't allow from this player.
   * - busy, no_room: the room couldn't take the player right now, or doesn't exist.
   * - blocked_player_here: quickJoin's first try at a room with someone the player blocked; quickJoin tries the others first, and you won't see it.
   * - other_version: the room runs another version of the game. On its Zaisma page the game reloads at the room's version and joins it, and you won't see it; you see it outside Zaisma, through a tester link, or when that version is no longer kept.
   * - watching_full: the room takes no more spectators (its game server's maximumSpectatorCount, 0 when it takes none).
   * - spectator_cannot_send: a spectator tried to send to the room ({@link Room.send}, {@link Room.sendBytes}).
   */
  type RoomErrorCode =
    | "full"
    | "closed"
    | "ended"
    | "kept_out"
    | "refused"
    | "hosting_paused"
    | "account_needed"
    | "game_not_open_to_player"
    | "game_unavailable"
    | "bad_pass"
    | "too_big"
    | "too_fast"
    | "bad_message"
    | "no_hello"
    | "not_allowed"
    | "busy"
    | "no_room"
    | "blocked_player_here"
    | "other_version"
    | "watching_full"
    | "spectator_cannot_send";

  /**
   * The codes a request's errors have ({@link Server.request}), from Zaisma or the Node runner alike:
   * - bad_request: not plain JSON with the player's pass.
   * - too_big: a request over 16 KB.
   * - bad_pass: the player pass wasn't accepted (the SDK gets a new one and tries once more).
   * - account_needed: the player is a guest, and the game needs a Zaisma account for multiplayer or the whole game.
   * - game_not_open_to_player: the account is younger than the game's minimum age (set on the dashboard); the game never learns its age.
   * - game_unavailable: the game can't be played right now.
   * - no_request_handler: the game's server has no onRequest.
   * - game_server_error: onRequest threw, answered something that isn't plain JSON or over 1 MB, or took over 10 seconds.
   * - hosting_paused: the game's hosting on Zaisma is paused this month; requests work again when the month resets (UTC) or its developer adds credit.
   * - slow_down: too many requests from this address; try again in a minute.
   * - bad_origin: the request didn't come from the game's own page.
   * - busy: Zaisma couldn't answer right now; try again soon.
   */
  type RequestErrorCode =
    | "bad_request"
    | "too_big"
    | "bad_pass"
    | "account_needed"
    | "game_not_open_to_player"
    | "game_unavailable"
    | "no_request_handler"
    | "game_server_error"
    | "hosting_paused"
    | "slow_down"
    | "bad_origin"
    | "busy";

  /**
   * The codes the SDK's errors have: a room's ({@link RoomErrorCode}), and:
   * - unchecked: no player pass, because the game isn't played on its zaisma.com page or Zaisma couldn't check the browser.
   * - unknown_option, unknown_event: a call the SDK doesn't take; the message lists what it does.
   * - slow_down: too many calls; try again in a minute.
   * - no_rooms: the game doesn't use Zaisma rooms.
   * - bad_report: a report whose reason isn't a {@link ReportReason}, or whose player ID isn't one.
   * - bad_origin: the call didn't come from the game's own page.
   * - not_on_zaisma: the game isn't hosted on Zaisma, so it has no player passes, sign-in or room lists, and joinRoom needs a serverUrl.
   * - sign_in_declined: the player chose Not now when the game asked them to sign in ({@link player.signIn}) or showed the "Keep your progress" card ({@link player.offerAccount}).
   * - account_offer_too_soon: the "Keep your progress" card already showed this visit, or the player chose Not now in the last 3 days ({@link player.offerAccount}).
   * - cloud_saves_off: the game has cloud saves off, or plays from a tester link, so it has no saves on players' accounts ({@link saves}).
   * - bad_save_copy_id: not a save copy ID; they come from {@link Saves.listCopies}, like "save_copy_k2v9q4x7m1p3w8r5t6y0".
   * - no_save_copy: the player has no earlier version with that ID in this game.
   * - bad_room_code: not a room code, which is six characters like "K7Q2MX", from 2 to 9 and A to Z without I or O.
   * - bad_server_url: a serverUrl that isn't a full wss://, ws://, https:// or http:// address ({@link Friends.setRoom} takes only wss:// and https://).
   * - unlisted_server: {@link Friends.setRoom} named a server that isn't one of the game's own servers (own_server_urls).
   * - connection_closed: the connection to the room closed before it let the player in; the message says why.
   * - bad_bytes: {@link Room.sendBytes} was given something other than an ArrayBuffer or a typed array.
   * - request_failed: Zaisma didn't answer (no connection, or a problem on Zaisma's side); try again.
   * - And a request's ({@link RequestErrorCode}).
   */
  type ErrorCode =
    | RoomErrorCode
    | RequestErrorCode
    | "unchecked"
    | "unknown_option"
    | "unknown_event"
    | "slow_down"
    | "no_rooms"
    | "bad_report"
    | "bad_origin"
    | "not_on_zaisma"
    | "sign_in_declined"
    | "account_offer_too_soon"
    | "cloud_saves_off"
    | "bad_save_copy_id"
    | "no_save_copy"
    | "no_player"
    | "bad_player_id"
    | "bad_room_code"
    | "bad_bytes"
    | "bad_send_option"
    | "bad_delay"
    | "bad_server_url"
    | "unlisted_server"
    | "unknown_link"
    | "bad_link_path"
    | "bad_item_name"
    | "bad_link_query"
    | "bad_own_site_url"
    | "needs_player_tap"
    | "connection_closed"
    | "request_failed";

  /**
   * An error from the SDK: its code says what went wrong, for the game to branch on, and its message
   * says it in one sentence, with what to fix.
   *
   * @example
   * try { room = await Zaisma.joinRoom(); }
   * catch (error) { if (error.code === "full") showRoomFull(); else showError(error.message); }
   */
  interface SdkError extends Error {
    code: ErrorCode;
  }

  /** What {@link invite} did: "opened" Zaisma's Share on a Zaisma page; elsewhere "shared" from the share sheet, "copied" the link, "cancelled" the share sheet, or "failed" to do either. */
  type InviteStatus = "opened" | "shared" | "copied" | "cancelled" | "failed";

  /** What {@link filterText} found. */
  interface FilteredText {
    /** Whether it can be sent. */
    isAllowed: boolean;
    /**
     * Why not, null when it's allowed: "contact_details" (a link, handle, email, phone number or contact
     * app in any disguise, or moving to another app or meeting up), "personal_details" (where someone
     * lives, their school, their full name, photos), "slur", "sexual", "unchecked" (Zaisma couldn't
     * check it: try again in a moment) or "too_long" (over 2000 characters).
     */
    reason: "contact_details" | "personal_details" | "slur" | "sexual" | "unchecked" | "too_long" | null;
    /** The words to show the sender when it's stopped (never about age or the other player); null when it's allowed. */
    message: string | null;
    /** Whether it swears. Zaisma allows swearing; block it yourself if your game doesn't. */
    hasSwearing: boolean;
    /** The text tidied up: hidden characters and extra spaces gone, line breaks kept (empty when it's too_long). */
    text: string;
  }

  /** What happened, in a player report. Zaisma looks at real_life_threat (a threat that reaches past the game: their real details, finding them, a plan), personal_details (sharing someone's), following_after_block and sexual (behavior); harassment, cheating and other go to the game's developer. */
  type ReportReason = "real_life_threat" | "personal_details" | "following_after_block" | "sexual" | "harassment" | "cheating" | "other";

  /** Zaisma's answer to a report. */
  interface ReportAnswer {
    isReported: true;
  }

  /** The game's listed rooms ({@link Rooms.list}). */
  interface RoomList {
    /** Rooms with space first (the player's country, then region, then the busiest), then full and closed ones. Up to 50, in the region asked for. */
    rooms: ListedRoom[];
    /** Everyone playing in the game's rooms everywhere, hidden rooms too (for "playing now"), and how many listed rooms are closed. */
    playing: { playerCount: number; roomCount: number; closedRoomCount: number };
    /** Rooms a player could join right now, everywhere. */
    joinableRoomCount: number;
    /** Listed rooms taking players, full ones too, in the region and with the labels asked for: the ones listed plus the ones past them (moreOpenRoomCount). */
    openRoomCount: number;
    /** The regions with listed rooms, busiest first, for a region filter. */
    regions: { region: string; name: string; roomCount: number; playerCount: number }[];
    /** The region the rooms are filtered to, or null for everywhere. */
    region: string | null;
    /** Open rooms in that region past the ones listed. */
    moreOpenRoomCount: number;
    /** Labels worth filtering by: ones several rooms have, with a handful of values. */
    filters: { label: string; values: string[] }[];
  }

  /** A room in a room list. Never who's in it. */
  interface ListedRoom {
    roomCode: string;
    /** Players in the match, not counting players who walked away. */
    playerCount: number;
    /** Seats held for players coming back or on their way: a room has space while playerCount + heldSeatCount < maximumPlayerCount. */
    heldSeatCount: number;
    maximumPlayerCount: number;
    /** Spectators watching the room. */
    spectatorCount: number;
    /** Spectators the room takes (its game server's maximumSpectatorCount): 0 when nobody can watch. Room to watch while spectatorCount < maximumSpectatorCount, full or closed rooms too. */
    maximumSpectatorCount: number;
    /** false: closed, so only players who were in it can come back. */
    isOpen: boolean;
    /**
     * Where the room runs: the country its first player connected from, and its region (a continent),
     * like { countryCode: "DE", countryName: "Germany", region: "EU" }; null when unknown.
     */
    location: { countryCode: string; countryName: string; region: string | null } | null;
    /** In the same region as the player asking. */
    isNear: boolean;
    /** The room's name, or null. */
    name: string | null;
    /** The room's labels. */
    labels: Record<string, string>;
    /** Kept by the game server (room.setKept): a world that stays listed with nobody in it, like a server waiting for players. */
    isKept: boolean;
    /** The room's link on Zaisma, to join it or pass it on. */
    inviteUrl: string;
  }
}

interface Window {
  /** The Zaisma SDK: see the Zaisma namespace. */
  Zaisma: typeof Zaisma;
}
