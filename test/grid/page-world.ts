import { env } from "cloudflare:test";
import { accountById, acceptFriendInvite, addTesterLink, blockPlayer, bumpSave, canonicalSave, createApiKey, createFriendInvite, createGame, newId, sendFriendRequest, saveCopyKey, saveFromParts, saveHash, saveKey, sha256Hex } from "@zaisma/core";
import { previewLinkToken } from "../../apps/site/src/preview-links.ts";
import { png } from "../site/access-world.ts";
import type { PageWorld } from "./samples.ts";
import { makeWorld, sessionIdOf } from "./site-world.ts";

/** test/site/access-world.ts's world, with the things only a page names: a live game, the owner's key, friends, a block and a recent proof. */
export async function makePageWorld(routeName = ""): Promise<PageWorld> {
  const world = await makeWorld(routeName);
  const { n, victimAccountId, victimOwnerId } = world;
  const nowMs = Date.now();
  const { key } = await createApiKey(env.DB, victimAccountId, "Owner's key");
  const ownerUsername = `Victim_${n}`;
  const privateTitle = `Private Title ${n}`;
  const privateDescription = `Private description ${n}`;
  await env.DB.prepare("UPDATE games SET title = ?, description = ? WHERE slug = ?").bind(privateTitle, privateDescription, world.values.slug!).run();

  // A live game of the owner's, with a passed version, a link, and the owner's own save and an earlier copy.
  const live = await createGame(env.DB, { slug: `live-${n}`, title: `Live ${n}`, description: "", ownerId: victimOwnerId, visibility: "listed" });
  const liveVersionId = newId("version");
  const liveBytes = new TextEncoder().encode(`<!doctype html><p>live ${n}</p>`);
  const liveHash = await sha256Hex(liveBytes);
  const linkName = "site";
  await env.DB.batch([
    env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, published_at_ms, created_at_ms) VALUES (?, ?, ?, 1, ?, 'approved', ?, ?)").bind(liveVersionId, live.id, `manifests/${liveVersionId}`, liveBytes.byteLength, nowMs, nowMs),
    env.DB.prepare("UPDATE games SET review_status = 'live', live_version_id = ?, cloud_saves_enabled = 1, refund_policy = 'unused_within_14_days', links = ? WHERE id = ?").bind(liveVersionId, JSON.stringify([{ link_name: linkName, destination_url: "https://example.test/", is_on_game_page: true }]), live.id),
    env.DB.prepare("INSERT INTO game_items (game_id, item_name, title, item_kind, item_category, price_minor_units, currency_code, created_at_ms, updated_at_ms) VALUES (?, 'revive', 'Revive', 'consumable', 'gameplay', 199, 'usd', ?, ?)").bind(live.id, nowMs, nowMs),
  ]);
  await env.GAMES.put(`manifests/${liveVersionId}`, JSON.stringify({ files: { "index.html": { sha256: liveHash } } }));
  const saveText = canonicalSave(saveFromParts({ coins: `private-coins-${n}` }, []));
  await bumpSave(env.DB, { accountId: victimAccountId, gameId: live.id, baseVersionNumber: 0, sha256: await saveHash(saveText), sizeBytes: saveText.length, changedByKind: "player", versionId: null });
  await env.SAVES.put(saveKey(victimAccountId, live.id, 1, await saveHash(saveText)), saveText);
  const liveSaveCopyId = newId("save_copy");
  const copyText = canonicalSave(saveFromParts({ coins: `private-earlier-coins-${n}` }, []));
  await env.DB.prepare("INSERT INTO save_history (id, account_id, game_id, saved_at_ms, copy_reason, sha256, size_bytes) VALUES (?, ?, ?, ?, 'hourly', ?, ?)").bind(liveSaveCopyId, victimAccountId, live.id, nowMs - 60_000, await saveHash(copyText), copyText.length).run();
  await env.SAVES.put(saveCopyKey(victimAccountId, live.id, liveSaveCopyId), copyText);

  // A friend, a block, the owner's invite and a stranger's, a sign-in app the owner said yes to, and a recent proof with the passkey.
  const helperAccountId = `helper-${n}`;
  const helper = (await accountById(env.DB, helperAccountId))!;
  const playerOwnAccount = (await accountById(env.DB, `player-${n}`))!;
  const helpersInvite = await createFriendInvite(env.DB, helperAccountId, nowMs);
  if ("invite" in helpersInvite) await acceptFriendInvite(env.DB, victimAccountId, helpersInvite.invite.invite_code, nowMs);
  const blocked = await accountById(env.DB, world.strangerAccountId);
  await blockPlayer(env.DB, victimAccountId, blocked!.player_id, nowMs);
  const ownersInvite = await createFriendInvite(env.DB, victimAccountId, nowMs);
  const strangersInvite = await createFriendInvite(env.DB, playerOwnAccount.id, nowMs);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sign_in_grants (account_id, sign_in_app_id, created_at_ms, last_used_at_ms) VALUES (?, ?, ?, ?)").bind(victimAccountId, world.values.sign_in_app_id!, nowMs, nowMs),
    env.DB.prepare("INSERT INTO session_proofs (session_id, account_id, proof_kind, passkey_id, proved_at_ms) VALUES (?, ?, 'passkey', ?, ?)").bind(sessionIdOf(victimAccountId), victimAccountId, `passkey-${n}`, nowMs),
  ]);

  const owner = (await accountById(env.DB, victimAccountId))!;
  await sendFriendRequest(env.DB, playerOwnAccount, owner.player_id, null, nowMs);

  const tester = await addTesterLink(env.DB, env, live.id, "Testers");
  const version = await env.DB.prepare("SELECT id, scan_status, preview_link_key FROM versions WHERE id = ?").bind(world.values.version_id!).first<{ id: string; scan_status: string; preview_link_key: string }>();
  return {
    ...world,
    liveSlug: live.slug,
    liveSaveCopyId,
    liveSaveVersionNumber: 1,
    liveSaveTag: (await saveHash(`${victimAccountId}:${live.id}`)).slice(0, 16),
    requesterPlayerId: playerOwnAccount.player_id,
    newSaveJson: canonicalSave(saveFromParts({ coins: "9" }, [])),
    liveLinkName: linkName,
    coverFile: new File([png(1280, 720)], "cover.png", { type: "image/png" }),
    shaderFile: new File(["void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(1.0); }"], "background.glsl", { type: "text/plain" }),
    strangersInviteCode: "invite" in strangersInvite ? strangersInvite.invite.invite_code : "",
    helperPlayerId: helper.player_id,
    helperUsername: helper.username!,
    privateCanaries: [privateTitle, privateDescription, `private-coins-${n}`, `private-earlier-coins-${n}`],
    pagePathValues: {
      ...world.values,
      key_id: key.id,
      passkey_id: `passkey-${n}`,
      at_username: `@${ownerUsername}`,
      invite_code: "invite" in ownersInvite ? ownersInvite.invite.invite_code : "",
      blocked_player_id: blocked!.player_id,
      tester_token: tester.token,
      preview_token: previewLinkToken(env, version as never, nowMs)!.token,
    },
  };
}
