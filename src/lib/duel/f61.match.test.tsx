/**
 * FASE 61 · GAMEPLAY 5.0 · THE MATCH — invariantes, ritmo, autoridad, idempotencia y recuperación.
 *
 *   MOTOR    · la presentación no altera resultados: huella dorada de 120 partidas del motor puro, determinismo y
 *              funciones de `matchFlow` que no mutan (entradas congeladas).
 *   UI       · entrada (rival → VS → equipo), rol, eje revelado, veredicto de turno, marcador, línea de turnos,
 *              desempate, golpe final y resultado; con cartas REALES del catálogo (`qaSimulation`).
 *   AUTORIDAD· el cliente no decide ganador, eje del defensor, punto ni recompensa.
 *   IDEMPOT. · refresh, doble clic, respuesta repetida y recarga del resultado no duplican turno, punto, pago ni rating.
 *   RECUPER. · F5 en pre-partida, a mitad de turno, tras el turno y en el resultado recupera un estado coherente.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { qaSnapshot, qaSimulate, qaView } from "./qaSimulation";
import {
  ENTRANCE_MS, ENTRANCE_ORDER, MOMENT_BEATS, TIEBREAK_STEP_MS, CLIMAX_LABEL,
  climaxLevel, endSequence, entranceBeatAt, entranceCopy, entranceTimeline, leaveConsequence, lineupSummary,
  momentBeats, momentHoldMs, roleBanner, shouldPlayEntrance, statReveal, tiebreakPlan,
} from "./matchFlow";
import { INTRO_MS, introDuration } from "./gameplayUx";
import { buildTimeline, decisionSteps } from "./experience";
import { STAT_INFO, type DuelMatchView, type DuelResultView } from "./types";
import { MatchIntro } from "@/components/duel/MatchIntro";
import { DuelMoment } from "@/components/duel/DuelMoment";
import { MatchComplete } from "@/components/duel/MatchComplete";
import { MatchBoard } from "@/components/duel/MatchBoard";
import { ResultScreen } from "@/components/duel/ResultScreen";
import { TiebreakReveal } from "@/components/duel/experience/TiebreakReveal";
import { LeaveMatchDialog } from "@/components/duel/experience/LeaveMatchDialog";
import { MatchEnding } from "@/components/duel/experience/MatchEnding";
import { getCard } from "@/data/catalog";
import { SOUND_EVENTS } from "@/lib/sound";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const html = (n: React.ReactElement) => renderToStaticMarkup(n);
const noop = () => {};

const mine = qaSnapshot(0, "qa-you", "Mi equipo");
const rival = qaSnapshot(1, "qa-rival", "Rival");
const mirror = qaSnapshot(0, "qa-mirror", "Espejo");

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o as object)) deepFreeze(v); }
  return o;
}

/* Vistas reales (motor puro + cartas del catálogo). */
const start = qaView(qaSimulate(mine, rival, 0, "A"));
const defense = qaView(qaSimulate(mine, rival, 0, "B"));
const full = Array.from({ length: 120 }, (_, i) => qaSimulate(mine, rival, 10, (i + 1) % 2 ? "A" : "B", i + 1));
const winM = full.find((m) => m.result?.winner === "A" && m.result.combat.decidedBy === "SCORE")!;
const lossM = full.find((m) => m.result?.winner === "B" && m.result.combat.decidedBy === "SCORE")!;
const ovrM = full.find((m) => m.result?.combat.decidedBy === "OVR_TIEBREAK")!;
const mirrors = Array.from({ length: 300 }, (_, i) => qaSimulate(mine, mirror, 10, (i + 1) % 2 ? "A" : "B", i + 1));
const drawM = mirrors.find((m) => m.result?.isDraw) ?? null;
const statM = [...mirrors, ...full].find((m) => m.result?.combat.decidedBy === "STAT_MARGIN") ?? null;
const win = qaView(winM);
const loss = qaView(lossM);
const ovr = qaView(ovrM);
const turnAt = (want: "A" | "B" | "TIE"): DuelMatchView | null => {
  for (let seed = 1; seed <= 120; seed++) for (let n = 2; n <= 7; n++) {
    const v = qaView(qaSimulate(mine, rival, n, seed % 2 ? "A" : "B", seed));
    if (v.lastTurn?.outcome === want) return v;
  }
  return null;
};
const winAt = turnAt("A")!;
const loseAt = turnAt("B")!;
const tieAt = turnAt("TIE");
const findCard = (v: DuelMatchView, uid: string) => [...v.yourHand, ...v.yourUsed, ...v.rivalUsed].find((c) => c.uid === uid)!;

