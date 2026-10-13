/**
 * CALIBRACIÓN DEL PESO DE UN TEAM PACK (Fase 20) — instrumento, fuera de CI.
 *
 *   npx tsx scripts/_fase20-calibrate.ts
 *
 * ────────────────────────── QUÉ PREGUNTA CONTESTA ──────────────────────────
 *
 * Un Team Pack no GARANTIZA una carta del equipo: la hace más probable. «Más probable»
 * es un número, y ese número hay que elegirlo a la vista de lo que produce, no a ojo.
 *
 * El objetivo de diseño es explicable en una frase: **de media, alrededor de UNA carta del
 * equipo por sobre** — a veces ninguna, a veces dos. Este script recorre pesos candidatos y
 * mide, con el MOTOR REAL (`openPack`), qué produce cada uno:
 *
 *   · cuota de cartas del equipo sobre el total repartido,
 *   · cartas del equipo por sobre (la media),
 *   · P(al menos una carta del equipo en el sobre).
 *
 * No escribe nada y no toca la base de datos. La distribución se construye en memoria con
 * la MISMA forma que compone el servidor (`PackDistribution`), así que lo que se mide es lo
 * que el motor hará cuando el pool esté persistido.
 */
import { PLAYERS } from "@/data/players";
import { CARDS } from "@/data/catalog";
import { CardRegistry } from "@/collection/registry";
import { openPack } from "@/domain/packs/openPack";
import { freshPity } from "@/domain/packs/pity";
import { buildPool } from "@/domain/packs/pool";
import { DEFAULT_WEIGHT } from "@/domain/packs/weighted";
import type { PackDistribution } from "@/domain/packs/distribution";
import type { PackDef } from "@/domain/packs/types";
import { getVariant } from "@/domain/cards/variants";
import { bucketForRank } from "@/domain/packs/types";

const registry = new CardRegistry();

/** Los cuatro equipos del encargo, con la región REAL de su plantilla. */
const OBJETIVO: { team: string; region: "EMEA" | "Americas" | "Pacific" | "China" }[] = [
  { team: "Team Heretics", region: "EMEA" },
  { team: "Fnatic", region: "EMEA" },
  { team: "NAVI", region: "EMEA" },
  { team: "G2", region: "Americas" },
];

/** Pesos de los sobres regionales: el punto de partida heredado, no inventado. */
const WEIGHTS = { common: 35, uncommon: 40, rare: 18, epic: 6, legendary: 1 };
const CANDIDATOS = [1, 5, 10, 15, 20, 30, 50];
const N = 4000;

const cardsOfTeam = (team: string): Set<string> => {
  const ids = new Set(PLAYERS.filter((p) => p.team === team).map((p) => p.id));
  return new Set(CARDS.filter((c) => ids.has(c.playerId)).map((c) => c.id));
};

function distribucion(miembros: Set<string>, peso: number): PackDistribution {
  return {
    key: `calibracion:${peso}`,
    // `members: null` es LA decisión: el pool no restringe la pertenencia, solo repondera.
    // Con un `Set` aquí el sobre entregaría SOLO cartas del equipo — una garantía, que es
    // exactamente lo que §11 del encargo prohíbe.
    members: null,
    excluded: new Set(),
    weightOf: (cardId) => (miembros.has(cardId) ? peso : DEFAULT_WEIGHT),
    uniform: peso === DEFAULT_WEIGHT,
  };
}

console.log("# Calibración del peso de un Team Pack — motor real, sin tocar la base de datos\n");
console.log(`  muestra: ${N} aperturas por combinación · pesos del regional: ${JSON.stringify(WEIGHTS)}\n`);

for (const { team, region } of OBJETIVO) {
  const miembros = cardsOfTeam(team);
  const pack: PackDef = {
    id: `calib-${team}`, name: team, description: "", price: 3000, cardCount: 5,
    weights: WEIGHTS, restrictRegion: region, accent: "#ffffff",
  };

  // Cuántas cartas del equipo son elegibles de verdad en este sobre, y en qué rarezas.
  const { pool, size } = buildPool(registry, pack);
  const elegiblesDelEquipo = Object.values(pool).flat().filter((c) => miembros.has(c.id));
  const porRareza = new Map<string, number>();
  for (const c of elegiblesDelEquipo) {
    const b = bucketForRank(getVariant(c.variantId).rank);
    porRareza.set(b, (porRareza.get(b) ?? 0) + 1);
  }

  console.log(`## ${team} (${region})`);
  console.log(`   pool del sobre: ${size} cartas · del equipo: ${elegiblesDelEquipo.length}`
    + ` (${[...porRareza.entries()].map(([b, n]) => `${b} ${n}`).join(", ") || "ninguna"})`);
  console.log("   peso   cuota    equipo/sobre   P(>=1 del equipo)");

  for (const peso of CANDIDATOS) {
    const dist = distribucion(miembros, peso);
    let delEquipo = 0, total = 0, sobresConAlguna = 0;
    for (let i = 0; i < N; i++) {
      const r = openPack(registry, pack, {
        seed: (0x9e3779b9 + i * 7919) >>> 0, owned: new Set<string>(), pity: freshPity(), distribution: dist,
      });
      let enEste = 0;
      for (const d of r.decisions) {
        total++;
        if (miembros.has(d.card.id)) { delEquipo++; enEste++; }
      }
      if (enEste > 0) sobresConAlguna++;
    }
    const cuota = total > 0 ? delEquipo / total : 0;
    console.log(
      `   ${String(peso).padStart(4)}   ${(cuota * 100).toFixed(1).padStart(5)}%`
      + `   ${(delEquipo / N).toFixed(2).padStart(10)}`
      + `   ${((sobresConAlguna / N) * 100).toFixed(1).padStart(14)}%`,
    );
  }
  console.log("");
}

console.log("Criterio: se busca ~1,0 carta del equipo por sobre, con P(>=1) claramente por");
console.log("debajo del 100 % — un Team Pack que SIEMPRE diera una carta del equipo sería una");
console.log("garantía, y el encargo (§11) la prohíbe expresamente.");
