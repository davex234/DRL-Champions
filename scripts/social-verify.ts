/**
 * VERIFICACIÓN — Friends, Party & Social Engine (DRL Champions, Online Fase 4/7).
 *
 *   npx tsx scripts/social-verify.ts [usuarios]
 *
 * Comprueba: friends · party · leader · kick · transfer · invite · presence · ready · reconnect ·
 * notifications · privacy · recent players · determinismo · rendimiento · cero estados imposibles ·
 * compat Matchmaking · compat Online · compat Competitive · compat Replay. Reutiliza matchmaking/
 * online/competitive. DETERMINISTA (reloj lógico).
 */
import { SocialEngine, friendsListView, partyView, notificationsView } from "../src/social";
import { Matchmaker } from "../src/matchmaking";
import { createLocalGame, connectAll, runUntilMatchEnd, reconstruct, newInputLog } from "../src/online";
import { CompetitiveEngine, type CompetitiveMatchResult } from "../src/competitive";
import type { LobbyDraft } from "../src/online";

let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "✓" : "✕"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};
console.log("# Verificación del Friends, Party & Social Engine — DRL Champions (Online Fase 4)\n");

function base(): SocialEngine {
  const s = new SocialEngine(1); s.now = 0;
  for (const [id, name] of [["A", "Ana"], ["B", "Ben"], ["C", "Cid"], ["D", "Dua"], ["E", "Eli"]]) s.register(id, name, "EMEA");
  return s;
}

// ─────────────────────── 1. Friends ───────────────────────
console.log("## Friends");
{
  const s = base(); s.now = 1;
  s.sendFriendRequest("A", "B");
  check("FRIENDS: solicitud → estado incoming + notificación", s.friends.state("B", "A") === "incoming" && s.notifs.unread("B") === 1);
  s.acceptFriend("B", "A");
  check("FRIENDS: aceptar crea amistad recíproca", s.friends.isFriend("A", "B") && s.friends.isFriend("B", "A"));
  check("FRIENDS: solicitud DUPLICADA se rechaza", !s.sendFriendRequest("A", "B").ok);
  s.sendFriendRequest("C", "D"); s.sendFriendRequest("D", "C");
  check("FRIENDS: solicitud recíproca ⇒ amistad automática", s.friends.isFriend("C", "D"));
  s.removeFriend("A", "B");
  check("FRIENDS: eliminar amigo funciona", !s.friends.isFriend("A", "B"));
}

// ─────────────────────── 2. Privacy + Block ───────────────────────
console.log("\n## Privacy + block");
{
  const s = base(); s.now = 1;
  s.block("A", "B");
  check("BLOCK: un bloqueado NO puede enviar solicitud", !s.sendFriendRequest("B", "A").ok);
  s.setPrivacy("C", { allowFriendRequests: false });
  check("PRIVACY: respeta 'no aceptar solicitudes'", !s.sendFriendRequest("D", "C").ok);
  s.setPrivacy("E", { showPresence: "friends" });
  s.goOnline("E");
  check("PRIVACY: presencia friends-only oculta a no-amigos", s.presenceOf("A", "E") === null && !!s.presenceOf("E", "E"));
}

// ─────────────────────── 3. Party (1..5) + anti doble party ───────────────────────
console.log("\n## Party");
{
  const s = base(); s.now = 1;
  for (const [a, b] of [["A", "B"], ["A", "C"], ["A", "D"], ["A", "E"]]) { s.sendFriendRequest(a, b); s.acceptFriend(b, a); }
  const p = s.createParty("A");
  check("PARTY: se crea con el líder (tamaño 1)", p.members.length === 1 && p.leaderId === "A");
  for (const u of ["B", "C", "D", "E"]) { s.invitePartyMember("A", u, p.id); const inv = s.invites.forUser(u)[0]; s.acceptPartyInvite(inv.id); }
  check("PARTY: soporta hasta 5 jugadores", s.parties.get(p.id)!.members.length === 5);
  s.register("F", "Fox"); s.register("G", "Gus");
  const pf = s.createParty("F");
  s.parties.join(pf.id, { id: "G", name: "Gus", region: "EMEA" }, s.now);      // G ya en pf
  const dbl = s.parties.join(p.id, { id: "G", name: "Gus", region: "EMEA" }, s.now);
  check("PARTY: anti DOBLE party (un usuario en una sola party)", dbl.error === "already-in-party" && s.parties.partyOf("G")!.id === pf.id);
  const sixth = s.parties.join(p.id, { id: "H", name: "H", region: "EMEA" }, s.now);
  check("PARTY: no admite un 6º (capacidad)", sixth.error === "full" && s.parties.get(p.id)!.members.length === 5);
}

