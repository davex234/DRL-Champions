/**
 * DIAGNÓSTICO (instrumento `_`, fuera de `verify:all`; SOLO LECTURA, no escribe ficheros).
 *
 *   npx tsx scripts/_preparation-eco-diag.ts [partidos=5]
 *
 * Investiga el fallo de `preparation-verify` «la economía manda la entrada (ATK eco ⇒ eco_rush 100%)» con la MISMA
 * configuración que el verify (perfiles, atributos, semillas 3000 + i·13 y homeSetup). Por cada ronda de ataque del
 * equipo home con compra eco/save en el plan y entrada distinta de eco_rush, dice POR QUÉ, según la decisión del
 * entrenador guardada en el historial:
 *   pistol_round · react_match_point · react_to_losses · (otra causa)
 * y compara la compra del PLAN con la compra REAL de la ronda (pregunta 3 de la propuesta: ¿el plan dice «eco»
 * cuando el equipo compra otra cosa?).
 *
 * Cada partido simulado tarda ~15 s en un PC de escritorio: por defecto 5 partidos por configuración (~2,5 min).
 */
import type { RosterEntry } from "../src/sim";
import { PROFILES } from "../src/sim";
import { makeMatchConfig, simulateMatch } from "../src/match";

const N = Math.max(1, Number(process.argv[2] ?? 5));
const ECO = new Set(["eco", "save"]);
const CAUSES = ["pistol_round", "react_match_point", "react_to_losses"] as const;

// Idéntico a scripts/preparation-verify.ts.
function roster(profile: keyof typeof PROFILES, tag: string): RosterEntry[] {
  const roles = ["entry", "igl", "lurk", "anchor", "support"] as const;
  return roles.map((role, i) => ({
    name: `${tag}${i}`, role,
    attrs: { aim: 76, gameSense: 76, utility: 76, leadership: 76 },
    identity: PROFILES[profile],
  }));
}
const SETUP = { side: "ATK" as const, approach: "default", tempo: "mid" as const, aggression: "balanced" as const };
const cfg = (home: RosterEntry[], away: RosterEntry[], seed: number) =>
  makeMatchConfig({ seed, rosters: { home, away }, homeSetup: SETUP });

interface Row {
  match: number; round: number; planBuy: string; realBuy: string; entry: string;
  concept: string; cause: string; deviated: boolean; notes: string;
}

function diagnose(label: string, home: RosterEntry[], away: RosterEntry[]) {
  let ecoTotal = 0;
  let ecoConsistent = 0;
  const rows: Row[] = [];
  const buyMismatch: Record<string, number> = {};
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const m = simulateMatch(cfg(home, away, 3000 + i * 13));
    for (const h of m.history) {
      const p = h.plan;
      if (!p || p.side !== "ATK" || !ECO.has(p.economy.buy)) continue;
      ecoTotal++;
      const realBuy = h.loadout?.home.buy ?? h.economy?.home ?? "?";
      if (String(realBuy) !== p.economy.buy) {
        const k = `${p.economy.buy}→${String(realBuy)}`;
        buyMismatch[k] = (buyMismatch[k] ?? 0) + 1;
      }
      if (p.entryType === "eco_rush") { ecoConsistent++; continue; }
      const notes = h.coach?.notes ?? [];
      rows.push({
        match: i, round: h.number, planBuy: p.economy.buy, realBuy: String(realBuy), entry: p.entryType,
        concept: h.coach?.concept ?? "(sin entrenador)",
        cause: CAUSES.find((c) => notes.includes(c)) ?? (h.coach ? "OTRA" : "SIN_ENTRENADOR"),
        deviated: !!h.coach?.deviated, notes: notes.join(","),
      });
    }
  }
  const byCause: Record<string, number> = {};
  for (const r of rows) byCause[r.cause] = (byCause[r.cause] ?? 0) + 1;

  console.log(`\n## ${label} — ${N} partidos (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  console.log(`  rondas ATK con compra eco/save en el plan: ${ecoTotal}`);
  console.log(`  con entrada eco_rush: ${ecoConsistent}  ·  SIN eco_rush: ${rows.length}`);
  console.log(`  causa de las que no son eco_rush: ${Object.entries(byCause).map(([k, v]) => `${k} ${v}`).join(" · ") || "—"}`);
  console.log(`  compra del plan ≠ compra real (todas las rondas ATK eco del plan): ${Object.entries(buyMismatch).map(([k, v]) => `${k} ${v}`).join(" · ") || "ninguna"}`);
  for (const r of rows) {
    console.log(`    p${r.match} r${String(r.round).padStart(2)} · plan ${r.planBuy} / real ${r.realBuy} · entrada ${r.entry} · ${r.concept} · ${r.cause}${r.deviated ? " (improvisó)" : ""} [${r.notes}]`);
  }
  return { ecoTotal, ecoConsistent, rows, byCause };
}

console.log("# Diagnóstico · «ATK eco ⇒ eco_rush» en partidos con entrenador de IA (configuración de preparation-verify)");
const mixed = roster("cerebral-igl", "MIX");
const a = diagnose("equipo agresivo vs mixto (el que mide el verify)", roster("aggressive-duelist", "AGG"), mixed);
const d = diagnose("equipo disciplinado vs mixto", roster("patient-anchor", "DIS"), mixed);

const other = [...a.rows, ...d.rows].filter((r) => r.cause === "OTRA" || r.cause === "SIN_ENTRENADOR");
console.log(`\n## Conclusión`);
console.log(`  incumplimientos explicados por las tres reglas del entrenador: ${a.rows.length + d.rows.length - other.length}/${a.rows.length + d.rows.length}`);
console.log(other.length ? `  ⚠ ${other.length} sin explicar por esas reglas (ver filas OTRA/SIN_ENTRENADOR)` : "  todos los incumplimientos los explica el entrenador");
