/**
 * DUEL GAMEPLAY UX 2.0 · QA EN PRODUCCIÓN (instrumento de operador, fuera de CI y fuera de la release).
 *
 *   QA_CREDS_DIR=… QA_SB=https://valorosters.com QA_ANON=… BASE_URL=https://valorosters.com npx tsx scripts/_duelux2-prod-qa.mts [A] [B]
 *
 * Con una persona QA (nunca davex ni ValoRosters: aborta si ve sus ids) juega UNA partida rápida PvE por la API real:
 *   1 · sin reloj: nace sin plazo; se espera > 30 s (el plazo antiguo) sin hacer nada → nada se mueve;
 *   2 · después, la jugada manual funciona; doble envío = UNA transición; versión vieja = 409;
 *   3 · carta comprometida del bot: el payload ANTES de responder no contiene la carta que luego se revela (uid, id, jugador);
 *   4 · recibo: «rewards» = lo que subió el saldo real; F5 y 20 lecturas a la vez = el mismo recibo, el saldo no se mueve;
 *   5 · otra persona QA no lee la partida (404).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fnv1a32 } from "../src/domain/cardgame/hints.ts";

const BASE = process.env.BASE_URL!, SB = process.env.QA_SB!, ANON = process.env.QA_ANON!, DIR = process.env.QA_CREDS_DIR!;
const REAL = ["2f86cbe8", "3befce61", "b7ccff02"];
const OLD_TIMEOUT_MS = 30_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` ${JSON.stringify(detail)?.slice(0, 400)}`}`);
};

async function token(p: string): Promise<{ id: string; t: string }> {
  const c = JSON.parse(readFileSync(join(DIR, `${p}.json`), "utf8")) as { email: string; password: string };
  const j = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify(c) })).json() as { access_token: string; user: { id: string } };
  if (REAL.some((x) => j.user.id.startsWith(x))) throw new Error("CUENTA REAL: abortado");
  return { id: j.user.id, t: j.access_token };
}
async function call(t: string, path: string, body?: unknown): Promise<{ status: number; raw: string; json: any }> {
  const r = await fetch(`${BASE}${path}`, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${t}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const raw = await r.text();
  let json: any = null; try { json = JSON.parse(raw); } catch { /* no JSON */ }
  return { status: r.status, raw, json };
}
const duel = (t: string, body: Record<string, unknown>) => call(t, "/api/game/duel", body);
const credits = async (t: string) => Number((await call(t, "/api/game/state")).json?.credits);

const [PA = "A", PB = "B"] = process.argv.slice(2);
const a = await token(PA), b = await token(PB);
console.log(`persona ${PA}=${a.id.slice(0, 8)} · otra ${PB}=${b.id.slice(0, 8)}`);

// Una partida previa abierta se abandona (no es de esta prueba).
const act = await duel(a.t, { action: "active" });
if (act.json?.view?.matchId) await duel(a.t, { action: "abandon", matchId: act.json.view.matchId });

const ws = (await call(a.t, "/api/game/duels")).json;
const deckId: string | undefined = ws?.activeDeckId ?? ws?.decks?.find((d: any) => d.valid !== false)?.id;
if (!deckId) { console.log("ABORT sin equipo"); process.exit(1); }
const c0 = await credits(a.t);

// 1 · sin reloj.
const s = await duel(a.t, { action: "start", deckId, difficulty: "NORMAL" });
check("start 200", s.status === 200, s.status);
let v = s.json.view;
const id: string = v.matchId;
check("nace SIN plazo (turnDeadlineAt null)", v.turnDeadlineAt === null, v.turnDeadlineAt);
console.log(`esperando ${(OLD_TIMEOUT_MS + 10_000) / 1000} s sin hacer nada…`);
await sleep(OLD_TIMEOUT_MS + 10_000);
const w = (await duel(a.t, { action: "state", matchId: id })).json.view;
check("tras > 30 s: misma versión, mismo turno, ninguna jugada automática, sin derrota",
  w.stateVersion === v.stateVersion && w.turn === v.turn && w.history.length === v.history.length && w.status === "IN_PROGRESS" && (w.timeouts ?? []).length === 0 && w.yourUsed.length === 0,
  { before: [v.stateVersion, v.turn], after: [w.stateVersion, w.turn, w.status, w.timeouts] });
check("tras > 30 s: sigue sin plazo", w.turnDeadlineAt === null, w.turnDeadlineAt);
const act2 = (await duel(a.t, { action: "active" })).json?.view;
check("retomar (otra sesión) tampoco mueve nada", act2?.stateVersion === v.stateVersion, act2?.stateVersion);
v = w;

