/**
 * FASE 41 · SIMULACIÓN DEL STARTER — `npx tsx scripts/economy-starter-simulation.ts [N] [--write]`
 *
 * Alternativas A–F para el primer equipo con el motor de sobres REAL (`PackEngine` → `openPack`, catálogo real de 772
 * cartas, odds reales) y la preparación REAL del recorrido (`deckReadiness` ≡ `autocomplete` del constructor):
 *
 *   A  actual (Fase 40): Sobre Inicial gratis y repetible, sin asistencia.
 *   B  sobre de rol completo: los 5 huecos del Sobre Inicial entre roles que faltan.
 *   C1/C2/C3  protección de rol: los primeros 1/2/3 huecos del Sobre Inicial entre roles que faltan (+ tope de gratis).
 *   D  elegir carta: el jugador elige 1 carta de un rol que falta por sobre (se modela como C1 exacto; rechazada: el
 *      cliente elegiría recompensa).
 *   E  bootstrap determinista: 10 cartas fijas al alta (rechazada: cambia el alta y regala plantilla).
 *   F  asistencia también en el Sobre Estándar de bienvenida (2 huecos) además de C2.
 *
 * Métrica objetivo (encargo): aperturas de starter TOTALES (bienvenida + gratis extra) hasta poder formar plantilla,
 * P50 ≤ 4 · P90 ≤ 6 · P99 ≤ 8, y 100 % con plantilla. Además: cuentas atrapadas por el tope, OVR del equipo autocompletado,
 * rareza (la asistencia no puede subirla) y reparto de roles.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { CardRegistry } from "../src/collection/registry";
import { PackEngine } from "../src/pack/engine";
import { getPack } from "../src/data/packs";
import { freshPity } from "../src/domain/packs/pity";
import { bucketForRank } from "../src/domain/packs/types";
import { deckReadiness } from "../src/domain/journey";
import { starterAssistFor, STARTER_POLICY } from "../src/domain/economy/starter";
import type { StarterAssist } from "../src/domain/packs/openPack";
import { autocomplete, indexPool } from "../src/domain/deckBuilder/builder";
import { builderCollection } from "../src/server/services/deckTeams";

const N = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 20_000);
const WRITE = process.argv.includes("--write");
const REG = new CardRegistry();
const ENGINE = new PackEngine(REG);
const resolve = (id: string) => {
  const c = REG.card(id); const p = c ? REG.player(c.playerId) : undefined;
  return c && p ? { playerId: c.playerId, role: p.role, dataVersion: c.dataVersion ?? "", combat: !!c.combat } : null;
};
const WELCOME = [{ packId: "inicial", qty: 3 }, { packId: "estandar", qty: 1 }];

interface Alt { id: string; label: string; inicialSlots: number; estandarSlots: number; cap: number | null; order: "inicial-first" | "estandar-first"; rejected?: string }
const ALTS: Alt[] = [
  { id: "A", label: "Actual: Sobre Inicial gratis repetible, sin asistencia", inicialSlots: 0, estandarSlots: 0, cap: null, order: "inicial-first", rejected: "grifo infinito (P0) y P99 fuera de objetivo" },
  { id: "B", label: "Sobre de rol completo (5 huecos asistidos)", inicialSlots: 5, estandarSlots: 0, cap: STARTER_POLICY.maxFreeClaims, order: "inicial-first" },
  { id: "C1", label: "Protección de rol: 1 hueco asistido", inicialSlots: 1, estandarSlots: 0, cap: STARTER_POLICY.maxFreeClaims, order: "inicial-first" },
  { id: "C2", label: "Protección de rol: 2 huecos asistidos", inicialSlots: 2, estandarSlots: 0, cap: STARTER_POLICY.maxFreeClaims, order: "inicial-first" },
  { id: "C3", label: "Protección de rol: 3 huecos asistidos", inicialSlots: 3, estandarSlots: 0, cap: STARTER_POLICY.maxFreeClaims, order: "inicial-first" },
  { id: "C2-estandar-first", label: "C2 abriendo primero el Sobre Estándar", inicialSlots: 2, estandarSlots: 0, cap: STARTER_POLICY.maxFreeClaims, order: "estandar-first" },
  { id: "D", label: "Elegir 1 carta de rol que falta por sobre (modelado como C1)", inicialSlots: 1, estandarSlots: 0, cap: STARTER_POLICY.maxFreeClaims, order: "inicial-first", rejected: "el cliente elegiría la recompensa (NO-GO de autoridad)" },
  { id: "F", label: "C2 + asistencia en el Sobre Estándar de bienvenida (2 huecos)", inicialSlots: 2, estandarSlots: 2, cap: STARTER_POLICY.maxFreeClaims, order: "inicial-first", rejected: "toca un sobre de pago (odds generales del Estándar)" },
];

const q = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

function runAlt(alt: Alt) {
  const t0 = performance.now();
  const totals: number[] = []; const extras: number[] = [];
  let readyAfterWelcome = 0; let trapped = 0; let capHits = 0;
  const bucketAssisted = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 } as Record<string, number>;
  let assistedCards = 0; let ovrSum = 0; let ovrN = 0;
  for (let acc = 0; acc < N; acc++) {
    let pity = freshPity(); const ids: string[] = []; let k = 0;
    const open = (packId: string) => {
      const slots = packId === "inicial" ? alt.inicialSlots : packId === "estandar" ? alt.estandarSlots : 0;
      let assist: StarterAssist | null = null;
      if (slots > 0) {
        const a = starterAssistFor("inicial", ids, resolve);
        assist = a ? { ...a, slots } : null;
      }
      const r = ENGINE.draw(getPack(packId)!, { seed: ((acc * 7_919 + k++ * 104_729 + 17) >>> 0) % 2147483647, owned: [], mintCounts: {}, pity, now: 0, assist } as never);
      pity = r.pityAfter;
      for (const i of r.instances) {
        ids.push(i.cardId);
        if (assist) { assistedCards++; bucketAssisted[bucketForRank(REG.variant(i.variantId).rank)]++; }
      }
    };
    const order = alt.order === "inicial-first" ? WELCOME : [...WELCOME].reverse();
    let opened = 0;
    for (const p of order) for (let n = 0; n < p.qty; n++) { open(p.packId); opened++; }
    let ready = deckReadiness(ids, resolve).ready;
    if (ready) readyAfterWelcome++;
    let extra = 0;
    while (!ready) {
      if (alt.cap !== null && extra >= alt.cap) { capHits++; break; }
      if (extra > 500) break;
      open("inicial"); extra++; opened++;
      ready = deckReadiness(ids, resolve).ready;
    }
    if (!ready) trapped++;
    totals.push(opened); extras.push(extra);
    if (ready && acc < 2_000) {
      const a = autocomplete([], indexPool(builderCollection(ids.map((cardId, i) => ({ uid: `u${i}`, cardId, obtainedAt: 0 })) as never) as never));
      if (a.ok) { ovrSum += a.uids.reduce((s, uid) => s + REG.card(ids[Number(uid.slice(1))])!.ovr, 0) / a.uids.length; ovrN++; }
    }
  }
  totals.sort((a, b) => a - b); extras.sort((a, b) => a - b);
  const pctOf = (n: number) => Math.round((10_000 * n) / Math.max(1, assistedCards)) / 100;
  const out = {
    id: alt.id, label: alt.label, rejected: alt.rejected ?? null, accounts: N, order: alt.order,
    inicialSlots: alt.inicialSlots, estandarSlots: alt.estandarSlots, freeClaimCap: alt.cap,
    readyAfterWelcomePct: Math.round((10_000 * readyAfterWelcome) / N) / 100,
    totalOpenings: { p50: q(totals, 0.5), p90: q(totals, 0.9), p99: q(totals, 0.99), p999: q(totals, 0.999), max: totals[totals.length - 1], mean: Math.round((100 * totals.reduce((a, b) => a + b, 0)) / N) / 100 },
    extraFreePacks: { p50: q(extras, 0.5), p90: q(extras, 0.9), p99: q(extras, 0.99), max: extras[extras.length - 1] },
    readyPct: Math.round((10_000 * (N - trapped)) / N) / 100, trapped, capHits,
    teamOvrMean: ovrN ? Math.round((10 * ovrSum) / ovrN) / 10 : null,
    assistedRarityPct: assistedCards ? Object.fromEntries(Object.entries(bucketAssisted).map(([b, n]) => [b, pctOf(n)])) : null,
    meetsTargets: q(totals, 0.5) <= 4 && q(totals, 0.9) <= 6 && q(totals, 0.99) <= 8 && trapped === 0,
    ms: Math.round(performance.now() - t0),
  };
  console.log(`${alt.id.padEnd(18)} total p50 ${out.totalOpenings.p50} p90 ${out.totalOpenings.p90} p99 ${out.totalOpenings.p99} max ${out.totalOpenings.max} · listo tras bienvenida ${out.readyAfterWelcomePct}% · atrapadas ${trapped} · OVR ${out.teamOvrMean} · objetivos ${out.meetsTargets ? "SÍ" : "no"} · ${out.ms} ms`);
  return out;
}

const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const results = ALTS.filter((a) => !only || only.includes(a.id)).map(runAlt);
const E = { id: "E", label: "Bootstrap determinista: 10 cartas fijas al alta", rejected: "cambia el alta (migración del trigger) y regala una plantilla; no se simula con sobres: 0 aperturas, 100 %", accounts: N };
const chosen = results.find((r) => r.id === `C${STARTER_POLICY.assistSlots}`) ?? null;
const report = { phase: 41, generatedAt: new Date().toISOString(), engine: "PackEngine real + deckReadiness", catalogCards: REG.cards.length, policy: STARTER_POLICY, alternatives: [...results, E], chosen: chosen?.id ?? null };
if (WRITE) {
  mkdirSync("docs/product/qa/fase41", { recursive: true });
  writeFileSync("docs/product/qa/fase41/starter-simulation.json", JSON.stringify(report, null, 2) + "\n");
  console.log("→ docs/product/qa/fase41/starter-simulation.json");
}
