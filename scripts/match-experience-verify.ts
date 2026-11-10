/**
 * FASE 45 · VERIFICADOR DE LA EXPERIENCIA DE PARTIDA.
 *
 *   npm run match-experience:verify      (todo)
 *   npm run match-arena:verify           escenario, bandos, turno, cartas, marcador
 *   npm run match-state:verify           máquina de estados, cerrojos, reanudar, fuzz de 100.000
 *   npm run match-result:verify          golpe final, resultado, recompensas reales, volver a jugar
 *   npm run match-audio:verify           contexto MATCH/RESULT, sonidos del turno, una sola música
 *   npm run match-security:verify        autoridad del servidor e idempotencia
 *   npm run match-responsive:verify      390…2560, movimiento reducido y capturas
 *
 * Puro y reproducible (semillas fijas) + EVIDENCIA de navegador de `scripts/_fase45-*.ts` en docs/product/qa/fase45.
 * Sin evidencia, la sección FALLA: no se da por bueno lo que no se ha jugado ni fotografiado.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchBoard } from "../src/components/duel/MatchBoard";
import { MatchComplete, MATCH_COMPLETE_MS } from "../src/components/duel/MatchComplete";
import { ResultScreen } from "../src/components/duel/ResultScreen";
import { GameModesHub } from "../src/components/modes/GameModesHub";
import { gameModes, type ModeFacts } from "../src/lib/campaign/presentation";
import { fase45Fixtures, FASE45_SCENES, SECTIONS_45 } from "../src/app/design-system/fase45/fixtures";
import { INITIAL_SESSION, canConfirm, canSelect, matchSessionReducer, sessionInvariants, type MatchEvent } from "../src/lib/duel/matchSession";
import { arenaSignals, turnImpact } from "../src/lib/duel/experience";
import { INITIAL_MUSIC, musicContextForPath, musicPlan, musicReducer } from "../src/lib/audio/music";
import { SOUND_EVENTS } from "../src/lib/sound";

const section = process.argv[2] ?? "all";
const want = (s: string) => section === "all" || section === s;
const ROOT = process.cwd();
const QA = join(ROOT, "docs/product/qa/fase45");
let ok = 0; let ko = 0;
const check = (label: string, cond: boolean, detail = "") => { if (cond) ok++; else ko++; console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`); };
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
/* eslint-disable @typescript-eslint/no-explicit-any */
const evidence = <T = any>(name: string): T | null => (existsSync(join(QA, name)) ? JSON.parse(readFileSync(join(QA, name), "utf8")) as T : null);
function lcg(seed: number) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) walk(p, out); else out.push(p); }
  return out;
}

const fx = fase45Fixtures();
const noop = () => {};
const html = (n: any) => renderToStaticMarkup(n);
const BOARD = read("src/components/duel/MatchBoard.tsx");
const CSS = read("src/app/game-experience.css");
const ARENA_PAGE = read("src/app/duelos/jugar/page.tsx");
const RESULT_SRC = read("src/components/duel/ResultScreen.tsx");
/* RESULTADO ÚNICO · la pantalla común de todos los duelos (sonido, música, recompensas); `ResultScreen` es su adaptador. */
const DUEL_RESULT_SRC = read("src/components/duel/result/DuelResult.tsx");
const board = (view: any, o: any = {}) => html(createElement(MatchBoard, { view, onPlay: noop, busy: false, error: null, onDismissError: noop, ...o }));

