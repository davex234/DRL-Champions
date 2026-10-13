/**
 * FASE 65 · Reparte `simulation-report.json` en los entregables por tema y escribe `simulation-report.md`.
 *   npx tsx scripts/balance/report.ts [dir]      (también lo llama `simulate.ts` al terminar)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { catalogCards, combatSum, peakStat, STATS } from "../../src/domain/balance/lab";
import { DIFFICULTY_PROFILE } from "../../src/domain/cardgame/opponent";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function writeReports(dir: string): void {
  const rep = JSON.parse(readFileSync(join(dir, "simulation-report.json"), "utf8"));
  const R = rep.results;
  const w = (name: string, data: unknown) => writeFileSync(join(dir, name), JSON.stringify(data, null, 2) + "\n");
  const pool = catalogCards();
  const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
  const pct = (x: number | null | undefined, d = 1) => (x == null ? "—" : `${(x * 100).toFixed(d)} %`);
  const ci = (o: any) => (o ? `${pct(o.rate)} [${pct(o.lo)}–${pct(o.hi)}]` : "—");

  const side = {
    question: "¿Atacar primero da ventaja? ¿Hay ventaja de lado A/B?",
    mirror: R.mirror && Object.fromEntries(Object.entries(R.mirror).map(([p, s]: any) => [p, { matches: s.matches, firstAttackerWin: s.firstAttackerWin, drawRate: s.drawRate, sideA: s.sideA, encounter: s.encounter, decidedBy: s.decidedBy }])),
    pairedSideSwap: R.side && { method: "misma pareja de mazos y misma semilla; solo cambia quién ataca primero (HARD vs HARD)", effectOnFirstAttackerScore: R.side.pairedFirstAttackerEffect, firstAttackerWin: R.side.firstAttackerWin, sideA: R.side.sideA },
    field: R.field && { HARD: { firstAttackerWin: R.field.HARD.firstAttackerWin, sideA: R.field.HARD.sideA, encounter: R.field.HARD.encounter, perTurn: R.field.HARD.perTurn }, NORMAL: { firstAttackerWin: R.field.NORMAL.firstAttackerWin, sideA: R.field.NORMAL.sideA } },
  };
  w("side-advantage.json", side);

  const dist = Object.fromEntries(STATS.map((s) => { const v = pool.map((c) => c.combat[s]); return [s, { mean: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2), p10: q(v, 0.1), p50: q(v, 0.5), p90: q(v, 0.9), min: Math.min(...v), max: Math.max(...v) }]; }));
  const peakOf: Record<string, number> = { stronghold: 0, gamesense: 0, entryfrag: 0 };
  for (const c of pool) { const top = STATS.reduce((a, b) => (c.combat[b] > c.combat[a] ? b : a)); peakOf[top]++; }
  w("stat-balance.json", {
    question: "¿Algún eje domina? ¿La tabla SH↔EF, GS↔GS es justa?",
    catalogDistribution: dist, cardsWhosePeakIs: peakOf,
    fieldHARD: R.field?.HARD.perStat, fieldNORMAL: R.field?.NORMAL.perStat,
    roles: R.roles, specialisedDecks: R.strategies?.vsField.filter((x: any) => x.strategy.startsWith("SPEC") || x.strategy === "PEAK_MAX" || x.strategy === "BALANCED"),
  });

  const H = R.field?.HARD;
  w("tiebreak-analysis.json", {
    question: "¿Cuánto decide el desempate y es justo? (OVR impreso frente a combate)",
    rules: "marcador → suma de OVR IMPRESO (+1 punto) → margen de estadística declarada → DRAW",
    fieldHARD: H && { decidedBy: H.decidedBy, drawRate: H.drawRate, tiedEncounters: H.tiedEncounters, ovrTiebreak: H.ovrTiebreak, shadow: H.shadow, shadowCurrentMismatches: H.shadowCurrentMismatches },
    fieldNORMAL: R.field && { decidedBy: R.field.NORMAL.decidedBy, ovrTiebreak: R.field.NORMAL.ovrTiebreak, shadow: R.field.NORMAL.shadow },
    edition: R.edition, powerSignals: R.field?.corr, cardLevel: R.cards?.corr,
    byOvrGap_per5: H?.byOvrGap_per5, byCombatGap_per20: H?.byCombatGap_per20,
  });

  w("bot-analysis.json", {
    question: "¿La escalera de bots está ordenada y es honesta? ¿Algún bot ve información oculta?",
    profiles: DIFFICULTY_PROFILE, anyProfileSeesHiddenInfo: Object.values(DIFFICULTY_PROFILE).some((p) => p.perfectInformation),
    policies: { RANDOM: "createRandomBot", EASY: "createDuelBot EASY (0 % heurística = aleatorio)", NORMAL: "50 % heurística", HARD: "85 % heurística", SMART: "createSmartBot 100 % heurística, info pública (no existe como nivel)", ORACLE: "createSmartBot con perfectInformation (solo laboratorio)" },
    ladder: R.bots?.ladder, matrix: R.bots?.matrix, pve: R.pve,
  });

  w("starter-analysis.json", { question: "¿Qué tan lejos está el equipo inicial del meta y del PvE?", ...R.starter });
  w("auto-deck-analysis.json", { question: "¿El autocompletar construye equipos competitivos?", ...R.autodeck, ovrMaxInMatrix: R.strategies?.matrix.filter((x: any) => x.a === "OVR_MAX"), ovrMaxVsField: R.strategies?.vsField.find((x: any) => x.strategy === "OVR_MAX") });

  const integ = existsSync(join(dir, "integrity-audit.json")) ? JSON.parse(readFileSync(join(dir, "integrity-audit.json"), "utf8")) : null;
  w("integrity.json", {
    deckAttacks: R.integrity, rng: R.rng,
    engineIntegrity: { integrityBadInField: H?.integrityBad ?? null, shadowCurrentMismatches: H?.shadowCurrentMismatches ?? null },
    clientAuthority: integ,
  });

  if (!existsSync(join(dir, "real-vs-sim.json"))) {
    w("real-vs-sim.json", {
      status: "BLOCKED",
      reason: "La lectura directa de la BD del VPS (psql por ssh) fue denegada por el control de permisos de esta sesión. No se buscó otra vía.",
      howToUnblock: "Ejecutar real-telemetry-query.sql (solo lectura, agregado, sin user_id) y comparar con los valores de `simulated`.",
      simulated: H && { PvE: R.pve?.filter((x: any) => x.deck === "RANDOM" && x.playerPolicy === "NORMAL"), fieldHARD: { firstAttackerWin: H.firstAttackerWin, drawRate: H.drawRate, decidedBy: H.decidedBy, stompRate: H.stompRate } },
    });
  }

  if (R.cards) {
    const by = (f: string) => R.cards.flagged.filter((x: any) => x.flag === f);
    w("card-balance-proposals.json", {
      status: "PROPUESTA — NO APLICADA. Ningún stat, OVR, rol ni edición impresos se han cambiado (regla de F65).",
      method: "impacto causal por sustitución emparejada (misma partida, misma semilla, misma posición; solo cambia la carta), 320 parejas por carta, contracción empírico-bayesiana; atípica = |impacto| > 2·τ con IC 95 % que excluye 0; mal etiquetada = |puesto por impacto − puesto por OVR| > 100",
      tauBetweenCards: R.cards.shrinkage.tau2 != null ? Math.sqrt(R.cards.shrinkage.tau2) : null,
      counts: { OUTLIER_HIGH: by("OUTLIER_HIGH").length, OUTLIER_LOW: by("OUTLIER_LOW").length, OVR_UNDERSTATES: by("OVR_UNDERSTATES").length, OVR_OVERSTATES: by("OVR_OVERSTATES").length },
      proposals: [
        { id: "CB-1", kind: "REVIEW_OUTLIERS", cards: [...by("OUTLIER_HIGH"), ...by("OUTLIER_LOW")], action: "Revisión de diseño carta a carta en una fase de parche con su propia simulación; el laboratorio da el antes/después con `--suites=paired`." },
        { id: "CB-2", kind: "OVR_LABEL", cards: [...by("OVR_UNDERSTATES"), ...by("OVR_OVERSTATES")], action: "El OVR impreso no refleja el poder de juego de estas cartas. Si el producto quiere que OVR signifique poder, recalcular OVR desde el trío (cambio impreso: requiere decisión) o dejar de usar OVR como desempate y como criterio del autocompletar (ver rule-change-proposal.md)." },
      ],
    });
  }

  // Informe legible.
  const md: string[] = [];
  md.push(`# F65 · Simulation report`, "", `Generado por \`npm run balance:simulate\` — ${rep.matches.toLocaleString("es-ES")} partidas del motor real en ${rep.seconds}s. Semilla ${rep.config.seed}, escala ${rep.config.scale}, catálogo ${rep.config.catalog.cards} cartas (huella ${rep.config.catalog.hash}), reglas ${rep.config.engine.rules.version}, orquestador ${rep.config.engine.orchestrator}. 0 escrituras en BD.`, "");
  md.push("## Partidas por suite", "", "| suite | partidas | s |", "|---|---:|---:|", ...Object.entries(rep.timing).map(([k, v]: any) => `| ${k} | ${v.matches.toLocaleString("es-ES")} | ${v.seconds} |`), "");
  if (R.mirror) {
    md.push("## Posición (espejo y cambio de lado)", "", "| política | primer atacante gana | empates |", "|---|---|---|", ...Object.entries(R.mirror).map(([p, s]: any) => `| ${p} espejo | ${ci(s.firstAttackerWin)} | ${pct(s.drawRate)} |`));
    if (R.side) md.push(`| HARD emparejado (efecto de atacar primero) | ${R.side.pairedFirstAttackerEffect.mean} [${R.side.pairedFirstAttackerEffect.lo}, ${R.side.pairedFirstAttackerEffect.hi}] | ${pct(R.side.drawRate)} |`);
    md.push("");
  }
  if (H) {
    md.push("## Campo (mazos aleatorios, HARD vs HARD)", "", `- Lado A: ${ci(H.sideA)} · empates ${pct(H.drawRate)} · primer atacante ${ci(H.firstAttackerWin)}`, `- Decidido por: ${Object.entries(H.decidedBy).map(([k, v]: any) => `${k} ${pct(v / H.matches)}`).join(" · ")}`, `- Palizas (≥6 de margen) ${pct(H.stompRate)} · ajustadas (≤1) ${pct(H.closeRate)} · remontadas desde −2 ${pct(H.comebackFrom2Down)} · decididas antes del último turno ${pct(H.decidedBeforeLastTurn)}`, `- Desempate por OVR: ${pct(H.ovrTiebreak.shareOfMatches)} de las partidas; el ganador tenía MENOS combate total en ${pct(H.ovrTiebreak.winnerHadLowerCombatSum)}`, `- Sombra: sin OVR cambia el ganador en ${pct(H.shadow.NO_OVR.changedWinner, 2)}; con suma de combate en ${pct(H.shadow.COMBAT_SUM.changedWinner, 2)}`, `- corr(dif. OVR, resultado) ${R.field.corr.ovrDiff_vs_result} · corr(dif. combate, resultado) ${R.field.corr.combatDiff_vs_result}`, "");
    md.push("| eje | se declara | atacante gana | empate | ataque medio | defensa media |", "|---|---|---|---|---|---|", ...STATS.map((s) => { const x = H.perStat[s]; return `| ${s} | ${pct(x.declared)} | ${ci(x.attackerWin)} | ${pct(x.tieRate)} | ${x.meanAttack} | ${x.meanDefense} |`; }), "");
  }
  if (R.strategies) {
    md.push("## Estrategias de construcción contra el campo", "", "| estrategia | gana | OVR | combate | pico medio |", "|---|---|---:|---:|---:|", ...R.strategies.vsField.map((x: any) => `| ${x.strategy} | ${ci(x)} | ${x.sumOvr} | ${x.combatSum} | ${x.meanPeak} |`), "");
    const names = [...new Set(R.strategies.matrix.map((x: any) => x.a))] as string[];
    md.push("### Matriz (fila gana a columna)", "", `| | ${names.join(" | ")} |`, `|---|${names.map(() => "---:").join("|")}|`, ...names.map((a) => `| **${a}** | ${names.map((b) => pct(R.strategies.matrix.find((x: any) => x.a === a && x.b === b).rate, 0)).join(" | ")} |`), "");
  }
  if (R.hillclimb) md.push("## Búsqueda de mazo dominante", "", `- ${R.hillclimb.climbs} ascensos × ${R.hillclimb.steps} pasos; mejor fuera de muestra ${pct(R.hillclimb.decks[0].testWin)}; contrajuego específico gana ${pct(R.hillclimb.counter.winVsBest)}; ${R.hillclimb.distinctCardsAcrossClimbs} cartas distintas entre ascensos; núcleo (≥ mitad): ${R.hillclimb.core.length}`, "");
  if (R.bots) md.push("## Bots", "", ...R.bots.ladder.map((x: any) => `- ${x.policy}: ${pct(x.meanWinVsOthers)} de media contra el resto`), "");
  if (R.pve) md.push("## PvE real (rival de `buildOpponentDeck`)", "", "| mazo | jugador | bot | gana el jugador | empates | OVR bot − jugador |", "|---|---|---|---|---|---:|", ...R.pve.map((x: any) => `| ${x.deck} | ${x.playerPolicy} | ${x.botDifficulty} | ${ci(x.playerWin)} | ${pct(x.drawRate)} | ${x.meanBotOvrMinusPlayer} |`), "");
  if (R.starter) md.push("## Starter", "", `- ${R.starter.starterDecks} equipos de bienvenida reales; OVR p50 ${R.starter.starterSumOvr.p50} (meta ${R.starter.metaSumOvr}); combate p50 ${R.starter.starterCombatSum.p50} (meta ${R.starter.metaCombatSum})`, ...Object.entries(R.starter.winRate).map(([k, v]: any) => `- contra ${k}: ${ci(v)}`), "");
  if (R.autodeck) md.push("## Autocompletar", "", ...R.autodeck.rows.map((x: any) => `- colección de ${x.collectionSize}: ${Object.entries(x.autoWinRate).map(([k, v]: any) => `contra ${k} ${ci(v)}`).join(" · ")}`), "");
  if (R.cards) md.push("## Cartas (sustitución emparejada, contraída)", "", `- corr(OVR, impacto) ${R.cards.corr.ovr_vs_impact} · corr(combate, impacto) ${R.cards.corr.combatSum_vs_impact} · corr(pico, impacto) ${R.cards.corr.peak_vs_impact}`, `- Señaladas: ${R.cards.flagged.length} (ver card-metrics.csv)`, "", "| top | rol | OVR | SH/GS/EF | impacto |", "|---|---|---:|---|---:|", ...R.cards.top.slice(0, 10).map((x: any) => `| ${x.cardId} | ${x.role} | ${x.ovr} | ${x.combat.stronghold}/${x.combat.gamesense}/${x.combat.entryfrag} | ${x.impact} |`), "", "| fondo | rol | OVR | SH/GS/EF | impacto |", "|---|---|---:|---|---:|", ...R.cards.bottom.slice(0, 10).map((x: any) => `| ${x.cardId} | ${x.role} | ${x.ovr} | ${x.combat.stronghold}/${x.combat.gamesense}/${x.combat.entryfrag} | ${x.impact} |`), "");
  writeFileSync(join(dir, "simulation-report.md"), md.join("\n") + "\n");
  void combatSum; void peakStat;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) writeReports(process.argv[2] ?? join(process.cwd(), "docs/product/qa/fase65-balance"));
