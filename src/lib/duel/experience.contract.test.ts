/**
 * FASE 33 · CONTRATOS — accesibilidad (81–86), seguridad (88–96), modos (78–80), regresión (97–125) y las
 * fronteras de la capa de presentación (sin segundo motor, sin doble sondeo, telemetría cerrada, QA aislada).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { GLOBAL_MARKET_ENABLED } from "@/config/features";
import { FLOWS } from "@/lib/telemetry/contract";
import { K_ESTABLISHED, K_PROVISIONAL } from "@/domain/cardgame/rating";
import { EXPERIENCE_CONTEXTS, experienceFlow } from "./experienceTelemetry";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const files = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap((f) => {
  const rel = `${dir}/${f}`;
  return statSync(join(ROOT, rel)).isDirectory() ? files(rel) : /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [rel] : [];
});

const EXP = "src/lib/duel/experience.ts";
const HUD = "src/components/duel/experience/MatchHud.tsx";
const STORY = "src/components/duel/experience/ResultStory.tsx";
const REPLAY = "src/components/duel/ReplayViewer.tsx";
const ARENA = "src/components/duel/pvp/PvpArena.tsx";
const PVP_ROUTE = "src/app/api/game/duel/pvp/route.ts";
const DUEL_ROUTE = "src/app/api/game/duel/route.ts";
const END = "src/components/duel/experience/MatchEndHero.tsx";
const VERSUS = "src/components/duel/experience/PreMatchVersus.tsx";
const NEW_UI = [HUD, STORY, END, "src/components/duel/experience/TurnDetailSheet.tsx", VERSUS, REPLAY];

/* ───────────── 78–80 · modos ───────────── */

test("78 · IA de los bots sin cambios", () => {
  for (const f of files("src/domain/cardgame/opponent")) assert.ok(!/Fase 33|FASE 33|duel\/experience/.test(read(f)), f);
});

test("79 · el privado no liquida: isSettleable exige modo PVP", () => {
  assert.ok(code("src/server/services/duelsPvp.ts").includes('if (rec.mode !== "PVP") return false;'));
});

test("80 · liquidación ranked sin cambios", () => {
  assert.ok(!/Fase 33|FASE 33|duel\/experience/.test(read("src/server/services/duelsRating.ts")));
});

/* ───────────── 81–86 · accesibilidad ───────────── */

test("81 · la mano se elige con teclado: botones con nombre", () => {
  const hand = code("src/components/duel/arena/HandFan.tsx");
  assert.ok(/<button|DuelCard/.test(hand));
  assert.ok(/aria-label=\{t\("\{nick\}, \{role\}, OVR \{ovr\}", \{ nick: card\.nick, role: (?:td\()?card\.role\)?, ovr: card\.ovr \}\)\}/.test(code("src/components/duel/DuelCard.tsx")));
});

test("82 · la línea de turnos es navegable: botones con etiqueta textual", () => {
  const hud = code(HUD);
  assert.ok(hud.includes('type="button"') && /aria-label=\{playable \? t\("\{label\}\. Ver detalle", \{ label: (?:td\()?c\.label\)? \}\) : (?:td\()?c\.label\)?\}/.test(hud));
  assert.ok(hud.includes("min-h-[44px]"));
});

test("83 · la repetición se controla con teclado", () => {
  const r = code(REPLAY);
  for (const k of ['"ArrowLeft"', '"ArrowRight"', '"Home"', '"End"', 'e.key === " "']) assert.ok(r.includes(k), k);
  for (const l of ['label={tr("Turno anterior")}', 'label={tr("Turno siguiente")}', 'tr("Pausar") : tr("Reproducir")']) assert.ok(r.includes(l), l);
});

test("84 · el resultado es textual", () => {
  assert.ok(code(EXP).includes('VERDICT_TITLE: Record<MatchVerdict, string> = { WIN: "VICTORIA", LOSS: "DERROTA", DRAW: "EMPATE" }'));
  assert.ok(code(STORY).includes("OUTCOME_WORD"));
});

