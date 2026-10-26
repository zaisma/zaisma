// The test bench's page (local-play.js serves it): the game in a frame, shown the way zaisma.com's game page shows
// it, and one thin bar. The page is one piece of HTML with its CSS and script inline, in Glass's tokens, and
// depends on nothing: it is not a zaisma.com page, so the site's gallery and layout check don't cover it.
// It answers the frame's zaisma: messages the way the game page does, for the players the bar makes up.

/** The frame's sandbox and permissions, exactly the game page's (apps/site/src/pages.ts; test/node/local-play-parity.test.ts holds the two together). */
export const FRAME_SANDBOX = "allow-scripts allow-same-origin allow-pointer-lock";
export const FRAME_ALLOW = "fullscreen; gamepad; autoplay; web-share; clipboard-write; cross-origin-isolated";

/** What the frame's messages that the bench has no stand-in for do on Zaisma, said once each in the bar's log. */
export const ONLY_ON_ZAISMA = {
  "zaisma:link": "opens the game's registered links (Zaisma.links.open)",
  "zaisma:picture": "hands the game's picture to a player's report",
  "zaisma:version": "tells the page which version runs, so it can offer an update",
  "zaisma:version-ready": "answers whether the game takes a newer version by itself",
  "zaisma:version-update": "shows that a newer version is coming",
  "zaisma:reload": "reloads the game at a newer version",
  "zaisma:connection": "shows a weak connection beside the game",
  "zaisma:account-offer": "shows the Keep your progress card to a guest",
  "zaisma:report": "opens Zaisma's report sheet for a player, which goes to Zaisma's moderators (Room.report's own reports are printed in the terminal here)",
  "zaisma:performance": "sends how the game runs (load time, frame rate, crashes) to the developer's stats",
  "zaisma:alive": "tells the page the game is still running, for its performance stats",
  "zaisma:still-there": "shows the Still there? card beside the game (the game draws its own here)",
};

const STYLE = `
:root { color-scheme: light dark; --page: #E7E4DF; --ink: #14171C; --ink-2: #3D444E; --muted: #59606A; --line: rgba(20,23,28,.14); --glass: rgba(255,255,255,.62); --field: rgba(255,255,255,.62); --press-rim: rgba(20,23,28,.5); --warning: #7D5C00; --run: #F7931A; --on-run: #14171C; --display: Jost, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
@media (prefers-color-scheme: dark) { :root { --page: #121110; --ink: #F7F9FC; --ink-2: rgba(255,255,255,.86); --muted: rgba(255,255,255,.7); --line: rgba(255,255,255,.2); --glass: rgba(14,17,24,.72); --field: rgba(255,255,255,.08); --press-rim: rgba(255,255,255,.45); --warning: #F2C94C; } }
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body { background: var(--page); color: var(--ink); font: 15px/1.45 var(--display); display: flex; flex-direction: column; }
.bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 12px; background: var(--glass); backdrop-filter: blur(18px) saturate(1.2); -webkit-backdrop-filter: blur(18px) saturate(1.2); border-bottom: 1px solid var(--line); }
.bar .tool { font-weight: 600; margin-right: 4px; }
.bar .note { color: var(--muted); }
.control { min-height: 36px; padding: 0 12px; border-radius: 4px 12px 4px 12px; border: 1px solid var(--press-rim); background: var(--field); color: var(--ink); font: inherit; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; text-decoration: none; transition: transform .12s ease; }
.control:hover { transform: translateY(-1px); }
.control:active { transform: translateY(1px); }
.control:focus-visible { outline: 2px solid var(--run); outline-offset: 2px; }
select.control { padding-right: 8px; }
.grow { flex: 1 1 0; }
main { flex: 1 1 0; min-height: 0; position: relative; }
iframe { border: 0; width: 100%; height: 100%; display: block; background: #000; }
dialog { max-width: min(560px, calc(100vw - 32px)); width: 100%; border: 1px solid var(--line); border-radius: 4px 20px 4px 20px; background: var(--glass); color: var(--ink); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px); padding: 16px 20px 20px; max-height: calc(100dvh - 32px); overflow: auto; }
dialog::backdrop { background: rgba(0,0,0,.35); }
dialog h2 { font-size: 18px; margin: 0 0 8px; }
dialog h3 { font-size: 15px; margin: 16px 0 4px; }
dialog p { margin: 4px 0; text-wrap: pretty; }
dialog .note, .muted { color: var(--muted); }
.row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 6px 0; }
.row label { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; }
.row input[type=text], .row input[type=number], .row select { min-height: 36px; border-radius: 4px; border: 1px solid var(--press-rim); background: var(--field); color: inherit; font: inherit; padding: 0 8px; }
.row input[type=checkbox] { width: 18px; height: 18px; }
.pair { border-top: 1px solid var(--line); padding: 6px 0; }
.log { margin: 0; padding-left: 18px; }
.log li { margin: 2px 0; }
.qr { width: 180px; height: 180px; background: #fff; border-radius: 4px; }
.warn { color: var(--warning); }
`;

