/**
 * RESULTADO ÚNICO DE DUELOS · una sola pantalla de resultados para TODAS las modalidades.
 *
 *   · partida rápida (`QuickMatchResult`), Road to Champions y Draft Gauntlet (`ResultScreen`), clasificatoria, duelo
 *     privado/revancha y cruce de torneo (`PvpOutcome`) pintan `DuelResult`: misma estructura y mismo orden
 *     (RESULTADO → MARCADOR → RECOMPENSAS → ACCIONES);
 *   · las modalidades solo cambian DATOS (acción principal, lobby, rating, nota de una línea);
 *   · ningún modo conserva piezas del resultado antiguo;
 *   · las recompensas son las del servidor (recibo del libro mayor; `award` solo sin recibo) y sin nada concedido no
 *     hay bloque.
 * Las cifras de ejemplo son FIXTURES de prueba, no premios del juego.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MotionConfig } from "framer-motion";
import { DuelResult } from "./DuelResult";
import { QuickMatchResult } from "../QuickMatchResult";
import { ResultScreen } from "../ResultScreen";
import { PvpOutcome } from "../pvp/PvpOutcome";
import { fase45Fixtures } from "@/app/design-system/fase45/fixtures";
import { dailyCapReached, hasEarnings, resultEarnings, resultKind } from "@/lib/duel/resultSummary";
import type { DuelMatchView, DuelResultView, MatchRewardReceipt } from "@/lib/duel/types";

const fx = fase45Fixtures();
const noop = () => {};
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const html = (n: React.ReactElement, reduced = false) => renderToStaticMarkup(<MotionConfig reducedMotion={reduced ? "always" : "never"}>{n}</MotionConfig>);
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const actions = (h: string) => h.slice(h.indexOf('data-testid="result-actions"'));
const count = (h: string) => (h.match(/<(a|button)\b/g) ?? []).length;
const withReceipt = (v: DuelMatchView, rewards: MatchRewardReceipt | null | undefined): DuelMatchView => ({ ...v, result: { ...v.result!, rewards } });
const RECEIPT = (credits: number, xp: number): MatchRewardReceipt => ({ matchId: "m", capped: false, grants: [{ source: "MATCH", reward: { credits, xp }, points: 0 }] });
const RATING = (delta: number) => ({ matchId: "m", oldRating: 1200, delta, newRating: 1200 + delta, opponentRating: 1210, kFactor: 24, result: delta > 0 ? "WIN" as const : delta < 0 ? "LOSS" as const : "DRAW" as const, createdAt: 0 });
const PRIVATE = (busy = false) => ({ rival: { userId: "u2", username: "Rival QA", avatar: "" }, h2h: null, busy, onRematch: noop, onSocial: noop, onProfile: noop, onOtherChallenge: noop });

/* Lo que el resultado antiguo apilaba y la pantalla única NO enseña en ningún modo. */
const LEGACY_MARKERS = [
  'data-testid="pvp-rating"', 'data-testid="rank-change"', 'data-testid="pvp-ladder"', 'data-testid="private-duel-panel"',
  'data-testid="campaign-result"', 'data-testid="match-strategy"', 'data-testid="xp-progress"', 'data-testid="quick-result-rewards"',
  'data-testid="daily-reward-slot"', "nx-f61-reward-token", 'aria-label="Historial completo"', 'aria-label="Turno a turno"',
];
const LEGACY_TEXT = [/Carta destacada/i, /Turno a turno/i, /Los diez turnos/i, /Road to Champions/i, /Ver progreso/i, /Escalera ranked/i, /Cara a cara/i, /Qué sigue/i, /Recompensas obtenidas/i, /Cambiar rival o equipo/i, /Mis equipos/i];

/* ───────────── lógica pura ───────────── */

test("DR-01 · veredicto del resultado del servidor", () => {
  assert.equal(resultKind({ isDraw: false, winner: "YOU" }), "win");
  assert.equal(resultKind({ isDraw: false, winner: "RIVAL" }), "loss");
  assert.equal(resultKind({ isDraw: true, winner: null }), "draw");
  assert.equal(resultKind(null), null);
});

