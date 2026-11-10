/**
 * RESULTADO DE PARTIDA RÁPIDA · adaptador de la pantalla ÚNICA de resultados (`result/DuelResult`).
 *
 *   · la decisión pura: solo QUICK (servidor) + arena rápida (página) va por `QuickMatchResult`; el resto por `ResultScreen`
 *     (campaña, draft) o `PvpOutcome` (ranked, privado, torneo): los TRES pintan la misma pantalla;
 *   · la pantalla: veredicto, marcador, recompensas en una línea (SOLO las del recibo del servidor:
 *     `quickResultRewards.render.test.tsx`) y TRES acciones (JUGAR OTRA, VER PARTIDA, VOLVER AL LOBBY); sin el motivo
 *     redactado, sin progreso, objetivos, logros, temporada ni misiones; victoria/derrota/empate con su tono;
 *   · la página: JUGAR OTRA = `rematch()` (creación canónica de partida rápida), VOLVER AL LOBBY = `/`.
 *   · pantalla compartida en todos los modos: `duelResult.render.test.tsx`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MotionConfig } from "framer-motion";
import { QuickMatchResult } from "./QuickMatchResult";
import { ResultScreen } from "./ResultScreen";
import { isQuickMatchResult, MAIN_MENU_HREF } from "@/lib/duel/quickResult";
import { fase45Fixtures } from "@/app/design-system/fase45/fixtures";
import type { DuelMatchView } from "@/lib/duel/types";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const noop = () => {};
const fx = fase45Fixtures();
const quick = (v: DuelMatchView): DuelMatchView => ({ ...v, context: "QUICK" });
const html = (v: DuelMatchView, reduced = false) =>
  renderToStaticMarkup(<MotionConfig reducedMotion={reduced ? "always" : "never"}><QuickMatchResult view={quick(v)} onContinue={noop} /></MotionConfig>);
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

/* ───────────── decisión ───────────── */

test("QR-1 · SOLO partida rápida: contexto QUICK del servidor Y arena rápida", () => {
  assert.equal(isQuickMatchResult(quick(fx.win), "quick"), true);
  assert.equal(isQuickMatchResult({ ...fx.win, context: "CAMPAIGN" }, "quick"), false, "un nodo de campaña no se simplifica");
  assert.equal(isQuickMatchResult({ ...fx.win, context: "DRAFT" }, "draft"), false, "draft tampoco");
  assert.equal(isQuickMatchResult(quick(fx.win), "campaign"), false, "si la página monta campaña, manda el resultado completo");
  assert.equal(isQuickMatchResult(quick(fx.win), "draft"), false);
  assert.equal(isQuickMatchResult(quick(fx.win), "ranked"), false);
  assert.equal(isQuickMatchResult({ ...fx.win, context: undefined }, "quick"), false, "contexto desconocido → resultado completo (nunca se esconde nada por un fallo)");
  assert.equal(isQuickMatchResult(quick({ ...fx.win, status: "IN_PROGRESS" }), "quick"), false);
  assert.equal(isQuickMatchResult(quick({ ...fx.win, result: null }), "quick"), false);
  assert.equal(isQuickMatchResult(null, "quick"), false);
  assert.equal(MAIN_MENU_HREF, "/");
});

/* ───────────── pantalla ───────────── */

const FORBIDDEN = [/Puntos de rango/i, /XP de cuenta/i, /Ver progreso/i, /Nivel/i, /Objetivo/i, /Logro/i, /Reclamar/i, /Temporada/i, /Misi[oó]n/i, /Carta destacada/i, /Turno a turno/i, /Revancha/i, /Road to Champions/i, /Recompensas obtenidas/i];

for (const [name, v, title] of [["victoria", fx.win, "Victoria"], ["derrota", fx.loss, "Derrota"], ["empate", fx.draw, "Empate"]] as const) {
  test(`QR-2 · ${name}: veredicto, marcador y TRES acciones; ni motivo ni bloques secundarios`, () => {
    const h = html(v);
    const t = text(h);
    assert.ok(t.includes(title), title);
    assert.ok(h.includes('data-result="duel"') && h.includes('data-mode="QUICK"'), "la pantalla única, en modo rápido");
    assert.ok(t.includes(`${v.result!.scoreYou}`) && t.includes(`${v.result!.scoreRival}`), "marcador final");
    assert.ok(h.includes(`Marcador final: tú ${v.result!.scoreYou}, rival ${v.result!.scoreRival}`), "marcador accesible");
    if (v.result!.reason) assert.ok(!t.includes(v.result!.reason), "sin la explicación del resultado («Ganó más enfrentamientos»…)");
    assert.ok(/Jugar otra/i.test(t) && /Ver partida/i.test(t) && /Volver al lobby/i.test(t));
    assert.equal((h.match(/<(a|button)\b/g) ?? []).length, 3, "exactamente tres acciones");
    assert.ok(h.includes('href="/"'), "el lobby es /");
    assert.ok(h.includes(`href="/duelos/replay/${v.matchId}"`), "VER PARTIDA abre la repetición");
    for (const re of FORBIDDEN) assert.ok(!re.test(t), `no aparece ${re}`);
  });
}