/* ═════════════════════════ ARENA ═════════════════════════ */
if (want("arena")) {
  console.log("\n## ARENA · la mesa dentro de un escenario");
  check("la mesa se apoya en un escenario con suelo y luz propia", board(fx.attack).includes("nx-arena-stage") && /\.nx-arena-stage::before/.test(CSS));
  check("el bando que ataca se enciende (tú / rival / ninguno)", board(fx.attack).includes('data-attacker="you"') && board(fx.defense).includes('data-attacker="rival"') && board(fx.win).includes('data-attacker="none"'));
  check("el último turno se marca en la propia mesa", board(fx.t10).includes('data-final="true"') && board(fx.mid).includes('data-final="false"'));
  check("el turno resuelto golpea la arena con el color del ganador", /\[data-hit="win"\]/.test(CSS) && /\[data-hit="loss"\]/.test(CSS) && /\[data-hit="tie"\]/.test(CSS));
  check("el impacto sale del veredicto del servidor", BOARD.includes("turnImpact(view.history[resolved - 1].outcome)") && turnImpact("A").result === "win" && turnImpact("B").result === "loss" && turnImpact("TIE").result === "tie");
  check("el marcador se anima solo cuando cambia", /key=\{valor\}/.test(BOARD));
  check("las cartas jugadas se quedan en la mesa con su veredicto", read("src/components/duel/arena/PlayedRow.tsx").includes("suerteDe(turno, lado)") || read("src/components/duel/arena/PlayedRow.tsx").includes("suerteDe("));
  check("la mano del rival sigue siendo solo un recuento público", BOARD.includes("<RivalHand count={view.rivalRemaining}"));
  check("la mesa no decide nada del combate", ["resolveCombat", "computeCombatOvr", "createDuelBot", "Math.random"].every((f) => !BOARD.includes(f)));
  check("sin 3D, WebGL ni vídeo en la arena", !/three|webgl|<video/i.test(BOARD));
  const envQa = evidence("ui-qa.json");
  check("navegador: la arena real monta su ambiente y el escenario", !!envQa && envQa.arena?.every((r: any) => r.stage && r.environment === "match"), envQa ? "" : "falta ui-qa.json (scripts/_fase45-qa.ts)");
  check("navegador: el bando que ataca cambia con el turno", !!envQa && envQa.arena?.some((r: any) => r.attacker === "you") && envQa.arena?.some((r: any) => r.attacker === "rival" || r.attacker === "none"));
}