/** The page's script, run in the browser. It is written as a function so it stays real code; the page embeds its text. */
function benchScript(config) {
  const query = new URLSearchParams(location.search);
  const frame = document.getElementById("game");
  const gameOrigin = `http://${location.hostname}:${config.gamePort}`;
  let playerNumber = Number(query.get("player")) || 0;
  let state = null;
  let roomCode = null;
  let roomPlayers = [];
  const logLines = [];
  const reported = new Set();
  const dialogs = {};

  const byId = (id) => document.getElementById(id);
  const post = (message) => frame.contentWindow && frame.contentWindow.postMessage(message, gameOrigin);
  const call = async (path, options) => {
    const response = await fetch(path, options);
    return response.json();
  };
  const change = async (body) => {
    const answer = await call("/bench/state", { method: "POST", body: JSON.stringify(body) });
    if (!answer.error) state = answer;
    return answer;
  };
  const accountOfTab = () => (state && state.tabs[playerNumber] && state.tabs[playerNumber] !== "guest" ? state.accounts.find((account) => account.id === state.tabs[playerNumber]) : null);
  // Session blocks, per tab as the game page keeps them: a guest's, or of a guest, for as long as the tab is open.
  const sessionKey = () => `zaisma-bench:blocked:${playerNumber}`;
  const sessionBlocks = () => {
    try { return new Set(JSON.parse(sessionStorage.getItem(sessionKey()) || "[]")); } catch { return new Set(); }
  };
  const keepSessionBlocks = (blocked) => {
    try { sessionStorage.setItem(sessionKey(), JSON.stringify([...blocked])); } catch { /* fine: kept for this page only */ }
  };
  const accountOfPlayer = (playerId) => (state ? state.accounts.find((account) => account.playerId === playerId) : null);
  const log = (text, isOnlyOnZaisma) => {
    logLines.push(text);
    byId("log-count").textContent = String(logLines.length);
    if (isOnlyOnZaisma) call("/bench/report", { method: "POST", body: JSON.stringify({ kind: "only-on-zaisma", text: text.replace(/^Only on Zaisma: /, "") }) }).catch(() => {});
  };
  const onlyOnZaisma = (type, what) => {
    if (reported.has(type)) return;
    reported.add(type);
    log(`Only on Zaisma: ${what}`, true);
  };

  // --- The frame: the game as Zaisma's page frames it, through the restore page for an account so its save is put back first ---
  function frameQuery() {
    const kept = new URLSearchParams(location.search);
    kept.delete("player");
    const text = kept.toString();
    return text ? `?${text}` : "";
  }
  function loadFrame() {
    const account = accountOfTab();
    // Through the bench's page on the game's site, which drops a pass kept for someone else (local-play.js, BENCH_PAGE).
    frame.src = `${gameOrigin}/_zaisma/bench?playing=${account ? account.id : "guest"}&then=${account ? "restore" : "game"}#${encodeURIComponent(frameQuery())}`;
  }

  // --- The bar ---
  function renderBar() {
    if (!state) return;
    const account = accountOfTab();
    const who = byId("who");
    who.innerHTML = "";
    const guest = document.createElement("option");
    guest.value = "guest";
    guest.textContent = "Guest";
    who.append(guest);
    for (const each of state.accounts) {
      const option = document.createElement("option");
      option.value = each.id;
      option.textContent = each.username;
      who.append(option);
    }
    who.value = account ? account.id : "guest";
    byId("add").href = `${location.pathname}?player=${state.nextPlayerNumber}${roomCode ? `&room=${roomCode}` : ""}`;
    byId("room").textContent = roomCode ? `Room ${roomCode}` : "Not in a room";
    byId("room").disabled = !roomCode;
    document.title = `Player ${playerNumber}${account ? `, ${account.username}` : ", guest"}: test bench for ${config.gameSlug}`;
    byId("tab-name").textContent = `Player ${playerNumber}`;
  }

  // --- Panels ---
  /** A panel over the game, by name: built afresh each time it opens. isClosable false leaves out Close, for one with its own way out. */
  function dialog(name, title, build, isClosable = true) {
    if (!dialogs[name]) {
      const element = document.createElement("dialog");
      element.id = `panel-${name}`;
      document.body.append(element);
      element.addEventListener("click", (event) => { if (event.target === element) element.close(); });
      dialogs[name] = element;
    }
    const element = dialogs[name];
    element.innerHTML = "";
    const heading = document.createElement("h2");
    heading.textContent = title;
    element.append(heading);
    build(element);
    if (!isClosable) {
      if (!element.open) element.showModal();
      return element;
    }
    const close = document.createElement("div");
    close.className = "row";
    close.innerHTML = '<button class="control" type="button">Close</button>';
    close.firstChild.onclick = () => element.close();
    element.append(close);
    if (!element.open) element.showModal();
    return element;
  }
  const priceShown = (listedItem) => {
    try {
      const format = new Intl.NumberFormat(undefined, { style: "currency", currency: listedItem.currencyCode.toUpperCase() });
      return format.format(listedItem.priceMinorUnits / 10 ** format.resolvedOptions().maximumFractionDigits);
    } catch {
      return `${listedItem.priceMinorUnits} ${listedItem.currencyCode}`;
    }
  };
  const make = (tag, attributes, text) => {
    const made = document.createElement(tag);
    Object.assign(made, attributes || {});
    if (text) made.textContent = text;
    return made;
  };
  const checkbox = (label, isChecked, onChange) => {
    const wrapper = make("label");
    const input = make("input", { type: "checkbox", checked: isChecked });
    input.onchange = () => onChange(input.checked);
    wrapper.append(input, document.createTextNode(label));
    return wrapper;
  };

  function openPlayers() {
    dialog("players", "Friends and blocks", (box) => {
      box.append(make("p", { className: "note" }, "Between the bench's made-up accounts. A game sees only what Zaisma gives it: each account's pass lists its friends and blocks by player tags, never by name."));
      const account = accountOfTab();
      if (account) {
        const row = make("div", { className: "row" });
        const select = make("select");
        for (const choice of ["nobody", "friends", "anyone"]) select.append(make("option", { value: choice, selected: account.whoCanChat === choice }, choice));
        select.onchange = async () => { await change({ op: "set-chat", account: account.id, whoCanChat: select.value }); };
        row.append(make("span", {}, `${account.username} lets chat with:`), select);
        box.append(row);
      }
      const accounts = state.accounts;
      for (let firstIndex = 0; firstIndex < accounts.length; firstIndex++) {
        for (let secondIndex = firstIndex + 1; secondIndex < accounts.length; secondIndex++) {
          const first = accounts[firstIndex];
          const second = accounts[secondIndex];
          const isFriend = state.friends.some((pair) => pair.includes(first.id) && pair.includes(second.id));
          const blocks = (blocker, blocked) => state.blocks.some((block) => block.blocker === blocker.id && block.blocked === blocked.id);
          const pair = make("div", { className: "pair" });
          pair.append(make("div", {}, `${first.username} and ${second.username}`));
          const row = make("div", { className: "row" });
          row.append(
            checkbox("Friends", isFriend, async (isChecked) => { await change({ op: "set-friend", first: first.id, second: second.id, isFriend: isChecked }); }),
            checkbox(`${first.username} blocks ${second.username}`, blocks(first, second), async (isChecked) => { await change({ op: "set-block", blocker: first.id, blocked: second.id, isBlocked: isChecked }); }),
            checkbox(`${second.username} blocks ${first.username}`, blocks(second, first), async (isChecked) => { await change({ op: "set-block", blocker: second.id, blocked: first.id, isBlocked: isChecked }); }),
          );
          pair.append(row);
          box.append(pair);
        }
      }
      box.append(make("p", { className: "note" }, "A pass is made when a player joins. Reload a player's game (or leave and join the room again) to bring a change into its pass."));
    });
  }

  function openItems() {
    dialog("items", "Items", (box) => {
      box.append(make("p", { className: "note" }, state.purchaseDelivery === "game_server" ? "Purchases go to your game server's onPurchase." : "Purchases come to the game's Zaisma.items events."));
      if (!state.items.length) box.append(make("p", {}, "No items yet. Add one below; a game lists them with Zaisma.items.list() and opens a buy with Zaisma.items.buy()."));
      for (const listedItem of state.items) {
        const row = make("div", { className: "pair" });
        row.append(make("div", {}, `${listedItem.title} (${listedItem.itemName}), ${listedItem.itemKind}, ${priceShown(listedItem)}`));
        const owners = make("div", { className: "row" });
        for (const account of state.accounts) owners.append(checkbox(`${account.username} owns it`, (state.ownedItems[account.id] || []).includes(listedItem.itemName), async (isChecked) => { await change({ op: "set-owned", account: account.id, itemName: listedItem.itemName, isOwned: isChecked }); }));
        const remove = make("button", { className: "control", type: "button" }, "Remove");
        remove.onclick = async () => { await change({ op: "remove-item", itemName: listedItem.itemName }); openItems(); };
        owners.append(remove);
        row.append(owners);
        box.append(row);
      }
      box.append(make("h3", {}, "Add an item"));
      const form = make("div", { className: "row" });
      const name = make("input", { type: "text", placeholder: "item_name", size: 12 });
      const title = make("input", { type: "text", placeholder: "Title", size: 14 });
      const price = make("input", { type: "number", placeholder: "Price in cents", min: 0, value: 199 });
      const kind = make("select");
      for (const choice of ["permanent", "consumable"]) kind.append(make("option", { value: choice }, choice));
      const add = make("button", { className: "control", type: "button" }, "Add");
      add.onclick = async () => {
        const answer = await change({ op: "set-item", item: { itemName: name.value.trim(), title: title.value.trim(), priceMinorUnits: Number(price.value), itemKind: kind.value, currencyCode: "usd" } });
        if (answer.error) log(`${answer.error.message} ${answer.error.fix}`);
        openItems();
      };
      form.append(name, title, price, kind, add);
      box.append(form);
    });
  }

  function openRoom() {
    dialog("room", roomCode ? `Room ${roomCode}` : "Not in a room", (box) => {
      if (!roomCode) return box.append(make("p", {}, "Join or make a room in the game, and its code and link show here."));
      const link = `${location.origin}/g/${config.gameSlug}?room=${roomCode}`;
      box.append(make("p", {}, "Anyone on this computer can join by opening this link, as the next player:"));
      const row = make("div", { className: "row" });
      const field = make("input", { type: "text", value: link, readOnly: true, size: 40 });
      const copy = make("button", { className: "control", type: "button" }, "Copy");
      copy.onclick = () => navigator.clipboard.writeText(link).then(() => { copy.textContent = "Copied"; }, () => { field.select(); });
      row.append(field, copy);
      box.append(row);
      box.append(make("h3", {}, "Players in the room"));
      box.append(make("p", {}, roomPlayers.length ? roomPlayers.map((each) => each.name).join(", ") : "Only you so far."));
    });
  }

  function openPhone() {
    dialog("phone", "Open it on a phone", (box) => {
      if (!state.isOnNetwork || !state.addresses.length) {
        box.append(make("p", {}, "The bench answers only on this computer. To play with a phone on the same Wi-Fi, stop it and start it again with --on-network."));
        return;
      }
      const address = `http://${state.addresses[0]}:${config.benchPort}/g/${config.gameSlug}`;
      box.append(make("p", {}, `Open ${address} on a phone on the same Wi-Fi, or scan this code.`));
      box.append(make("img", { className: "qr", alt: "A QR code for the bench's address", src: `/bench/qr.svg?text=${encodeURIComponent(address)}` }));
      box.append(make("p", { className: "note warn" }, "Over the home network the bench is plain http, so the camera, microphone and other features a browser allows only on secure pages won't work on the phone."));
    });
  }

  function openLog() {
    dialog("log", "Log", (box) => {
      if (!logLines.length) return box.append(make("p", {}, "Nothing yet. Things Zaisma does that the bench doesn't show up here, once each."));
      const list = make("ul", { className: "log" });
      for (const line of logLines) list.append(make("li", {}, line));
      box.append(list);
    });
  }

  // --- The test sheet: what the buy sheet is on Zaisma, granting at no cost ---
  async function openTestSheet(asked) {
    const listedItem = state.items.find((each) => each.itemName === asked.itemName);
    if (!listedItem) {
      post({ type: "zaisma:buy", requestNumber: asked.requestNumber, status: "error", code: "no_item", message: `The bench has no item named ${asked.itemName}.`, fix: "Add it in the bench's bar, under Items." });
      return;
    }
    post({ type: "zaisma:buy", requestNumber: asked.requestNumber, status: "open" });
    let isDone = false;
    const finish = (message) => {
      if (isDone) return;
      isDone = true;
      post(Object.assign({ type: "zaisma:buy", requestNumber: asked.requestNumber }, message));
      sheet.close();
    };
    const account = accountOfTab();
    const sheet = dialog("buy", "Test purchase", (box) => {
      box.append(make("p", {}, `${listedItem.title}${asked.itemCount > 1 ? ` × ${asked.itemCount}` : ""}`));
      if (listedItem.description) box.append(make("p", { className: "note" }, listedItem.description));
      box.append(make("p", {}, `Zaisma would charge ${priceShown(listedItem)}. Here nothing is charged: Grant gives ${account ? account.username : "the player"} the item and a receipt your game server can check.`));
      const row = make("div", { className: "row" });
      if (account) {
        const grant = make("button", { className: "control", type: "button" }, "Grant");
        grant.onclick = async () => {
          const answer = await call("/bench/buy", { method: "POST", body: JSON.stringify({ playerNumber, itemName: asked.itemName, itemCount: asked.itemCount, gameAccountId: asked.gameAccountId }) });
          if (answer.error) return finish({ status: "failed", purchase: null });
          const given = answer.purchase;
          const purchase = { id: given.id, item_name: given.itemName, item_kind: given.itemKind, item_count: given.itemCount, purchase_source: given.purchaseSource, purchase_status: given.purchaseStatus, game_account_id: given.gameAccountId, paid_minor_units: given.paidMinorUnits, currency_code: given.currencyCode, purchased_at: given.purchasedAt, refunded_at: given.refundedAt, receipt: given.receipt };
          state = await call("/bench/state");
          finish({ status: "bought", purchase });
        };
        row.append(grant);
      } else box.append(make("p", { className: "warn" }, "This tab is a guest, and buying is for accounts. Switch the tab to an account in the player menu, then buy again."));
      const cancel = make("button", { className: "control", type: "button" }, "Cancel");
      cancel.onclick = () => finish({ status: "cancelled", purchase: null });
      row.append(cancel);
      box.append(row);
    }, false);
    sheet.addEventListener("close", () => finish({ status: "cancelled", purchase: null }), { once: true });
  }

  // --- What the frame says ---
  async function answerSaves(message) {
    const account = accountOfTab();
    if (!account) return;
    if (message.step === "hello" && message.phase === "restore") {
      const saved = (await call(`/bench/saves/${account.id}`)).saveText;
      post(saved ? { type: "zaisma:saves", step: "restore", action: "use-cloud", data: JSON.parse(saved) } : { type: "zaisma:saves", step: "restore", action: "keep" });
    } else if (message.step === "hello" && message.phase === "game") {
      post({ type: "zaisma:saves", step: "sync", text: (await call(`/bench/saves/${account.id}`)).saveText });
    } else if (message.step === "save" && typeof message.text === "string") {
      await call(`/bench/saves/${account.id}`, { method: "PUT", body: JSON.stringify({ saveText: message.text }) });
    }
  }
  function answerSavesRequest(message) {
    const reply = (body) => post(Object.assign({ type: "zaisma:saves-answer", requestNumber: message.requestNumber }, body));
    if (message.request === "listen") return;
    reply({ status: "asking" });
    onlyOnZaisma("saves-copies", "earlier versions of a player's save (Zaisma.saves.listCopies, getCopy, restoreCopy)");
    if (!accountOfTab()) return reply({ error: { code: "account_needed", message: "Earlier versions are kept for players signed in to Zaisma: a guest's progress stays in this browser. Ask the player to sign in first (Zaisma.player.signIn)." } });
    if (message.request === "list_copies") return reply({ answer: [] });
    reply({ error: { code: "no_save_copy", message: `The player has no earlier version ${message.saveCopyId} in this game: the bench keeps only the latest save.` } });
  }

  async function signIn() {
    post({ type: "zaisma:sign-in", status: "asking" });
    const inUse = new Set(Object.entries(state.tabs).filter(([tab]) => Number(tab) !== playerNumber && state.openPlayerNumbers.includes(Number(tab))).map(([, as]) => as));
    const account = state.accounts.find((each) => !inUse.has(each.id)) || state.accounts[0];
    await change({ op: "set-tab", playerNumber, as: account.id });
    renderBar();
    post({ type: "zaisma:signed-in", player: { id: account.playerId, name: account.username } });
  }

  async function onMessage(event) {
    if (event.origin !== gameOrigin || event.source !== frame.contentWindow || !event.data || typeof event.data.type !== "string") return;
    const message = event.data;
    if (!state) state = await call("/bench/state");
    switch (message.type) {
      case "zaisma:room":
        if (typeof message.code === "string" && /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(message.code)) {
          roomCode = message.code;
          const next = new URLSearchParams(location.search);
          next.set("player", String(playerNumber));
          next.set("room", roomCode);
          history.replaceState(null, "", `${location.pathname}?${next}`);
          renderBar();
        }
        return;
      case "zaisma:players":
        if (message.code === roomCode && Array.isArray(message.players)) roomPlayers = message.players;
        return;
      case "zaisma:left":
        if (message.code === roomCode) { roomCode = null; roomPlayers = []; renderBar(); }
        return;
      case "zaisma:room-key": {
        const given = await call(`/bench/key?player=${playerNumber}`);
        post({ type: "zaisma:room-key", key: given.key, playerKind: given.playerKind });
        return;
      }
      case "zaisma:saves": return answerSaves(message);
      case "zaisma:saves-request": return answerSavesRequest(message);
      case "zaisma:buy": return openTestSheet(message);
      case "zaisma:sign-in": return signIn();
      case "zaisma:share":
        openRoom();
        if (typeof message.requestNumber === "number") post({ type: "zaisma:share-answer", requestNumber: message.requestNumber, isOpened: true });
        return;
      case "zaisma:players-open": return openRoom();
      // As the game page's blocks (apps/site/src/blocks.ts): between two accounts the block lasts and reaches the next passes;
      // anyone else is blocked for this tab's session, at once. The game asks only which of the players it names this session blocked.
      case "zaisma:block": {
        if (!message.player || typeof message.player.id !== "string") return;
        const playerId = message.player.id;
        post({ type: "zaisma:block", status: "asking", playerId });
        const mine = accountOfTab();
        const other = accountOfPlayer(playerId);
        if (mine && other && message.playerKind === "account" && message.player.kind === "account") {
          await change({ op: "set-block", blocker: mine.id, blocked: other.id, isBlocked: true });
          return post({ type: "zaisma:block", status: "blocked", playerId, isLasting: true });
        }
        const blocked = sessionBlocks();
        blocked.add(playerId);
        keepSessionBlocks(blocked);
        return post({ type: "zaisma:block", status: "blocked", playerId, isLasting: false });
      }
      case "zaisma:unblock": {
        if (typeof message.playerId !== "string") return;
        const blocked = sessionBlocks();
        blocked.delete(message.playerId);
        keepSessionBlocks(blocked);
        return;
      }
      case "zaisma:blocks-among": {
        const blocked = sessionBlocks();
        const playerIds = Array.isArray(message.playerIds) ? message.playerIds.slice(0, 64).filter((playerId) => typeof playerId === "string" && blocked.has(playerId)) : [];
        if (playerIds.length) post({ type: "zaisma:blocks-among", playerIds });
        return;
      }
      default:
        if (ONLY_ON_ZAISMA[message.type] || message.type.startsWith("zaisma:")) {
          onlyOnZaisma(message.type, ONLY_ON_ZAISMA[message.type] || `answers ${message.type}, which the bench doesn't know`);
          if (message.type === "zaisma:link") post({ type: "zaisma:link", requestNumber: message.requestNumber, status: "error", code: "unknown_link", message: "The bench has no registered links: Zaisma.links.open works on Zaisma." });
          if (message.type === "zaisma:account-offer") post({ type: "zaisma:account-offer", status: "cloud_saves_not_here" });
        }
    }
  }

  async function start() {
    state = await call("/bench/state");
    // A tab with no player in its address takes the first number nobody holds, so a shared room link opens as someone new.
    if (!playerNumber) {
      playerNumber = state.nextPlayerNumber;
      query.set("player", String(playerNumber));
      history.replaceState(null, "", `${location.pathname}?${query}`);
    }
    const events = new EventSource(`/bench/events?player=${playerNumber}`);
    events.addEventListener("state", async () => { state = await call("/bench/state"); renderBar(); });
    events.addEventListener("reload", () => loadFrame());
    byId("who").onchange = async () => {
      await change({ op: "set-tab", playerNumber, as: byId("who").value });
      roomCode = null;
      roomPlayers = [];
      renderBar();
      loadFrame();
    };
    byId("friends").onclick = openPlayers;
    byId("items").onclick = openItems;
    byId("room").onclick = openRoom;
    byId("phone").onclick = openPhone;
    byId("log").onclick = openLog;
    addEventListener("message", onMessage);
    renderBar();
    loadFrame();
  }
  start();
}