/* ═══════════════════════ MOTOR · la presentación no altera resultados ═══════════════════════ */

/**
 * HUELLA DORADA DEL MOTOR, medida el 2026-09-25 ANTES de tocar nada de F61 (motor con fecha 2026-09-03, intacto):
 * 120 partidas del motor puro (mismos mazos reales, mismas semillas) → marcador, nivel que decidió, ganador, turnos
 * empatados, totales y los diez enfrentamientos (ejes, valores y resultado). Si esto cambia, cambió el JUEGO.
 *
 * DUEL GAMEPLAY UX 2.0 (2026-10-06) · nueva huella, CAMBIO DELIBERADO: el bot que defiende ya no conoce el valor de la
 * carta comprometida del atacante (`attackerValue: null`, información oculta simétrica). Reglas, reparto, puntuación y
 * desempates del motor no cambian; con el controlador anterior la huella vieja (590d2997…) se reproduce intacta.
 */
const ENGINE_DIGEST = "9a93fd520eebe3ca618587701812b8e68f9d88c07648581f361c43bce1dfb5f3";

test("F61 MOTOR 01 · huella dorada: mismas entradas y semillas ⇒ mismos resultados que antes de F61", () => {
  const rows = full.map((m, i) => {
    const c = m.result!.combat;
    return [i + 1, c.scoreA, c.scoreB, c.decidedBy, c.winner, c.tiedEncounters, c.statTotalA, c.statTotalB,
      c.encounters.map((e) => `${e.a.stat[0]}${e.a.value}${e.b.stat[0]}${e.b.value}${e.outcome}`).join(",")];
  });
  assert.equal(createHash("sha256").update(JSON.stringify(rows)).digest("hex"), ENGINE_DIGEST);
});

test("F61 MOTOR 02 · determinismo: la misma partida simulada dos veces da el mismo resultado", () => {
  for (const seed of [3, 17, 42, 99]) {
    const a = qaSimulate(mine, rival, 10, "A", seed);
    const b = qaSimulate(mine, rival, 10, "A", seed);
    assert.deepEqual(a.result, b.result);
  }
});

test("F61 MOTOR 03 · la capa de presentación no muta la vista del servidor (entradas congeladas)", () => {
  const v = deepFreeze(structuredClone(ovr));
  const before = JSON.stringify(v);
  lineupSummary(v.yourUsed); roleBanner(v); climaxLevel(v.turn, v.totalTurns); statReveal(v.lastTurn);
  tiebreakPlan(v.result, false); endSequence(v.result, true); shouldPlayEntrance(v);
  entranceCopy("quick", v, "Normal", "Normal"); buildTimeline(v); decisionSteps(v.result!);
  assert.equal(JSON.stringify(v), before);
});

test("F61 MOTOR 04 · las reglas reales leídas del código: 10 turnos, empate de turno sin punto, OVR +1, estadística sin punto", () => {
  const rules = read("src", "domain", "cardgame", "combat", "rules.ts");
  assert.match(rules, /version: "duel-combat-2",\s*encounterTie: "NO_POINT",\s*finalTiebreak: "STAT_MARGIN",\s*terminal: "DRAW"/);
  assert.equal(start.totalTurns, 10);
  // Un turno empatado no suma a nadie.
  const tieTurns = full.flatMap((m) => m.result!.combat.encounters.filter((e) => e.outcome === "TIE"));
  if (tieTurns.length) for (const m of full) {
    const c = m.result!.combat;
    const wins = { A: c.encounters.filter((e) => e.outcome === "A").length, B: c.encounters.filter((e) => e.outcome === "B").length };
    const bonus = c.decidedBy === "OVR_TIEBREAK" ? 1 : 0;
    assert.equal(c.scoreA + c.scoreB, wins.A + wins.B + bonus, "el desempate por OVR añade exactamente un punto");
  }
  // El desempate por OVR se ve en la vista: marcador final = empate + 1.
  const r = ovr.result!;
  assert.equal(r.decidedBy, "OVR_TIEBREAK");
  assert.equal(Math.abs(r.scoreYou - r.scoreRival), 1);
});

