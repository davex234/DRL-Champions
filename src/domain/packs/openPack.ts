/**
 * openPack — EL ÚNICO DECISOR DE DROPS (Collection Fase 2/7).
 *
 * Esta función es la única fuente de verdad que decide QUÉ carta cae de un sobre. Compone, en una sola
 * ruta: pool elegible + pesos por rareza + garantías (`guaranteedMin`/`guarantees`) + pity + anti-
 * duplicados. Está dividida INTERNAMENTE en `pool`/`pity`/`antidup` (mismo dominio), pero es UN SOLO
 * camino de decisión. 100% determinista (RNG oficial del proyecto `@/sim/rng`).
 *
 * NO acuña (no asigna nº de serie, calidad, origen ni marca de posesión): eso es responsabilidad del
 * Minter en la capa de orquestación. Aquí solo se DECIDE la carta y sus banderas (pity/compensada).
 *
 *   Pack UI → Pack Engine (orquestación) → openPack() [decisión] → Minter → Collection → Ownership
 */
import type { CardRegistry } from "@/collection";
import { makeRng, type Rng } from "@/sim/rng";
import { bucketForRank, type RarityBucket, type PackDef } from "./types";
import type { CardDef, RoleId, VariantGroup } from "../cards/types";
import { buildPool, BUCKETS, BUCKET_INDEX, type Pool } from "./pool";
import { pityDue, updatePity, type PityState } from "./pity";
import { resolveAntiDup } from "./antidup";
import { pickWeighted, DEFAULT_WEIGHT } from "./weighted";
import type { PackDistribution } from "./distribution";
import {
  packPlan, packCardClass, ovrTiltWeight, PACK_CLASS_ORDER, EmptyPackClassError,
  type ClassTable, type MainPackPlan, type PackCardClass,
} from "./packClass";

/** Una carta DECIDIDA por el drop (aún sin acuñar). */
export interface DropDecision {
  card: CardDef;
  bucket: RarityBucket;
  byPity: boolean;
  compensated: boolean;
}

/** Contexto de decisión (solo lo que el DECISOR necesita: azar + propiedad + pity). */
export interface DecideContext {
  seed: number;
  /** cardIds ya poseídos (para anti-duplicados). SOLO LECTURA. */
  owned: Set<string>;
  pity: PityState;
  /**
   * BLOQUE 8.3 — configuración de pool persistida: qué cartas pertenecen y cuánto pesan.
   *
   * OPCIONAL y aditiva. Sin ella el decisor se comporta EXACTAMENTE como antes de 8.3
   * —elegibilidad por `PackDef` y sorteo uniforme—, que es lo que hacen hoy los 12 sobres y
   * lo que necesitan los tests del dominio. Con ella, cambia una sola cosa: qué carta se
   * elige dentro del bucket. Ni los pesos por bucket, ni las garantías, ni el pity, ni el
   * anti-duplicados, ni el orden, ni el consumo del RNG.
   */
  distribution?: PackDistribution | null;
  /**
   * FASE 41 · ASISTENCIA DE PRIMER EQUIPO. Opcional e INERTE si no llega (todos los sobres, siempre, salvo el Sobre
   * Inicial de una cuenta que aún no puede formar plantilla: lo decide el SERVIDOR). Los primeros `slots` huecos se
   * sortean SOLO entre cartas de un rol que aún falta y de un jugador que aún no tiene. No cambia los pesos por
   * rareza, ni las garantías, ni el pity, ni el consumo del RNG por hueco: solo QUÉ carta del bucket es elegible.
   */
  assist?: StarterAssist | null;
}

/** Necesidad de roles de una cuenta sin plantilla legal (Fase 41). */
export interface StarterAssist {
  /** Huecos asistidos (los primeros del sobre). */
  slots: number;
  /** Rol → cuántos jugadores distintos faltan. */
  needByRole: Partial<Record<RoleId, number>>;
  /** Jugadores que ya posee (una copia de un jugador que ya tiene no le acerca a la plantilla). */
  ownedPlayers: ReadonlySet<string>;
}

export interface OpenPackResult {
  decisions: DropDecision[];
  pityAfter: PityState;
}

interface SlotReq { minIdx: number; groups?: VariantGroup[]; serialized?: boolean; assist?: AssistReq }
interface AssistReq { roles: Set<string>; excludePlayers: Set<string> }