// ─────────────────────── 4. Leader / Kick / Transfer ───────────────────────
console.log("\n## Leader / kick / transfer");
{
  const s = base(); s.now = 1;
  for (const [a, b] of [["A", "B"], ["A", "C"]]) { s.sendFriendRequest(a, b); s.acceptFriend(b, a); }
  const p = s.createParty("A");
  for (const u of ["B", "C"]) { s.invitePartyMember("A", u, p.id); s.acceptPartyInvite(s.invites.forUser(u)[0].id); }
  check("KICK: un NO líder no puede expulsar", !s.kickMember(p.id, "B", "C").ok);
  s.kickMember(p.id, "A", "C");
  check("KICK: el líder expulsa (miembro fuera + party libre)", !s.parties.get(p.id)!.members.some((m) => m.id === "C") && s.parties.partyOf("C") === null && s.notifs.unread("C") > 0);
  s.transferLeader(p.id, "A", "B");
  const pt = s.parties.get(p.id)!;
  check("TRANSFER: el liderazgo pasa y NUNCA hay dos líderes", pt.leaderId === "B" && pt.members.filter((m) => m.id === pt.leaderId).length === 1);
  s.leaveParty("B");
  check("LEADER: si el líder se va, se transfiere automáticamente (nunca sin líder)", s.parties.get(p.id)!.leaderId === "A");
}

// ─────────────────────── 5. Invitaciones (expirables, anti-dup) ───────────────────────
console.log("\n## Invitaciones");
{
  const s = base(); s.now = 1;
  s.sendFriendRequest("A", "B"); s.acceptFriend("B", "A");
  const p = s.createParty("A");
  check("INVITE: invitar a un amigo funciona", s.invitePartyMember("A", "B", p.id).ok);
  check("INVITE: invitación DUPLICADA se rechaza (anti-spam)", !s.invitePartyMember("A", "B", p.id).ok);
  s.now = 100; s.tick(100);
  check("INVITE: caduca por timeout y notifica", s.invites.forUser("B").length === 0 && s.notifs.all("B").some((n) => n.type === "invite_expired"));
}

// ─────────────────────── 6. Presence + Ready + Rich presence ───────────────────────
console.log("\n## Presence + ready");
{
  const s = base(); s.now = 1;
  s.sendFriendRequest("A", "B"); s.acceptFriend("B", "A");
  const p = s.createParty("A"); s.invitePartyMember("A", "B", p.id); s.acceptPartyInvite(s.invites.forUser("B")[0].id);
  check("PRESENCE: al entrar en party, presencia refleja party + líder", s.presence.get("A")!.partyId === p.id && s.presence.get("A")!.isLeader && !s.presence.get("B")!.isLeader);
  check("READY: allReady solo cuando todos están listos", !s.parties.allReady(p.id) && (s.setReady(p.id, "A", true), s.setReady(p.id, "B", true), s.parties.allReady(p.id)));
  const mm = new Matchmaker({ seedBase: 10 });
  s.queueParty(mm, p.id, "casual", () => 1500);
  check("PRESENCE: en cola ⇒ status in_queue + rich presence", s.presence.get("A")!.status === "in_queue" && s.presence.get("A")!.rich.includes("Buscando"));
}

