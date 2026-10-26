// The test bench page's own script (local-play.js serves it as /bench/bench.js). The page itself is Glass, drawn from the site's components
// (bench/glass.ts): the game page while playing, with the bench's buttons in its bar and the real buy sheet. This script answers the frame's
// zaisma: messages the way the game page does, for the players the bench makes up, and keeps the bench's sheets up to date.

/** The frame's sandbox and permissions, exactly the game page's (apps/site/src/pages.ts; test/node/local-play-parity.test.ts holds the two together). */
export const FRAME_SANDBOX = "allow-scripts allow-same-origin allow-pointer-lock";
export const FRAME_ALLOW = "fullscreen; gamepad; autoplay; web-share; clipboard-write; cross-origin-isolated";

/** What the frame's messages that the bench has no stand-in for do on Zaisma, said once each in the bench's log. */
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

/** The frame and the game's origin, as the game page's script names them for the buy sheet's script (/bench/frame.js). */
export const frameScriptSource = (gamePort) => `var frame = document.getElementById("game");\nvar gameOrigin = "http://" + location.hostname + ":${Number(gamePort)}";\n`;

/** The script, for a game on these ports. config: gameSlug, gamePort. */
export const benchScriptSource = (config) => `const ONLY_ON_ZAISMA = ${JSON.stringify(ONLY_ON_ZAISMA)};\n(${benchScript.toString()})(${JSON.stringify(config)});\n`;