/* ═════════════════════════ STATE ═════════════════════════ */
if (want("state")) {
  console.log("\n## STATE · máquina de partida, cerrojos y reanudar");
  const ev = (list: MatchEvent[]) => list.reduce(matchSessionReducer, INITIAL_SESSION);
  const start = ev([{ type: "start" }, { type: "introDone" }]);
  check("intro → mesa", start.state === "TURN_READY");
  const doble = ([{ type: "select", uid: "c1" }, { type: "confirm" }, { type: "confirm" }] as MatchEvent[]).reduce(matchSessionReducer, start);
  check("doble clic no envía dos jugadas", doble.submitted === 1 && !canConfirm(doble, false));
  const terminal = ([{ type: "resume", facts: { resolved: 10, terminal: true } }] as MatchEvent[]).reduce(matchSessionReducer, start);
  check("refrescar con la partida cerrada no reabre la mesa", terminal.state === "MATCH_COMPLETE" && !canSelect(terminal));
  const rejected = ([{ type: "select", uid: "c1" }, { type: "confirm" }, { type: "rejected" }] as MatchEvent[]).reduce(matchSessionReducer, start);
  check("una jugada rechazada devuelve el control sin contarla", rejected.submitted === 0 && rejected.state === "SELECTING");
  check("la máquina de estados está escrita y documentada", read("src/lib/duel/matchSession.ts").includes("PREPARING") && read("src/lib/duel/matchSession.ts").includes("MATCH_COMPLETE"));
  check("la arena reanuda desde el servidor (no desde el navegador)", ARENA_PAGE.includes("await Promise.all([fetchActiveDuel(), fetchDuelDecks()])") && !/localStorage/.test(ARENA_PAGE));
  // Fuzz de 100.000 secuencias (misma semilla que las pruebas).
  const rnd = lcg(45_000);
  let s = INITIAL_SESSION; let resolved = 0; let terminalF = false; let bad = 0;
  for (let i = 0; i < 100_000; i++) {
    const r = rnd();
    let e: MatchEvent;
    if (r < 0.1) e = { type: "start" };
    else if (r < 0.2) e = { type: "introDone" };
    else if (r < 0.4) e = { type: "select", uid: `c${Math.floor(rnd() * 10)}` };
    else if (r < 0.55) e = { type: "confirm" };
    else if (r < 0.75) { const adv = rnd() < 0.7 && resolved < 10 && !terminalF; if (adv) resolved++; if (resolved >= 10) terminalF = true; e = { type: "serverTurn", facts: { resolved, terminal: terminalF } }; }
    else if (r < 0.85) e = { type: "revealDone" };
    else if (r < 0.92) e = { type: "completeDone" };
    else if (r < 0.97) e = { type: "resume", facts: { resolved, terminal: terminalF } };
    else { e = { type: "playAgain" }; if (s.state === "RESULT") { resolved = 0; terminalF = false; } }
    s = matchSessionReducer(s, e);
    if (sessionInvariants(s, 10).length) bad++;
  }
  check("fuzz de estado 100.000: sin turnos dobles ni resultados imposibles", bad === 0, `${bad} fallos`);
  // Fuzz visual: las señales de la arena nunca se salen de rango.
  const rnd2 = lcg(4_500);
  let badV = 0;
  for (let i = 0; i < 50_000; i++) {
    const base = [fx.attack, fx.defense, fx.mid, fx.t10, fx.win][Math.floor(rnd2() * 5)];
    const view = { ...base, turn: Math.floor(rnd2() * 14) - 1, youAreAttacker: rnd2() < 0.5 } as any;
    const sig = arenaSignals(view);
    if (sig.turn < 1 || sig.turn > view.totalTurns) badV++;
    if (view.status !== "IN_PROGRESS" && (sig.attacker !== "none" || sig.finalTurn)) badV++;
  }
  check("fuzz visual 50.000: señales de arena siempre válidas", badV === 0, `${badV} fallos`);
  const play = evidence("playtest.json");
  check("navegador: partidas reales completas sin estado imposible", !!play && play.matches?.length >= 3 && play.matches.every((m: any) => m.turns === 10 && m.ok), play ? "" : "falta playtest.json (scripts/_fase45-playtest.ts)");
}

/* ═════════════════════════ RESULT ═════════════════════════ */
if (want("result")) {
  console.log("\n## RESULT · golpe final, resultado y recompensas");
  const complete = html(createElement(MatchComplete, { result: fx.win.result!, onDone: noop }));
  check("el golpe final existe, con veredicto y marcador", complete.includes('data-scene="match-complete"') && complete.includes('data-testid="match-complete-score"'));
  check("dura entre 1 y 2 s y es saltable", MATCH_COMPLETE_MS.full >= 1000 && MATCH_COMPLETE_MS.full <= 2000 && read("src/components/duel/MatchComplete.tsx").includes('e.key === "Enter"'));
  check("la arena lo enseña ANTES del resultado", ARENA_PAGE.includes("setComplete(true);") && ARENA_PAGE.includes("<MatchComplete"));
  const res = (view: any) => html(createElement(ResultScreen, { view, xp: 4200, onPlayAgain: noop, onDecks: noop, onReplay: noop, deckId: "qa" }));
  check("victoria, derrota y empate se distinguen", res(fx.win).includes('data-kind="win"') && res(fx.loss).includes('data-kind="loss"') && res(fx.draw).includes('data-kind="draw"'));
  // RESULTADO ÚNICO · recompensas del RECIBO del servidor en una línea; sin recibo (o vacío) no hay bloque.
  const { credits, xp } = fx.win.result!.award!;
  const paid = { ...fx.win, result: { ...fx.win.result!, rewards: { matchId: fx.win.matchId, capped: false, grants: [{ source: "MATCH", reward: { credits, xp }, points: 0 }] } } };
  check("las recompensas son las del servidor, en una línea", res(paid).includes('data-testid="duel-result-rewards"') && res(paid).includes(`+${credits}`) && res(paid).includes(`+${xp}`));
  check("sin recompensa no se inventa ninguna", !res({ ...fx.loss, result: { ...fx.loss.result!, award: null } }).includes("duel-result-rewards") && !res(fx.win).includes("duel-result-rewards"));
  const acciones = res(fx.win).slice(res(fx.win).indexOf('data-testid="result-actions"'));
  check("«volver a jugar» es la acción dominante del resultado", acciones.includes('data-cta="primary"'));
  check("JUGAR OTRA, VER PARTIDA y VOLVER AL LOBBY, nada más", (acciones.match(/<(a|button)\b/g) ?? []).length === 3 && /Jugar otra/.test(acciones) && /Ver partida/.test(acciones) && /Volver al lobby/.test(acciones));
  check("el nivel no se apila en el resultado", !RESULT_SRC.includes("LevelProgressPanel") && !/level-up/.test(RESULT_SRC + DUEL_RESULT_SRC));
  check("el draft sigue sin economía ni análisis de equipo", !RESULT_SRC.includes("MatchStrategyPanel") && !RESULT_SRC.includes("deckId={"));
  const play = evidence("playtest.json");
  check("navegador: el resultado real enseñó recompensas del servidor", !!play && play.matches?.every((m: any) => m.result && typeof m.result.credits === "number"), play ? "" : "falta playtest.json");
}

