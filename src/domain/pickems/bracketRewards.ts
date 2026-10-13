/**
 * F87 · PICK'EMS 2.0 — RECOMPENSAS POR ESCALÓN (puro).
 *
 * ────────────────────────── POR QUÉ ASÍ ──────────────────────────
 *
 * · ESCALONES NORMALIZADOS por PROPORCIÓN de puntos (puntos / máximo sin anulados), no por percentil:
 *   con 2 o 3 participantes un percentil es absurdo («top 10 %» de tres personas), y una proporción
 *   no depende de cuántos juegan ni del tamaño del cuadro. El mismo listón vale para un GSL de 7
 *   puntos y para un doble de 27.
 * · PARTICIPACIÓN REAL: haber predicho al menos `minCompletion` de los partidos puntuables antes de
 *   que cerraran. Abrir la página o hacer un pick no da nada.
 * · SE COBRA EL ESCALÓN MÁS ALTO, no la suma. Un reclamo por jugador y ámbito.
 * · PERFECTO = todos los puntuables con pick y acertados; un anulado no lo rompe, un hueco sin pick sí.
 * · Solo cosas que EXISTEN: sobres del catálogo (`getPack`), cartas del catálogo (`getCard`) e
 *   insignias de la familia `insignia:pickem:*`. Créditos permitidos pero con tope y aviso.
 * · Esto es CONFIGURACIÓN (vive en `pickem_brackets.rewards`, la escribe el admin): ningún componente
 *   contiene «si es Champions, da X».
 */
import { REWARD_ELIGIBILITY_V1 } from "./eligibility";
export type RewardTierId = "PARTICIPATION" | "GOOD" | "GREAT" | "ELITE" | "PERFECT";
export const TIER_ORDER: readonly RewardTierId[] = ["PARTICIPATION", "GOOD", "GREAT", "ELITE", "PERFECT"];
export const TIER_LABEL: Record<RewardTierId, string> = {
  PARTICIPATION: "Participación",
  GOOD: "Buen resultado",
  GREAT: "Gran resultado",
  ELITE: "Élite",
  PERFECT: "Pick'em perfecto",
};

export interface TierReward {
  packId?: string | null;
  packCount?: number | null;
  cardIds?: string[] | null;
  cosmetics?: string[] | null;
  credits?: number | null;
}

export interface TierConfig {
  id: RewardTierId;
  /** Proporción mínima de puntos (0..1). PARTICIPATION y PERFECT no la usan. */
  minRatio: number | null;
  reward: TierReward;
}

export type RewardStatus = "OFF" | "DRAFT" | "ACTIVE";

export interface BracketRewardConfig {
  /** Sube con cada cambio guardado. */
  version: number;
  /** F87.1 · reglas de las que sale la configuración (`pickem-rewards-v1` = la tabla aprobada). */
  rulesVersion?: string;
  /** F87.2 · política de elegibilidad de la CUENTA para cobrar (`reward-eligibility-v1`). Se congela con las recompensas. */
  eligibilityPolicy?: string;
  status: RewardStatus;
  /** Proporción mínima de partidos predichos para tener derecho a algo (0..1). */
  minCompletion: number;
  tiers: TierConfig[];
}

export const EMPTY_REWARDS: BracketRewardConfig = { version: 1, status: "OFF", minCompletion: 0.8, tiers: [] };

/** Tope de créditos por escalón: por encima, la configuración se rechaza (no es un premio, es un grifo). */
export const MAX_TIER_CREDITS = 5_000;
export const MAX_PACK_COUNT = 3;
export const MAX_CARD_COUNT = 1;
export const PICKEM_BADGE_PREFIX = "insignia:pickem:";

/**
 * `num / den ≥ frac` sin coma flotante: `frac` se lleva a milésimas (los listones son 0,5 / 0,7 / 0,8 / 0,85) y se
 * compara en enteros. Es lo que hace la BD con `numeric` exacto: 69,999… nunca pasa por 70 % por redondeo.
 */
export function atLeast(num: number, den: number, frac: number): boolean {
  if (!(den > 0)) return false;
  return num * 1000 >= Math.round(frac * 1000) * den;
}

/**
 * Escalón ganado según la puntuación final (resolución del SERVIDOR; orden PERFECT → ELITE → GREAT → GOOD →
 * PARTICIPATION → nada). NO acumulativo: un único escalón, el más alto. `null` = participación insuficiente.
 * Con los recuentos (`picked/scorable`, `points/maxPoints`) se decide en enteros; sin ellos, con las proporciones.
 */