test("DR-02 · recompensas: SOLO el recibo (suma de asientos); la tabla (`award`) nunca; nunca cifras negativas", () => {
  const base = fx.win.result! as DuelResultView;
  assert.deepEqual(resultEarnings({ ...base, rewards: RECEIPT(120, 40) }), { credits: 120, xp: 40, other: [] });
  const two: MatchRewardReceipt = { matchId: "m", capped: false, grants: [{ source: "MATCH", reward: { credits: 120, xp: 40 }, points: 0 }, { source: "CAMPAIGN_FIRST_CLEAR", reward: { credits: 300 }, points: 0 }] };
  assert.equal(resultEarnings({ ...base, rewards: two }).credits, 420, "partida + primera victoria de campaña");
  assert.ok(!hasEarnings(resultEarnings({ ...base, award: { points: 9, credits: 999, xp: 99 }, rewards: null } as DuelResultView)), "lectura fallida: nada, aunque haya tabla");
  assert.ok(!hasEarnings(resultEarnings({ ...base, award: { points: 9, credits: 999, xp: 99 }, rewards: { matchId: "m", capped: true, grants: [] } } as DuelResultView)), "partida topada: nada");
  assert.ok(!hasEarnings(resultEarnings({ ...base, award: { points: 3, credits: 50, xp: 20 }, rewards: undefined } as DuelResultView)), "vista sin recibo (antigua, PvP): nada");
  assert.equal(resultEarnings({ ...base, rewards: RECEIPT(-10, 5) }).credits, 0);
  const pack: MatchRewardReceipt = { matchId: "m", capped: false, grants: [{ source: "CAMPAIGN_FIRST_CLEAR", reward: { packId: "p", packCount: 2 }, points: 0 }] };
  assert.equal(resultEarnings({ ...base, rewards: pack }).other.length, 1, "sobres, cartas o cosméticos van aparte, tal cual");
  assert.ok(dailyCapReached({ rewards: { matchId: "m", capped: true, grants: [], daily: { slot: null, cap: 20 } } }));
  assert.ok(!dailyCapReached({ rewards: { matchId: "m", capped: false, grants: [], daily: { slot: 3, cap: 20 } } }));
  assert.ok(!dailyCapReached({ rewards: null }));
});

/* ───────────── la pantalla ───────────── */

for (const [kind, title, cls] of [["win", "Victoria", "text-[#2fe0ff]"], ["loss", "Derrota", "text-drl"], ["draw", "Empate", "text-drl-gold"]] as const) {
  test(`DR-03 · ${title}: resultado, marcador, recompensas y acciones, en ese orden`, () => {
    const h = html(<DuelResult mode="PVE" kind={kind} score={{ you: 4, rival: 6 }} earnings={{ credits: 120, xp: 40, other: [] }}
      primary={{ label: "Jugar otra", onClick: noop }} replayHref="/duelos/replay/m" lobby={{ label: "Volver al lobby", href: "/" }} />);
    assert.ok(h.includes(`data-kind="${kind}"`) && h.includes(cls));
    const order = ['data-testid="duel-result-verdict"', 'data-testid="duel-result-score"', 'data-testid="duel-result-rewards"', 'data-testid="result-actions"'].map((m) => h.indexOf(m));
    assert.ok(order.every((i) => i > 0) && order.every((i, n) => n === 0 || i > order[n - 1]), "RESULTADO → MARCADOR → RECOMPENSAS → ACCIONES");
    const t = text(h);
    assert.ok(t.includes(title) && t.includes("+120") && t.includes("+40") && /Créditos/.test(t) && /\bXP\b/.test(t));
    assert.ok(h.includes("Marcador final: tú 4, rival 6"));
    assert.ok(/Jugar otra/.test(t) && /Ver partida/.test(t) && /Volver al lobby/.test(t));
    assert.equal(count(actions(h)), 3);
    assert.ok(h.includes('href="/duelos/replay/m"') && h.includes('href="/"'));
  });
}

