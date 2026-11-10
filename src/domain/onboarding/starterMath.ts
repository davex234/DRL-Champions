/**
 * FASE 63 · MATEMÁTICA DEL STARTER — ¿el alta REAL permite formar un equipo legal?
 *
 * Simula cuentas recién creadas con el motor REAL de sobres (`PackEngine`: pesos, garantías, pity, anti-duplicados,
 * asistencia F41 del Sobre Inicial) sobre el catálogo del código y, si se le da, la configuración de pools de la BD
 * (foto de F58.1). Cada cuenta abre sus 4 sobres de bienvenida (3 Iniciales + 1 Bronce, `handle_new_user`) en el orden
 * que propone la guía y, mientras no pueda formar equipo, Sobres Iniciales GRATIS (la ruta real de F41, con su tope de
 * 8 concesiones). Después arma el equipo con el `autocomplete` del constructor y lo firma el validador canónico.
 *
 * Puro y determinista (semillas fijas). Lo usan el test (`starterMath.test.ts`) y el instrumento `_fase63-starter.ts`.
 */
import { CardRegistry } from "@/collection/registry";
import { PackEngine } from "@/pack/engine";
import { freshPity } from "@/domain/packs/pity";
import { getPack } from "@/data/packs";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { composeDistribution, type PackDistribution, type PoolDef } from "@/domain/packs/distribution";
import type { OwnedCard, RoleId } from "@/domain/cards/types";
import { deckReadiness, type ReadinessCard } from "@/domain/journey";
import { STARTER_POLICY, starterAssistFor } from "@/domain/economy/starter";
import { autocomplete, indexPool, poolResolver, type BuilderCard } from "@/domain/deckBuilder/builder";
import { createDuelDeck, validateDuelDeck } from "@/domain/cardgame";

/** Lo que concede `handle_new_user` (0011) — comprobado contra la función viva de la BD el 2026-09-26. */
export const STARTER_GRANT = { credits: 6000, packs: [{ packId: "inicial", qty: 3 }, { packId: "estandar", qty: 1 }] } as const;

/** `guide` = el orden que propone la guía (Bronce y luego Iniciales, `GUIDE_FIRST_PACK`); `inicial-first` = el de F40. */
export type OpenOrder = "guide" | "inicial-first";

export interface StarterRun {
  ready: boolean;
  /** Sobres Iniciales gratis extra que hicieron falta (0 = bastó con los 4 de bienvenida). */
  freeExtra: number;
  cards: number;
  deckValid: boolean;
  deckUniquePlayers: number;
  deckRoleCounts: Record<string, number>;
  /** cardIds del equipo que arma `autocomplete` (vacío si no hay equipo). Lo usa el laboratorio de balance (F65). */
  deckCardIds: string[];
}

const makeRng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed; };

export function simulateStarter(seed: number, order: OpenOrder, distribution: (packId: string) => PackDistribution | null = () => null): StarterRun {
  const reg = new CardRegistry();
  const engine = new PackEngine(reg, distribution);
  const resolve = (id: string): ReadinessCard | null => {
    const c = reg.card(id); const p = c ? reg.player(c.playerId) : undefined;
    return c && p ? { playerId: c.playerId, role: (c.role ?? p.role) as RoleId, dataVersion: c.dataVersion ?? "", combat: !!c.combat } : null;
  };
  const next = makeRng(seed);
  const owned: OwnedCard[] = [];
  let pity = freshPity();
  const mintCounts: Record<string, number> = {};
  const open = (packId: string) => {
    const pack = getPack(packId)!;
    const r = engine.draw(pack, {
      seed: next() & 0x7fffffff, owned, mintCounts, pity, now: 0,
      assist: starterAssistFor(packId, owned.map((o) => o.cardId), resolve),
    });
    pity = r.pityAfter;
    for (const [k, v] of Object.entries(r.mintDelta)) mintCounts[k] = (mintCounts[k] ?? 0) + v;
    for (const ins of r.instances) owned.push({ uid: `u${owned.length}`, cardId: ins.cardId, serial: ins.serial ?? undefined, obtainedAt: owned.length } as OwnedCard);
  };
  const welcome = order === "guide" ? ["estandar", "inicial", "inicial", "inicial"] : ["inicial", "inicial", "inicial", "estandar"];
  for (const p of welcome) open(p);
  let freeExtra = 0;
  const ready = () => deckReadiness(owned.map((o) => o.cardId), resolve).ready;
  while (!ready() && freeExtra < STARTER_POLICY.maxFreeClaims) { open(STARTER_POLICY.packId); freeExtra++; }

  // El equipo: `autocomplete` del constructor sobre los ejemplares poseídos → validador canónico.
  const pool = indexPool(owned.map((o): BuilderCard => {
    const c = reg.card(o.cardId)!; const p = reg.player(c.playerId)!;
    return {
      uid: o.uid, cardId: c.id, playerId: c.playerId, nick: p.nick, team: p.team, country: p.country, role: (c.role ?? p.role) as RoleId,
      region: p.region, variantId: c.variantId, ovr: c.ovr, combat: c.combat!, serial: null, dataVersion: c.dataVersion ?? "",
      statBoost: c.statBoost ?? 0, obtainedAt: o.obtainedAt,
    };
  }).filter((b) => !!b.combat));
  const auto = autocomplete([], pool);
  let deckValid = false; let deckUniquePlayers = 0; const deckRoleCounts: Record<string, number> = {}; const deckCardIds: string[] = [];
  if (auto.ok) {
    const v = validateDuelDeck(createDuelDeck({ id: "t", name: "t", cards: auto.uids, now: 0 }), poolResolver(pool));
    deckValid = v.valid;
    const cards = auto.uids.map((u) => pool.get(u)!);
    deckUniquePlayers = new Set(cards.map((c) => c.playerId)).size;
    for (const c of cards) deckRoleCounts[c.role] = (deckRoleCounts[c.role] ?? 0) + 1;
    deckCardIds.push(...cards.map((c) => c.cardId));
  }
  return { ready: ready(), freeExtra, cards: owned.length, deckValid, deckUniquePlayers, deckRoleCounts, deckCardIds };
}

