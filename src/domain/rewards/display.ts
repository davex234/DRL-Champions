/**
 * FASE 62 · UNA SOLA REPRESENTACIÓN DE LAS RECOMPENSAS (puro).
 *
 * Todo lo que NEXUS sabe conceder por su única ruta (`services/rewards.award` → RPC `app_grant_reward`) es, como mucho:
 * créditos, XP de CUENTA, sobres, una carta concreta, cosméticos y puntos de rango. Además, las misiones suman XP de
 * TEMPORADA al pase (no es una concesión del libro mayor: la suma `PassEngine` al reclamar). Aquí se normaliza cualquier
 * `Reward` —de misión, de nivel del pase, de logro, de duelo— a una lista de piezas que pinta `RewardDisplay`, con el
 * nombre de cada XP sin ambigüedad. `materials` existe en el tipo pero NO tiene ruta de entrega en el servidor: no se pinta.
 *
 * Sin React, sin red, sin reloj. No calcula recompensas: traduce las que ya decidió el servidor o el contenido.
 */

export type RewardItemKind = "credits" | "pack" | "card" | "accountXp" | "seasonXp" | "cosmetic" | "points";

export interface RewardItem {
  kind: RewardItemKind;
  /** Cantidad (créditos, XP, sobres, puntos). Cartas y cosméticos: 1. */
  amount: number;
  /** Id del sobre, de la carta o del cosmético. */
  ref?: string;
  label: string;
}

/** La forma mínima que llega del contenido o del servidor. */
export interface RewardLike {
  credits?: number;
  xp?: number;
  packId?: string;
  packCount?: number;
  cardId?: string;
  cosmetics?: string[];
}

export const XP_NAMES = {
  account: "XP de cuenta",
  season: "XP de temporada",
} as const;

const fmt = (n: number) => n.toLocaleString("es-ES", { useGrouping: "always" } as Intl.NumberFormatOptions);
const pos = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

export interface RewardContext {
  /** XP de temporada que suma al pase (misiones). */
  seasonXp?: number;
  /** Puntos de rango (duelo contra el bot). */
  points?: number;
  /** Nombre de un sobre por id (la UI pasa `getPack`), para no importar el catálogo en el dominio. */
  packName?: (id: string) => string | null;
  cardName?: (id: string) => string | null;
}

/**
 * `Reward` → piezas. `xp` de un `Reward` es SIEMPRE XP de cuenta (así la entrega `app_grant_reward`); la XP de
 * temporada llega aparte (`ctx.seasonXp`). Nunca se cuentan cantidades negativas ni ceros.
 */
export function rewardItems(r: RewardLike | null | undefined, ctx: RewardContext = {}): RewardItem[] {
  const out: RewardItem[] = [];
  if (r?.cardId) out.push({ kind: "card", amount: 1, ref: r.cardId, label: ctx.cardName?.(r.cardId) ?? "Carta" });
  if (r?.packId) {
    const n = Math.max(1, pos(r.packCount) || 1);
    const name = ctx.packName?.(r.packId) ?? "Sobre";
    out.push({ kind: "pack", amount: n, ref: r.packId, label: n > 1 ? `${n} × ${name}` : name });
  }
  if (pos(r?.credits)) out.push({ kind: "credits", amount: pos(r?.credits), label: `${fmt(pos(r?.credits))} créditos` });
  if (pos(ctx.seasonXp)) out.push({ kind: "seasonXp", amount: pos(ctx.seasonXp), label: `${fmt(pos(ctx.seasonXp))} ${XP_NAMES.season}` });
  if (pos(r?.xp)) out.push({ kind: "accountXp", amount: pos(r?.xp), label: `${fmt(pos(r?.xp))} ${XP_NAMES.account}` });
  for (const c of r?.cosmetics ?? []) out.push({ kind: "cosmetic", amount: 1, ref: c, label: cosmeticLabel(c) });
  if (pos(ctx.points)) out.push({ kind: "points", amount: pos(ctx.points), label: `${fmt(pos(ctx.points))} puntos de rango` });
  return out;
}