test("DR-04 · sin nada concedido no hay bloque de recompensas (ni vacío ni «sin recompensa»)", () => {
  const h = html(<DuelResult mode="PVE" kind="loss" score={{ you: 3, rival: 7 }} earnings={{ credits: 0, xp: 0, other: [] }}
    primary={{ label: "Jugar otra", onClick: noop }} replayHref="/duelos/replay/m" lobby={{ label: "Volver al lobby", href: "/" }} />);
  assert.ok(!h.includes("duel-result-rewards"));
  assert.ok(!/Recompensa|Créditos|Sin recompensa/i.test(text(h)));
});

test("DR-05 · rating de ranked: «…» mientras no hay asiento; después el delta tal cual, con su tono", () => {
  const base = { mode: "PVP" as const, kind: "win" as const, score: { you: 6, rival: 4 }, primary: { label: "Jugar otra", onClick: noop }, replayHref: null, lobby: { label: "Volver al lobby", href: "/" } };
  const pending = html(<DuelResult {...base} rating={{ pending: true }} />);
  assert.ok(pending.includes('data-field="rating-pending"') && text(pending).includes("…"));
  const up = html(<DuelResult {...base} rating={{ pending: false, delta: 18 }} />);
  assert.ok(text(up).includes("+18") && up.includes("text-drl-cyan"));
  const down = html(<DuelResult {...base} kind="loss" rating={{ pending: false, delta: -12 }} />);
  assert.ok(text(down).includes("-12") && !text(down).includes("+-12"));
  const flat = html(<DuelResult {...base} kind="draw" rating={{ pending: false, delta: 0 }} />);
  assert.ok(/(^|\s)0 Rating/.test(text(flat)) && !text(flat).includes("+0"));
});

test("DR-06 · movimiento reducido: sin corona ni barrido; derrota sin barrido nunca", () => {
  const props = { mode: "PVE" as const, score: { you: 6, rival: 4 }, primary: null, replayHref: null, lobby: { label: "Volver al lobby", href: "/" } };
  const win = html(<DuelResult {...props} kind="win" />);
  assert.ok(win.includes("nx-result-sweep") && win.includes("conic-gradient"));
  const reduced = html(<DuelResult {...props} kind="win" />, true);
  assert.ok(!reduced.includes("nx-result-sweep") && !reduced.includes("conic-gradient"));
  assert.ok(!html(<DuelResult {...props} kind="loss" />).includes("nx-result-sweep"));
});

/* ───────────── todas las modalidades, la misma pantalla ───────────── */

const MODES: [string, () => string][] = [
  ["partida rápida", () => html(<QuickMatchResult view={{ ...withReceipt(fx.win, RECEIPT(120, 40)), context: "QUICK" }} onContinue={noop} />)],
  ["PvE (contexto sin modo)", () => html(<ResultScreen view={fx.loss} onPlayAgain={noop} />)],
  ["Road to Champions · victoria", () => html(<ResultScreen view={{ ...fx.win, context: "CAMPAIGN" }} onPlayAgain={noop} campaign={{ mapHref: "/campana?node=c1-n1", nextHref: "/duelos/jugar?campaign=c1-n2" }} />)],
  ["Road to Champions · derrota", () => html(<ResultScreen view={{ ...fx.loss, context: "CAMPAIGN" }} onPlayAgain={noop} campaign={{ mapHref: "/campana?node=c1-n1", nextHref: null }} />)],
  ["Draft Gauntlet", () => html(<ResultScreen view={fx.draw} onPlayAgain={noop} playAgainLabel="Volver al gauntlet" mode="DRAFT_GAUNTLET" />)],
  ["clasificatoria", () => html(<PvpOutcome verdict="WIN" lifecycle="FINISHED" view={fx.win} outcome={RATING(18)} onAgain={noop} onBack={noop} />)],
  ["duelo privado (revancha)", () => html(<PvpOutcome verdict="LOSS" lifecycle="FINISHED" view={fx.loss} outcome={null} onAgain={noop} onBack={noop} privateDuel={PRIVATE()} />)],
  ["cruce de torneo", () => html(<PvpOutcome verdict="DRAW" lifecycle="FINISHED" view={fx.draw} outcome={null} onAgain={noop} onBack={noop} cupMatch={{ name: "Copa QA", roundName: "Final", href: "/copas/qa", outcome: "CHAMPION" }} />)],
];

