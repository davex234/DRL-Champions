/**
 * F76 · E2E EN VIVO de la cola ranked (fuera de CI). API real + BD real (lecturas en solo lectura) con cuentas QA.
 *   BASE_URL=<app> npx tsx scripts/_f76-live.ts
 *
 * No limpia la cola antes de empezar: parte del estado que haya (incluido un MATCHED muerto) y lo que crea lo cierra
 * con los mecanismos normales del jugador (abandonar su partida, cancelar su búsqueda).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { BASE, dbJson, legalDeck, login, mm, pvp, queueFacts, sleep, type Who } from "./_f76-lib";

const OUT = "docs/product/qa/f76-ranked";
mkdirSync(OUT, { recursive: true });
const results: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail: unknown = "") => {
  const d = typeof detail === "string" ? detail : JSON.stringify(detail);
  results.push({ id, ok, detail: d.slice(0, 700) });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${d.slice(0, 220)}`);
  return ok;
};
/** POST/GET sin reintentos: en concurrencia se quiere ver el código real (también un 429 del limitador). */
async function raw(w: Who, body?: unknown) {
  const r = await fetch(`${BASE}/api/game/duel/matchmaking`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${w.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => null) as any };
}
const liveQueueGlobal = () => dbJson<{ n: number }>(`select json_build_object('n', (select count(*) from duel_pvp_queue where state in ('QUEUED','PAIRING')))::jsonb`).n;
const matchRow = (id: string) => dbJson<any>(`select row_to_json(x)::jsonb from (select left(id::text,8) id, status, closed_reason, state_version, turn_deadline_at from duel_matches where id = '${id.replace(/[^0-9a-f-]/g, "")}') x`);
const finish = async (w: Who, matchId: string) => (await pvp(w, matchId, { action: "abandon" })).status;