test("F61 MOTOR 05 · matchFlow no toca reloj, azar, red ni almacenamiento", () => {
  const src = code(read("src", "lib", "duel", "matchFlow.ts"));
  for (const f of ["Math.random", "Date.now", "fetch(", "localStorage", "window.", "resolveCombat", "createDuelBot", "selectAttackerStat"]) {
    assert.ok(!src.includes(f), f);
  }
});

/* ═══════════════════════ UI · entrada ═══════════════════════ */

test("F61 UI 01 · la entrada dura 2–5 s, suma tres tiempos y el modo reducido conserva los tres (legibles)", () => {
  assert.deepEqual(ENTRANCE_ORDER, ["FOUND", "VERSUS", "LINEUP"]);
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  assert.equal(INTRO_MS.full, sum(ENTRANCE_MS.full));
  assert.equal(INTRO_MS.reduced, sum(ENTRANCE_MS.reduced));
  assert.ok(INTRO_MS.full >= 2000 && INTRO_MS.full <= 5000);
  assert.ok(INTRO_MS.reduced >= 1500 && INTRO_MS.reduced <= INTRO_MS.full);
  for (const b of ENTRANCE_ORDER) assert.ok(ENTRANCE_MS.reduced[b] >= 600, `${b} legible en reducido`);
  assert.equal(introDuration(false), entranceTimeline(false).total);
  assert.equal(entranceBeatAt(0, false), "FOUND");
  assert.equal(entranceBeatAt(ENTRANCE_MS.full.FOUND, false), "VERSUS");
  assert.equal(entranceBeatAt(INTRO_MS.full, false), "DONE");
  assert.equal(entranceTimeline(false, "LINEUP").total, ENTRANCE_MS.full.LINEUP, "ranked entra directo al equipo");
});

test("F61 UI 02 · MATCH FOUND: bot = «Rival preparado» sin nombre inventado; persona = «Rival encontrado · Jugador real»", () => {
  const bot = html(<MatchIntro view={start} rivalName="Normal" onDone={noop} />);
  assert.match(bot, /data-scene="intro"/);
  assert.match(bot, /data-beat="FOUND"/);
  assert.match(bot, />Rival preparado</);
  assert.match(bot, />Bot</);
  assert.match(bot, /Dificultad Normal/);
  const ranked = html(<MatchIntro view={start} rivalName="RivalReal" mode="ranked" rivalAvatar="🦊" onDone={noop} />);
  assert.match(ranked, />Rival encontrado</);
  assert.match(ranked, /Jugador real/);
  assert.ok(!/Diamante|Oro|Platino|Inmortal|Radiant|Rango/i.test(ranked), "sin rango inventado");
  assert.match(bot, /Saltar/);
});

test("F61 UI 03 · VS: tu equipo contra el rival, con la fuerza REAL de la vista y quién abre", () => {
  const h = html(<MatchIntro view={start} rivalName="Normal" from="VERSUS" onDone={noop} />);
  assert.match(h, /data-beat="VERSUS"/);
  assert.match(h, new RegExp(`>${start.yourSumOvr}<`));
  assert.match(h, new RegExp(`>${start.rivalSumOvr}<`));
  assert.match(h, /Abres tú: atacas en el turno 1/);
  const d = html(<MatchIntro view={defense} rivalName="Normal" from="VERSUS" onDone={noop} />);
  assert.match(d, /Abre el rival: defiendes en el turno 1/);
});

test("F61 UI 04 · EQUIPO: las diez cartas REALES (arte del catálogo, CardArt) por rol; el rival solo como número", () => {
  const h = html(<MatchIntro view={start} rivalName="Normal" from="LINEUP" onDone={noop} />);
  assert.match(h, /data-beat="LINEUP"/);
  assert.equal((h.match(/nx-f61-lineup-card/g) ?? []).length, 10);
  for (const c of start.yourHand) {
    const img = getCard(c.cardId)?.image;
    assert.ok(img && h.includes(img), `arte real de ${c.nick}`);
  }
  assert.match(h, /data-testid="intro-rival-backs"/);
  assert.match(h, /Equipo rival: 10 cartas ocultas/);
  const l = lineupSummary(start.yourHand);
  assert.equal(l.cards.length, 10);
  assert.equal(l.stars.length, 3);
  assert.equal(l.sumOvr, start.yourSumOvr);
  assert.deepEqual(l.roles.map((r) => r.count), [2, 2, 2, 2, 2]);
});

