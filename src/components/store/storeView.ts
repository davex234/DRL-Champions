/**
 * TIENDA 4.0 — ayudantes de presentación (Fase 49). Sin economía: formatos, tonos y lecturas del
 * catálogo real para pintar. Ningún precio se escribe aquí.
 */
import type { CSSProperties } from "react";
import { formatPrice } from "@/config/monetization";
import { formatCredits } from "@/lib/format";
import { hexToRgbTriplet } from "@/design/environment";
import { packStats } from "@/data/packStats";
import { getPack } from "@/data/packs";
import { getCard, getPlayer } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { bucketForRank, BUCKET_LABEL, type PackDef, type RarityBucket } from "@/domain/packs/types";
import { packOddsFor, pct, tablePct, finePct, slotLines, ICON_COPY, type IconOdds } from "@/domain/packs/odds";
import { BUCKET_COLOR } from "@/components/packs/PackOdds";
import { PACK_CLASS_COLOR } from "@/domain/packs/packClass";
import { packIdentity, teamCardCount } from "@/components/packs/packIdentity";
import type { PaymentMethod, PurchaseOption, ResolvedProduct } from "@/domain/store/types";
import { ns, td } from "@/i18n/runtime";

const t = ns("store");

/** `#rrggbb` → `r g b`, para `rgb(var(--x) / α)`. */
export const rgbVar = (hex: string): string => hexToRgbTriplet(hex).replace(/,/g, " ");

/** Tono de un sobre/caja: el acento real del producto, y para los de la casa, el de su gama. */
export function packTone(pack: Pick<PackDef, "id" | "accent" | "guaranteedMin" | "team" | "eventId" | "price" | "restrictRegion">): string {
  const tier = packIdentity(pack).tier;
  if (tier === "legend") return BUCKET_COLOR.legendary;
  if (tier === "premium") return BUCKET_COLOR.epic;
  if (tier === "elite") return pack.accent;
  if (pack.team || pack.restrictRegion) return pack.accent;
  return BUCKET_COLOR.rare;
}

export const accentStyle = (hex: string): CSSProperties => ({ ["--acc-rgb" as string]: rgbVar(hex) });

export const rarityLabel = (b: RarityBucket): string => td(BUCKET_LABEL[b]);
export const rarityColor = (b: RarityBucket): string => BUCKET_COLOR[b];

/*
 * F72.4 · PROBABILIDADES DEL DETALLE DE COMPRA. Una sola derivación, la MISMA llamada que la ficha `/packs/[packId]`:
 * `packOddsFor(pack, packStats(pack.id), equipo)`. De ahí salen dos casos, y ninguno repite una cifra a mano:
 *
 *   · línea principal (Bronce… Icon): `classOdds`, derivado del plan por ranuras que usa `openPack` (Pack Opening 3.0):
 *     media EXACTA por carta (un decimal) + las líneas de ranura normal / destacada / mejor carta (`slotLines`).
 *   · el resto (regionales, equipos, eventos, inicial): el motor sortea por pesos + pool + garantía + pity y no tiene un
 *     «X %» declarado; la cifra honesta es la MEDIDA (`PACK_STATS`, 20.000 aperturas con el motor real, revalidada por
 *     `packStats.test`). Un sobre del panel sin medición cae a sus pesos normalizados (`source: "weights"`).
 *
 * El catálogo de la tienda ya no enseña nada de esto: solo el detalle, ANTES de confirmar.
 */
export type OddsSource = "class-table" | "measured" | "weights";
export interface OddsRowView { key: string; label: string; scope?: string; pct: string; perCard: number; color: string }
export interface OddsGroup {
  packId: string; packName: string; cardCount: number; source: OddsSource; rows: OddsRowView[];
  guarantee: string | null; teamBoost: string | null;
  /** Pack Opening 3.0 · solo la línea principal: ranuras, mejor carta e inclinación (mismas frases que la ficha). */
  slots?: string[];
  /** Icon por sobre (2026-10-09): la frase de la ficha y, en el Sobre Icon, la probabilidad exacta de cada Icon. */
  icon?: { text: string; cards: string[]; method: string | null } | null;
}

export function packOddsGroup(pack: PackDef): OddsGroup {
  const team = pack.team ? teamCardCount(pack.team) : null;
  const odds = packOddsFor(pack, packStats(pack.id) ?? null, team?.total ?? 0);
  const base = { packId: pack.id, packName: pack.name, cardCount: pack.cardCount, teamBoost: odds.teamBoost?.copy ?? null };
  if (odds.classOdds) {
    return {
      ...base, source: "class-table", guarantee: odds.classOdds.guarantee,
      // Media exacta por carta con un decimal (0,3 % no se redondea a 0 %): el mismo formato que la ficha.
      rows: odds.classOdds.rows.map((r) => ({ key: r.cls, label: r.label, scope: r.scope, pct: tablePct(r.perCard), perCard: r.perCard, color: PACK_CLASS_COLOR[r.cls] })),
      slots: (() => { const l = slotLines(odds.classOdds.slots); return [...(l.regular ? [l.regular] : []), l.featured, l.best, ...(l.tilt ? [l.tilt] : [])]; })(),
      icon: iconView(odds.classOdds.icon),
    };
  }
  const gMin = odds.guaranteedMin;
  return {
    ...base, source: odds.source, guarantee: gMin ? t("Garantiza al menos una {v} o superior", { v: td(BUCKET_LABEL[gMin]).toLowerCase() }) : null,
    rows: odds.rows.filter((r) => !r.impossible && r.perCard > 0).map((r) => ({ key: r.bucket, label: r.label, pct: pct(r.perCard), perCard: r.perCard, color: BUCKET_COLOR[r.bucket] })),
  };
}