test("85 · movimiento reducido en intro, revelación, resultado, repetición, arena PvP y vibración", () => {
  for (const f of ["src/components/duel/MatchIntro.tsx", "src/components/duel/DuelMoment.tsx", "src/components/duel/ResultScreen.tsx", REPLAY, END, STORY]) assert.ok(code(f).includes("useReducedMotion()"), f);
  assert.ok(code(STORY).includes("initial={reduced ? false :"), "el desempate paso a paso aparece ya puesto con movimiento reducido");
  assert.ok(code(ARENA).includes('<MotionConfig reducedMotion="user">'));
  assert.ok(code("src/lib/haptics.ts").includes("(prefers-reduced-motion: reduce)"));
});

test("86 · nada depende solo del color: glifos y palabras", () => {
  const exp = code(EXP);
  assert.ok(exp.includes('WIN: "●", LOSS: "○", DRAW: "—"') && exp.includes('WIN: "ganado", LOSS: "perdido", DRAW: "empatado"'));
});

/* ───────────── 88–96 · seguridad ───────────── */

test("88–89 · el usuario sale del token; userId/playerId/side del cuerpo se ignoran", () => {
  for (const f of [PVP_ROUTE, DUEL_ROUTE]) {
    const c = code(f);
    assert.ok(c.includes("await getSession(req)"), f);
    assert.ok(!/body\.(userId|playerId|side|user_id)/.test(c), f);
  }
});

test("90–93 · el cliente no manda ganador, rating, recompensa ni eje del defensor", () => {
  const bodies = [...code("src/lib/duel/client.ts").matchAll(/\{ action: "[a-z_]+"[^}]*\}/g)].map((m) => m[0]).join("\n");
  assert.ok(!/winner|rating|delta|award|credits|reward/.test(bodies));
  for (const f of [PVP_ROUTE, DUEL_ROUTE]) assert.ok(!/body\.(winner|ratingDelta|delta|reward|award|credits|axis|defenseStat)/.test(code(f)), f);
  assert.ok(code("src/server/services/duelsPvp.ts").includes("const forced = requiredDefenderStat(d.match);"));
  assert.ok(code("src/server/services/duels.ts").includes("requiredDefenderStat"));
});

test("94 · cuerpo de acción validado campo a campo (desconocidos se ignoran, fijado por pvp-arena-verify)", () => {
  const c = code(PVP_ROUTE);
  assert.ok(c.includes("UUID.test") && c.includes("STATS"));
  assert.ok(code(DUEL_ROUTE).includes('return bad("Acción inválida");'));
});