/** `titulo:leyenda-s1` → «Título · Leyenda S1». Sin asset propio: texto (no se inventa imagen). */
export function cosmeticLabel(id: string): string {
  const [family, rest = ""] = id.split(":");
  const FAM: Record<string, string> = { avatar: "Avatar", titulo: "Título", marco: "Marco", banderin: "Banderín" };
  const name = rest.split("-").map((w) => (/^s\d+$/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
  return `${FAM[family] ?? "Cosmético"} · ${name || id}`;
}

/** Texto de una lista de piezas («1 × Sobre Plata · 600 créditos»). */
export function rewardText(items: RewardItem[]): string {
  return items.length ? items.map((i) => i.label).join(" · ") : "Sin recompensa";
}

/**
 * NIVEL DE PRESENTACIÓN de una recompensa (F62 §20): no toda recompensa merece una revelación.
 *   · major    — carta, varios sobres, o ≥ 2.000 créditos: revelación con pausa;
 *   · standard — un sobre, o ≥ 500 créditos: aparece con énfasis breve;
 *   · minor    — el resto (XP, créditos pequeños, puntos): en línea, sin ceremonia.
 */
export type RewardTier = "minor" | "standard" | "major";

export function rewardTier(items: RewardItem[]): RewardTier {
  const credits = items.find((i) => i.kind === "credits")?.amount ?? 0;
  const packs = items.filter((i) => i.kind === "pack").reduce((s, i) => s + i.amount, 0);
  if (items.some((i) => i.kind === "card") || packs >= 2 || credits >= 2000) return "major";
  if (packs >= 1 || credits >= 500 || items.some((i) => i.kind === "cosmetic")) return "standard";
  return "minor";
}

/* ─────────────────────── validación de contenido (F62 §56) ─────────────────────── */

export interface RewardIssue { code: "EMPTY" | "NEGATIVE" | "NOT_INTEGER" | "UNKNOWN_PACK" | "UNKNOWN_CARD" | "UNKNOWN_FIELD" | "NO_DELIVERY"; field: string }

const KNOWN_FIELDS = new Set(["credits", "xp", "packId", "packCount", "cardId", "cosmetics", "materials"]);

/**
 * ¿Se puede publicar esta recompensa? La usa la salud de progresión del Admin y los tests de contenido. No inventa
 * reglas de economía: comprueba que la recompensa EXISTE y se puede ENTREGAR (sobre y carta conocidos, cantidades
 * enteras y positivas, campos conocidos, nada que el servidor no sepa entregar como `materials`).
 */
export function validateReward(
  r: Record<string, unknown> | null | undefined,
  known: { packExists: (id: string) => boolean; cardExists: (id: string) => boolean },
): RewardIssue[] {
  const out: RewardIssue[] = [];
  if (!r || typeof r !== "object") return [{ code: "EMPTY", field: "reward" }];
  for (const k of Object.keys(r)) if (!KNOWN_FIELDS.has(k)) out.push({ code: "UNKNOWN_FIELD", field: k });
  for (const k of ["credits", "xp", "packCount"] as const) {
    const v = r[k];
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v)) out.push({ code: "NOT_INTEGER", field: k });
    else if (v < 0) out.push({ code: "NEGATIVE", field: k });
    else if (!Number.isInteger(v)) out.push({ code: "NOT_INTEGER", field: k });
  }
  if (typeof r.packId === "string" && !known.packExists(r.packId)) out.push({ code: "UNKNOWN_PACK", field: "packId" });
  if (typeof r.cardId === "string" && !known.cardExists(r.cardId)) out.push({ code: "UNKNOWN_CARD", field: "cardId" });
  const mats = r.materials as Record<string, number> | undefined;
  if (mats && Object.values(mats).some((n) => (n ?? 0) > 0)) out.push({ code: "NO_DELIVERY", field: "materials" });
  const hasSomething = ["credits", "xp", "packId", "cardId"].some((k) => r[k] !== undefined && r[k] !== 0)
    || (Array.isArray(r.cosmetics) && r.cosmetics.length > 0);
  if (!hasSomething) out.push({ code: "EMPTY", field: "reward" });
  return out;
}