test("F61 UI 05 · la entrada solo en partida recién creada: nunca al recargar a mitad ni en el resultado", () => {
  assert.equal(shouldPlayEntrance(start), true);
  assert.equal(shouldPlayEntrance(winAt), false);
  assert.equal(shouldPlayEntrance(win), false);
  assert.equal(shouldPlayEntrance(null), false);
});

/* ═══════════════════════ UI · campo y turno ═══════════════════════ */

test("F61 UI 06 · ATACAS / DEFIENDES con icono y texto (no solo color), y ESPERANDO AL RIVAL en PvP", () => {
  assert.deepEqual(roleBanner(start), { kind: "ATTACK", title: "Atacas", sub: "Elige carta y estadística" });
  const d = roleBanner(defense);
  assert.equal(d.kind, "DEFENSE");
  assert.equal(d.sub, `Respondes con ${STAT_INFO[defense.requiredStat!].label}`);
  assert.equal(roleBanner(start, true).kind, "WAIT");
  assert.equal(roleBanner(win).kind, "NONE");
  const a = html(<MatchBoard view={start} onPlay={noop} busy={false} error={null} onDismissError={noop} hudInTopBar />);
  assert.match(a, /data-testid="role-banner" data-role="ATTACK"/);
  assert.match(a, /data-role-icon="ATTACK"/);
  const b = html(<MatchBoard view={defense} onPlay={noop} busy={false} error={null} onDismissError={noop} hudInTopBar />);
  assert.match(b, /data-testid="role-banner" data-role="DEFENSE"/);
  const w = html(<MatchBoard view={start} onPlay={noop} busy error={null} onDismissError={noop} waitingRival />);
  assert.match(w, /data-role="WAIT"[\s\S]*Esperando al rival/);
});

test("F61 UI 07 · revelación: el EJE antes que las cifras, las cifras antes del veredicto (con y sin movimiento)", () => {
  for (const reduced of [false, true]) {
    const b = momentBeats(reduced);
    assert.ok(b.cards < b.stat && b.stat < b.values && b.values < b.compare && b.compare <= b.verdict, JSON.stringify(b));
    assert.ok(b.verdict * 1000 < momentHoldMs("NORMAL", reduced) - 1200, "queda tiempo para leer el veredicto");
  }
  assert.ok(MOMENT_BEATS.reduced.verdict < MOMENT_BEATS.full.verdict);
  const t = winAt.lastTurn!;
  const s = statReveal(t)!;
  assert.equal(s.attacker, t.attacker === "A" ? "YOU" : "RIVAL");
  assert.equal(s.declared, t.attacker === "A" ? t.you.stat : t.rival.stat);
  const h = html(<DuelMoment turn={t} yourCard={findCard(winAt, t.you.uid)} rivalCard={findCard(winAt, t.rival.uid)} totalTurns={10} onClose={noop} />);
  assert.match(h, /data-testid="moment-axis"/);
  assert.match(h, new RegExp(s.declaredLabel));
  assert.match(h, /data-testid="moment-header"/);
  assert.match(h, t.attacker === "A" ? /Atacas tú/ : /Defiendes/);
});

test("F61 UI 08 · turno ganado / perdido / empatado: el veredicto es el `outcome` del servidor, y el empate no da punto", () => {
  const cases: [DuelMatchView | null, RegExp][] = [[winAt, /PUNTO PARA TI/], [loseAt, /PUNTO PARA EL RIVAL/], [tieAt, /EMPATE/]];
  for (const [v, re] of cases) {
    if (!v) continue;
    const t = v.lastTurn!;
    const h = html(<DuelMoment turn={t} yourCard={findCard(v, t.you.uid)} rivalCard={findCard(v, t.rival.uid)} totalTurns={10} onClose={noop} />);
    assert.match(h, re);
    assert.match(h, new RegExp(`data-outcome="${t.outcome}"`));
    assert.match(h, /data-testid="moment-score"/);
  }
  if (tieAt) {
    const t = tieAt.lastTurn!;
    const prev = tieAt.history[tieAt.history.length - 2];
    assert.equal(t.scoreAfterYou, prev ? prev.scoreAfterYou : 0);
    assert.equal(t.scoreAfterRival, prev ? prev.scoreAfterRival : 0);
  }
});