test("QR-3 · tonos: victoria con corona y barrido; derrota sin barrido; empate dorado", () => {
  assert.ok(html(fx.win).includes('data-kind="win"') && html(fx.win).includes("nx-result-sweep"));
  assert.ok(html(fx.loss).includes('data-kind="loss"') && !html(fx.loss).includes("nx-result-sweep"));
  assert.ok(html(fx.draw).includes('data-kind="draw"') && html(fx.draw).includes("text-drl-gold"));
});

test("QR-4 · movimiento reducido: sin corona ni barrido", () => {
  const h = html(fx.win, true);
  assert.ok(!h.includes("nx-result-sweep") && !h.includes("conic-gradient"));
});

test("QR-5 · el resultado no paga, no reclama y no lee progreso; un clic en JUGAR OTRA basta", () => {
  const c = read("src", "components", "duel", "QuickMatchResult.tsx");
  const shared = read("src", "components", "duel", "result", "DuelResult.tsx");
  for (const src of [c, shared]) {
    for (const s of ["PostMatchProgress", "SeasonPostMatch", "LevelProgressPanel", "NextUpAfter", "claim", "fetch(", "/api/"]) {
      assert.ok(!src.includes(s), `el resultado no contiene «${s}»`);
    }
  }
  assert.ok(c.includes("onClick: onContinue, once: true"), "JUGAR OTRA es de un solo clic");
  assert.ok(shared.includes("disabled={primary.disabled || starting}") && shared.includes("if (starting) return;") && shared.includes("if (primary.once) setStarting(true);"), "un clic basta: doble clic no lanza dos partidas");
});

/* ───────────── página y aislamiento ───────────── */

const PAGE = read("src", "app", "duelos", "jugar", "page.tsx");

test("QR-6 · la página: rápida → QuickMatchResult con `rematch`; lo demás → ResultScreen (misma pantalla única)", () => {
  assert.ok(PAGE.includes('isQuickMatchResult(view, arenaMode) && (\n        <QuickMatchResult key={view.matchId} view={view} onContinue={rematch} />'));
  assert.ok(PAGE.includes("!isQuickMatchResult(view, arenaMode) && (\n        <ResultScreen"), "campaña y draft conservan su resultado completo");
  assert.ok(PAGE.includes('const arenaMode: ArenaMode = draftMode ? "draft" : campaignMatchNode || campaignNodeId ? "campaign" : "quick";'));
  // SEGUIR JUGANDO = la creación canónica de partida rápida: sin nodo, `startDuel` con el mismo equipo y dificultad.
  assert.ok(PAGE.includes("void begin(deckId, difficulty);"));
  assert.ok(PAGE.includes("const r = nodeId ? await startCampaignNode(nodeId, id) : await startDuel(id, lv);"));
  assert.ok(PAGE.includes("if (!id || inFlight.current) return;"), "cerrojo contra partidas duplicadas");
});

test("QR-7 · RANKED / AMISTOSO / TORNEO no pasan por aquí: /duelos/pvp no conoce el resultado rápido", () => {
  const pvp = read("src", "app", "duelos", "pvp", "page.tsx");
  assert.ok(!pvp.includes("QuickMatchResult") && !pvp.includes("isQuickMatchResult"));
  const outcome = read("src", "components", "duel", "pvp", "PvpOutcome.tsx");
  assert.ok(!outcome.includes("QuickMatchResult"));
});

test("QR-8 · campaña y draft (`ResultScreen`) pintan la MISMA pantalla única, sin los bloques del resultado antiguo", () => {
  const h = renderToStaticMarkup(<ResultScreen view={fx.win} xp={4_200} onPlayAgain={noop} onDecks={noop} onReplay={noop} deckId="qa" />);
  assert.ok(h.includes('data-testid="result-actions"') && h.includes('data-result="duel"'));
  const rs = read("src", "components", "duel", "ResultScreen.tsx");
  assert.ok(rs.includes("<DuelResult"), "ResultScreen es un adaptador de la pantalla única");
  for (const s of ["{progress}", "{extra}", "LevelProgressPanel", "FeaturedCardPanel", "ResultStory", "MatchStrategyPanel", "TurnHistory"]) assert.ok(!rs.includes(s), `ResultScreen ya no pinta «${s}»`);
  // El cupo diario solo aparece cuando explica la ausencia de recompensa (tope agotado).
  assert.ok(rs.includes("dailyCapReached(r) ? <DailyRewardSlot"));
});

test("QR-9 · el servidor sigue pagando y liquidando al terminar (lo que no se enseña sigue ocurriendo)", () => {
  const svc = read("src", "server", "services", "duels.ts");
  assert.ok(svc.includes("await awardMatchOutcome(sb, row.user_id, row.id, m, level)"), "créditos/XP/puntos de la partida");
  assert.ok(svc.includes("else await settleCampaignFor(sb, row.user_id, row.id, m);"), "campaña");
  assert.ok(svc.includes("await settleMissionsForMatch(sb, row.id, m, [{ userId: row.user_id, side: HUMAN }],"), "misiones");
  assert.ok(svc.includes('if (v.status === "IN_PROGRESS") return v;'), "el contexto solo se lee con la partida terminada");
});
