/**
 * FASE 66 · SUITE API CONTRA EL SERVIDOR REAL (instrumento `_`, fuera de CI): app :3005 → túnel → Postgres del VPS.
 * SOLO cuentas QA. Cada caso es una carrera o un ataque de verdad (peticiones HTTP concurrentes), no un mock.
 *
 *   npx tsx scripts/multiplayer/_fase66-api.ts [queue|ranked|pve|all]
 *
 * Salidas: docs/product/qa/fase66-multiplayer/{queue-concurrency,turn-concurrency,idempotency,security,privacy,
 *          abandon,result-integrity,elo-integrity,reward-integrity,rate-limits}.api.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { api, login, mm, pvpGet, validDeck, legalMove, publicFacts, recomputeFromHistory, rating, credits, sleep, uuid, type Who } from "./_qa";

/* eslint-disable @typescript-eslint/no-explicit-any */
const OUT = join(process.cwd(), "docs/product/qa/fase66-multiplayer");
mkdirSync(OUT, { recursive: true });
const save = (name: string, data: unknown) => { writeFileSync(join(OUT, `${name}.api.json`), JSON.stringify({ at: new Date().toISOString(), ...(data as object) }, null, 2)); console.log(`→ ${name}.api.json`); };
const phase = process.argv[2] ?? "all";
const count = <T,>(xs: T[], f: (x: T) => boolean) => xs.filter(f).length;
const statuses = (rs: { status: number }[]) => rs.reduce<Record<string, number>>((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});

async function cleanQueue(...ws: Who[]) { for (const w of ws) await mm(w, { action: "cancel" }); }
async function liveMatchOf(w: Who): Promise<string | null> {
  const s = (await mm(w)).json;
  return s?.entry?.state === "MATCHED" ? s.entry.matchId : null;
}
/** Cierra (abandona) cualquier PvP vivo de estas cuentas para empezar limpio. */
async function closeLive(...ws: Who[]) {
  for (const w of ws) {
    const id = await liveMatchOf(w);
    if (!id) continue;
    const s = (await pvpGet(w, id)).json?.snapshot;
    if (s && !["FINISHED", "ABANDONED", "EXPIRED"].includes(s.lifecycle)) await api(w, "/api/game/duel/pvp", { action: "abandon", matchId: id });
  }
}