test("F61 UI 09 · marcador y línea de turnos: «turno N de 10», marcas por turno y cuánto falta", () => {
  const cells = buildTimeline(winAt);
  assert.equal(cells.length, 10);
  assert.equal(cells.filter((c) => c.state === "WIN" || c.state === "LOSS" || c.state === "DRAW").length, winAt.history.length);
  assert.equal(cells.filter((c) => c.state === "PENDING").length + 1, 10 - winAt.history.length);
});

test("F61 UI 10 · clímax: recta final (8–9) y último turno (10), sin tocar nada del servidor", () => {
  assert.equal(climaxLevel(1, 10), "NORMAL");
  assert.equal(climaxLevel(8, 10), "LATE");
  assert.equal(climaxLevel(9, 10), "LATE");
  assert.equal(climaxLevel(10, 10), "FINAL");
  assert.equal(CLIMAX_LABEL.FINAL, "Último turno");
  assert.ok(momentHoldMs("FINAL", false) > momentHoldMs("NORMAL", false));
  const late = qaView(qaSimulate(mine, rival, 7, "A", 7));
  const h = html(<MatchBoard view={late} onPlay={noop} busy={false} error={null} onDismissError={noop} hudInTopBar />);
  assert.match(h, /data-climax="LATE"/);
  const t = win.history[9];
  const m = html(<DuelMoment turn={t} yourCard={findCard(win, t.you.uid)} rivalCard={findCard(win, t.rival.uid)} totalTurns={10} onClose={noop} />);
  assert.match(m, /data-climax="FINAL"[\s\S]*Último turno/);
});

/* ═══════════════════════ UI · final ═══════════════════════ */

test("F61 UI 11 · desempate por OVR en escena: empate de turnos → suma de OVR (+1), cifras del servidor", () => {
  const p = tiebreakPlan(ovr.result, false)!;
  assert.equal(p.bonusPoint, true);
  assert.deepEqual(p.steps.map((s) => s.key), ["SCORE", "OVR"]);
  assert.equal(p.totalMs, TIEBREAK_STEP_MS.full * 3);
  const h = html(<TiebreakReveal result={ovr.result!} onDone={noop} />);
  assert.match(h, /data-scene="tiebreak" data-decided="OVR_TIEBREAK"/);
  assert.match(h, />Desempate</);
  assert.match(h, /data-step="SCORE"/);
});

test("F61 UI 12 · desempate por estadística (sin punto) y empate total: los pasos que de verdad se aplicaron", () => {
  const stat = statM ? qaView(statM).result! : ({ ...win.result!, decidedBy: "STAT_MARGIN", scoreYou: 5, scoreRival: 5 } as DuelResultView);
  assert.deepEqual(tiebreakPlan(stat, true)!.steps.map((s) => s.key), ["SCORE", "OVR", "STAT_TOTAL"]);
  assert.equal(tiebreakPlan(stat, true)!.bonusPoint, false);
  const none = drawM ? qaView(drawM).result! : ({ ...win.result!, decidedBy: "NONE", winner: null, isDraw: true } as DuelResultView);
  const pn = tiebreakPlan(none, false)!;
  assert.equal(pn.title, "Empate total");
  assert.match(html(<TiebreakReveal result={none} onDone={noop} />), />Empate total</);
  assert.equal(tiebreakPlan(win.result, false), null, "una victoria por turnos no se disfraza de final ajustado");
});

test("F61 UI 13 · secuencia de final: desempate solo si hizo falta y solo si se vio en directo", () => {
  assert.deepEqual(endSequence(win.result, true), ["COMPLETE"]);
  assert.deepEqual(endSequence(ovr.result, true), ["TIEBREAK", "COMPLETE"]);
  assert.deepEqual(endSequence(ovr.result, false), [], "recargar el resultado no reescenifica nada");
  assert.deepEqual(endSequence(null, true), []);
});

test("F61 UI 14 · VICTORIA / DERROTA / EMPATE con el marcador final", () => {
  assert.match(html(<MatchComplete result={win.result!} onDone={noop} />), /data-verdict="WIN"[\s\S]*>VICTORIA</);
  assert.match(html(<MatchComplete result={loss.result!} onDone={noop} />), /data-verdict="LOSS"[\s\S]*>DERROTA</);
  if (drawM) assert.match(html(<MatchComplete result={qaView(drawM).result!} onDone={noop} />), /data-verdict="DRAW"[\s\S]*>EMPATE</);
});