for (const [name, render] of MODES) {
  test(`DR-07 · ${name}: la pantalla única, sin piezas del resultado antiguo`, () => {
    const h = render();
    assert.ok(h.includes('data-result="duel"') && h.includes('data-scene="result"'), "DuelResult");
    for (const m of ['data-testid="duel-result-verdict"', 'data-testid="duel-result-score"', 'data-testid="result-actions"']) assert.ok(h.includes(m), m);
    assert.equal(count(actions(h)), 3, "tres acciones");
    assert.ok(/Ver partida/.test(text(actions(h))), "VER PARTIDA en todos los modos");
    for (const m of LEGACY_MARKERS) assert.ok(!h.includes(m), `sin «${m}»`);
    const t = text(h);
    for (const re of LEGACY_TEXT) assert.ok(!re.test(t), `sin ${re}`);
    if (fx.win.result!.reason) assert.ok(!t.includes(fx.win.result!.reason) && !t.includes(fx.loss.result!.reason), "sin la explicación del resultado");
  });
}

test("DR-08 · acciones por modo: solo cambian los datos", () => {
  const camp = MODES.find(([n]) => n === "Road to Champions · victoria")![1]();
  assert.ok(/Siguiente nodo/.test(text(actions(camp))) && camp.includes('href="/duelos/jugar?campaign=c1-n2"'), "tras ganar, el siguiente nodo");
  assert.ok(/Volver al mapa/.test(text(actions(camp))) && camp.includes('href="/campana?node=c1-n1"'), "en campaña el lobby es el mapa");
  const campLoss = MODES.find(([n]) => n === "Road to Champions · derrota")![1]();
  assert.ok(/Jugar otra/.test(text(actions(campLoss))), "sin victoria liquidada: reintentar el nodo");
  const draft = MODES.find(([n]) => n === "Draft Gauntlet")![1]();
  assert.ok(/Volver al gauntlet/.test(text(actions(draft))) && !/Jugar otra/.test(text(actions(draft))));
  const ranked = MODES.find(([n]) => n === "clasificatoria")![1]();
  assert.ok(/Jugar otra/.test(text(actions(ranked))) && ranked.includes('data-testid="ranked-again"') && ranked.includes('data-field="rating"'));
  const priv = MODES.find(([n]) => n === "duelo privado (revancha)")![1]();
  assert.ok(/Revancha/.test(text(actions(priv))) && priv.includes('data-testid="private-rematch"') && !priv.includes('data-field="rating'));
  const busy = html(<PvpOutcome verdict="WIN" lifecycle="FINISHED" view={fx.win} outcome={null} onAgain={noop} onBack={noop} privateDuel={PRIVATE(true)} />);
  assert.match(busy, /data-testid="private-rematch"[^>]*disabled=""|disabled=""[^>]*data-testid="private-rematch"/, "revancha ya pedida: bloqueada");
  const cup = MODES.find(([n]) => n === "cruce de torneo")![1]();
  assert.ok(/Volver al torneo/.test(text(actions(cup))) && cup.includes('href="/copas/qa"') && !/Revancha|Jugar otra/.test(text(cup)));
  assert.ok(text(cup).includes("¡Campeón del torneo!") && !cup.includes('data-field="rating'));
});

test("DR-09 · PvP cerrado a medias sin vista: veredicto y nota «Por abandono»; sin marcador ni VER PARTIDA inventados", () => {
  const h = html(<PvpOutcome verdict="WIN" lifecycle="ABANDONED" view={null} outcome={RATING(9)} onAgain={noop} onBack={noop} />);
  assert.ok(h.includes('data-kind="win"') && text(h).includes("Por abandono"));
  assert.ok(!h.includes("duel-result-score") && !h.includes("/duelos/replay/"));
  assert.equal(count(actions(h)), 2);
});

