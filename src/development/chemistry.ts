/**
 * QUÍMICA — los jugadores desarrollan RELACIONES (confianza/respeto/sinergia/conflicto).
 *
 * La compatibilidad base nace de la personalidad (ambición/ego, determinista por par);
 * jugar juntos y GANAR construye confianza y sinergia, perder y chocar de ego crea
 * conflicto. La química del quinteto modula el partido (vía apply.ts). PURO.
 */
import type { Relationship } from "./types";

/** FNV-1a estable para una afinidad base determinista por par. */
function hash2(a: string, b: string): number {
  let h = 2166136261 >>> 0;
  const s = `${a}~${b}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Clave de relación con ids ORDENADOS (a < b). */
export function relKey(x: string, y: string): string {
  return x < y ? `${x}|${y}` : `${y}|${x}`;
}

const clamp100 = (n: number) => Math.max(0, Math.min(100, n));

/** Relación inicial entre dos jugadores (compatibilidad por personalidad + afinidad base). */
export function freshRelationship(x: string, y: string, ambX: number, ambY: number): Relationship {
  const [a, b] = x < y ? [x, y] : [y, x];
  const jitter = ((hash2(a, b) % 1000) / 1000) * 2 - 1; // -1..1
  const ambSim = 1 - Math.abs(ambX - ambY) / 100;       // ambición parecida → encajan
  const compatibility = clamp100(50 + ambSim * 18 + jitter * 16);
  return {
    a, b, compatibility,
    trust: clamp100(compatibility * 0.5 + 25),
    respect: clamp100(compatibility * 0.5 + 25),
    communication: clamp100(compatibility * 0.5 + 25),
    synergy: clamp100(compatibility * 0.5 + 20),
    conflict: clamp100(35 - compatibility * 0.25),
    sharedMatches: 0,
  };
}

export interface ChemMatchInput {
  won: boolean;
  impactX: number; // impacto del jugador x en el partido (0..~)
  impactY: number;
  egoX: number;    // 0..100 (rasgo de ego, para roces)
  egoY: number;
}

/** Actualiza una relación tras un partido jugado JUNTOS. Devuelve una nueva relación. */
export function updateChemistry(rel: Relationship, m: ChemMatchInput): Relationship {
  const r: Relationship = { ...rel, sharedMatches: rel.sharedMatches + 1 };
  const pull = (rel.compatibility - 50) / 50; // compatibles convergen más rápido
  if (m.won) {
    r.trust = clamp100(r.trust + 2 + pull);
    r.synergy = clamp100(r.synergy + 1.8 + pull);
    r.conflict = clamp100(r.conflict - 1.5);
  } else {
    r.trust = clamp100(r.trust - 0.8);
    r.synergy = clamp100(r.synergy - 0.5);
    // Perder + egos altos → roces.
    const egoClash = (m.egoX + m.egoY) / 200; // 0..1
    r.conflict = clamp100(r.conflict + 1.5 * egoClash);
  }
  // Respeto: rendir bien se respeta.
  r.respect = clamp100(r.respect + (m.impactX + m.impactY) * 0.02 - 0.3);
  r.communication = clamp100(r.communication + (m.won ? 0.6 : -0.2));
  return r;
}

/** Química del quinteto (0..100): media de sinergia − conflicto de los pares presentes. */
export function teamChemistry(rels: Record<string, Relationship>, lineup: string[]): number {
  let sum = 0, n = 0;
  for (let i = 0; i < lineup.length; i++) {
    for (let j = i + 1; j < lineup.length; j++) {
      const r = rels[relKey(lineup[i], lineup[j])];
      if (r) { sum += r.synergy - r.conflict * 0.5; n++; }
    }
  }
  if (n === 0) return 50;
  return Math.max(0, Math.min(100, Math.round(sum / n)));
}