export function tierFor(
  cfg: Pick<BracketRewardConfig, "minCompletion" | "tiers">,
  s: { completion: number; ratio: number; perfect: boolean; picked?: number; scorable?: number; points?: number; maxPoints?: number },
): RewardTierId | null {
  const exact = s.picked !== undefined && s.scorable !== undefined && s.points !== undefined && s.maxPoints !== undefined;
  const completionOk = exact ? atLeast(s.picked!, s.scorable!, cfg.minCompletion) : s.completion >= cfg.minCompletion;
  if (!completionOk) return null;
  const has = (id: RewardTierId) => cfg.tiers.some((t) => t.id === id);
  if (s.perfect && has("PERFECT")) return "PERFECT";
  let best: RewardTierId | null = has("PARTICIPATION") ? "PARTICIPATION" : null;
  for (const id of ["GOOD", "GREAT", "ELITE"] as const) {
    const t = cfg.tiers.find((x) => x.id === id);
    if (!t || t.minRatio === null) continue;
    if (exact ? atLeast(s.points!, s.maxPoints!, t.minRatio) : s.ratio >= t.minRatio) best = id;
  }
  // Un perfecto sin escalón PERFECT configurado cobra el mejor por proporción (ratio = 1).
  return best;
}

export interface CatalogLookup {
  packPrice: (packId: string) => number | null;
  cardExists: (cardId: string) => boolean;
  /** Valor interno de una carta (para el pasivo). `null` si no se sabe. */
  cardValue?: (cardId: string) => number | null;
}

export interface RewardIssue { severity: "ERROR" | "WARNING"; code: string; message: string; tier?: RewardTierId }

/** Valor interno de un escalón en créditos equivalentes (precio de tienda de los sobres + créditos + cartas). */
export function tierValue(r: TierReward, cat: CatalogLookup): number {
  const packs = r.packId ? (cat.packPrice(r.packId) ?? 0) * Math.max(0, r.packCount ?? 1) : 0;
  const cards = (r.cardIds ?? []).reduce((s, id) => s + (cat.cardValue?.(id) ?? 0), 0);
  return packs + cards + Math.max(0, r.credits ?? 0);
}

/** Validación de la configuración: lo que la UI promete es lo que el servidor entregará. */
export function validateRewards(cfg: BracketRewardConfig, cat: CatalogLookup): RewardIssue[] {
  const out: RewardIssue[] = [];
  const err = (code: string, message: string, tier?: RewardTierId) => out.push({ severity: "ERROR", code, message, tier });
  const warn = (code: string, message: string, tier?: RewardTierId) => out.push({ severity: "WARNING", code, message, tier });
  if (!(cfg.minCompletion >= 0.5 && cfg.minCompletion <= 1)) err("MIN_COMPLETION", "La participación mínima debe estar entre 50 % y 100 %.");
  const ids = new Set<RewardTierId>();
  for (const t of cfg.tiers) {
    if (!TIER_ORDER.includes(t.id)) { err("TIER_UNKNOWN", `Escalón desconocido: ${t.id}.`); continue; }
    if (ids.has(t.id)) err("TIER_DUP", `Escalón repetido: ${t.id}.`, t.id);
    ids.add(t.id);
    const needsRatio = t.id === "GOOD" || t.id === "GREAT" || t.id === "ELITE";
    if (needsRatio && !(typeof t.minRatio === "number" && t.minRatio > 0 && t.minRatio < 1)) err("RATIO", `${TIER_LABEL[t.id]}: proporción mínima entre 0 y 1.`, t.id);
    if (!needsRatio && t.minRatio !== null) err("RATIO", `${TIER_LABEL[t.id]} no usa proporción.`, t.id);
    const r = t.reward ?? {};
    const any = !!r.packId || (r.cardIds?.length ?? 0) > 0 || (r.cosmetics?.length ?? 0) > 0 || (r.credits ?? 0) > 0;
    if (!any) err("EMPTY_TIER", `${TIER_LABEL[t.id]} no entrega nada.`, t.id);
    if (r.packId) {
      if (cat.packPrice(r.packId) === null) err("PACK_UNKNOWN", `Sobre inexistente: ${r.packId}.`, t.id);
      const n = r.packCount ?? 1;
      if (!(Number.isInteger(n) && n >= 1 && n <= MAX_PACK_COUNT)) err("PACK_COUNT", `Entre 1 y ${MAX_PACK_COUNT} sobres.`, t.id);
    }
    if ((r.cardIds?.length ?? 0) > MAX_CARD_COUNT) err("CARD_COUNT", `Como mucho ${MAX_CARD_COUNT} carta por escalón.`, t.id);
    for (const c of r.cardIds ?? []) if (!cat.cardExists(c)) err("CARD_UNKNOWN", `Carta inexistente: ${c}.`, t.id);
    for (const c of r.cosmetics ?? []) if (!/^insignia:pickem:[a-z0-9-]{3,64}$/.test(c)) err("COSMETIC", `Solo insignias «${PICKEM_BADGE_PREFIX}…»: ${c}.`, t.id);
    if ((r.credits ?? 0) < 0 || !Number.isInteger(r.credits ?? 0)) err("CREDITS", "Créditos enteros y no negativos.", t.id);
    if ((r.credits ?? 0) > MAX_TIER_CREDITS) err("CREDITS_CAP", `Más de ${MAX_TIER_CREDITS} créditos en un escalón.`, t.id);
    if ((r.credits ?? 0) > 0) warn("CREDITS_USED", `${TIER_LABEL[t.id]} da créditos: preferible sobres/coleccionables.`, t.id);
  }
  // Listones crecientes y valor no decreciente: subir de escalón nunca puede empeorar.
  const ordered = TIER_ORDER.map((id) => cfg.tiers.find((t) => t.id === id)).filter((t): t is TierConfig => !!t);
  let lastRatio = 0, lastValue = 0;
  for (const t of ordered) {
    if (t.minRatio !== null) { if (t.minRatio <= lastRatio) err("RATIO_ORDER", `${TIER_LABEL[t.id]}: su listón debe superar al anterior.`, t.id); lastRatio = t.minRatio; }
    const v = tierValue(t.reward, cat);
    if (v < lastValue) err("VALUE_ORDER", `${TIER_LABEL[t.id]} vale menos que un escalón inferior.`, t.id);
    lastValue = Math.max(lastValue, v);
  }
  if (cfg.status === "ACTIVE" && cfg.tiers.length === 0) err("ACTIVE_EMPTY", "No se pueden activar recompensas vacías.");
  return out;
}