/** Requisitos por hueco: garantías asignadas a los últimos huecos + `guaranteedMin` en el último. */
function slotRequirements(pack: PackDef): SlotReq[] {
  const reqs: SlotReq[] = Array.from({ length: pack.cardCount }, () => ({ minIdx: 0 }));
  let ptr = pack.cardCount - 1;
  for (const g of pack.guarantees ?? []) {
    for (let n = 0; n < g.count && ptr >= 0; n++, ptr--) {
      const r = reqs[ptr];
      if (g.minBucket) r.minIdx = Math.max(r.minIdx, BUCKET_INDEX[g.minBucket]);
      if (g.groups) r.groups = g.groups;
      if (g.serialized != null) r.serialized = g.serialized;
    }
  }
  if (pack.guaranteedMin) {
    const last = reqs[pack.cardCount - 1];
    last.minIdx = Math.max(last.minIdx, BUCKET_INDEX[pack.guaranteedMin]);
  }
  return reqs;
}

const matchesReq = (registry: CardRegistry, c: CardDef, req: SlotReq): boolean => {
  const v = registry.variant(c.variantId);
  if (req.serialized != null && v.serialized !== req.serialized) return false;
  if (req.groups && !req.groups.includes(v.group)) return false;
  if (req.assist) {
    if (req.assist.excludePlayers.has(c.playerId)) return false;
    const role = c.role ?? registry.player(c.playerId)?.role;
    if (!role || !req.assist.roles.has(role)) return false;
  }
  return true;
};

/** ¿El requisito exige filtrar el pool (grupo/serie/no-repetible/asistencia)? Si no, se usa el pool base (rápido). */
const needsFilter = (req: SlotReq, repeatable: boolean): boolean =>
  req.groups != null || req.serialized != null || req.assist != null || !repeatable;

/** Pool filtrado por requisito + repetibilidad (solo ruta lenta: garantías por grupo/serie). */
function filtered(registry: CardRegistry, pool: Pool, req: SlotReq, drawn: Set<string>, repeatable: boolean): Pool {
  const out: Pool = { common: [], uncommon: [], rare: [], epic: [], legendary: [] };
  for (const b of BUCKETS) {
    if (BUCKET_INDEX[b] < req.minIdx) continue;
    out[b] = pool[b].filter((c) => matchesReq(registry, c, req) && (repeatable || !drawn.has(c.id)));
  }
  return out;
}

/** Bucket con probabilidad ponderada entre buckets con stock e índice >= minIdx (fallback: más alto). */
function rollBucket(weights: Record<RarityBucket, number>, pool: Pool, minIdx: number, rng: Rng): RarityBucket | null {
  let total = 0, usableCount = 0;
  for (const b of BUCKETS) if (BUCKET_INDEX[b] >= minIdx && pool[b].length > 0) { usableCount++; total += weights[b] || 0; }
  if (usableCount === 0) return null;
  if (total <= 0) { // ningún peso: el más alto disponible
    for (let i = BUCKETS.length - 1; i >= 0; i--) { const b = BUCKETS[i]; if (BUCKET_INDEX[b] >= minIdx && pool[b].length > 0) return b; }
  }
  let roll = rng.next() * total;
  for (const b of BUCKETS) {
    if (BUCKET_INDEX[b] < minIdx || pool[b].length === 0) continue;
    roll -= weights[b] || 0;
    if (roll <= 0) return b;
  }
  for (let i = BUCKETS.length - 1; i >= 0; i--) { const b = BUCKETS[i]; if (BUCKET_INDEX[b] >= minIdx && pool[b].length > 0) return b; }
  return null;
}

/**
 * DECIDE las cartas de UN sobre (sin acuñar). Determinista dado (pack, ctx). Devuelve las decisiones en
 * ORDEN DE SORTEO (el orden de revelado lo aplica la orquestación tras acuñar, para respetar seriales).
 */