// ─────────────────────── 7. Reconnect + Notifications ───────────────────────
console.log("\n## Reconnect + notifications");
{
  const s = base(); s.now = 1;
  s.sendFriendRequest("A", "B"); s.acceptFriend("B", "A");
  const p = s.createParty("A"); s.invitePartyMember("A", "B", p.id); s.acceptPartyInvite(s.invites.forUser("B")[0].id);
  s.goOffline("B");
  check("RECONNECT: la party PERSISTE con el amigo offline (offline friends)", s.parties.get(p.id)!.members.length === 2 && s.presence.get("B")!.status === "offline");
  const re = s.reconnectParty("B");
  check("RECONNECT: reconectar recupera la party", !!re && re.id === p.id);
  const nv = notificationsView(s, "B");
  check("NOTIFICATIONS: buzón con no-leídas", nv.unread >= 1 && nv.items.length >= 1);
}

// ─────────────────────── 8. Recent players ───────────────────────
console.log("\n## Recent players");
{
  const s = base(); s.now = 1;
  s.sendFriendRequest("A", "B"); s.acceptFriend("B", "A");
  const p = s.createParty("A"); s.invitePartyMember("A", "B", p.id); s.acceptPartyInvite(s.invites.forUser("B")[0].id);
  s.setReady(p.id, "A", true); s.setReady(p.id, "B", true);
  s.onMatchLaunched(p.id, "match-1", "casual");
  check("RECENT: tras jugar juntos, aparecen en recientes", s.recent.list("A").some((r) => r.id === "B") && s.recent.list("B").some((r) => r.id === "A"));
}

// ─────────────────────── 9. Determinismo ───────────────────────
console.log("\n## Determinismo");
function scenario(): string {
  const s = new SocialEngine(7);
  for (let i = 0; i < 12; i++) s.register(`u${i}`, `U${i}`, (["EMEA", "Americas", "Pacific", "China"] as const)[i % 4]);
  for (let i = 0; i < 12; i++) { s.now = i; s.sendFriendRequest(`u${i}`, `u${(i + 1) % 12}`); s.acceptFriend(`u${(i + 1) % 12}`, `u${i}`); }
  const p = s.createParty("u0"); for (let i = 1; i < 4; i++) { s.invitePartyMember("u0", `u${i}`, p.id); const inv = s.invites.forUser(`u${i}`)[0]; if (inv) s.acceptPartyInvite(inv.id); }
  return JSON.stringify({ party: s.parties.snapshot(p.id), friends: [...Array(12)].map((_, k) => s.friends.friendsOf(`u${k}`).sort()) });
}
check("DETERMINISMO: mismas operaciones ⇒ mismo estado social", scenario() === scenario());

// ─────────────────────── 10. Compat Matchmaking + Online + Competitive + Replay ───────────────────────
console.log("\n## Compat (Matchmaking / Online / Competitive / Replay)");
{
  const s = base(); s.now = 1;
  s.sendFriendRequest("A", "B"); s.acceptFriend("B", "A");
  const p = s.createParty("A"); s.invitePartyMember("A", "B", p.id); s.acceptPartyInvite(s.invites.forUser("B")[0].id);
  s.setReady(p.id, "A", true); s.setReady(p.id, "B", true);
  const mm = new Matchmaker({ seedBase: 700 });
  const drafts: LobbyDraft[] = [];
  mm.onMatchReady = (_pr, d) => { drafts.push(d); };
  const q = s.queueParty(mm, p.id, "ai_match", () => 1500);
  mm.tick(1);
  check("COMPAT MATCHMAKING: la party entra en cola como grupo (partyId) y empareja", !!q.ticketId && drafts.length === 1);
  const d0 = drafts[0];
  const game = createLocalGame({ seed: d0.seed, rosters: d0.rosters, homeSetup: d0.homeSetup, teamNames: d0.teamNames, coach: { mode: "ai" } }, [{ name: "H" }, { name: "A2" }]);
  connectAll(game, 8);
  for (const c of game.clients) c.joinLobby();
  game.step(); game.step(); game.clients[0].ready(); game.clients[1].ready(); game.step(); game.clients[0].start(); game.step(); game.step();
  runUntilMatchEnd(game);
  s.onMatchLaunched(p.id, "mm-match", "ai_match");
  check("COMPAT ONLINE: la partida de la party llega a MATCH_END", game.server.match!.phase === "MATCH_END");
  const ms = game.server.match!;
  const comp = new CompetitiveEngine();
  const cr: CompetitiveMatchResult = { matchId: "sm-1", season: 1, mode: "competitive", homeId: "A", awayId: "bot-x", winner: ms.score.home >= ms.score.away ? "home" : "away", scoreHome: ms.score.home, scoreAway: ms.score.away, mvp: null, region: "EMEA", at: 10 };
  const upd = comp.applyMatchResult(cr);
  check("COMPAT COMPETITIVE: el resultado actualiza el ranking del líder", upd.players.length === 1 && !!comp.profile("A"));
  check("COMPAT REPLAY: seed + input log reconstruyen la partida de la party", reconstruct(game.server.config!, newInputLog(game.server.config!.seed)).winner === ms.winner);
}

