/**
 * FASE 66 · SOAK DE 100 PARTIDAS PvP REALES (instrumento `_`, fuera de CI) contra la app :3005 → Postgres del VPS.
 *
 * Usa el mecanismo SEGURO que ya existe: DUELO PRIVADO entre amigos (`PVP_PRIVATE`, Fase 29), que por diseño NO liquida
 * rating ni paga recompensas (dos redes: `isSettleable` y el RPC `duel_pvp_settle_match` → NOT_PVP). Así 100 partidas
 * no conceden 100 veces nada. Dos parejas de cuentas QA en paralelo. Caos aleatorio (semilla fija) en cada partida:
 * jugadas duplicadas concurrentes, reintentos con la misma actionId, pestaña vieja, abandono a mitad y abandono contra
 * jugada. Al final: invariantes.
 *
 *   npx tsx scripts/multiplayer/_fase66-soak.ts [--matches=100]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { api, login, pvpGet, legalMove, publicFacts, recomputeFromHistory, rating, credits, uuid, sleep, validDeck, type Who } from "./_qa";

/* eslint-disable @typescript-eslint/no-explicit-any */
const OUT = join(process.cwd(), "docs/product/qa/fase66-multiplayer");
mkdirSync(OUT, { recursive: true });
const TOTAL = Number(process.argv.find((a) => a.startsWith("--matches="))?.slice(10) ?? 100);
let seed = 66_066;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const social = (w: Who, body: object) => api(w, "/api/game/social", body);

async function befriend(a: Who, b: Who) {
  const r1 = await social(a, { action: "friend_request", targetUserId: b.userId });
  const r2 = await social(b, { action: "friend_accept", targetUserId: a.userId });
  return { request: r1.status, accept: r2.status, codes: [r1.json?.code, r2.json?.code] };
}

async function oneMatch(a: Who, b: Who, deckA: string, deckB: string, idx: number) {
  const m: any = { idx, pair: `${a.name}-${b.name}`, chaos: [] as string[], http5xx: 0, versions: [] as number[] };
  const ch = await social(a, { action: "challenge_create", targetUserId: b.userId, deckId: deckA });
  const challengeId = ch.json?.challengeId;
  if (!challengeId) return { ...m, error: `challenge ${ch.status} ${ch.json?.code ?? ch.json?.error}` };
  // Doble aceptación simultánea: la RPC reserva UNA partida (mismo id).
  const [acc1, acc2] = await Promise.all([
    social(b, { action: "challenge_accept", challengeId, deckId: deckB }),
    social(b, { action: "challenge_accept", challengeId, deckId: deckB }),
  ]);
  const ids = [acc1.json?.matchId, acc2.json?.matchId].filter(Boolean);
  m.doubleAcceptSameMatch = new Set(ids).size <= 1;
  const matchId = ids[0];
  if (!matchId) return { ...m, error: `accept ${acc1.status}/${acc2.status}` };
  m.matchId = matchId.slice(0, 8);
  const abandonAt = rnd() < 0.08 ? 2 + Math.floor(rnd() * 14) : -1;
  const raceAt = rnd() < 0.06 ? 2 + Math.floor(rnd() * 14) : -1;
  let actions = 0;
  for (let guard = 0; guard < 120; guard++) {
    const [ra, rb] = await Promise.all([pvpGet(a, matchId), pvpGet(b, matchId)]);
    if (ra.status >= 500 || rb.status >= 500) m.http5xx++;
    const sa = ra.json?.snapshot, sb = rb.json?.snapshot;
    if (!sa || !sb) { await sleep(300); continue; }
    m.versions.push(sa.stateVersion);
    if (JSON.stringify(publicFacts(sa)) !== JSON.stringify(publicFacts(sb))) m.inconsistent = (m.inconsistent ?? 0) + 1;
    if (["FINISHED", "ABANDONED", "EXPIRED"].includes(sa.lifecycle)) { m.final = { lifecycle: sa.lifecycle, facts: publicFacts(sa), result: sa.match.result }; break; }
    const w = sa.isYourTurn ? a : sb.isYourTurn ? b : null;
    if (!w) { await sleep(200); continue; }
    const s = w === a ? sa : sb;
    const mv = legalMove(s)!;
    const body = { action: "play", matchId, actionId: uuid(), expectedVersion: s.stateVersion, ...mv };
    const r = rnd();
    let res: any[];
    if (actions === abandonAt) { m.chaos.push(`abandon@${actions}`); res = [await api(rnd() < 0.5 ? a : b, "/api/game/duel/pvp", { action: "abandon", matchId })]; }
    else if (actions === raceAt) { m.chaos.push(`play-vs-abandon@${actions}`); res = await Promise.all([api(w, "/api/game/duel/pvp", body), api(w === a ? b : a, "/api/game/duel/pvp", { action: "abandon", matchId })]); m.raceOutcome = res.map((x) => x.status); }
    else if (r < 0.15) { m.chaos.push("dup3"); res = await Promise.all([body, { ...body, actionId: uuid() }, { ...body, actionId: uuid(), ...legalMove(s, 1)! }].map((x) => api(w, "/api/game/duel/pvp", x))); }
    else if (r < 0.25) { m.chaos.push("sameId2"); res = await Promise.all([api(w, "/api/game/duel/pvp", body), api(w, "/api/game/duel/pvp", body)]); }
    else if (r < 0.32 && s.stateVersion > 0) { m.chaos.push("stale"); res = [await api(w, "/api/game/duel/pvp", { ...body, expectedVersion: s.stateVersion - 1 }), await api(w, "/api/game/duel/pvp", body)]; }
    else res = [await api(w, "/api/game/duel/pvp", body)];
    m.http5xx += res.filter((x) => x.status >= 500).length;
    actions++;
  }
  const f = m.final;
  m.checks = {
    terminal: !!f,
    monotonic: m.versions.every((v: number, i: number) => i === 0 || v >= m.versions[i - 1]),
    consistentBothSides: !m.inconsistent,
    possibleScore: f?.facts ? f.facts.scoreA + f.facts.scoreB <= 11 && f.facts.scoreA >= 0 && f.facts.scoreB >= 0 : false,
    recomputeAgrees: f?.lifecycle === "FINISHED" ? recomputeFromHistory(f.result)?.agrees === true : true,
    tenTurnsWhenFinished: f?.lifecycle === "FINISHED" ? f.facts.turns.split("|").length === 10 : true,
    no5xx: m.http5xx === 0,
    doubleAcceptSameMatch: m.doubleAcceptSameMatch,
  };
  delete m.versions;
  if (f) m.final = { lifecycle: f.lifecycle, score: `${f.facts.scoreA}-${f.facts.scoreB}`, decidedBy: f.facts.result?.decidedBy ?? null };
  return m;
}