export function openPack(registry: CardRegistry, pack: PackDef, ctx: DecideContext): OpenPackResult {
  // Fase 57.3 · la línea principal (Bronce, Plata, Oro, Masters, Champions, Icon) decide por CLASE DE SOBRE.
  // Pack Opening 3.0 · con su PLAN por ranuras (normales + destacada) e inclinación por OVR dentro de la clase.
  // Pack Opening 3.1 · también los especiales (regionales, de equipo, EWC): mismo motor, su pool de siempre.
  const plan = packPlan(pack.id);
  if (plan) return openByClass(registry, pack, ctx, plan);

  const rng = makeRng(ctx.seed);
  const dist = ctx.distribution ?? null;
  const { pool, flat: flatAll } = buildPool(registry, pack, dist);
  // Sin configuración, peso por defecto para todo: `pickWeighted` se reduce entonces,
  // aritmética a aritmética, a `rng.pick`. La demostración está en `./weighted`.
  const weightOf = dist ? (c: CardDef) => dist.weightOf(c.id) : () => DEFAULT_WEIGHT;
  const reqs = slotRequirements(pack);
  const repeatable = pack.repeatable !== false;
  const policy = pack.antiDuplicate ?? "allow";

  const owned = ctx.owned;
  const drawn = new Set<string>();
  let pity = ctx.pity;

  // Fase 41 · necesidad viva de la asistencia (se consume a medida que caen cartas útiles). Sin `assist`, nada cambia.
  const need = new Map<string, number>(Object.entries(ctx.assist?.needByRole ?? {}).filter(([, n]) => (n ?? 0) > 0) as [string, number][]);
  const helpedPlayers = new Set<string>(ctx.assist?.ownedPlayers ?? []);

  const decisions: DropDecision[] = [];
  for (let i = 0; i < pack.cardCount; i++) {
    // Requisito efectivo del hueco (+ pity si está pendiente).
    const req: SlotReq = { ...reqs[i] };
    const forcedByPity = pack.pity != null && pityDue(pack, pity);
    if (forcedByPity) req.minIdx = Math.max(req.minIdx, BUCKET_INDEX[pack.pity!.minBucket]);
    const assisted = !!ctx.assist && i < ctx.assist.slots && need.size > 0;
    if (assisted) req.assist = { roles: new Set(need.keys()), excludePlayers: helpedPlayers };

    // Ruta rápida (pool base, sin copiar) o lenta (garantías por grupo/serie) con fallback si vacía.
    const slow = needsFilter(req, repeatable);
    let fp = slow ? filtered(registry, pool, req, drawn, repeatable) : pool;
    let bucket = rollBucket(pack.weights, fp, slow ? 0 : req.minIdx, rng);
    if (!bucket && slow) {
      fp = filtered(registry, pool, { ...req, minIdx: 0 }, drawn, repeatable);
      bucket = rollBucket(pack.weights, fp, 0, rng);
    }
    // Asistencia imposible (no queda ningún jugador útil en el pool): hueco normal, nunca un hueco vacío.
    if (!bucket && req.assist) {
      const plain: SlotReq = { ...req, assist: undefined, minIdx: 0 };
      fp = needsFilter(plain, repeatable) ? filtered(registry, pool, plain, drawn, repeatable) : pool;
      bucket = rollBucket(pack.weights, fp, 0, rng);
    }
    if (!bucket) continue; // pool imposible para este hueco: se omite

    const candidates = fp[bucket];
    /*
     * LA ÚNICA LÍNEA DEL MOTOR QUE CAMBIA EN 8.3.
     *
     * Antes: `rng.pick(candidates)` — uniforme. Ahora: proporcional al peso configurado, y
     * con pesos iguales devuelve el MISMO índice consumiendo la MISMA tirada. Es el único
     * punto donde puede vivir la probabilidad por carta, y por eso es el único que se toca.
     */
    const rawCard = pickWeighted(candidates, weightOf, rng);
    const { card, compensated } = resolveAntiDup(policy, rawCard, candidates, flatAll, owned, registry, rng);
    const finalBucket = bucketForRank(registry.variant(card.variantId).rank);
    drawn.add(card.id);
    if (need.size > 0 && !helpedPlayers.has(card.playerId)) {
      const role = card.role ?? registry.player(card.playerId)?.role;
      const left = role ? need.get(role) : undefined;
      if (role && left !== undefined) {
        helpedPlayers.add(card.playerId);
        if (left <= 1) need.delete(role); else need.set(role, left - 1);
      }
    }

    decisions.push({
      card, bucket: finalBucket, compensated,
      byPity: forcedByPity && BUCKET_INDEX[finalBucket] >= BUCKET_INDEX[pack.pity!.minBucket],
    });
    pity = updatePity(pack, pity, finalBucket);
  }

  return { decisions, pityAfter: pity };
}

/* ═══════════════════════ Fase 57.3 · PACK CLASS DISTRIBUTION ═══════════════════════ */