/** The page's script, run in the browser. It is written as a function so it stays real code; the bench serves its text. */
function benchScript(config) {
  const frame = document.getElementById("game");
  const gameOrigin = `http://${location.hostname}:${config.gamePort}`;
  const query = new URLSearchParams(location.search);
  let playerNumber = Number(query.get("player")) || 0;
  let state = null;
  let roomCode = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(query.get("room") || "") ? query.get("room") : null;
  const reported = new Set();

  const byId = (id) => document.getElementById(id);
  const post = (message) => frame.contentWindow && frame.contentWindow.postMessage(message, gameOrigin);
  const call = async (path, options) => (await fetch(path, options)).json();
  const change = async (body) => {
    const answer = await call("/bench/state", { method: "POST", body: JSON.stringify(body) });
    if (!answer.error) state = answer;
    return answer;
  };
  const accountOfTab = () => (state && state.tabs[playerNumber] && state.tabs[playerNumber] !== "guest" ? state.accounts.find((account) => account.id === state.tabs[playerNumber]) : null);
  const accountOfPlayer = (playerId) => (state ? state.accounts.find((account) => account.playerId === playerId) : null);
  const onlyOnZaisma = (type, what) => {
    if (reported.has(type)) return;
    reported.add(type);
    call("/bench/report", { method: "POST", body: JSON.stringify({ kind: "only-on-zaisma", text: what }) }).catch(() => {});
  };
  // Session blocks, per tab as the game page keeps them: a guest's, or of a guest, for as long as the tab is open.
  const sessionKey = () => `zaisma-bench:blocked:${playerNumber}`;
  const sessionBlocks = () => {
    try { return new Set(JSON.parse(sessionStorage.getItem(sessionKey()) || "[]")); } catch { return new Set(); }
  };
  const keepSessionBlocks = (blocked) => {
    try { sessionStorage.setItem(sessionKey(), JSON.stringify([...blocked])); } catch { /* fine: kept for this page only */ }
  };

  // --- The frame: through the bench's page on the game's site, which drops a pass kept for someone else, and for an account through the
  // restore page that puts its save back (local-play.js, BENCH_PAGE) ---
  function frameQuery() {
    const kept = new URLSearchParams(location.search);
    kept.delete("player");
    const text = kept.toString();
    return text ? `?${text}` : "";
  }
  function loadFrame() {
    const account = accountOfTab();
    frame.src = `${gameOrigin}/_zaisma/bench?playing=${account ? account.id : "guest"}&then=${account ? "restore" : "game"}#${encodeURIComponent(frameQuery())}`;
  }
  function keepAddress() {
    const next = new URLSearchParams(location.search);
    next.set("player", String(playerNumber));
    if (roomCode) next.set("room", roomCode);
    else next.delete("room");
    history.replaceState(null, "", `${location.pathname}?${next}`);
  }

  // --- The bar and the sheets, drawn by the bench from Glass's components ---
  function renderBar() {
    if (!state) return;
    const account = accountOfTab();
    const who = byId("bench-who");
    const label = who && who.querySelector(".face > span:not([class])");
    if (label) label.textContent = account ? account.username : "Guest";
    const add = byId("bench-add");
    if (add) {
      add.href = `${location.pathname}?player=${state.nextPlayerNumber}${roomCode ? `&room=${roomCode}` : ""}`;
      add.target = "_blank";
    }
    document.title = `Player ${playerNumber}, ${account ? account.username : "guest"}: test bench for ${config.gameSlug}`;
  }
  async function refreshSheet(name) {
    const body = byId(`bench-${name}-body`);
    if (!body) return;
    const response = await fetch(`/bench/sheet/${name}?player=${playerNumber}${roomCode ? `&room=${roomCode}` : ""}`);
    if (response.ok) body.innerHTML = await response.text();
  }
  const openSheetNames = () => ["friends", "items", "room", "phone", "log"].filter((name) => { const sheet = byId(`bench-${name}`); return sheet && sheet.open; });
  // A sheet's button opens it (the components' own script); it's drawn afresh as it opens.
  document.addEventListener("click", (event) => {
    const opener = event.target.closest && event.target.closest("[aria-controls^='bench-']");
    if (opener) refreshSheet(opener.getAttribute("aria-controls").replace(/^bench-/, ""));
  }, true);
  // Changes in the sheets: friends, blocks, who can chat, owned items, and adding or removing items.
  document.addEventListener("change", async (event) => {
    const input = event.target;
    if (!input || !input.name || !input.name.startsWith("bench-")) return;
    const [first, second] = String(input.value).split(":");
    if (input.name === "bench-friend") await change({ op: "set-friend", first, second, isFriend: input.checked });
    else if (input.name === "bench-block") await change({ op: "set-block", blocker: first, blocked: second, isBlocked: input.checked });
    else if (input.name === "bench-owned") await change({ op: "set-owned", account: first, itemName: second, isOwned: input.checked });
    else if (input.name === "bench-chat") await change({ op: "set-chat", account: input.dataset.benchAccount, whoCanChat: input.value });
    else return;
    openSheetNames().forEach(refreshSheet);
  });
  document.addEventListener("click", async (event) => {
    const target = event.target.closest ? event.target : null;
    if (!target) return;
    const remove = target.closest("button[name=bench-remove-item]");
    if (remove) {
      await change({ op: "remove-item", itemName: remove.value });
      return refreshSheet("items");
    }
    if (target.closest("#bench-item-add")) {
      const nameField = byId("bench-item-name");
      const answer = await change({ op: "set-item", item: { itemName: nameField.value.trim(), title: byId("bench-item-title").value.trim(), priceMinorUnits: Number(byId("bench-item-price").value), itemKind: document.querySelector("input[name=item_kind]").value, currencyCode: "usd" } });
      if (answer.error) {
        nameField.setCustomValidity(answer.error.message);
        return nameField.reportValidity();
      }
      return refreshSheet("items");
    }
    // Who this tab plays as: the page opens again as them, in the same room.
    const as = target.closest("[data-bench-as]");
    if (as) {
      event.preventDefault();
      await change({ op: "set-tab", playerNumber, as: as.dataset.benchAs });
      keepAddress();
      return location.reload();
    }
    // The buy sheet's Sign in and Make an account, for a guest: here the tab plays as an account at once, and the sheet goes on.
    if (target.closest("#buy-guest-buttons a, [data-buy-sign-in]")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      await signIn(false);
    }
  }, true);

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
    onlyOnZaisma("saves-copies", "keeps earlier versions of a player's save (Zaisma.saves.listCopies, getCopy, restoreCopy)");
    if (!accountOfTab()) return reply({ error: { code: "account_needed", message: "Earlier versions are kept for players signed in to Zaisma: a guest's progress stays in this browser. Ask the player to sign in first (Zaisma.player.signIn)." } });
    if (message.request === "list_copies") return reply({ answer: [] });
    reply({ error: { code: "no_save_copy", message: `The player has no earlier version ${message.saveCopyId} in this game: the bench keeps only the latest save.` } });
  }

  // Signing in while the game runs: the tab plays as the first account no other open tab plays as, and the game hears who it is now.
  async function signIn(isAskedByGame) {
    if (isAskedByGame) post({ type: "zaisma:sign-in", status: "asking" });
    const inUse = new Set(Object.entries(state.tabs).filter(([tab]) => Number(tab) !== playerNumber && state.openPlayerNumbers.includes(Number(tab))).map(([, as]) => as));
    const account = state.accounts.find((each) => !inUse.has(each.id)) || state.accounts[0];
    await change({ op: "set-tab", playerNumber, as: account.id });
    renderBar();
    post({ type: "zaisma:signed-in", player: { id: account.playerId, name: account.username } });
    // The buy sheet goes on once the player is signed in, as on Zaisma (its script checks the cookie and listens on this channel).
    document.cookie = "zaisma_in=1; path=/; SameSite=Lax";
    try { new BroadcastChannel("zaisma").postMessage("signed-in"); } catch { /* fine: it checks again on focus */ }
  }

  async function onMessage(event) {
    if (event.origin !== gameOrigin || event.source !== frame.contentWindow || !event.data || typeof event.data.type !== "string") return;
    const message = event.data;
    if (!state) state = await call(`/bench/state?player=${playerNumber}`);
    switch (message.type) {
      case "zaisma:room":
        if (typeof message.code === "string" && /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(message.code)) {
          roomCode = message.code;
          keepAddress();
          renderBar();
        }
        return;
      case "zaisma:left":
        if (message.code === roomCode) {
          roomCode = null;
          keepAddress();
          renderBar();
        }
        return;
      case "zaisma:players":
        return;
      case "zaisma:room-key": {
        const given = await call(`/bench/key?player=${playerNumber}`);
        post({ type: "zaisma:room-key", key: given.key, playerKind: given.playerKind });
        return;
      }
      case "zaisma:saves": return answerSaves(message);
      case "zaisma:saves-request": return answerSavesRequest(message);
      // The real buy sheet, as on the game page; the bench stands in for its calls, with a test card.
      case "zaisma:buy":
        if (typeof message.requestNumber === "number" && typeof message.itemName === "string" && window.askBuy) window.askBuy(message);
        return;
      case "zaisma:sign-in": return signIn(true);
      case "zaisma:share":
      case "zaisma:players-open":
        byId("bench-room-open").click();
        if (message.type === "zaisma:share" && typeof message.requestNumber === "number") post({ type: "zaisma:share-answer", requestNumber: message.requestNumber, isOpened: true });
        return;
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
        onlyOnZaisma(message.type, ONLY_ON_ZAISMA[message.type] || `answers ${message.type}, which the bench doesn't know`);
        if (message.type === "zaisma:link") post({ type: "zaisma:link", requestNumber: message.requestNumber, status: "error", code: "unknown_link", message: "The bench has no registered links: Zaisma.links.open works on Zaisma." });
        if (message.type === "zaisma:account-offer") post({ type: "zaisma:account-offer", status: "cloud_saves_not_here" });
    }
  }

  async function start() {
    state = await call(`/bench/state${playerNumber ? `?player=${playerNumber}` : ""}`);
    // A tab with no player in its address takes the first number nobody holds, so a shared room link opens as someone new.
    if (!playerNumber) {
      playerNumber = state.nextPlayerNumber;
      keepAddress();
    }
    // About once a second: the bar's state, that this tab is open, and whether a game file changed (reloadNumber).
    let reloadNumber = state.reloadNumber;
    setInterval(async () => {
      const fresh = await call(`/bench/state?player=${playerNumber}`).catch(() => null);
      if (!fresh) return;
      state = fresh;
      renderBar();
      if (fresh.reloadNumber !== reloadNumber) {
        reloadNumber = fresh.reloadNumber;
        loadFrame();
      }
    }, 1000);
    addEventListener("message", onMessage);
    renderBar();
    loadFrame();
  }
  start();
}