test("DR-10 · tope diario: una línea que explica por qué no hubo recompensa; el cupo normal no se enseña", () => {
  const capped = html(<QuickMatchResult view={{ ...withReceipt(fx.win, { matchId: "m", capped: true, grants: [], daily: { slot: null, cap: 20 } }), context: "QUICK" }} onContinue={noop} />);
  assert.ok(!capped.includes("duel-result-rewards") && /Tope diario alcanzado/.test(text(capped)));
  const normal = html(<QuickMatchResult view={{ ...withReceipt(fx.win, { ...RECEIPT(120, 40), daily: { slot: 7, cap: 20 } }), context: "QUICK" }} onContinue={noop} />);
  assert.ok(!/de 20 hoy/.test(text(normal)));
});

/* ───────────── páginas: ningún modo conserva la pantalla antigua ───────────── */

test("DR-11 · las dos páginas de duelos solo montan los adaptadores de la pantalla única", () => {
  const jugar = read("src", "app", "duelos", "jugar", "page.tsx");
  const pvp = read("src", "app", "duelos", "pvp", "page.tsx");
  for (const s of ["<CampaignResultBanner", "<DraftResultBanner", "<PostMatchProgress", "<SeasonPostMatch", "<NextUpAfter", "<OnboardingAfterMatch", "<JourneyDiscovery", "<LevelProgressPanel"]) {
    assert.ok(!jugar.includes(s) && !pvp.includes(s), s);
  }
  assert.ok(jugar.includes("<QuickMatchResult") && jugar.includes("<ResultScreen") && pvp.includes("<PvpOutcome"));
  for (const f of [["QuickMatchResult.tsx"], ["ResultScreen.tsx"], ["pvp", "PvpOutcome.tsx"]]) {
    assert.ok(read("src", "components", "duel", ...f).includes("<DuelResult"), `${f.join("/")} es un adaptador de DuelResult`);
  }
  // Los dos resultados se ven sobre el estadio.
  assert.ok(jugar.includes("<ArenaEnvironment variant={arenaMode} />") && pvp.includes('<ArenaEnvironment variant="ranked" />'));
});

test("DR-12 · el resultado no paga, no reclama y no calcula: solo presenta", () => {
  const src = read("src", "components", "duel", "result", "DuelResult.tsx") + read("src", "lib", "duel", "resultSummary.ts");
  for (const s of ["fetch(", "/api/", "claim", "awardMatchOutcome", "app_grant_reward", "newRating - ", "oldRating"]) assert.ok(!src.includes(s), s);
});

/* ───────────── torneo, tiempo agotado y casos límite (cierre) ───────────── */

const CUP = { name: "Copa QA", roundName: "Semifinal", href: "/copas/qa" };
for (const [outcome, line, extra] of [
  ["ADVANCED", "✓ Has avanzado a Final", { nextRoundName: "Final" }],
  ["ELIMINATED", "Quedas eliminado en Semifinal", {}],
  ["REVIEW", "Cruce en revisión: lo resuelve la organización", {}],
  [null, "Torneo · Semifinal", {}],
] as const) {
  test(`DR-13 · torneo ${outcome ?? "sin desenlace"}: una línea con lo que registró el cuadro; sin rating ni revancha`, () => {
    const h = html(<PvpOutcome verdict={outcome === "ELIMINATED" ? "LOSS" : "WIN"} lifecycle="FINISHED" view={fx.win} outcome={null} onAgain={noop} onBack={noop} cupMatch={{ ...CUP, outcome, ...extra }} />);
    assert.ok(h.includes('data-mode="CUP"'));
    const note = /data-testid="duel-result-note"[^>]*>([^<]*)</.exec(h);
    assert.equal(note?.[1], line);
    assert.ok(!h.includes('data-field="rating') && !/Revancha|Jugar otra/.test(text(h)));
    assert.ok(/Volver al torneo/.test(text(actions(h))) && h.includes('href="/copas/qa"'));
  });
}

