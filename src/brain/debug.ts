/**
 * BRAIN ENGINE — Brain Debug.
 *
 * Extrae una foto legible del cerebro de un jugador: qué sabe, qué cree, qué opciones
 * evalúa, cuál elige y por qué, qué recibió y si cambió de idea. Herramienta para
 * ENTENDER la mente, no para jugar. Solo lee `SimPlayer.brain`.
 */
import type { SimPlayer } from "../sim/types";
import type { BrainTrace } from "./types";

export interface BrainView {
  name: string;
  role: string;
  agent?: string;
  knows: string[];
  believes: { label: string; prob: number }[];
  options: { kind: string; score: number; chosen: boolean }[];
  chosen: string;
  reason: string;
  received: string[];
  changed: boolean;
  /** Estado mental relevante. */
  mind: { confidence: number; tilt: number; pressure: number; momentum: number };
}

export function brainView(p: SimPlayer): BrainView | null {
  if (!p.brain) return null;
  const t: BrainTrace | null = p.brain.trace;
  return {
    name: p.name,
    role: p.role,
    agent: p.agent?.agent.codename,
    knows: t?.knows ?? [],
    believes: t?.beliefs ?? [],
    options: (t?.options ?? []).map((o) => ({ kind: o.kind, score: o.score, chosen: o.kind === t?.chosen })),
    chosen: t?.chosen ?? "—",
    reason: t?.reason ?? "—",
    received: t?.received ?? [],
    changed: t?.changed ?? false,
    mind: {
      confidence: Math.round(p.mental.confidence),
      tilt: Math.round(p.mental.tilt),
      pressure: Math.round(p.mental.pressure),
      momentum: Math.round(p.mental.momentum),
    },
  };
}