// 2 · primera jugada: doble envío con la misma versión.
const play = (vv: any, k = 0) => duel(a.t, { action: "play", matchId: id, cardUid: vv.yourHand[k].uid, stat: vv.youAreAttacker ? "stronghold" : undefined, expectedVersion: vv.stateVersion });
let hiddenChecks = 0, committedSeen = 0;
const seenPre: any[] = [];
const inspect = (pre: any, preRaw: string, post: any) => {
  // 3 · la carta que el bot comprometió atacando, revelada al cerrar el turno, NO estaba en el payload previo.
  if (pre.youAreAttacker || !pre.pendingRival) return;
  committedSeen++;
  check(`T${pre.turn} · pendiente = solo «comprometida» + estadística + pista + rol`, JSON.stringify(Object.keys(pre.pendingRival).sort()) === '["committed","hint","role","stat"]' && (pre.pendingRival.hint === null || JSON.stringify(Object.keys(pre.pendingRival.hint).sort()) === '["type","value"]'), pre.pendingRival);
  seenPre.push(pre);
  const rv = post.lastTurn?.rival;
  const card = post.rivalUsed.find((c: any) => c.uid === rv?.uid);
  const mine = new Set([...pre.yourHand, ...pre.yourUsed].flatMap((c: any) => [c.uid, c.cardId, c.playerId, c.nick]));
  const secrets = [rv?.uid, card?.cardId, card?.playerId, card?.nick].filter((x) => x && !mine.has(x));
  const leaked = secrets.filter((x) => preRaw.includes(`"${x}"`));
  hiddenChecks++;
  check(`T${pre.turn} · la carta comprometida no viajó antes de responder (${secrets.length} claves: uid, carta, jugador, nick)`, secrets.length >= 4 && leaked.length === 0, { leaked, n: secrets.length });
  check(`T${pre.turn} · revelada tras responder, con su estadística declarada`, !!card && rv.stat === pre.pendingRival.stat, { rv, stat: pre.pendingRival.stat });
};
{
  const pre = v, preRaw = JSON.stringify(v);
  const [x, y] = await Promise.all([play(v), play(v)]);
  check("doble envío: exactamente UNA jugada aplicada, la otra 409", [x, y].filter((r) => r.status === 200).length === 1 && [x, y].some((r) => r.status === 409), [x.status, y.status]);
  const ok = x.status === 200 ? x : y;
  v = ok.json.view;
  check("una sola transición", v.stateVersion === (pre.stateVersion ?? 0) + 1 || v.history.length === pre.history.length + 1, [pre.stateVersion, v.stateVersion]);
  inspect(pre, preRaw, v);
  const stale = await duel(a.t, { action: "play", matchId: id, cardUid: v.yourHand[0]?.uid, stat: v.youAreAttacker ? "gamesense" : undefined, expectedVersion: pre.stateVersion });
  check("versión vieja → 409", stale.status === 409, stale.status);
}
for (let i = 0; i < 20 && v.status === "IN_PROGRESS"; i++) {
  const pre = v, preRaw = JSON.stringify(v);
  const r = await play(v);
  if (r.status !== 200) { check(`jugada T${v.turn}`, false, [r.status, r.json?.error]); break; }
  v = r.json.view;
  inspect(pre, preRaw, v);
  await sleep(250);
}
check("la partida terminó", v.status !== "IN_PROGRESS", v.status);
// AJUSTE · pista central = pista de ESA carta en la fila superior (orden por hash recalculado con los uids ya públicos).
for (const pre of seenPre) {
  const unplayed = v.history.filter((h: any) => h.number >= pre.turn).map((h: any) => h.rival.uid as string);
  const uidT = v.history.find((h: any) => h.number === pre.turn)?.rival.uid;
  const order = [...unplayed].sort((x, y) => fnv1a32(`${id}:${x}:order`) - fnv1a32(`${id}:${y}:order`));
  const i = order.indexOf(uidT);
  const card = v.rivalUsed.find((c: any) => c.uid === uidT);
  check(`T${pre.turn} · pista central = pista de esa carta arriba (${JSON.stringify(pre.pendingRival.hint)} · ${pre.pendingRival.role})`,
    i >= 0 && JSON.stringify(pre.rivalHints[i]) === JSON.stringify(pre.pendingRival.hint) && pre.rivalRoles?.[i] === pre.pendingRival.role && card?.role === pre.pendingRival.role,
    { i, top: pre.rivalHints[i], topRole: pre.rivalRoles?.[i], central: pre.pendingRival });
}
check("se vio al menos una carta comprometida por el bot y se comprobó", committedSeen > 0 && hiddenChecks === committedSeen, { committedSeen, hiddenChecks });

// 4 · recibo.
const c1 = await credits(a.t);
const rw = v.result?.rewards;
console.log(`RECIBO ${JSON.stringify(rw)} · award ${JSON.stringify(v.result?.award)} · saldo ${c0} → ${c1}`);
check("hay recibo del servidor", !!rw && rw.matchId === id, rw);
const got = (rw?.grants ?? []).reduce((s: number, g: any) => s + (g.reward?.credits ?? 0), 0);
check("créditos del recibo = lo que subió el saldo real", c1 - c0 === got, { delta: c1 - c0, got });
check("tipos solo créditos/XP en partida rápida", (rw?.grants ?? []).every((g: any) => Object.keys(g.reward).every((k) => k === "credits" || k === "xp")), rw?.grants);
const f5 = (await duel(a.t, { action: "state", matchId: id })).json.view;
check("F5 = mismo recibo", JSON.stringify(f5.result?.rewards) === JSON.stringify(rw), f5.result?.rewards);
const many = await Promise.all(Array.from({ length: 20 }, () => duel(a.t, { action: "state", matchId: id })));
check("20 lecturas a la vez: 200 y el mismo recibo", many.every((m) => m.status === 200 && JSON.stringify(m.json.view.result?.rewards) === JSON.stringify(rw)), many.map((m) => m.status));
check("el saldo no se movió al leer", (await credits(a.t)) === c1);

// 5 · otra persona.
const other = await duel(b.t, { action: "state", matchId: id });
check("otra persona: 404 y sin recibo", other.status === 404 && !other.raw.includes("grants"), [other.status, other.raw.slice(0, 120)]);

console.log(`\nDUEL UX 2.0 PROD QA: ${pass}/${pass + fail} · partida ${id}`);
process.exitCode = fail ? 1 : 0;