(async () => {
  const pairs: [Who, Who][] = [[await login("D"), await login("E")], [await login("F"), await login("G")]];
  const ev: any = { at: new Date().toISOString(), mode: "PVP_PRIVATE (sin rating ni recompensa)", total: TOTAL, pairs: pairs.map(([x, y]) => `${x.userId.slice(0, 8)}-${y.userId.slice(0, 8)}`) };
  const everyone = pairs.flat();
  const before = Object.fromEntries(await Promise.all(everyone.map(async (w) => [w.name, { ...(await rating(w)), ...(await credits(w)) }])));
  ev.friendship = await Promise.all(pairs.map(([x, y]) => befriend(x, y)));
  const decks = new Map<string, string>();
  for (const w of everyone) { const d = await validDeck(w); if (!d) throw new Error(`${w.name} sin equipo válido`); decks.set(w.name, d.id); }
  // Doble asignación: con D en partida privada, D no puede abrir otra (ni ranked ni privada).
  const results: any[] = [];
  let next = 0;
  const t0 = Date.now();
  await Promise.all(pairs.map(async ([x, y]) => {
    while (next < TOTAL) {
      const i = ++next;
      const [p, q] = i % 2 ? [x, y] : [y, x];
      const m = await oneMatch(p, q, decks.get(p.name)!, decks.get(q.name)!, i).catch((e) => ({ idx: i, error: String(e) }));
      results.push(m);
      if (i % 10 === 0) console.log(`soak ${i}/${TOTAL} · ${Math.round((Date.now() - t0) / 1000)} s`);
    }
  }));
  // Doble partida: abrir un reto mientras se está en una partida viva.
  const [x, y] = pairs[0];
  const ch = await social(x, { action: "challenge_create", targetUserId: y.userId, deckId: decks.get(x.name)! });
  const acc = await social(y, { action: "challenge_accept", challengeId: ch.json?.challengeId, deckId: decks.get(y.name)! });
  const live = acc.json?.matchId;
  const second = await api(x, "/api/game/duel/matchmaking", { action: "enqueue", deckId: decks.get(x.name)! });
  ev.doubleMatchGuard = { liveMatch: !!live, enqueueWhileInMatch: second.status, code: second.json?.code, ok: second.status === 409 };
  if (live) await api(x, "/api/game/duel/pvp", { action: "abandon", matchId: live });

  const after = Object.fromEntries(await Promise.all(everyone.map(async (w) => [w.name, { ...(await rating(w)), ...(await credits(w)) }])));
  const ok = (k: string) => results.filter((r) => r.checks?.[k]).length;
  ev.seconds = Math.round((Date.now() - t0) / 1000);
  ev.invariants = {
    played: results.length, errors: results.filter((r) => r.error).length,
    terminal: ok("terminal"), monotonicVersions: ok("monotonic"), consistentBothSides: ok("consistentBothSides"), possibleScores: ok("possibleScore"),
    resultRecomputedAgrees: ok("recomputeAgrees"), tenTurnsWhenFinished: ok("tenTurnsWhenFinished"), zero5xx: ok("no5xx"), doubleAcceptOneMatch: ok("doubleAcceptSameMatch"),
    lifecycles: results.reduce<Record<string, number>>((m, r) => ((m[r.final?.lifecycle ?? "NONE"] = (m[r.final?.lifecycle ?? "NONE"] ?? 0) + 1), m), {}),
    chaosEvents: results.flatMap((r) => r.chaos ?? []).reduce<Record<string, number>>((m, c) => { const k = c.split("@")[0]; m[k] = (m[k] ?? 0) + 1; return m; }, {}),
    ratingUnchanged: everyone.every((w) => before[w.name].rating === after[w.name].rating && before[w.name].games === after[w.name].games),
    creditsUnchanged: everyone.every((w) => before[w.name].credits === after[w.name].credits),
  };
  ev.before = before; ev.after = after;
  ev.matches = results.sort((p, q) => p.idx - q.idx);
  writeFileSync(join(OUT, "soak.json"), JSON.stringify(ev, null, 2));
  console.log(JSON.stringify({ seconds: ev.seconds, invariants: ev.invariants, doubleMatchGuard: ev.doubleMatchGuard }, null, 2));
})().catch((e) => { console.error("SOAK FALLÓ:", e); process.exit(1); });