/* ───────────────────────── 1 · COLA ───────────────────────── */
async function queueSuite() {
  const A = await login("A"), A2 = await login("A"), B = await login("B"), C = await login("C");
  await closeLive(A, B, C); await cleanQueue(A, B, C);
  const [dA, dB, dC] = await Promise.all([validDeck(A), validDeck(B), validDeck(C)]);
  if (!dA || !dB || !dC) throw new Error("falta equipo válido en A/B/C");
  const ev: any = { accounts: { A: A.userId.slice(0, 8), B: B.userId.slice(0, 8), C: C.userId.slice(0, 8) } };

  // 1a · 10 JOIN concurrentes del mismo usuario → una entrada.
  const joins = await Promise.all(Array.from({ length: 10 }, () => mm(A, { action: "enqueue", deckId: dA.id })));
  const ids = new Set(joins.map((r) => r.json?.entry?.entryId).filter(Boolean));
  ev.duplicateJoin = { requests: 10, statuses: statuses(joins), distinctEntryIds: ids.size, codes: [...new Set(joins.map((r) => r.json?.code))], ok: ids.size === 1 };

  // 1b · segunda pestaña/sesión del mismo usuario → misma entrada; y nunca se empareja consigo mismo.
  const tab2 = await mm(A2, { action: "enqueue", deckId: dA.id });
  const polls: any[] = [];
  for (let i = 0; i < 6; i++) { const [p1, p2] = await Promise.all([mm(A), mm(A2)]); polls.push([p1.json?.entry?.state, p2.json?.entry?.state]); await sleep(1500); }
  ev.twoTabs = { sameEntry: tab2.json?.entry?.entryId === [...ids][0], states: polls, selfMatched: polls.some((p) => p.includes("MATCHED")), ok: tab2.json?.entry?.entryId === [...ids][0] && !polls.some((p) => p.includes("MATCHED")) };
  await mm(A, { action: "cancel" });

  // 1c · carrera JOIN/LEAVE ×8: el estado final es uno de los válidos y nunca hay dos entradas vivas.
  const races: any[] = [];
  for (let i = 0; i < 8; i++) {
    const [j, c] = await Promise.all([mm(A, { action: "enqueue", deckId: dA.id }), mm(A, { action: "cancel" })]);
    const st = (await mm(A)).json?.entry?.state ?? null;
    races.push({ join: j.status, cancel: c.status, final: st });
    await mm(A, { action: "cancel" });
  }
  ev.joinLeaveRace = { races, ok: races.every((r) => ["QUEUED", "CANCELLED", null].includes(r.final)) };

  // 1d · tres usuarios a la vez (10 sondeos concurrentes cada uno) → UNA partida para dos; el tercero sigue en cola; nadie en dos.
  await Promise.all([mm(A, { action: "enqueue", deckId: dA.id }), mm(B, { action: "enqueue", deckId: dB.id }), mm(C, { action: "enqueue", deckId: dC.id })]);
  await Promise.all([A, B, C].flatMap((w) => Array.from({ length: 4 }, () => mm(w))));
  let states: Record<string, any> = {};
  for (let i = 0; i < 10; i++) {
    const [sa, sb, sc] = await Promise.all([mm(A), mm(B), mm(C)]);
    states = { A: sa.json?.entry, B: sb.json?.entry, C: sc.json?.entry };
    if (Object.values(states).filter((e: any) => e?.state === "MATCHED").length >= 2) break;
    await sleep(1500);
  }
  const matched = Object.entries(states).filter(([, e]: any) => e?.state === "MATCHED");
  const matchIds = new Set(matched.map(([, e]: any) => e.matchId));
  ev.threeWay = {
    states: Object.fromEntries(Object.entries(states).map(([k, e]: any) => [k, e ? { state: e.state, matchId: e.matchId?.slice(0, 8) ?? null } : null])),
    matchedPlayers: matched.length, distinctMatches: matchIds.size, ok: matched.length === 2 && matchIds.size === 1,
  };
  // El tercero no queda en dos partidas: su estado sigue QUEUED. Se le saca.
  const leftover = Object.entries(states).find(([, e]: any) => e?.state !== "MATCHED")?.[0];
  if (leftover) await mm({ A, B, C }[leftover as "A" | "B" | "C"]!, { action: "cancel" });
  // 1e · ya en partida: volver a encolarse se rechaza (ACTIVE_MATCH), no crea una segunda.
  const who = matched.map(([k]) => ({ A, B, C })[k as "A" | "B" | "C"]!);
  if (who[0]) {
    const again = await mm(who[0], { action: "enqueue", deckId: (who[0] === A ? dA : who[0] === B ? dB : dC).id });
    ev.alreadyInMatch = { status: again.status, code: again.json?.code, ok: again.status === 409 && again.json?.code === "ACTIVE_MATCH" };
  }
  ev.matchForRanked = matchIds.size === 1 ? { id: [...matchIds][0], players: matched.map(([k]) => k) } : null;
  save("queue-concurrency", ev);
  return ev.matchForRanked as { id: string; players: string[] } | null;
}

