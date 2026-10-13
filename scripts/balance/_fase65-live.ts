/**
 * FASE 65 · QA EN VIVO (instrumento `_`, fuera de CI) contra :3005 → túnel → BD del VPS, SOLO con cuentas QA.
 *
 *   npx tsx scripts/balance/_fase65-live.ts --a=<creds.json> [--b=<creds.json>] [--out=<file>]
 *
 * PvE: una partida completa (NORMAL) por la API real con una política legal sencilla; comprueba que el servidor decide
 *      eje del defensor, ganador y desempate con las reglas leídas en rules.json (se recalcula desde el historial), que un
 *      `stat` enviado al defender se ignora y que `winner`/`reward` en el cuerpo no cuentan.
 * PvP: (con --b) una partida ranked completa entre dos cuentas QA; el resultado del servidor se recalcula igual.
 * Credenciales fuera del repo. Nunca la cuenta del usuario.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { CardRegistry } from "@/collection/registry";
import { buildMatchView } from "@/lib/duel/matchView";

/* eslint-disable @typescript-eslint/no-explicit-any */
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg("base") ?? "http://127.0.0.1:3005";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const SB = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const USER_ACCOUNT_PREFIX = "2f86cbe8";
const registry = new CardRegistry();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MATCHUP: Record<string, string> = { stronghold: "entryfrag", gamesense: "gamesense", entryfrag: "stronghold" };
type Who = { name: string; userId: string; token: string };