export interface Liability {
  perTier: { id: RewardTierId; value: number }[];
  /** Peor caso: todos los participantes en el escalón más caro. */
  worstCase: (participants: number) => number;
  maxTierValue: number;
}

export function liabilityOf(cfg: BracketRewardConfig, cat: CatalogLookup): Liability {
  const perTier = cfg.tiers.map((t) => ({ id: t.id, value: tierValue(t.reward, cat) }));
  const maxTierValue = Math.max(0, ...perTier.map((t) => t.value));
  return { perTier, maxTierValue, worstCase: (n) => n * maxTierValue };
}

/** Valor esperado por participante dada una distribución de escalones (probabilidades que suman ≤ 1). */
export function expectedValue(cfg: BracketRewardConfig, cat: CatalogLookup, dist: Partial<Record<RewardTierId | "NONE", number>>): number {
  return cfg.tiers.reduce((s, t) => s + (dist[t.id] ?? 0) * tierValue(t.reward, cat), 0);
}

/** Huella estable de la configuración congelada. */
export function canonicalRewards(cfg: BracketRewardConfig): string {
  return JSON.stringify({
    version: cfg.version, rulesVersion: cfg.rulesVersion ?? null, status: cfg.status, minCompletion: cfg.minCompletion,
    tiers: TIER_ORDER.map((id) => cfg.tiers.find((t) => t.id === id)).filter(Boolean).map((t) => [t!.id, t!.minRatio, t!.reward.packId ?? null, t!.reward.packCount ?? null, t!.reward.cardIds ?? [], t!.reward.cosmetics ?? [], t!.reward.credits ?? 0]),
    // F87.2 · al final y solo si existe: las configuraciones anteriores conservan su checksum.
    ...(cfg.eligibilityPolicy ? { eligibilityPolicy: cfg.eligibilityPolicy } : {}),
  });
}

/** Normaliza lo que llega del admin (o de la BD) a una configuración bien formada. */
export function parseRewards(raw: unknown): BracketRewardConfig {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const tiers = Array.isArray(o.tiers) ? o.tiers : [];
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return {
    version: Math.max(1, Math.floor(num(o.version, 1))),
    ...(typeof o.rulesVersion === "string" ? { rulesVersion: o.rulesVersion } : {}),
    ...(typeof o.eligibilityPolicy === "string" ? { eligibilityPolicy: o.eligibilityPolicy } : {}),
    status: o.status === "ACTIVE" || o.status === "DRAFT" ? o.status : "OFF",
    minCompletion: num(o.minCompletion, 0.8),
    tiers: tiers.map((t) => {
      const x = (t ?? {}) as Record<string, unknown>;
      const r = (x.reward ?? {}) as Record<string, unknown>;
      return {
        id: x.id as RewardTierId,
        minRatio: typeof x.minRatio === "number" ? x.minRatio : null,
        reward: {
          packId: typeof r.packId === "string" && r.packId ? r.packId : null,
          packCount: typeof r.packCount === "number" ? r.packCount : r.packId ? 1 : null,
          cardIds: Array.isArray(r.cardIds) ? r.cardIds.filter((c): c is string => typeof c === "string") : [],
          cosmetics: Array.isArray(r.cosmetics) ? r.cosmetics.filter((c): c is string => typeof c === "string") : [],
          credits: typeof r.credits === "number" ? r.credits : 0,
        },
      };
    }),
  };
}