test("95 · sin clave de servicio en el cliente", () => {
  for (const f of [EXP, "src/lib/duel/experienceTelemetry.ts", "src/lib/haptics.ts", ...NEW_UI, ARENA]) {
    assert.ok(!/SERVICE_ROLE|service_role|getSupabaseAdmin|@\/server\//.test(code(f)), f);
  }
});

test("96 · sin errores internos hacia el cliente", () => {
  assert.ok(!/error: e instanceof Error \? e\.message/.test(code(DUEL_ROUTE)));
  assert.ok(!/return bad\(message\(e\), 500\)/.test(code(PVP_ROUTE)));
  assert.ok(code(PVP_ROUTE).includes("safeError(res.status, res.error)"));
  assert.ok(!/fail\(409, [a-z]\.error\.code, [a-z]\.error\.code\)/.test(code("src/server/services/duelsPvp.ts")));
  const replay = code("src/server/services/duels.ts");
  const fn = replay.slice(replay.indexOf("export async function getReplay"), replay.indexOf("export async function listReplays"));
  assert.ok(!fn.includes("fail(500, error.message)") && fn.includes("No se pudo cargar la repetición"));
});

test("96b · historial/detalle competitivo: un 5xx del servicio no viaja crudo (texto genérico)", () => {
  const c = code("src/app/api/game/competitive/route.ts");
  assert.ok(c.includes("if (r.status >= 500) {") && c.includes('return NextResponse.json({ error: "Error de servidor" }, { status: r.status, headers: NO_STORE });'));
  assert.ok(!/r\.ok \? r\.data : \{ error: r\.error/.test(c), "ninguna rama devuelve r.error sin filtrar el 5xx");
});

/* ───────────── fronteras de la presentación ───────────── */

test("sin segundo motor: ningún MatchEngine3/BattleResolver/… y la presentación no importa el motor", () => {
  const names = files("src").join("\n");
  assert.ok(!/MatchEngine3|BattleResolver|VisualCombatResolver|ReplayCombatEngine|ClientTurnResolver/.test(names));
  for (const f of [EXP, ...NEW_UI]) assert.ok(!/@\/domain\/cardgame\/(match|combat|opponent)/.test(code(f)), f);
});

test("sin doble sondeo: la arena reutiliza el poller y no abre intervalos nuevos", () => {
  const arena = code(ARENA);
  assert.ok((arena.match(/setInterval\(/g) ?? []).length <= 1);
  // Importar `turnRemainingMs`/`SyncState` de `pvpPoller` es leer; lo prohibido es abrir otro bucle.
  assert.ok(!/fetch\(|new \w*Poller\(|usePvpSync\(/.test(arena));
  for (const f of [EXP, ...NEW_UI]) assert.ok(!/setInterval\(|fetch\(/.test(code(f)), f);
  assert.ok(code(ARENA).includes("planReveals(vistos.current, view.history)"));
});

test("máquina de presentación en la mesa: la fase la deriva `derivePhase` y en PvP manda el poller", () => {
  const board = code("src/components/duel/MatchBoard.tsx");
  assert.ok(board.includes("const phase = derivePhase({") && board.includes("data-phase={phase}"));
  assert.ok(code(ARENA).includes("sync={{ status: state.status, isYourTurn: tuTurno, lifecycle: snap.lifecycle }}"));
  assert.ok(code("src/app/duelos/jugar/page.tsx").includes("revealing={reveal !== null || settling}"));
  assert.ok(!/useState<MatchPhase>|setPhase\(/.test(board), "la fase no es estado guardado: se recalcula");
});

test("final PvP/privado: transición con veredicto del servidor, sin rating inventado y sin «Revancha» en el ranked", () => {
  const out = code(ARENA.replace("PvpArena", "PvpOutcome"));
  assert.ok(out.includes("<MatchEndHero") && out.includes("verdict={verdict}"));
  assert.ok(!/Revancha/.test(out));
  const hero = code(END);
  assert.ok(hero.includes("matchEndPresentation({ verdict, view })"));
  assert.ok(!/winner\s*===|scoreYou\s*[<>]|delta/.test(hero), "el héroe no compara ni calcula nada");
});

test("pre-partida privada: tu equipo contra el amigo con su equipo en reversos (sin datos del rival)", () => {
  const sheet = code("src/components/social/ChallengeSheet.tsx");
  assert.ok(sheet.includes('<PreMatchVersus compact deck={elegido} rival={{ kind: "PRIVATE", username: target.username, avatar: target.avatar }}'));
  const versus = code(VERSUS);
  assert.ok(versus.includes("DuelCardBack") && !/rival\.(cards|deck)/.test(versus), "del rival solo identidad pública y reversos");
});

test("la simulación QA solo la usan arneses y tests", () => {
  for (const f of files("src").filter((x) => !x.includes("design-system") && !x.endsWith("qaSimulation.ts"))) {
    assert.ok(!code(f).includes("qaSimulation"), f);
  }
});

test("telemetría: ocho contextos, cerrada hasta aplicar 0046, sin tocar DUEL_CONTEXTS", () => {
  assert.equal(EXPERIENCE_CONTEXTS.length, 8);
  assert.equal(experienceFlow(), null);
  assert.equal(FLOWS.length, 4);
});

test("carta de la partida: sin «MVP» en el código de las pantallas y sin premio", () => {
  for (const f of ["src/components/duel/MatchSummary.tsx", "src/components/duel/ResultScreen.tsx", "src/components/duel/pvp/PvpOutcome.tsx", STORY]) {
    assert.ok(!/\bMVP\b/.test(code(f)), f);
  }
  assert.ok(!/award\(|credits \+|xp \+/.test(code(EXP)));
});

test("perspectiva corregida en la proyección (no en el motor)", () => {
  const mv = code("src/lib/duel/matchView.ts");
  assert.ok(mv.includes('attacker: side === "A" ? t.attacker : other(t.attacker),'));
  assert.ok(mv.includes('outcome: side === "A" || t.outcome === "TIE" ? t.outcome : t.outcome === "A" ? "B" : "A",'));
});

/* ───────────── 97–125 · regresión ───────────── */

const MARK = /Fase 33|FASE 33|duel\/experience|experienceTelemetry|qaSimulation/;
const untouched = (label: string, list: string[]) => test(label, () => {
  assert.ok(list.length > 0);
  for (const f of list) { assert.ok(existsSync(join(ROOT, f)), f); assert.ok(!MARK.test(read(f)), f); }
});

untouched("97 · motor de combate intacto", files("src/domain/cardgame/combat"));
test("98 · versión del orquestador sin cambios", () => { assert.ok(read("src/domain/cardgame/match/types.ts").includes('ORCHESTRATOR_VERSION = "duel-turns-2"')); });
test("99 · reglas de combate sin cambios", () => {
  const r = code("src/domain/cardgame/combat/rules.ts");
  assert.ok(r.includes("CURRENT_COMBAT_RULES = COMBAT_RULES_V2") && r.includes('"duel-combat-2"'));
});
test("100 · alternancia de ataque sin cambios", () => { assert.ok(code("src/domain/cardgame/match/orchestrator.ts").includes("attacker: other(attacker)")); });
test("101 · eje del defensor sin cambios", () => { assert.ok(code("src/domain/cards/combat.ts").includes('stronghold: "entryfrag"')); });
untouched("102–103 · puntuación y desempates sin cambios", ["src/domain/cardgame/combat/resolver.ts", "src/domain/cardgame/combat/rules.ts"]);
untouched("104 · dificultad de los bots sin cambios", files("src/domain/cardgame/opponent"));
untouched("105 · matchmaking sin cambios", [...files("src/domain/cardgame/matchmaking"), "src/server/services/duelsMatchmaking.ts"]);
untouched("106 · fórmula de rating sin cambios", files("src/domain/cardgame/rating"));
test("107 · factor K sin cambios", () => { assert.deepEqual([K_PROVISIONAL, K_ESTABLISHED], [40, 24]); });
untouched("108 · liquidación sin cambios", ["src/server/services/duelsRating.ts"]);
untouched("109 · recompensas sin cambios", ["src/domain/progression/duelRewards.ts", "src/server/services/rewards.ts"]);
untouched("110 · validación de mazos sin cambios", ["src/domain/cardgame/deck.ts", "src/domain/cardgame/resolve.ts"]);
untouched("111 · Team Builder sin cambios", files("src/domain/deckBuilder").filter((f) => !f.includes("test")));
untouched("112 · colección sin cambios", ["src/collection/ownership.ts", "src/collection/filter.ts"]);
untouched("113 · perfil sin cambios", ["src/server/services/playerIdentity.ts", "src/domain/profile/identity.ts"]);
untouched("114 · social sin cambios", ["src/server/services/social.ts", "src/domain/social/social.ts"]);
untouched("115 · Pick'ems sin cambios", files("src/domain/pickems"));
untouched("116 · eventos en directo sin cambios", ["src/server/services/liveEvents.ts", "src/domain/liveEvents/eventState.ts"]);
untouched("117 · progresión sin cambios", ["src/domain/progression/levels.ts", "src/domain/progression/achievements.ts", "src/server/services/progression.ts"]);
untouched("118 · RNG de sobres sin cambios", ["src/domain/packs/weighted.ts", "src/domain/packs/pity.ts", "src/domain/packs/openPack.ts"]);
test("119 · Marketplace OFF", () => { assert.equal(GLOBAL_MARKET_ENABLED, false); });
untouched("120 · worker de esports intacto", ["scripts/esports-autosync-worker.ts", "scripts/vlr-sync.ts"]);

const mig = readdirSync(join(ROOT, "supabase", "migrations"));
for (const [n, label] of [["0046", "121"], ["0047", "122"], ["0048", "123"], ["0049", "124"], ["0050", "125"]] as const) {
  test(`${label} · ${n} aplicada en la Fase 35.1 (cabecera honesta)`, () => {
    const f = mig.find((x) => x.startsWith(n))!;
    assert.ok(/— APLICADA \(VPS 2026-09-15, Fase 35\.1\)\.$/.test(read(`supabase/migrations/${f}`).split("\n")[0]));
  });
}
test("sin migración de repeticiones: la repetición usa la persistencia existente", () => {
  // Fase 35: la única 0051 es la de Road to Champions (progreso de campaña), no una tabla de repeticiones.
  assert.ok(mig.filter((f) => f.startsWith("0051")).every((f) => f.includes("campaign")));
  for (const f of mig.filter((x) => x.startsWith("0051"))) {
    assert.ok(!/create table[^;]*replay/i.test(readFileSync(join(process.cwd(), "supabase", "migrations", f), "utf8")), f);
  }
});