async function main() {
  const [H, I, F, D, C] = [await login("H"), await login("I"), await login("F"), await login("D"), await login("C")];
  const deck: Record<string, string> = {};
  for (const w of [H, I, F, D, C]) deck[w.p] = await legalDeck(w);
  const ev: Record<string, unknown> = { base: BASE, at: new Date().toISOString(), accounts: Object.fromEntries([H, I, F, D, C].map((w) => [w.p, w.userId.slice(0, 8)])) };
  check("0 · cola global vacía al empezar (nadie ajeno a QA en cola)", liveQueueGlobal() === 0, { live: liveQueueGlobal() });

  // ── W · DOS USUARIOS: emparejan, juegan/terminan, vuelven: no recuperan la vieja y emparejan de nuevo ──
  const [jh, ji] = await Promise.all([mm(H, { action: "enqueue", deckId: deck.H }), mm(I, { action: "enqueue", deckId: deck.I })]);
  let m1: string | null = null;
  for (let k = 0; k < 10 && !m1; k++) {
    const [sh, si] = [(await mm(H)).json, (await mm(I)).json];
    if (sh?.entry?.state === "MATCHED" && sh.entry.matchId === si?.entry?.matchId) m1 = sh.entry.matchId; else await sleep(1500);
  }
  check("W1 · join simultáneo H+I → UNA partida compartida", !!m1, { jh: jh.json?.code, ji: ji.json?.code, m1: m1?.slice(0, 8) });
  if (!m1) throw new Error("sin emparejamiento: no sigue");
  ev.m1 = m1.slice(0, 8);

  // ── L · CONTROL POSITIVO: partida ACTIVA se recupera (F5 x3) y volver a JUGAR da la misma ──
  const f5 = await Promise.all([mm(H), mm(H), mm(H)]);
  check("L1 · F5 ×3 con partida ACTIVA → la misma partida", f5.every((r) => r.json?.entry?.state === "MATCHED" && r.json.entry.matchId === m1), f5.map((r) => r.json?.entry?.matchId?.slice(0, 8)));
  const again = await raw(H, { action: "enqueue", deckId: deck.H });
  check("L2 · volver a JUGAR con partida activa → 409 ACTIVE_MATCH con ESA partida adjunta (se retoma)", again.status === 409 && again.json?.code === "ACTIVE_MATCH" && again.json?.entry?.matchId === m1, { status: again.status, code: again.json?.code, m: again.json?.entry?.matchId?.slice(0, 8) });
  check("L3 · no se creó otra búsqueda", queueFacts(H.userId).live === 0, queueFacts(H.userId).live);

  // ── AA/AB · F72.8: plazo de 30 s en servidor y jugada automática al vencer (sin cierre EXPIRED) ──
  const s0 = (await pvp(H, m1)).json?.snapshot;
  const dl = s0?.turnDeadlineAt ?? null, v0 = s0?.stateVersion ?? null;
  check("AA1 · el turno tiene plazo de servidor (~30 s)", typeof dl === "number" && dl - (s0?.turnStartedAt ?? 0) >= 29_000 && dl - (s0?.turnStartedAt ?? 0) <= 31_000, { dl, start: s0?.turnStartedAt });
  await sleep(Math.max(0, (dl ?? Date.now()) - Date.now()) + 4000);
  const s1 = (await pvp(I, m1)).json?.snapshot;
  check("AB1 · al vencer, el servidor juega solo: la versión avanza y la partida SIGUE (no EXPIRED)", (s1?.stateVersion ?? 0) > (v0 ?? 0) && s1?.lifecycle === "IN_TURN", { v0, v1: s1?.stateVersion, life: s1?.lifecycle });
  check("AB2 · BD: sin closed_reason tras el vencimiento", matchRow(m1)?.closed_reason === null, matchRow(m1));

  // ── V · RECONEXIÓN MIENTRAS TERMINA: status y abandono a la vez ──
  const [stH, ab] = await Promise.all([mm(H), finish(I, m1)]);
  check("V1 · reconectar mientras termina: o la viva en ese instante o nada; nunca otra", ab === 200 && (stH.json?.entry === null || stH.json?.entry?.matchId === m1), { ab, st: stH.json?.entry?.state });
  const terminal1 = matchRow(m1);
  check("N1 · abandono → partida terminal (IN_PROGRESS + ABANDONED)", terminal1?.closed_reason === "ABANDONED", terminal1);

  // ── J · STALE MATCHED: tras terminar, las dos entradas siguen MATCHED en BD y la API NO las presenta ──
  const qh = queueFacts(H.userId).entries[0], qi = queueFacts(I.userId).entries[0];
  check("J1 · BD: el estado del bug existe de verdad (entradas MATCHED → partida terminal)", qh?.state === "MATCHED" && qh?.match === m1.slice(0, 8) && qi?.state === "MATCHED", { qh, qi });
  const [sH, sI] = [(await mm(H)).json, (await mm(I)).json];
  check("J2 · la API ya NO devuelve la partida terminada (IDLE, sin entrada)", sH?.code === "IDLE" && sH?.entry === null && sI?.entry === null, { h: sH?.code, i: sI?.code });
  const cH = (await mm(H, { action: "cancel" })).json;
  check("O1 · cancelar sin búsqueda: NOT_QUEUED sin devolver la partida muerta", cH?.code === "NOT_QUEUED" && cH?.entry === null, cH?.code);
  const viewDead = await pvp(H, m1);
  check("J3 · la partida muerta sigue legible como RESULTADO (historial), terminal", viewDead.status === 200 && ["ABANDONED", "FINISHED", "EXPIRED"].includes(viewDead.json?.snapshot?.lifecycle), viewDead.json?.snapshot?.lifecycle);
  const playDead = await pvp(H, m1, { action: "play", actionId: randomUUID(), expectedVersion: viewDead.json?.snapshot?.stateVersion ?? 0, cardUid: "00000000-0000-4000-8000-000000000000", stat: "entryfrag" });
  check("J4 · un cliente manipulado NO puede jugar la partida terminada", playDead.status >= 400, { status: playDead.status, code: playDead.json?.code });

  // ── W2 · vuelven a JUGAR: cola nueva y partida NUEVA ──
  const [rh, ri] = await Promise.all([mm(H, { action: "enqueue", deckId: deck.H }), mm(I, { action: "enqueue", deckId: deck.I })]);
  let m2: string | null = null;
  for (let k = 0; k < 10 && !m2; k++) {
    const [sh, si] = [(await mm(H)).json, (await mm(I)).json];
    if (sh?.entry?.state === "MATCHED" && sh.entry.matchId === si?.entry?.matchId) m2 = sh.entry.matchId; else await sleep(1500);
  }
  check("W2 · rematch: entran en cola NUEVA y emparejan en una partida NUEVA", !!m2 && m2 !== m1, { rh: rh.json?.code, ri: ri.json?.code, m2: m2?.slice(0, 8) });
  // ── T · FIN/JOIN: H abandona mientras I vuelve a JUGAR ──
  if (m2) {
    const [abH, jI] = await Promise.all([finish(H, m2), raw(I, { action: "enqueue", deckId: deck.I })]);
    const sI2 = (await mm(I)).json;
    check("T1 · fin/join a la vez: I recibe la viva (409+partida) o una cola nueva; después nunca la terminada",
      abH === 200 && ((jI.status === 409 && jI.json?.entry?.matchId === m2) || (jI.status === 200 && jI.json?.entry?.state === "QUEUED"))
      && (sI2?.entry === null || sI2?.entry?.state === "QUEUED"), { abH, j: jI.status, jcode: jI.json?.code, after: sI2?.entry?.state ?? sI2?.code });
    if (sI2?.entry?.state === "QUEUED") await mm(I, { action: "cancel" });
    ev.m2 = m2.slice(0, 8);
  }

  // ── R/S · 10× JUGAR y 10× CANCELAR del MISMO usuario a la vez (F) ──
  const j10 = await Promise.all(Array.from({ length: 10 }, () => raw(F, { action: "enqueue", deckId: deck.F })));
  const okJ = j10.filter((r) => r.status === 200);
  const ids = new Set(okJ.map((r) => r.json?.entry?.entryId));
  const qF = queueFacts(F.userId);
  check("R1 · 10× JUGAR simultáneo → UNA búsqueda (una fila viva; todas las respuestas 200 describen la misma)", qF.live === 1 && ids.size === 1 && okJ.filter((r) => r.json?.code === "OK").length === 1,
    { statuses: j10.map((r) => `${r.status}:${r.json?.code}`), live: qF.live, distinct: ids.size });
  const c10 = await Promise.all(Array.from({ length: 10 }, () => raw(F, { action: "cancel" })));
  const qF2 = queueFacts(F.userId);
  check("S1 · 10× CANCELAR simultáneo → una cancelación, 0 filas vivas, nadie devuelve una partida", qF2.live === 0 && c10.filter((r) => r.json?.code === "OK").length === 1 && c10.every((r) => !r.json?.entry?.matchId),
    { statuses: c10.map((r) => `${r.status}:${r.json?.code}`), live: qF2.live });
  await sleep(61_000); // ventana del limitador `mm_write` (20/min): lo que sigue no debe medir el 429
  const back = await mm(F, { action: "enqueue", deckId: deck.F });
  check("R2 · después vuelve a JUGAR y funciona", back.status === 200 && back.json?.entry?.state === "QUEUED", back.json?.code);

  // ── U · CANCEL contra EMPAREJADOR: F en cola; D entra (dispara emparejar) mientras F cancela ──
  const [cF, eD] = await Promise.all([raw(F, { action: "cancel" }), raw(D, { action: "enqueue", deckId: deck.D })]);
  await sleep(1500);
  const fRow = queueFacts(F.userId).entries[0], dRow = queueFacts(D.userId).entries[0];
  const paired = fRow?.state === "MATCHED";
  check("U1 · cancel vs emparejador: o cancela (y D sigue en cola) o empareja (cancel no dice OK); nunca las dos",
    (fRow?.state === "CANCELLED" && cF.json?.code === "OK" && ["QUEUED", "PAIRING"].includes(dRow?.state)) || (paired && cF.json?.code !== "OK" && dRow?.state === "MATCHED" && dRow?.match === fRow?.match),
    { cancel: cF.json?.code, enq: eD.json?.code, f: fRow?.state, d: dRow?.state });
  if (paired) { const mid = (await mm(F)).json?.entry?.matchId; if (mid) await finish(F, mid); } else await mm(D, { action: "cancel" });

  // ── X · SEGURIDAD entre usuarios ──
  const mx = m2 ?? m1;
  const foreignView = await pvp(C, mx);
  check("X1 · C no puede leer la partida de H/I (404 uniforme)", foreignView.status === 404, foreignView.status);
  const foreignAbandon = await pvp(C, mx, { action: "abandon" });
  check("X2 · C no puede cerrar/abandonar la partida ajena", foreignAbandon.status === 404, foreignAbandon.status);
  const foreignDeck = await raw(C, { action: "enqueue", deckId: deck.H });
  check("X3 · C no puede encolarse con el equipo de H", foreignDeck.status === 404 && foreignDeck.json?.code === "DECK_NOT_OWNED", { s: foreignDeck.status, c: foreignDeck.json?.code });
  const forged = await raw(C, { action: "enqueue", deckId: deck.C, userId: H.userId, matchId: mx, state: "MATCHED", rating: 3000 });
  const cRow = queueFacts(C.userId).entries[0];
  check("X4 · campos inyectados (userId/matchId/state/rating) se ignoran: C entra en SU cola, sin partida ajena", forged.status === 200 && cRow?.state === "QUEUED" && cRow?.match === null, { s: forged.status, row: cRow });
  const cancelC = (await mm(C, { action: "cancel" })).json;
  const hAfter = queueFacts(H.userId).entries[0];
  check("X5 · el cancel de C solo toca SU entrada (la de H intacta)", cancelC?.code === "OK" && hAfter?.match === (m2 ?? m1).slice(0, 8), { c: cancelC?.code, h: hAfter });
  const restRaw = await fetch(`${BASE}/rest/v1/duel_pvp_queue?select=id&limit=1`, { headers: { apikey: "x", authorization: `Bearer ${C.token}` } });
  check("X6 · la tabla de cola no es accesible por REST con la sesión del jugador", restRaw.status >= 400 || (await restRaw.json().catch(() => [])).length === 0, restRaw.status);

  // ── Z · LIMPIEZA: nada vivo de QA, nada vivo global ──
  for (const w of [H, I, F, D, C]) { const s = (await mm(w)).json; if (s?.entry?.state === "QUEUED") await mm(w, { action: "cancel" }); if (s?.entry?.state === "MATCHED" && s.entry.matchId) await finish(w, s.entry.matchId); }
  const leftovers = [H, I, F, D, C].map((w) => queueFacts(w.userId).live);
  check("Z1 · al terminar: 0 búsquedas vivas de QA y 0 en la cola global", leftovers.every((n) => n === 0) && liveQueueGlobal() === 0, { leftovers, global: liveQueueGlobal() });
  const dup = dbJson<{ n: number }>(`select json_build_object('n', (select count(*) from (select user_id from duel_pvp_queue where state in ('QUEUED','PAIRING') group by 1 having count(*) > 1) x))::jsonb`).n;
  check("Z2 · BD: 0 usuarios con dos búsquedas vivas", dup === 0, dup);

  const failed = results.filter((r) => !r.ok).length;
  writeFileSync(`${OUT}/live-${BASE.includes("valorosters") ? "prod" : "local"}-${Date.now()}.json`, JSON.stringify({ ...ev, total: results.length, failed, results }, null, 2) + "\n");
  console.log(`\n${results.length - failed}/${results.length} PASS`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