test("F61 UI 15 · resultado (RESULTADO ÚNICO): JUGAR OTRA, VER PARTIDA y VOLVER AL LOBBY; recompensas del servidor en una línea", () => {
  const paid = { ...win, result: { ...win.result!, rewards: { matchId: win.matchId, capped: false, grants: [{ source: "MATCH" as const, reward: { credits: win.result!.award!.credits, xp: win.result!.award!.xp }, points: 0 }] } } };
  const h = html(<ResultScreen view={paid} xp={1200} onPlayAgain={noop} onDecks={noop} onReplay={noop} onChange={noop} />);
  const actions = h.slice(h.indexOf('data-testid="result-actions"'));
  assert.match(actions, /Jugar otra/);
  assert.match(actions, /Ver partida/);
  assert.ok(!/Cambiar rival o equipo|Mis equipos|Salir a Duelos/.test(actions), "sin acciones de más");
  assert.equal((actions.match(/<(a|button)\b/g) ?? []).length, 3);
  assert.match(h, /href="\/"[^>]*>Volver al lobby/);
  assert.match(h, /data-field="credits"/);
  assert.match(h, new RegExp(`\\+${win.result!.award!.credits}`));
  // Draft: la acción principal es la suya, no «Jugar otra».
  const d = html(<ResultScreen view={win} onPlayAgain={noop} onDecks={noop} onReplay={noop} playAgainLabel="Volver al gauntlet" mode="DRAFT_GAUNTLET" />);
  assert.ok(!/Jugar otra/.test(d.slice(d.indexOf('data-testid="result-actions"'))));
});