/** La Icon por sobre, en frases (las mismas cifras exactas que la ficha). */
export function iconView(icon: IconOdds | null): OddsGroup["icon"] {
  if (!icon) return null;
  return {
    text: icon.text,
    cards: icon.guaranteed ? [...icon.cards.map((c) => t("{label} · OVR {ovr}: {p} por carta", { label: td(c.label), ovr: c.ovr, p: tablePct(c.p) })), ...(icon.top ? [ICON_COPY.topAtLeastOne(icon.top.ovr, icon.top.atLeastOne)] : [])] : [],
    method: icon.quality ? `${icon.quality.levels.map((l) => t("Nivel {value}: {p}", { value: formatGame(l.value), p: finePct(l.p) })).join(" · ")}. ${icon.quality.method}` : null,
  };
}

/** Las probabilidades de un producto: una tabla por TIPO de sobre que entrega (caja = la de su sobre). Carta: ninguna. */
export function productOdds(p: ResolvedProduct): OddsGroup[] {
  const ids = p.previewPack ? [p.previewPack.id] : [...new Set(p.grant.packs.map((x) => x.packId))];
  return ids.map((id) => (p.previewPack && p.previewPack.id === id ? p.previewPack : getPack(id))).filter((x): x is PackDef => !!x).map(packOddsGroup);
}

/**
 * F72.4 · EL PRECIO DE LA TARJETA DEL CATÁLOGO: uno solo. Créditos si el producto los acepta con precio; si no, euros
 * con precio; si ninguno tiene precio, «por anunciar». Los demás métodos se ven en el detalle.
 */
export function catalogPrice(p: ResolvedProduct): { kind: "credits" | "money" | "pending"; text: string } {
  const game = p.options.find((o) => o.method === "GAME_CURRENCY" && o.price !== null);
  if (game) return { kind: "credits", text: formatGame(game.price) };
  const money = p.options.find((o) => o.method === "REAL_MONEY" && o.price !== null);
  if (money) return { kind: "money", text: formatMoney(money.price) };
  return { kind: "pending", text: t("Precio por anunciar") };
}

/** Nombre comercial: el de la oferta, y en una carta el del jugador (el `name` de la oferta es el id de la carta). */
export function productName(p: ResolvedProduct): string {
  if (p.kind === "CARD" && p.cardId) return cardFacts(p.cardId)?.nick ?? p.name;
  if (p.kind === "PACK") return packOf(p)?.name ?? p.name;
  return p.name;
}

export interface CardFacts {
  id: string;
  image: string;
  nick: string;
  team: string;
  edition: string;
  rarity: RarityBucket;
  ovr: number;
  role: string;
}

/** Lo que se sabe de una carta del catálogo real para enseñarla (su arte ya lleva OVR, nombre y stats). */
export function cardFacts(cardId: string): CardFacts | null {
  const c = getCard(cardId);
  if (!c) return null;
  const variant = getVariant(c.variantId);
  return {
    id: c.id,
    image: c.image ?? `/cards/${c.id}.webp`,
    nick: getPlayer(c.playerId)?.nick ?? c.playerId,
    team: c.team ?? getPlayer(c.playerId)?.teamTag ?? "",
    edition: variant.label,
    rarity: bucketForRank(variant.rank),
    ovr: c.printed?.ovr ?? c.ovr,
    role: c.role ?? getPlayer(c.playerId)?.role ?? "",
  };
}

/** F60 · `previewPack`: la vista previa del panel pinta un sobre en BORRADOR (fuera del registro) con este mismo componente. */
export const packOf = (p: ResolvedProduct): PackDef | undefined => p.previewPack ?? (p.packId ? getPack(p.packId) : undefined);

export const formatMoney = (cents: number | null): string =>
  cents === null ? t("Por anunciar") : formatPrice({ cents, currency: "EUR" });

export const formatGame = (credits: number | null): string =>
  credits === null ? t("Por anunciar") : credits === 0 ? t("Gratis") : formatCredits(credits);

export const METHOD_LABEL: Record<PaymentMethod, string> = { GAME_CURRENCY: "DRL Credits", REAL_MONEY: "Dinero real" };

/** Texto corto del estado de un método, para el botón o la etiqueta. */
export function optionNote(o: PurchaseOption): string {
  switch (o.status) {
    case "AVAILABLE": return t("Disponible");
    case "PRICE_PENDING": return t("Precio por anunciar");
    case "CHECKOUT_PENDING": return t("Próximamente");
    case "FULFILMENT_PENDING": return t("Próximamente");
  }
}

/** Resumen del contenido de un producto en palabras del jugador. */
export function contentsLines(p: ResolvedProduct): string[] {
  const out: string[] = [];
  for (const x of p.grant.packs) {
    const pack = getPack(x.packId);
    out.push(`${x.count} × ${pack?.name ?? x.packId}${pack ? ` (${x.count * pack.cardCount === 1 ? t("1 carta") : t("{n} cartas", { n: x.count * pack.cardCount })})` : ""}`);
  }
  for (const id of p.grant.cardIds) {
    const f = cardFacts(id);
    out.push(f ? t("Carta garantizada: {nick} · {edition} ({rarity})", { nick: f.nick, edition: td(f.edition), rarity: rarityLabel(f.rarity) }) : id);
  }
  if (p.grant.credits > 0) out.push(`${formatCredits(p.grant.credits)} DRL Credits`);
  return out;
}