export interface StarterStats { n: number; order: OpenOrder; readyRate: number; validRate: number; readyWithWelcomeOnly: number; freeExtra: { p50: number; p90: number; p99: number; max: number }; histogram: Record<number, number> }

export function starterStats(n: number, order: OpenOrder, distribution?: (packId: string) => PackDistribution | null, seed0 = 63_000): StarterStats {
  const runs = Array.from({ length: n }, (_, i) => simulateStarter(seed0 + i * 7919, order, distribution));
  const extra = runs.map((r) => r.freeExtra).sort((a, b) => a - b);
  const q = (p: number) => extra[Math.min(extra.length - 1, Math.floor(p * extra.length))];
  const histogram: Record<number, number> = {};
  for (const e of extra) histogram[e] = (histogram[e] ?? 0) + 1;
  return {
    n, order,
    readyRate: runs.filter((r) => r.ready).length / n,
    validRate: runs.filter((r) => r.deckValid && r.deckUniquePlayers === 10).length / n,
    readyWithWelcomeOnly: runs.filter((r) => r.freeExtra === 0).length / n,
    freeExtra: { p50: q(0.5), p90: q(0.9), p99: q(0.99), max: extra[extra.length - 1] },
    histogram,
  };
}

const SNAP_PATH = join(process.cwd(), "docs/product/qa/fase58-1-gold-pool/pool-snapshot-after.json");
type Snap = { pools: { id: string; mode: PoolDef["mode"]; rules: PoolDef["rules"] }[]; entries: { pool_id: string; card_id: string; weight: number | string; mode: "INCLUDE" | "EXCLUDE" }[]; packPools: { pack_id: string; pool_id: string; priority: number }[] };

/** Pools REALES de la BD (foto F58.1, la misma de `goldPool.test.ts`). Sin la foto: pools del código. */
export function dbDistribution(): (packId: string) => PackDistribution | null {
  if (!existsSync(SNAP_PATH)) return () => null;
  const snap = JSON.parse(readFileSync(SNAP_PATH, "utf8")) as Snap;
  const pools = new Map<string, PoolDef>();
  for (const p of snap.pools) pools.set(p.id, { id: p.id, mode: p.mode, rules: p.rules ?? {}, entries: [], availableFrom: null, availableTo: null });
  for (const e of snap.entries) pools.get(e.pool_id)?.entries.push({ cardId: e.card_id, weight: Number(e.weight), mode: e.mode });
  const cache = new Map<string, PackDistribution | null>();
  return (packId) => {
    if (!cache.has(packId)) {
      const bind = snap.packPools.filter((p) => p.pack_id === packId).map((p) => ({ pool: pools.get(p.pool_id)!, priority: p.priority })).filter((b) => !!b.pool);
      cache.set(packId, bind.length ? (composeDistribution(bind, Date.parse("2026-09-26T12:00:00Z")) as PackDistribution | null) : null);
    }
    return cache.get(packId)!;
  };
}