test("F61 UI 16 · final PvP vivido: último turno → (desempate) → golpe final, sin pedir nada", () => {
  const h = html(<MatchEnding view={win} />);
  assert.match(h, /data-f61="moment"/, "empieza por la revelación del último turno");
  const src = code(read("src", "components", "duel", "experience", "MatchEnding.tsx"));
  assert.ok(!/fetch\(|playDuelTurn|abandon/.test(src));
});

/* ═══════════════════════ SALIR ═══════════════════════ */

test("F61 SALIR 01 · la consecuencia REAL por modo (sin penalizaciones inventadas)", () => {
  const pve = leaveConsequence("quick");
  assert.match(pve.abandon!.note, /no cuenta ni da recompensa/);
  assert.match(pve.abandon!.note, /Sin penalización/);
  assert.match(pve.keep!.note, /Continuar partida/);
  assert.equal(leaveConsequence("draft").abandon, null, "en draft no se abandona desde la arena");
  assert.match(leaveConsequence("ranked").abandon!.note, /derrota/);
  assert.match(leaveConsequence("private").abandon!.note, /sin rating/);
  assert.match(leaveConsequence("campaign").abandon!.note, /reintentar/);
  // El abandono PvE borra la fila: no hay partida que cobrar (servidor).
  const duels = code(read("src", "server", "services", "duels.ts"));
  assert.match(duels, /from\("duel_matches"\)\.delete\(\)\.eq\("id", matchId\)\.eq\("user_id", userId\)/);
  const h = html(<LeaveMatchDialog open consequence={pve} onStay={noop} onKeep={noop} onAbandon={noop} />);
  assert.match(h, /role="alertdialog"/);
  assert.match(h, /data-testid="leave-stay"[\s\S]*Seguir jugando/);
  assert.match(h, /data-testid="leave-keep"/);
  assert.match(h, /data-testid="leave-abandon"/);
});

test("F61 SALIR 02 · «Salir» ya no abandona de un clic y el botón Atrás abre el diálogo (PvE y PvP)", () => {
  const page = read("src", "app", "duelos", "jugar", "page.tsx");
  assert.ok(page.includes("onQuit={openLeave}"), "la barra abre el diálogo");
  assert.ok(page.includes("useLeaveGuard((stage === \"match\" || stage === \"intro\")"), "Atrás protegido en partida");
  const arena = read("src", "components", "duel", "pvp", "PvpArena.tsx");
  assert.ok(arena.includes("useLeaveGuard(enJuego, abrirSalida);"));
  const guard = code(read("src", "lib", "duel", "useLeaveGuard.ts"));
  assert.ok(guard.includes("...prev, nxMatchGuard: true"), "conserva el estado del router de Next");
  assert.ok(!/abandon|fetch\(/.test(guard), "la guarda no abandona ni llama a nadie");
});

test("F61 SALIR 03 · modo partida enfocado: PvE y PvP sin armazón, y cada estado PvP con su salida", async () => {
  const { isImmersive } = await import("@/design/nav");
  assert.ok(isImmersive("/duelos/jugar") && isImmersive("/duelos/pvp"));
  assert.ok(!isImmersive("/competitivo") && !isImmersive("/duelos"), "los centros siguen con su armazón");
  const page = read("src", "app", "duelos", "pvp", "page.tsx");
  assert.ok(page.includes('<ExitLink href="/competitivo" label={t("Volver a Competitivo")} />'), "antesala y error con salida");
  const arena = read("src", "components", "duel", "pvp", "PvpArena.tsx");
  assert.ok(arena.includes('data-testid="pvp-leave">{t("Salir")}</NxButton>'), "la partida con «Salir» → diálogo");
  const outcome = read("src", "components", "duel", "pvp", "PvpOutcome.tsx");
  assert.ok(outcome.includes('{ label: tr("Volver al lobby"), onClick: onBack, testId: "ranked-back" }'), "el resultado con su vuelta");
});

/* ═══════════════════════ AUTORIDAD ═══════════════════════ */

test("F61 AUTORIDAD 01 · el cliente no decide ganador, eje del defensor, punto ni recompensa", () => {
  const client = code(read("src", "lib", "duel", "client.ts"));
  // F67 · + `expectedVersion` (versión optimista validada por el servidor).
  assert.ok(client.includes('post<{ view: DuelMatchView }>(DUEL, { action: "play", matchId, cardUid, stat, ...(typeof expectedVersion === "number" ? { expectedVersion } : {}) })'));
  const duels = code(read("src", "server", "services", "duels.ts"));
  assert.ok(duels.includes("const forced = requiredDefenderStat(d.match);"), "el eje del defensor lo impone el servidor");
  for (const f of ["MatchIntro.tsx", "DuelMoment.tsx", "MatchComplete.tsx", "ResultScreen.tsx", "experience/TiebreakReveal.tsx", "experience/MatchEnding.tsx", "experience/LeaveMatchDialog.tsx"]) {
    const src = code(read("src", "components", "duel", f));
    assert.ok(!/turn\.you\.value\s*[<>]=?\s*turn\.rival\.value/.test(src), `${f} no compara valores para decidir`);
    assert.ok(!/scoreYou\s*[<>]\s*.*scoreRival/.test(src), `${f} no decide por marcador`);
    assert.ok(!/sumOvrYou\s*[<>]|statTotalYou\s*[<>]/.test(src), `${f} no decide desempates`);
    assert.ok(!/award\s*=|credits\s*\+=|xp\s*\+=/.test(src), `${f} no concede recompensas`);
    assert.ok(!/@\/server|@\/domain\/cardgame\/combat|Math\.random/.test(src), `${f} sin servidor, combate ni azar`);
  }
});

/* ═══════════════════════ IDEMPOTENCIA ═══════════════════════ */

test("F61 IDEMPOT 01 · una partida terminada rechaza jugadas ANTES de pagar; el pago es uno por partida", () => {
  const duels = code(read("src", "server", "services", "duels.ts"));
  const guard = duels.indexOf('if (row.state.status !== "IN_PROGRESS") return fail(409, "La partida ya ha terminado");');
  const pay = duels.indexOf("await awardMatchOutcome(sb, row.user_id, row.id, m, level)");
  assert.ok(guard > 0 && pay > guard, "respuesta repetida tras el final: 409, sin pagar");
  assert.ok(duels.includes("ref: `duel:${matchId}`"), "clave de idempotencia del libro mayor");
});

test("F61 IDEMPOT 02 · cerrar la revelación dos veces (Intro + clic) no pide el final dos veces", () => {
  const page = read("src", "app", "duelos", "jugar", "page.tsx");
  assert.ok(page.includes("const key = reveal && view ? `${view.matchId}:${reveal.number}` : null;"));
  assert.ok(page.includes("if (!key || closedReveal.current === key) return;"));
  assert.ok(page.includes("if (!view || inFlight.current) return;"), "cerrojo de red: sin doble envío");
  const ending = read("src", "components", "duel", "experience", "MatchEnding.tsx");
  assert.ok(ending.includes("if (cur !== from) return cur;"), "el final PvP no salta dos pasos con un doble cierre");
});

test("F61 IDEMPOT 03 · el golpe final y el desempate se muestran una vez; recargar el resultado no los repite", () => {
  const page = read("src", "app", "duelos", "jugar", "page.tsx");
  // `complete`/`tiebreak` solo se encienden en `finish`, que solo llaman la revelación cerrada o la jugada final.
  assert.equal((page.match(/setComplete\(true\)/g) ?? []).length, 1);
  assert.ok(page.includes("setTiebreak(endSequence(result ?? null, true).includes(\"TIEBREAK\"));"));
  const boot = page.slice(page.indexOf("const boot = useCallback"), page.indexOf("const refreshCampaign"));
  assert.ok(!/setComplete|finish\(/.test(boot), "el arranque (F5) nunca reproduce el final");
  const pvp = read("src", "app", "duelos", "pvp", "page.tsx");
  assert.ok(pvp.includes("matchId && enVivo === matchId && finalVisto !== matchId && view?.result"));
});

test("F61 IDEMPOT 04 · el rating PvP lo liquida el servidor una vez; el cliente solo lee el evento", () => {
  const sec = read("src", "lib", "duel", "matchSecurity.test.ts");
  assert.ok(sec.includes("competitivo es de SOLO LECTURA"));
  const pvp = code(read("src", "app", "duelos", "pvp", "page.tsx"));
  assert.ok(!/duel_pvp_settle_match|rpc\(/.test(pvp));
});

/* ═══════════════════════ RECUPERACIÓN ═══════════════════════ */

test("F61 RECUPER 01 · F5 en pre-partida, a mitad de turno, tras el turno y en el resultado", () => {
  const page = read("src", "app", "duelos", "jugar", "page.tsx");
  const boot = page.slice(page.indexOf("const boot = useCallback"), page.indexOf("const refreshCampaign"));
  // Sin partida activa → pre-partida. Con partida en curso → la mesa (no la intro). Terminada → resultado directo.
  assert.ok(boot.includes('setStage("prematch")'));
  assert.ok(boot.includes('setStage(active.view.status === "IN_PROGRESS" ? "match" : "result")'));
  assert.ok(boot.includes("setRecovered(active.view.status === \"IN_PROGRESS\")"), "se dice que se recuperó");
  // A mitad de turno (el rival ya declaró) la vista trae `pendingRival` y el eje impuesto: la mesa se reconstruye igual.
  assert.ok(defense.pendingRival && defense.requiredStat);
  // PvP: la primera foto (entrada o reconexión) no anima nada; solo una partida sin turnos trae la entrada.
  const arena = read("src", "components", "duel", "pvp", "PvpArena.tsx");
  assert.ok(arena.includes("if (primera) { if (view.history.length === 0 && enJuego) setIntro(true); return; }"));
});

test("F61 RECUPER 02 · F5 sobre el resultado vuelve al resultado (lectura del propietario), sin golpe final ni pago", () => {
  const page = read("src", "app", "duelos", "jugar", "page.tsx");
  const boot = page.slice(page.indexOf("const boot = useCallback"), page.indexOf("const refreshCampaign"));
  assert.ok(boot.includes("const done = await fetchDuelState(resultMatchId)"), "relee la partida terminada");
  assert.ok(boot.includes('if (done && done.status !== "IN_PROGRESS") {'));
  assert.ok(!/setComplete|setTiebreak|finish\(/.test(boot), "no reescenifica el final");
  assert.ok(page.includes("const resultAtBoot = useRef("), "el parámetro se lee una vez: quitarlo no re-arranca");
  assert.ok(page.includes('window.history.replaceState(window.history.state, "", u.toString());'), "sin navegar");
  // La lectura es del propietario: `getMatch` → `loadMatch` filtra por `user_id`.
  const duels = code(read("src", "server", "services", "duels.ts"));
  assert.match(duels, /\.eq\("id", matchId\)\.eq\("user_id", userId\)\.maybeSingle\(\)/);
});

test("F61 AUDIO · eventos nuevos sintetizados (sin ficheros), respetan silencio/volumen como el resto", () => {
  for (const k of ["match.vs", "match.lineup", "stat.reveal", "tiebreak.step"] as const) {
    assert.ok(SOUND_EVENTS[k], k);
    assert.ok(!SOUND_EVENTS[k].hover, `${k} no es de paso`);
  }
  const sound = read("src", "lib", "sound.ts");
  assert.ok(!/\.mp3|\.ogg|\.wav|new Audio\(/.test(code(sound)), "sin assets de audio");
});