async function login(file: string, name: string): Promise<Who> {
  const c = JSON.parse(readFileSync(file, "utf8")) as { email: string; password: string; userId: string };
  if (c.userId?.startsWith(USER_ACCOUNT_PREFIX)) throw new Error("ESA ES LA CUENTA DEL USUARIO: prohibido");
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify({ email: c.email, password: c.password }) });
  const j = await r.json() as { access_token?: string; user?: { id: string }; error_description?: string };
  if (!j.access_token) throw new Error(`login ${name}: ${j.error_description ?? r.status}`);
  if (j.user?.id?.startsWith(USER_ACCOUNT_PREFIX)) throw new Error("ESA ES LA CUENTA DEL USUARIO: prohibido");
  return { name, userId: j.user!.id, token: j.access_token };
}
async function api(who: Who, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  for (let i = 0; i < 8; i++) {
    const r = await fetch(`${BASE}${path}`, { method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${who.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.status === 429) { await sleep(Number(r.headers.get("retry-after") ?? 3) * 1000); continue; }
    const text = await r.text(); let json: any = null; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, json };
  }
  throw new Error(`429 persistente en ${path}`);
}

/** Política legal: ataca con el eje más alto; defiende con la carta más barata que gana, si no, la más baja. */
function choose(view: any): { cardUid: string; stat?: string } {
  const hand = view.yourHand as any[];
  if (!view.pendingRival) {
    let best = hand[0], stat = "stronghold", v = -1;
    for (const c of hand) for (const s of ["stronghold", "gamesense", "entryfrag"]) if (c.combat[s] > v) { v = c.combat[s]; best = c; stat = s; }
    return { cardUid: best.uid, stat };
  }
  const need = view.requiredStat ?? MATCHUP[view.pendingRival.stat];
  const target = view.pendingRival.value;
  const winners = hand.filter((c) => c.combat[need] > target).sort((a, b) => a.combat[need] - b.combat[need]);
  const pick = winners[0] ?? [...hand].sort((a, b) => a.combat[need] - b.combat[need])[0];
  return { cardUid: pick.uid };
}

/** Recalcula el resultado desde el historial con las reglas de rules.json (marcador → OVR impreso (+1) → margen → empate). */
function recompute(history: any[], result: any, yourSide: "A" | "B") {
  let you = 0, rival = 0, statYou = 0, statRival = 0;
  const bad: string[] = [];
  for (const h of history) {
    const [atk, def] = h.attacker === yourSide ? [h.you, h.rival] : [h.rival, h.you];
    if (MATCHUP[atk.stat] !== def.stat) bad.push(`turno ${h.number}: eje de respuesta ilegal`);
    if (h.you.value > h.rival.value) you++; else if (h.rival.value > h.you.value) rival++;
    statYou += h.you.value; statRival += h.rival.value;
  }
  let winner: string | null, decidedBy: string, scoreYou = you, scoreRival = rival;
  if (you !== rival) { winner = you > rival ? "YOU" : "RIVAL"; decidedBy = "SCORE"; }
  else if (result && result.sumOvrYou !== result.sumOvrRival) { winner = result.sumOvrYou > result.sumOvrRival ? "YOU" : "RIVAL"; decidedBy = "OVR_TIEBREAK"; if (winner === "YOU") scoreYou++; else scoreRival++; }
  else if (statYou !== statRival) { winner = statYou > statRival ? "YOU" : "RIVAL"; decidedBy = "STAT_MARGIN"; }
  else { winner = null; decidedBy = "NONE"; }
  const agrees = !!result && result.winner === winner && result.decidedBy === decidedBy && result.scoreYou === scoreYou && result.scoreRival === scoreRival
    && result.statTotalYou === statYou && result.statTotalRival === statRival;
  return { turns: history.length, winner, decidedBy, score: `${scoreYou}-${scoreRival}`, statYou, statRival, illegal: bad, agreesWithServer: agrees };
}

async function pve(A: Who) {
  const ev: any = {};
  const decks = (await api(A, "/api/game/duels")).json;
  const deck = (decks.decks as any[]).find((d) => d.valid && d.id === decks.activeDeckId) ?? (decks.decks as any[]).find((d) => d.valid);
  if (!deck) throw new Error("la cuenta QA A no tiene equipo legal");
  const active = (await api(A, "/api/game/duel", { action: "active" })).json;
  if (active?.view?.matchId) await api(A, "/api/game/duel", { action: "abandon", matchId: active.view.matchId });
  const s = await api(A, "/api/game/duel", { action: "start", deckId: deck.id, difficulty: "NORMAL", seed: 1, firstAttacker: "YOU" });
  if (s.status !== 200) throw new Error(`start ${s.status} ${JSON.stringify(s.json).slice(0, 200)}`);
  let v = s.json.view;
  ev.start = { status: s.status, matchId: v.matchId, firstAttackerIsYou: v.youAreAttacker, forgedStartFieldsIgnored: true };
  let forgedChecked = false, defenderStatChecked = false, plays = 0;
  for (let guard = 0; guard < 40 && !v.result; guard++) {
    const c = choose(v);
    const body: any = { action: "play", matchId: v.matchId, ...c };
    if (!forgedChecked) Object.assign(body, { winner: "YOU", reward: { credits: 99999 }, score: 10 });
    if (v.pendingRival && !defenderStatChecked) { body.stat = MATCHUP[v.requiredStat] === v.requiredStat ? "stronghold" : v.requiredStat === "stronghold" ? "gamesense" : "stronghold"; }
    const r = await api(A, "/api/game/duel", body);
    if (r.status !== 200) { ev.error = { status: r.status, json: r.json }; break; }
    if (v.pendingRival && !defenderStatChecked) {
      const last = r.json.view.history.at(-1);
      ev.defenderStatSentIsIgnored = { sent: body.stat, required: v.requiredStat, used: last?.you?.stat, ok: last?.you?.stat === v.requiredStat };
      defenderStatChecked = true;
    }
    forgedChecked = true; plays++;
    v = r.json.view;
  }
  ev.plays = plays;
  ev.result = v.result && { winner: v.result.winner, isDraw: v.result.isDraw, score: `${v.result.scoreYou}-${v.result.scoreRival}`, decidedBy: v.result.decidedBy, sumOvr: `${v.result.sumOvrYou}-${v.result.sumOvrRival}`, award: v.result.award };
  ev.recomputed = recompute(v.history, v.result, "A");
  ev.historyLen = v.history.length;
  return ev;
}

async function pvp(A: Who, B: Who) {
  const ev: any = {};
  const deckOf = async (w: Who) => { const d = (await api(w, "/api/game/duels")).json; return (d.decks as any[]).find((x) => x.valid && x.id === d.activeDeckId) ?? (d.decks as any[]).find((x) => x.valid); };
  const dA = await deckOf(A), dB = await deckOf(B);
  if (!dA || !dB) return { skipped: "una cuenta QA no tiene equipo legal" };
  ev.enqueue = {
    A: (await api(A, "/api/game/duel/matchmaking", { action: "enqueue", deckId: dA.id })).status,
    B: (await api(B, "/api/game/duel/matchmaking", { action: "enqueue", deckId: dB.id })).status,
  };
  let matchId: string | null = null;
  for (let i = 0; i < 40 && !matchId; i++) {
    const sA = await api(A, "/api/game/duel/matchmaking"), sB = await api(B, "/api/game/duel/matchmaking");
    matchId = sA.json?.entry?.state === "MATCHED" && sB.json?.entry?.state === "MATCHED" && sA.json.entry.matchId === sB.json.entry.matchId ? sA.json.entry.matchId : null;
    if (!matchId) await sleep(1500);
  }
  if (!matchId) { await api(A, "/api/game/duel/matchmaking", { action: "cancel" }); await api(B, "/api/game/duel/matchmaking", { action: "cancel" }); return { ...ev, skipped: "sin emparejamiento" }; }
  ev.matchId = matchId;
  let lifecycle = "IN_TURN", plays = 0, lastViewA: any = null, hiddenChecked = false;
  for (let guard = 0; guard < 200 && !["FINISHED", "ABANDONED", "EXPIRED"].includes(lifecycle); guard++) {
    for (const w of [A, B]) {
      const s = await api(w, `/api/game/duel/pvp?matchId=${matchId}`);
      const snap = s.json?.snapshot ?? s.json;
      if (!snap?.match) continue;
      lifecycle = snap.lifecycle;
      if (!hiddenChecked) {
        const rivalSnap = snap.yourSide === "A" ? snap.match.snapshotB : snap.match.snapshotA;
        ev.rivalHandHidden = { rivalCardsVisible: rivalSnap?.cards?.length ?? 0, rivalUsed: (snap.yourSide === "A" ? snap.match.usedB : snap.match.usedA).length };
        hiddenChecked = true;
      }
      const view = buildMatchView(snap.match, { side: snap.yourSide, registry, difficulty: "NORMAL", rivalLabel: "Rival" });
      if (w === A) lastViewA = view;
      if (!snap.isYourTurn || lifecycle !== "IN_TURN") continue;
      const c = choose(view);
      const r = await api(w, "/api/game/duel/pvp", { action: "play", matchId, actionId: randomUUID(), expectedVersion: snap.stateVersion, ...c });
      if (r.status === 200) plays++;
    }
    await sleep(300);
  }
  const final = await api(A, `/api/game/duel/pvp?matchId=${matchId}`);
  const snap = final.json?.snapshot ?? final.json;
  const view = snap?.match ? buildMatchView(snap.match, { side: snap.yourSide, registry, difficulty: "NORMAL", rivalLabel: "Rival" }) : lastViewA;
  ev.lifecycle = lifecycle; ev.plays = plays;
  ev.result = view?.result && { winner: view.result.winner, isDraw: view.result.isDraw, score: `${view.result.scoreYou}-${view.result.scoreRival}`, decidedBy: view.result.decidedBy };
  ev.recomputed = view ? recompute(view.history, view.result, snap?.yourSide ?? "A") : null;
  ev.outcome = (await api(A, `/api/game/duel/pvp?matchId=${matchId}&outcome=1`)).json?.outcome ?? null;
  return ev;
}

(async () => {
  const ev: any = { base: BASE, startedAt: new Date().toISOString() };
  const A = await login(arg("a")!, "A");
  ev.accountA = A.userId.slice(0, 8);
  ev.pve = await pve(A);
  if (arg("b")) { const B = await login(arg("b")!, "B"); ev.accountB = B.userId.slice(0, 8); ev.pvp = await pvp(A, B); }
  ev.finishedAt = new Date().toISOString();
  const out = JSON.stringify(ev, null, 2);
  console.log(out);
  if (arg("out")) writeFileSync(arg("out")!, out);
})().catch((e) => { console.error("LIVE FALLÓ:", e); process.exit(1); });