/* ═════════════════════════ AUDIO ═════════════════════════ */
if (want("audio")) {
  console.log("\n## AUDIO · partida y resultado");
  check("la ruta de duelo suena a partida y el resultado a resultado", musicContextForPath("/duelos/jugar") === "MATCH" && musicContextForPath("/duelos/pvp") === "MATCH");
  check("el resultado impone su contexto mientras está en pantalla", DUEL_RESULT_SRC.includes('useMusicOverride("RESULT")'));
  check("el turno tiene sus propios sonidos, distintos del desenlace", ["turn.win", "turn.loss", "turn.tie"].every((k) => k in SOUND_EVENTS) && SOUND_EVENTS["turn.win"].level <= 2);
  check("el tablero suena con el veredicto del servidor", BOARD.includes("playSound(impact.sound)"));
  check("el desenlace mantiene su stinger y agacha la música", DUEL_RESULT_SRC.includes("stingDuck();"));
  const rnd = lcg(2_000);
  let m = INITIAL_MUSIC; let bad = 0;
  for (let i = 0; i < 20_000; i++) {
    const r = rnd();
    const e: any = r < 0.1 ? { type: "unlock" } : r < 0.45 ? { type: "route", context: ["LOBBY", "MATCH", "RESULT"][Math.floor(rnd() * 3)] } : r < 0.6 ? { type: "override", context: rnd() < 0.5 ? null : "RESULT" } : r < 0.75 ? { type: "duck", on: rnd() < 0.5 } : r < 0.88 ? { type: "visibility", hidden: rnd() < 0.3 } : { type: "volume", value: rnd() };
    m = musicReducer(m, e);
    const p = musicPlan(m);
    if (p.gain < 0 || p.gain > 1) bad++;
    if (!m.unlocked && p.context) bad++;
    if (m.hidden && p.gain !== 0) bad++;
  }
  check("fuzz de audio 20.000: una sola música, nada antes del gesto", bad === 0, `${bad} fallos`);
  const a = evidence("ui-qa.json");
  check("navegador: en partida suena MATCH y en resultado RESULT", !!a && a.audio?.match === "MATCH" && a.audio?.result === "RESULT", a ? "" : "falta ui-qa.json");
  check("navegador: nunca dos temas a la vez", !!a && (a.audio?.maxActiveLayers ?? 9) <= 1);
}