/** The page, for a game on these ports. config: gameSlug, benchPort, gamePort, roomsPort, isOnNetwork. */
export function benchPage(config) {
  const shown = JSON.stringify(config).replace(/</g, "\\u003c");
  const only = JSON.stringify(ONLY_ON_ZAISMA).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Test bench for ${config.gameSlug.replace(/[^a-z0-9-]/g, "")}</title>
<style>${STYLE}</style>
</head>
<body>
<header class="bar" role="toolbar" aria-label="Test bench">
  <span class="tool">Test bench</span>
  <span class="note" id="tab-name"></span>
  <select class="control" id="who" aria-label="Playing as"></select>
  <a class="control" id="add" href="/" target="_blank" rel="noopener">Add a player</a>
  <button class="control" id="friends" type="button">Friends and blocks</button>
  <button class="control" id="items" type="button">Items</button>
  <button class="control" id="room" type="button" disabled>Not in a room</button>
  <span class="grow"></span>
  <button class="control" id="phone" type="button">Phone</button>
  <button class="control" id="log" type="button">Log <span id="log-count">0</span></button>
</header>
<main><iframe id="game" title="${config.gameSlug.replace(/[^a-z0-9-]/g, "")}" sandbox="${FRAME_SANDBOX}" allow="${FRAME_ALLOW}" allowfullscreen referrerpolicy="no-referrer"></iframe></main>
<script>
const ONLY_ON_ZAISMA = ${only};
(${benchScript.toString()})(${shown});
</script>
</body>
</html>
`;
}