/** Pool elegible del sobre agrupado por clase de sobre (cartas sin clase: fuera). */
export function classPool(registry: CardRegistry, pack: PackDef, dist: PackDistribution | null): Record<PackCardClass, CardDef[]> {
  const built = buildPool(registry, pack, dist);
  const hit = CLASS_POOL_CACHE.get(built);
  if (hit) return hit;
  const out = Object.fromEntries(PACK_CLASS_ORDER.map((c) => [c, [] as CardDef[]])) as Record<PackCardClass, CardDef[]>;
  for (const card of built.flat) {
    const k = packCardClass(card);
    if (k) out[k].push(card);
  }
  CLASS_POOL_CACHE.set(built, out);
  return out;
}
/** Colgada del `BuiltPool` (que ya está cacheado por registro + configuración): se invalida con él. */
const CLASS_POOL_CACHE = new WeakMap<object, Record<PackCardClass, CardDef[]>>();

/** Clase de un hueco: ponderada sobre la tabla ENTERA. Un cubo > 0 vacío aborta (nunca se renormaliza). UNA tirada. */
function rollClass(packId: string, table: ClassTable, pools: Record<PackCardClass, CardDef[]>, rng: Rng): PackCardClass {
  for (const c of PACK_CLASS_ORDER) if (table[c] > 0 && pools[c].length === 0) throw new EmptyPackClassError(packId, c);
  let total = 0;
  for (const c of PACK_CLASS_ORDER) total += Math.max(0, table[c]);
  let roll = rng.next() * total;
  let last: PackCardClass | null = null;
  for (const c of PACK_CLASS_ORDER) {
    if (table[c] <= 0) continue;
    last = c;
    roll -= table[c];
    if (roll < 0) return c;
  }
  // Solo por redondeo en el último tramo: la última clase con probabilidad.
  if (!last) throw new EmptyPackClassError(packId, "base");
  return last;
}

/**
 * Sorteo de la línea principal. Por hueco: (1) clase con la tabla de SU RANURA (`plan.regular` en los huecos normales,
 * `plan.featured` en el último: la ranura destacada); (2) cartas de esa clase dentro del pool del sobre (sus restricciones
 * de datos y, si hay pool persistido, su pertenencia y peso); (3) una carta, con peso = peso del pool × inclinación por
 * OVR del sobre (`ovrTiltWeight`); (4) la política anti-duplicado del sobre, SIEMPRE dentro de la misma clase. Sin
 * fallback a otra clase ni al catálogo. Consumo del RNG por hueco: una tirada de clase + una de carta (como antes).
 *
 * La tabla SUSTITUYE a las reglas por rareza de estos productos: `weights`, `guaranteedMin`, `guarantees` y `pity` no
 * intervienen (el `guaranteedMin` que conserva el `PackDef` es identidad de producto —arte, escalón—, no sorteo). El
 * pity se devuelve intacto. La asistencia de primer equipo no aplica: solo la recibe el Sobre Inicial.
 */
function openByClass(registry: CardRegistry, pack: PackDef, ctx: DecideContext, plan: MainPackPlan): OpenPackResult {
  const rng = makeRng(ctx.seed);
  const dist = ctx.distribution ?? null;
  const pools = classPool(registry, pack, dist);
  const base = dist ? (c: CardDef) => dist.weightOf(c.id) : () => DEFAULT_WEIGHT;
  const weightOf = plan.ovrTilt > 0 ? (c: CardDef) => base(c) * ovrTiltWeight(plan.ovrTilt, c.ovr) : base;
  const repeatable = pack.repeatable !== false;
  const policy = pack.antiDuplicate ?? "allow";
  const drawn = new Set<string>();

  const decisions: DropDecision[] = [];
  for (let i = 0; i < pack.cardCount; i++) {
    const table = i === pack.cardCount - 1 ? plan.featured : plan.regular;
    const k = rollClass(pack.id, table, pools, rng);
    const candidates = repeatable ? pools[k] : pools[k].filter((c) => !drawn.has(c.id));
    if (candidates.length === 0) throw new EmptyPackClassError(pack.id, k);
    const rawCard = pickWeighted(candidates, weightOf, rng);
    const { card, compensated } = resolveAntiDup(policy, rawCard, candidates, candidates, ctx.owned, registry, rng);
    drawn.add(card.id);
    decisions.push({ card, bucket: bucketForRank(registry.variant(card.variantId).rank), compensated, byPity: false });
  }
  return { decisions, pityAfter: ctx.pity };
}