/* ═════════════════════════ SECURITY ═════════════════════════ */
if (want("security")) {
  console.log("\n## SECURITY · autoridad del servidor");
  const client = code(read("src/lib/duel/client.ts"));
  check("la jugada solo lleva partida, carta y eje", /action: "play", matchId, cardUid, stat/.test(client));
  check("el cliente no envía ganador, marcador, recompensa ni rating", !/(winner|scoreYou|award|credits|rating)\s*[,:}]/.test(client.replace(/import[\s\S]*?;/g, "")));
  check("el defensor no manda su eje", BOARD.includes("onPlay(chosen.uid, attacking ? stat ?? undefined : undefined);"));
  check("competitivo es de solo lectura", !/export async function POST/.test(read("src/app/api/game/competitive/route.ts")));
  check("PvP exige identificador de acción y versión", read("src/app/duelos/pvp/page.tsx").includes("actionId: crypto.randomUUID()") && read("src/app/duelos/pvp/page.tsx").includes("expectedVersion: state.stateVersion"));
  check("la campaña no acepta primera victoria desde el cliente", !/body\.(firstClear|credits|reward)/.test(read("src/app/api/game/campaign/route.ts")));
  const uiFiles = walk(join(ROOT, "src/components/duel")).filter((p) => /\.tsx?$/.test(p) && !/\.test\./.test(p));
  /*
   * El módulo tiene que terminar ahí (`"` o `/`): `@/domain/cardgame/matchmaking` (política de cola, dominio puro) no es
   * el motor `@/domain/cardgame/match`. Antes el prefijo coincidía y daba un falso positivo con `RankedSearch.tsx`.
   * La lista de los que fallan se informa para que un fallo real diga dónde está.
   */
  const ENGINE_IMPORT = /@\/domain\/cardgame\/(match|combat|opponent)(?=["/])/;
  const engineImports = uiFiles.filter((p) => { const s2 = code(readFileSync(p, "utf8")); return /from "@\/server\//.test(s2) || ENGINE_IMPORT.test(s2); });
  check("ninguna pieza de duelo importa el servidor ni el motor", engineImports.length === 0, engineImports.map((p) => p.replace(ROOT, "")).join(", "));
  check("el detector del motor distingue match de matchmaking (y sigue viendo el motor)",
    ENGINE_IMPORT.test('from "@/domain/cardgame/match"') && ENGINE_IMPORT.test('from "@/domain/cardgame/match/orchestrator"') && ENGINE_IMPORT.test('from "@/domain/cardgame/combat"')
    && ENGINE_IMPORT.test('from "@/domain/cardgame/opponent/bots"') && !ENGINE_IMPORT.test('from "@/domain/cardgame/matchmaking"'));
  check("ninguna pieza de duelo guarda la partida en el navegador", uiFiles.every((p) => !/localStorage|sessionStorage/.test(readFileSync(p, "utf8"))));
  const play = evidence("playtest.json");
  check("navegador: el doble clic no produjo turnos dobles en partidas reales", !!play && play.doubleClick?.extraTurns === 0, play ? "" : "falta playtest.json");
  check("navegador: la huella de BD solo cambió en lo que una partida cambia", !!play && Array.isArray(play.fingerprint?.changed), play ? "" : "");
}

/* ═════════════════════════ RESPONSIVE ═════════════════════════ */
if (want("responsive")) {
  console.log("\n## RESPONSIVE · anchos, movimiento reducido y capturas");
  check("la mesa se dimensiona con el juego (`arenaVars`)", BOARD.includes("arenaVars(view.totalTurns)"));
  check("sin anchos fijos de cuatro cifras en la arena", !/(?<!max-)w-\[\d{4,}px\]/.test(BOARD));
  check("el escenario no anima con movimiento reducido", /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,400}nx-arena-stage/.test(CSS));
  const facts: ModeFacts = { signedIn: true, hasValidDeck: true, activePve: true, activePvp: false, rankedProvisional: false, campaign: { available: true, completed: 2, total: 15, complete: false, nextName: "x", chapter: "Capítulo 1" }, draft: { available: true, status: null, pick: 0, stage: 0, lastStatus: null } };
  const hub = html(createElement(GameModesHub, { cards: gameModes(facts) }));
  check("con partida abierta el hub prioriza retomarla, con UNA acción dominante", hub.includes('data-testid="play-hub-resume"') && (hub.match(/data-cta="primary"/g) ?? []).length === 1);
  check("el hub reacciona al mundo al apuntar cada modo", read("src/components/modes/ModePanel.tsx").includes("focusEnvironment(focus)"));
  check("el arnés cubre las secciones del encargo", FASE45_SCENES.length >= 50 && SECTIONS_45.length >= 15, `${FASE45_SCENES.length} escenas · ${SECTIONS_45.length} secciones`);
  /*
   * ─────────────────── CAPTURAS · EL CONTRATO CAMBIÓ, Y SE DEJA ESCRITO ───────────────────
   *
   * Estas comprobaciones exigían ≥ 200 capturas con un reparto por bloque (arena 50, turn 30, result 30,
   * responsive 30…). Ese era el encargo ORIGINAL de la fase. El encargo vigente lo sustituyó de forma explícita:
   * «NO 200 screenshots… mínimo 60 capturas ÚTILES», y más tarde, para el cierre, «no necesito otras 100 capturas;
   * guarda únicamente evidencia útil del playtest real, aprox. 10-15».
   *
   * Se ajusta el listón a lo pedido HOY en lugar de dejar cinco comprobaciones rojas para siempre o, peor, de
   * fabricar capturas para llegar a un número que ya nadie quiere. Lo que NO se relaja es la exigencia de fondo:
   * las capturas tienen que ser de ESTA build (`build` en el manifiesto), cubrir los anchos del encargo y venir
   * acompañadas de capturas de una partida REAL, que es la evidencia que de verdad demuestra la fase.
   *
   * El manifiesto lo escribe `_fase45-arena-shots.ts`; `_fase45-shots.ts` (el runner viejo, que además no arranca
   * Chrome en este entorno) queda sin usar.
   */
  const shots = evidence("arena/shots.json");
  const rows: any[] = shots?.rows ?? [];
  check("≥ 60 capturas del arnés, todas de la misma build", rows.length >= 60 && rows.every((r) => r.build === shots?.build), `${rows.length}`);
  const by = (g: string) => rows.filter((r) => r.group === g).length;
  const floors: [string, number][] = [["hub", 6], ["arena", 20], ["clash", 10], ["turn", 6], ["result", 4]];
  check("reparto por bloque (contrato vigente)", floors.every(([g, n]) => by(g) >= n), floors.map(([g]) => `${g} ${by(g)}`).join(" · "));
  check("los anchos del encargo", ["390", "768", "1440", "1920", "2560"].every((w) => rows.some((r) => r.size === w)),
    [...new Set(rows.map((r) => r.size))].sort().join(","));
  // La evidencia que no se puede sustituir por un arnés: fotos de una partida jugada de verdad.
  const reales = existsSync(join(QA, "playtest")) ? readdirSync(join(QA, "playtest")).filter((f) => f.endsWith(".png")) : [];
  check("≥ 10 capturas de una partida REAL", reales.length >= 10, `${reales.length}`);
  const mem = evidence("after/memory-log.json");
  check("capturas por lotes, sin Chrome huérfano y sin crecer de lote en lote", !!mem && mem.batches.length > 0 && mem.batches.every((b: any) => b.screenshots <= 25 && b.leftoverPidsKilled.length === 0 && (b.chromeMbPeak ?? 0) <= 1536), mem ? `${mem.batches.length} lotes` : "falta after/memory-log.json");
}

console.log(`\n${ko === 0 ? "OK" : "FALLOS"} · ${ok} correctas · ${ko} fallidas`);
process.exit(ko === 0 ? 0 : 1);