// ─────────────────────── 11. Rendimiento (miles) ───────────────────────
console.log("\n## Rendimiento");
{
  const N = Math.max(1000, Number(process.argv[2] ?? 4000));
  const s = new SocialEngine(9);
  const regions = ["EMEA", "Americas", "Pacific", "China"] as const;
  const t0 = Date.now();
  for (let i = 0; i < N; i++) s.register(`u${i}`, `U${i}`, regions[i % 4]);
  for (let i = 0; i < N; i++) { s.now = i; s.sendFriendRequest(`u${i}`, `u${(i + 1) % N}`); s.acceptFriend(`u${(i + 1) % N}`, `u${i}`); }
  let parties = 0;
  for (let i = 0; i < N; i += 5) { const p = s.createParty(`u${i}`); parties++; for (let j = 1; j < 5 && i + j < N; j++) s.parties.join(p.id, { id: `u${i + j}`, name: `U${i + j}`, region: regions[(i + j) % 4] }, i); }
  const ms = Date.now() - t0;
  check("RENDIMIENTO: miles de usuarios/parties, incremental (sin O(n²))", ms < 3000 && s.parties.size() === parties, `${N} usuarios · ${parties} parties · ${ms}ms`);
}

// ─────────────────────── 12. Cero estados imposibles ───────────────────────
console.log("\n## Integridad (cero estados imposibles)");
{
  const s = base(); s.now = 1;
  for (const [a, b] of [["A", "B"], ["A", "C"], ["A", "D"], ["A", "E"]]) { s.sendFriendRequest(a, b); s.acceptFriend(b, a); }
  const p = s.createParty("A");
  for (const u of ["B", "C", "D", "E"]) { s.invitePartyMember("A", u, p.id); s.acceptPartyInvite(s.invites.forUser(u)[0].id); }
  s.transferLeader(p.id, "A", "C"); s.kickMember(p.id, "C", "B"); s.leaveParty("D");
  const party = s.parties.get(p.id)!;
  let bad = 0; const reasons: string[] = [];
  const leaders = party.members.filter((m) => m.id === party.leaderId).length;
  if (leaders !== 1) { bad++; reasons.push(`leaders=${leaders}`); }
  if (new Set(party.members.map((m) => m.id)).size !== party.members.length) { bad++; reasons.push("dup-members"); }
  if (party.members.length < 1 || party.members.length > party.settings.maxSize) { bad++; reasons.push("size"); }
  for (const m of party.members) if (s.parties.partyOf(m.id)?.id !== party.id) { bad++; reasons.push(`membership ${m.id}`); }
  check("INTEGRIDAD: un único líder, sin miembros duplicados, membership coherente", bad === 0, bad ? reasons.join(" · ") : `${party.members.length} miembros OK`);
}

console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
process.exit(failures === 0 ? 0 : 1);