/** F87.1 · versión de las reglas de recompensa APROBADAS (participación Bronce · 50 % Plata · 70 % Oro · 85 % Masters · perfecto Masters + insignia). */
export const REWARD_RULES_V1 = "pickem-rewards-v1" as const;

/**
 * REGLAS V1 APROBADAS (F87.1) para un ámbito. Una sola fuente: el panel las carga, la BD las exige exactas para
 * activar (`_pickem_rules_v1_ok`) y el reclamo entrega exactamente esto. `status` por defecto OFF: activar es un paso
 * aparte, explícito y auditado. La insignia de perfecto es POR ÁMBITO (`insignia:pickem:<slug>-perfecto`).
 */
export function rewardRulesV1(badgeSlug: string, status: RewardStatus = "OFF"): BracketRewardConfig {
  return {
    version: 1, rulesVersion: REWARD_RULES_V1, eligibilityPolicy: REWARD_ELIGIBILITY_V1, status, minCompletion: 0.8,
    tiers: [
      { id: "PARTICIPATION", minRatio: null, reward: { packId: "estandar", packCount: 1 } },
      { id: "GOOD", minRatio: 0.5, reward: { packId: "premium", packCount: 1 } },
      { id: "GREAT", minRatio: 0.7, reward: { packId: "oro", packCount: 1 } },
      { id: "ELITE", minRatio: 0.85, reward: { packId: "masters", packCount: 1 } },
      { id: "PERFECT", minRatio: null, reward: { packId: "masters", packCount: 1, cosmetics: [`${PICKEM_BADGE_PREFIX}${badgeSlug}-perfecto`] } },
    ],
  };
}

/** Compatibilidad con F87: la propuesta es hoy la regla v1 aprobada (en BORRADOR). */
export const proposedRewards = (badgeSlug: string): BracketRewardConfig => rewardRulesV1(badgeSlug, "DRAFT");

/** Espejo EXACTO de `_pickem_rules_v1_ok` (0072): ¿es esta configuración la v1 aprobada, sin variaciones? */
export function isRewardRulesV1(cfg: BracketRewardConfig, badgeSlug: string): boolean {
  if (cfg.rulesVersion !== REWARD_RULES_V1 || cfg.minCompletion !== 0.8 || cfg.tiers.length !== 5) return false;
  const want: Record<RewardTierId, [string, number | null]> = { PARTICIPATION: ["estandar", null], GOOD: ["premium", 0.5], GREAT: ["oro", 0.7], ELITE: ["masters", 0.85], PERFECT: ["masters", null] };
  const seen = new Set<RewardTierId>();
  for (const t of cfg.tiers) {
    const w = want[t.id];
    if (!w || seen.has(t.id)) return false;
    seen.add(t.id);
    const r = t.reward ?? {};
    if ((r.credits ?? 0) !== 0 || (r.cardIds?.length ?? 0) !== 0 || (r.packCount ?? 1) !== 1) return false;
    if (r.packId !== w[0] || (t.minRatio ?? null) !== w[1]) return false;
    const cos = r.cosmetics ?? [];
    if (t.id === "PERFECT" ? !(cos.length === 1 && cos[0] === `${PICKEM_BADGE_PREFIX}${badgeSlug}-perfecto`) : cos.length !== 0) return false;
  }
  return seen.size === 5;
}

/** Lo que el jugador ve: exactamente lo que entrega el servidor (mismo objeto). */
export function describeTierReward(r: TierReward, packName: (id: string) => string): string[] {
  const out: string[] = [];
  if (r.packId) out.push(`${(r.packCount ?? 1) > 1 ? `${r.packCount}× ` : ""}${packName(r.packId)}`);
  for (const _c of r.cardIds ?? []) out.push("Carta conmemorativa");
  for (const c of r.cosmetics ?? []) if (c.startsWith(PICKEM_BADGE_PREFIX)) out.push("Insignia «Pick'em perfecto»");
  if ((r.credits ?? 0) > 0) out.push(`${(r.credits ?? 0).toLocaleString("es-ES")} créditos`);
  return out;
}