/* ───────────────────────── 2 · PARTIDA RANKED (carreras, seguridad, resultado) ───────────────────────── */
async function rankedSuite(pre?: { id: string; players: string[] } | null) {
  const W: Record<string, Who> = { A: await login("A"), B: await login("B"), C: await login("C") };
  let m = pre;
  if (!m) {
    await closeLive(W.A, W.B); await cleanQueue(W.A, W.B, W.C);
    const [dA, dB] = await Promise.all([validDeck(W.A), validDeck(W.B)]);
    await mm(W.A, { action: "enqueue", deckId: dA!.id }); await mm(W.B, { action: "enqueue", deckId: dB!.id });
    for (let i = 0; i < 15 && !m; i++) { const [a, b] = await Promise.all([mm(W.A), mm(W.B)]); if (a.json?.entry?.state === "MATCHED" && b.json?.entry?.state === "MATCHED") m = { id: a.json.entry.matchId, players: ["A", "B"] }; else await sleep(1500); }
    if (!m) throw new Error("sin emparejamiento A-B");
  }
  const [p1, p2] = m.players.map((k) => W[k]);
  const outsider = Object.values(W).find((w) => w !== p1 && w !== p2)!;
  const id = m.id;
  const ratingBefore = { [p1.name]: await rating(p1), [p2.name]: await rating(p2) };
  const turn: any = {}, sec: any = {}, priv: any = {}, idem: any = {};

  const snapOf = async (w: Who) => (await pvpGet(w, id)).json?.snapshot;
  const actor = async () => { const [s1, s2] = await Promise.all([snapOf(p1), snapOf(p2)]); return s1?.isYourTurn ? { w: p1, s: s1 } : { w: p2, s: s2 }; };

  // 2a · PRIVACIDAD: la mano del rival no viaja; ni correos ni ids de usuario en el cable.
  const raw = await pvpGet(p1, id);
  const s1 = raw.json.snapshot;
  const rivalSnap = s1.yourSide === "A" ? s1.match.snapshotB : s1.match.snapshotA;
  const wire = JSON.stringify(raw.json);
  priv.rivalUnplayedCardsVisible = rivalSnap?.cards?.length ?? 0;
  priv.emailsOnWire = (wire.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? []).length;
  priv.rivalUserIdOnWire = wire.includes(p2.userId);
  priv.ownUserIdOnWire = wire.includes(p1.userId);
  priv.topLevelKeys = Object.keys(s1);
  priv.ok = priv.rivalUnplayedCardsVisible === 0 && priv.emailsOnWire === 0 && !priv.rivalUserIdOnWire;

  // 2b · IDOR y enumeración: un tercero no lee, no juega, no abandona, no ve el resultado; y un id inventado responde igual.
  const g = await pvpGet(outsider, id);
  const gOut = await pvpGet(outsider, id, "&outcome=1");
  const pl = await api(outsider, "/api/game/duel/pvp", { action: "play", matchId: id, actionId: uuid(), expectedVersion: s1.stateVersion, cardUid: uuid(), stat: "stronghold" });
  const ab = await api(outsider, "/api/game/duel/pvp", { action: "abandon", matchId: id });
  const fake = await pvpGet(outsider, uuid());
  const unauth = await api(null, `/api/game/duel/pvp?matchId=${id}`);
  const replayOther = await api(outsider, "/api/game/duel", { action: "replay", matchId: id });
  sec.idor = { get: g.status, outcome: gOut.status, play: pl.status, abandon: ab.status, inventedId: fake.status, noSession: unauth.status, replay: replayOther.status,
    bodies: { foreign: g.json, invented: fake.json },
    sameAnswerForForeignAndInvented: g.status === fake.status && JSON.stringify(g.json) === JSON.stringify(fake.json),
    ok: [g, gOut, pl, ab, fake, replayOther].every((r) => r.status === 404) && unauth.status === 401 && JSON.stringify(g.json) === JSON.stringify(fake.json) };

  // 2c · MANIPULACIÓN: campos falsos en una jugada legal; turno/versión futura; carta ajena; eje ilegal.
  let a = await actor();
  const mv = legalMove(a.s)!;
  const other = a.w === p1 ? p2 : p1;
  const otherSnap = await snapOf(other);
  const otherSide = otherSnap.yourSide as "A" | "B";
  const otherCard = (otherSide === "A" ? otherSnap.match.snapshotA : otherSnap.match.snapshotB).cards[0]?.uid;
  sec.tamper = {
    futureVersion: (await api(a.w, "/api/game/duel/pvp", { action: "play", matchId: id, actionId: uuid(), expectedVersion: a.s.stateVersion + 7, ...mv })).status,
    rivalCard: (await api(a.w, "/api/game/duel/pvp", { action: "play", matchId: id, actionId: uuid(), expectedVersion: a.s.stateVersion, cardUid: otherCard, stat: "stronghold" })).status,
    badStat: (await api(a.w, "/api/game/duel/pvp", { action: "play", matchId: id, actionId: uuid(), expectedVersion: a.s.stateVersion, cardUid: mv.cardUid, stat: "ovr" })).status,
    notYourTurn: (await api(other, "/api/game/duel/pvp", { action: "play", matchId: id, actionId: uuid(), expectedVersion: a.s.stateVersion, cardUid: otherCard, stat: "stronghold" })).status,
  };
  const forged = await api(a.w, "/api/game/duel/pvp", { action: "play", matchId: id, actionId: uuid(), expectedVersion: a.s.stateVersion, ...mv,
    winner: a.s.yourSide, score: 10, scoreA: 10, scoreB: 0, reward: { credits: 99999 }, ratingDelta: 500, newRating: 4999, ovr: 99, combat: { stronghold: 99 }, turn: 10, opponentId: outsider.userId, playerId: outsider.userId, side: "B" });
  const afterForged = forged.json?.snapshot;
  sec.tamper.forgedFieldsInLegalPlay = { status: forged.status, versionAdvancedByOne: afterForged?.stateVersion === a.s.stateVersion + 1, turnsResolved: afterForged?.match?.turns?.length ?? null, noResult: !afterForged?.match?.result };
  sec.tamper.ok = sec.tamper.futureVersion === 409 && sec.tamper.rivalCard === 409 && sec.tamper.badStat === 400 && sec.tamper.notYourTurn === 409 && forged.status === 200 && sec.tamper.forgedFieldsInLegalPlay.versionAdvancedByOne && sec.tamper.forgedFieldsInLegalPlay.noResult;

  // 2d · MISMO TURNO ×10 concurrente (Postgres real): una transición; el resto 409 con estado para resincronizar.
  a = await actor();
  const ten = await Promise.all(Array.from({ length: 10 }, (_, k) => api(a.w, "/api/game/duel/pvp", { action: "play", matchId: id, actionId: uuid(), expectedVersion: a.s.stateVersion, ...legalMove(a.s, k)! }, { noRetry: true })));
  const v1 = (await snapOf(a.w)).stateVersion;
  turn.sameTurnTen = { statuses: statuses(ten), ok200: count(ten, (r) => r.status === 200), conflictsWithState: count(ten, (r) => r.status === 409 && !!r.json?.sync), versionBefore: a.s.stateVersion, versionAfter: v1, ok: count(ten, (r) => r.status === 200) === 1 && v1 === a.s.stateVersion + 1 };

  // 2e · REINTENTO con la misma actionId ×5 concurrente + uno tardío: idempotente, una transición.
  a = await actor();
  const aid = uuid(); const mv2 = legalMove(a.s)!;
  const five = await Promise.all(Array.from({ length: 5 }, () => api(a.w, "/api/game/duel/pvp", { action: "play", matchId: id, actionId: aid, expectedVersion: a.s.stateVersion, ...mv2 }, { noRetry: true })));
  const late = await api(a.w, "/api/game/duel/pvp", { action: "play", matchId: id, actionId: aid, expectedVersion: a.s.stateVersion, ...mv2 });
  const v2 = (await snapOf(a.w)).stateVersion;
  idem.sameActionIdFive = { statuses: statuses(five), lateRetry: late.status, versionBefore: a.s.stateVersion, versionAfter: v2, ok: v2 === a.s.stateVersion + 1 && late.status === 200 && five.every((r) => r.status === 200 || r.status === 409) };

  // 2f · PESTAÑA VIEJA: misma cuenta, otra sesión, con la versión anterior → 409 + estado actual; la partida no se toca.
  a = await actor();
  const stale = await login(a.w.name === "A" ? "A" : a.w.name === "B" ? "B" : "C");
  const staleRes = await api(stale, "/api/game/duel/pvp", { action: "play", matchId: id, actionId: uuid(), expectedVersion: a.s.stateVersion - 1, ...legalMove(a.s)! });
  turn.staleTab = { status: staleRes.status, code: staleRes.json?.code, resyncVersion: staleRes.json?.sync?.stateVersion ?? null, current: a.s.stateVersion, ok: staleRes.status === 409 && staleRes.json?.sync?.stateVersion === a.s.stateVersion };
  // Fuera de orden: la N+1 llega antes que la N (dos acciones del mismo jugador, versiones v y v+1, en orden inverso).
  const oo1 = await api(a.w, "/api/game/duel/pvp", { action: "play", matchId: id, actionId: uuid(), expectedVersion: a.s.stateVersion + 1, ...legalMove(a.s, 1)! });
  const oo0 = await api(a.w, "/api/game/duel/pvp", { action: "play", matchId: id, actionId: uuid(), expectedVersion: a.s.stateVersion, ...legalMove(a.s, 0)! });
  turn.outOfOrder = { futureFirst: oo1.status, thenCurrent: oo0.status, ok: oo1.status === 409 && oo0.status === 200 };

  // 2g · jugar el resto hasta el final alternando jugadores, comprobando CONSISTENCIA de hechos públicos tras cada turno.
  const consistency: any[] = [];
  for (let i = 0; i < 60; i++) {
    const [x, y] = await Promise.all([snapOf(p1), snapOf(p2)]);
    const fx = publicFacts(x), fy = publicFacts(y);
    consistency.push({ v: fx?.version, same: JSON.stringify(fx) === JSON.stringify(fy) });
    if (["FINISHED", "ABANDONED", "EXPIRED"].includes(x.lifecycle)) break;
    const w = x.isYourTurn ? p1 : y.isYourTurn ? p2 : null;
    if (!w) { await sleep(500); continue; }
    const s = w === p1 ? x : y;
    await api(w, "/api/game/duel/pvp", { action: "play", matchId: id, actionId: uuid(), expectedVersion: s.stateVersion, ...legalMove(s)! });
  }
  turn.consistencyEveryTurn = { checks: consistency.length, allSame: consistency.every((c) => c.same), ok: consistency.every((c) => c.same) };

  // 2h · RESULTADO: autoridad, recálculo, exactamente una vez (10 lecturas de resultado y 10 abandonos concurrentes tras terminar).
  const fin1 = await pvpGet(p1, id, "&outcome=1"), fin2 = await pvpGet(p2, id, "&outcome=1");
  const r1 = fin1.json.snapshot.match.result, r2 = fin2.json.snapshot.match.result;
  const reads = await Promise.all(Array.from({ length: 10 }, (_, k) => pvpGet(k % 2 ? p2 : p1, id, "&outcome=1")));
  const abandons = await Promise.all(Array.from({ length: 10 }, (_, k) => api(k % 2 ? p2 : p1, "/api/game/duel/pvp", { action: "abandon", matchId: id }, { noRetry: true })));
  const ratingAfter = { [p1.name]: await rating(p1), [p2.name]: await rating(p2) };
  const out1 = fin1.json.outcome, out2 = fin2.json.outcome;
  const result = {
    lifecycle: fin1.json.snapshot.lifecycle, sameResultBothSides: JSON.stringify(r1?.combat) === JSON.stringify(r2?.combat),
    recomputed: recomputeFromHistory(r1), finishedAbandonAttempts: statuses(abandons),
    outcomeReadsIdentical: reads.every((r) => JSON.stringify(r.json.outcome) === JSON.stringify((r.json.snapshot.yourSide === fin1.json.snapshot.yourSide ? fin1 : fin2).json.outcome)),
  };
  const elo = {
    before: ratingBefore, after: ratingAfter, outcome: { [p1.name]: out1, [p2.name]: out2 },
    appliedOnce: out1 && out2 ? ratingAfter[p1.name].rating - ratingBefore[p1.name].rating === out1.delta && ratingAfter[p2.name].rating - ratingBefore[p2.name].rating === out2.delta && ratingAfter[p1.name].games === ratingBefore[p1.name].games! + 1 : null,
    zeroSum: out1 && out2 ? out1.delta + out2.delta : null,
  };
  save("turn-concurrency", { matchId: id.slice(0, 8), ...turn });
  save("idempotency", idem);
  save("security", sec);
  save("privacy", priv);
  save("result-integrity", { ...result, ok: result.sameResultBothSides && result.recomputed?.agrees && Object.keys(result.finishedAbandonAttempts).every((k) => k === "409") });
  save("elo-integrity", { ...elo, ok: elo.appliedOnce === true });
}