test("DR-14 · PvP por tiempo agotado: veredicto del servidor y nota «Tiempo agotado»", () => {
  for (const [verdict, kind] of [["WIN", "win"], ["LOSS", "loss"]] as const) {
    const h = html(<PvpOutcome verdict={verdict} lifecycle="EXPIRED" view={fx.win} outcome={RATING(verdict === "WIN" ? 12 : -12)} onAgain={noop} onBack={noop} />);
    assert.ok(h.includes(`data-kind="${kind}"`) && text(h).includes("Tiempo agotado"));
    assert.ok(!text(h).includes("Por abandono"));
  }
  const finished = html(<PvpOutcome verdict="WIN" lifecycle="FINISHED" view={fx.win} outcome={RATING(12)} onAgain={noop} onBack={noop} />);
  assert.ok(!finished.includes("duel-result-note"), "partida jugada entera: sin nota");
});

test("DR-15 · sin marcador cuando no hay nada que enseñar; con vista a medias, el marcador al cierre", () => {
  const none = html(<PvpOutcome verdict="LOSS" lifecycle="EXPIRED" view={null} outcome={null} onAgain={noop} onBack={noop} />);
  assert.ok(!none.includes("duel-result-score") && none.includes('data-kind="loss"'));
  const half = { ...fx.loss, result: null, lastTurn: { ...fx.loss.lastTurn!, scoreAfterYou: 2, scoreAfterRival: 3 } } as DuelMatchView;
  const closed = html(<PvpOutcome verdict="LOSS" lifecycle="ABANDONED" view={half} outcome={null} onAgain={noop} onBack={noop} />);
  assert.ok(closed.includes("Marcador final: tú 2, rival 3"), "el del último turno guardado");
});

test("DR-16 · PvP no mueve economía: ni en ranked ni en privado ni en torneo hay créditos o XP", () => {
  for (const h of [
    html(<PvpOutcome verdict="WIN" lifecycle="FINISHED" view={fx.win} outcome={RATING(18)} onAgain={noop} onBack={noop} />),
    html(<PvpOutcome verdict="WIN" lifecycle="FINISHED" view={fx.win} outcome={null} onAgain={noop} onBack={noop} privateDuel={PRIVATE()} />),
    html(<PvpOutcome verdict="WIN" lifecycle="FINISHED" view={fx.win} outcome={null} onAgain={noop} onBack={noop} cupMatch={{ ...CUP, outcome: "CHAMPION" }} />),
  ]) assert.ok(!h.includes('data-field="credits"') && !h.includes('data-field="xp"'));
  const priv = MODES.find(([n]) => n === "duelo privado (revancha)")![1]();
  assert.ok(!priv.includes("duel-result-rewards"), "privado: ni siquiera bloque");
});

for (const [name, v] of [["victoria", fx.win], ["derrota", fx.loss], ["empate", fx.draw]] as const) {
  test(`DR-17 · ${name} en partida rápida: con recibo enseña créditos y XP; sin recibo, sin bloque`, () => {
    const paid = html(<QuickMatchResult view={{ ...withReceipt(v, RECEIPT(60, 30)), context: "QUICK" }} onContinue={noop} />);
    assert.ok(paid.includes(`data-kind="${resultKind(v.result)}"`) && text(paid).includes("+60") && text(paid).includes("+30"));
    const unpaid = html(<QuickMatchResult view={{ ...withReceipt(v, { matchId: "m", capped: false, grants: [] }), context: "QUICK" }} onContinue={noop} />);
    assert.ok(!unpaid.includes("duel-result-rewards"));
  });
}

test("DR-18 · el «un clic basta» de JUGAR OTRA no se arrastra a la partida siguiente: cada resultado se monta por partida", () => {
  const jugar = read("src", "app", "duelos", "jugar", "page.tsx");
  assert.ok(jugar.includes("<QuickMatchResult key={view.matchId} view={view} onContinue={rematch} />"));
  assert.ok(jugar.includes("<ResultScreen\n          key={view.matchId}"));
  const shared = read("src", "components", "duel", "result", "DuelResult.tsx");
  assert.ok(shared.includes("const [starting, setStarting] = useState(false);"), "el cerrojo es estado del montaje, no global");
});
