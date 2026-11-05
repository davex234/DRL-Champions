/**
 * FASE 55 · E2E REAL del ranked contra la BD del VPS (fuera de CI). DOS cuentas QA juegan UNA partida ranked
 * completa por la API real de la app (`next start` :3005 → túnel → Supabase del VPS):
 *
 *   competitivo (antes) → cola A y B → MATCHED → ?matchup= → 10 turnos jugados con clics legales → FINISHED →
 *   ?outcome=1 (asiento real) → competitivo (después): historial, rating, escalera y temporada.
 *
 * Además intenta, como cliente malicioso: enviar ganador/rating en el cuerpo, repetir una acción (mismo actionId),
 * pedir el `matchup` sin sesión, pedir el resultado dos veces, y escanea TODAS las respuestas buscando correos.
 *
 *   npx tsx scripts/_fase55-live-e2e.ts --a=<creds.json> --b=<creds.json> [--base=http://127.0.0.1:3005]
 *
 * Las credenciales viven fuera del repo (scratchpad). Salida: JSON de evidencia en stdout y en --out.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { CardRegistry } from "@/collection/registry";
import { buildMatchView } from "@/lib/duel/matchView";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg("base") ?? "http://127.0.0.1:3005";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const SB = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const registry = new CardRegistry();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const EMAIL_RX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const leaks: string[] = [];

interface Who { name: string; email: string; password: string; userId: string; token: string }

async function login(file: string, name: string): Promise<Who> {
  const c = JSON.parse(readFileSync(file, "utf8")) as { email: string; password: string; userId: string };
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify({ email: c.email, password: c.password }) });
  const j = await r.json() as { access_token?: string; error_description?: string };
  if (!j.access_token) throw new Error(`login ${name}: ${j.error_description ?? r.status}`);
  return { name, email: c.email, password: c.password, userId: c.userId, token: j.access_token };
}

async function api(who: Who | null, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(`${BASE}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { ...(who ? { authorization: `Bearer ${who.token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.status === 429) { await sleep(Number(r.headers.get("retry-after") ?? 3) * 1000); continue; }
    const text = await r.text();
    const m = text.match(EMAIL_RX);
    if (m) leaks.push(`${path} → ${m[0]}`);
    let json: any = null; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, json };
  }
  throw new Error(`429 persistente en ${path}`);
}

function bestStat(c: { combat: Record<string, number> }): string {
  return Object.entries(c.combat).sort((a, b) => b[1] - a[1])[0][0];
}

(async () => {
  const ev: Record<string, unknown> = { base: BASE, startedAt: new Date().toISOString() };
  const A = await login(arg("a")!, "A"), B = await login(arg("b")!, "B");
  ev.players = { A: A.userId, B: B.userId };

  // 1 · centro competitivo ANTES + mazos legales.
  const before = { A: (await api(A, "/api/game/competitive")).json, B: (await api(B, "/api/game/competitive")).json };
  ev.before = Object.fromEntries(Object.entries(before).map(([k, s]) => [k, { rating: s.self?.rating?.rating, games: s.self?.rating?.gamesPlayed, position: s.self?.position, rankedTotal: s.self?.rankedTotal, season: s.season?.displayName, seasonMatches: s.season?.record?.matches }]));
  const deckOf = async (w: Who) => { const d = (await api(w, "/api/game/duels")).json; return (d.decks as any[]).find((x) => x.valid && x.id === d.activeDeckId) ?? (d.decks as any[]).find((x) => x.valid); };
  const dA = await deckOf(A), dB = await deckOf(B);
  if (!dA || !dB) throw new Error("una de las cuentas QA no tiene mazo legal");
  ev.decks = { A: dA.name, B: dB.name };

  // 2 · ataque: meter un rating en el cuerpo de la cola (debe ignorarse: la cola solo lee deckId).
  const enqA = await api(A, "/api/game/duel/matchmaking", { action: "enqueue", deckId: dA.id, rating: 4999, opponentId: B.userId });
  const enqB = await api(B, "/api/game/duel/matchmaking", { action: "enqueue", deckId: dB.id });
  ev.enqueue = { A: { status: enqA.status, code: enqA.json?.code, snapshot: enqA.json?.entry?.ratingSnapshot }, B: { status: enqB.status, code: enqB.json?.code } };

  // 3 · emparejamiento por el propio tráfico (GET de quien está en cola).
  let matchId: string | null = null;
  for (let i = 0; i < 40 && !matchId; i++) {
    const sA = await api(A, "/api/game/duel/matchmaking");
    const sB = await api(B, "/api/game/duel/matchmaking");
    matchId = sA.json?.entry?.state === "MATCHED" && sB.json?.entry?.state === "MATCHED" && sA.json.entry.matchId === sB.json.entry.matchId ? sA.json.entry.matchId : null;
    if (!matchId) await sleep(1500);
  }
  if (!matchId) throw new Error("no hubo emparejamiento");
  ev.matchId = matchId;

  // 4 · rival encontrado: los dos lados; sin sesión 401; ids inválidos 400.
  const muA = await api(A, `/api/game/competitive?matchup=${matchId}`);
  const muAnon = await api(null, `/api/game/competitive?matchup=${matchId}`);
  const muBad = await api(A, `/api/game/competitive?matchup=not-a-uuid`);
  ev.matchup = { status: muA.status, you: muA.json?.you?.username, rival: muA.json?.rival?.username, rivalKind: muA.json?.rivalKind, keys: Object.keys(muA.json?.rival ?? {}), anon: muAnon.status, badId: muBad.status };

  // 5 · jugar la partida con clics legales desde la vista redactada propia de cada uno.
  const players = { A, B };
  let version = 0; let turns = 0; let lifecycle = "IN_TURN"; let replayChecked = false; let forgedChecked = false;
  for (let guard = 0; guard < 200 && lifecycle !== "FINISHED" && lifecycle !== "ABANDONED" && lifecycle !== "EXPIRED"; guard++) {
    for (const w of Object.values(players)) {
      const s = await api(w, `/api/game/duel/pvp?matchId=${matchId}`);
      const snap = s.json?.snapshot ?? s.json;
      if (!snap?.match) continue;
      lifecycle = snap.lifecycle; version = snap.stateVersion;
      if (!snap.isYourTurn || lifecycle !== "IN_TURN") continue;
      const view = buildMatchView(snap.match, { side: snap.yourSide, registry, difficulty: "NORMAL", rivalLabel: "Rival" });
      const card = view.yourHand[0];
      if (!card) continue;
      const stat = view.pendingRival ? view.requiredStat ?? undefined : bestStat(card as any);
      const actionId = randomUUID();
      const body: Record<string, unknown> = { action: "play", matchId, actionId, expectedVersion: version, cardUid: card.uid, stat };
      if (!forgedChecked) { Object.assign(body, { winner: w.name === "A" ? "A" : "B", ratingDelta: 500, newRating: 4999 }); }
      const r = await api(w, "/api/game/duel/pvp", body);
      if (!forgedChecked) { ev.forgedFieldsInPlay = { status: r.status, note: "winner/ratingDelta/newRating enviados en el cuerpo de una jugada legal" }; forgedChecked = true; }
      if (!replayChecked && r.status === 200) {
        const again = await api(w, "/api/game/duel/pvp", { ...body, winner: undefined });
        ev.replaySameActionId = { status: again.status, code: again.json?.code, versionAfterFirst: r.json?.snapshot?.stateVersion ?? r.json?.stateVersion, versionAfterReplay: again.json?.snapshot?.stateVersion ?? again.json?.stateVersion };
        replayChecked = true;
      }
      turns++;
    }
    await sleep(350);
  }
  ev.plays = turns; ev.lifecycle = lifecycle;

  // 6 · resultado del servidor, dos veces (idempotente al leer) para cada jugador.
  const outA1 = await api(A, `/api/game/duel/pvp?matchId=${matchId}&outcome=1`);
  const outA2 = await api(A, `/api/game/duel/pvp?matchId=${matchId}&outcome=1`);
  const outB = await api(B, `/api/game/duel/pvp?matchId=${matchId}&outcome=1`);
  ev.outcome = { A: outA1.json?.outcome, Asecond: outA2.json?.outcome, B: outB.json?.outcome, sameTwice: JSON.stringify(outA1.json?.outcome) === JSON.stringify(outA2.json?.outcome) };

  // 7 · centro competitivo DESPUÉS: historial con el asiento, escalera, temporada y página de la escalera.
  const after = { A: (await api(A, "/api/game/competitive")).json, B: (await api(B, "/api/game/competitive")).json };
  ev.after = Object.fromEntries(Object.entries(after).map(([k, s]) => [k, {
    rating: s.self?.rating?.rating, games: s.self?.rating?.gamesPlayed, position: s.self?.position, rankedTotal: s.self?.rankedTotal,
    lastMatch: s.recentMatches?.[0] ? { id: s.recentMatches[0].matchId, outcome: s.recentMatches[0].outcome, rating: s.recentMatches[0].rating, rival: s.recentMatches[0].rival?.username, score: `${s.recentMatches[0].scoreYou}-${s.recentMatches[0].scoreRival}` } : null,
    season: s.season?.record,
  }]));
  const page = await api(A, "/api/game/competitive?ladder=1&offset=0&size=9999");
  ev.ladderPage = { status: page.status, size: page.json?.size, total: page.json?.total, entries: (page.json?.entries ?? []).map((e: any) => `#${e.position} ${e.username} ${e.rating}`), selfPosition: page.json?.selfPosition };
  const detail = await api(B, `/api/game/competitive?match=${matchId}`);
  ev.detailB = { status: detail.status, outcome: detail.json?.outcome, rating: detail.json?.rating ? { old: detail.json.rating.oldRating, delta: detail.json.rating.delta, new: detail.json.rating.newRating } : null };
  // 8 · otra vez en cola tras terminar (no hay partida viva que lo bloquee) y cancelar enseguida: no deja rastro de partida.
  const reA = await api(A, "/api/game/duel/matchmaking", { action: "enqueue", deckId: dA.id });
  const caA = await api(A, "/api/game/duel/matchmaking", { action: "cancel" });
  ev.requeue = { enqueue: reA.json?.code ?? reA.status, cancel: caA.json?.code ?? caA.status };

  ev.emailLeaks = leaks;
  ev.finishedAt = new Date().toISOString();
  const out = JSON.stringify(ev, null, 2);
  console.log(out);
  if (arg("out")) writeFileSync(arg("out")!, out);
})().catch((e) => { console.error("E2E FALLÓ:", e); process.exit(1); });