/* ───────────────────────── 3 · PvE (carrera F65, reintento, F5, pago una vez) ───────────────────────── */
async function pveSuite() {
  const W = await login("C");
  const deck = await validDeck(W);
  const act = (await api(W, "/api/game/duel", { action: "active" })).json?.view;
  if (act?.matchId) await api(W, "/api/game/duel", { action: "abandon", matchId: act.matchId });
  const before = await credits(W);
  const s = await api(W, "/api/game/duel", { action: "start", deckId: deck!.id, difficulty: "EASY" });
  let v = s.json.view;
  const ev: any = { account: W.userId.slice(0, 8), matchId: v.matchId.slice(0, 8), creditsBefore: before };
  // F67 · como el cliente real: la jugada lleva la versión de la vista que la originó.
  const mv = (view: any, k = 0) => { const c = view.yourHand[k % view.yourHand.length]; return { cardUid: c.uid, ...(view.youAreAttacker ? { stat: "stronghold" } : {}), ...(typeof view.stateVersion === "number" ? { expectedVersion: view.stateVersion } : {}) }; };

  // 3a · la carrera de F65: diez jugadas del mismo turno a la vez → UNA.
  const ten = await Promise.all(Array.from({ length: 10 }, (_, k) => api(W, "/api/game/duel", { action: "play", matchId: v.matchId, ...mv(v, k) })));
  const st = (await api(W, "/api/game/duel", { action: "state", matchId: v.matchId })).json.view;
  ev.sameTurnTen = { statuses: statuses(ten), historyBefore: v.history.length, historyAfter: st.history.length, conflictCarriesView: ten.filter((r) => r.status === 409).every((r) => !!r.json?.view), ok: count(ten, (r) => r.status === 200) === 1 && st.history.length === v.history.length + 1 };
  v = st;
  // 3b · respuesta perdida: el cliente aborta el fetch enseguida; luego lee el estado. La jugada, si se procesó, está UNA vez.
  const ctrl = new AbortController();
  const hist0 = v.history.length;
  const pending = api(W, "/api/game/duel", { action: "play", matchId: v.matchId, ...mv(v) }, { signal: ctrl.signal }).catch((e) => ({ status: 0, json: String(e) }));
  setTimeout(() => ctrl.abort(), 30);
  await pending; await sleep(1500);
  const afterLost = (await api(W, "/api/game/duel", { action: "state", matchId: v.matchId })).json.view;
  const retry = await api(W, "/api/game/duel", { action: "play", matchId: v.matchId, ...mv(v) });
  const afterRetry = (await api(W, "/api/game/duel", { action: "state", matchId: v.matchId })).json.view;
  ev.lostResponseRetry = { historyBefore: hist0, afterAbort: afterLost.history.length, retryStatus: retry.status, afterRetry: afterRetry.history.length, ok: afterRetry.history.length <= hist0 + 1 || (afterLost.history.length === hist0 && afterRetry.history.length === hist0 + 1) };
  v = afterRetry;
  // 3c · F5 = `active`: la misma partida, no otra.
  const f5 = (await api(W, "/api/game/duel", { action: "active" })).json.view;
  ev.refresh = { sameMatch: f5?.matchId === v.matchId, sameTurn: f5?.turn === v.turn, ok: f5?.matchId === v.matchId };
  // 3d · terminar y pagar UNA vez aunque se lean/reintenten cosas en paralelo.
  for (let k = 0; k < 30 && !v.result; k++) { const r = await api(W, "/api/game/duel", { action: "play", matchId: v.matchId, ...mv(v) }); if (r.status === 200) v = r.json.view; else v = (await api(W, "/api/game/duel", { action: "state", matchId: v.matchId })).json.view; }
  const lastCard = v.yourUsed?.[0]?.uid;
  const post = await Promise.all([
    ...Array.from({ length: 5 }, () => api(W, "/api/game/duel", { action: "state", matchId: v.matchId })),
    ...Array.from({ length: 5 }, () => api(W, "/api/game/duel", { action: "play", matchId: v.matchId, cardUid: lastCard ?? uuid(), stat: "stronghold" })),
    ...Array.from({ length: 3 }, () => api(W, "/api/game/duel", { action: "abandon", matchId: v.matchId })),
  ]);
  const after = await credits(W);
  const award = v.result?.award?.credits ?? 0;
  const replay = await api(W, "/api/game/duel", { action: "replay", matchId: v.matchId });
  ev.finish = { result: v.result ? { winner: v.result.winner, score: `${v.result.scoreYou}-${v.result.scoreRival}`, decidedBy: v.result.decidedBy, award: v.result.award } : null,
    postFinishStatuses: statuses(post), creditsAfter: after, creditsDelta: after.credits - before.credits, awardCredits: award, replayStillThere: replay.status === 200,
    ok: after.credits - before.credits === award && replay.status === 200 };
  save("reward-integrity", { pve: ev, ok: ev.sameTurnTen.ok && ev.lostResponseRetry.ok && ev.refresh.ok && ev.finish.ok });
}

/* ───────────────────────── 4 · límites de frecuencia ───────────────────────── */
async function rateSuite() {
  const W = await login("C");
  const bursts: any = {};
  const r = await Promise.all(Array.from({ length: 60 }, () => mm(W, undefined)));
  bursts.mmStatus60 = statuses(r);
  save("rate-limits", { bursts, note: "60 sondeos de cola simultáneos de un usuario: la cubeta mm_status (90/min) no corta un uso normal; el abuso sostenido sí (Retry-After)." });
}

(async () => {
  if (phase === "queue" || phase === "all") { const m = await queueSuite(); if (phase === "all") await rankedSuite(m); }
  if (phase === "ranked") await rankedSuite();
  if (phase === "pve" || phase === "all") await pveSuite();
  if (phase === "rate" || phase === "all") await rateSuite();
})().catch((e) => { console.error("SUITE FALLÓ:", e); process.exit(1); });
