/**
 * CARD REGISTRY + CARD IDENTITY (Collection Fase 1/7).
 *
 * Adaptador de SOLO LECTURA sobre el catálogo EXISTENTE (`@/data/catalog` + `@/domain/cards/variants`)
 * — NO crea otro catálogo. Construye índices (por jugador/variante/región/grupo/rareza) + un índice de
 * búsqueda para filtros/búsqueda instantáneos, y define los SETS/SERIES/SEASONS derivados. Card
 * Identity = `cardId` = `${playerId}__${variantId}`. Determinista, O(n) al construir.
 */
import { CARDS, getCard as catalogGetCard, getPlayer as catalogGetPlayer } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import type { CardDef, Player, VariantDef, VariantId, VariantGroup, Region, RoleId, SetDef } from "./types";
import { ns } from "@/i18n/runtime";

const t = ns("collection");

/** Card Identity: parte un cardId en su jugador + variante. */
export function parseCardId(cardId: string): { playerId: string; variantId: VariantId } {
  const i = cardId.lastIndexOf("__");
  return i < 0
    ? { playerId: cardId, variantId: "bronze" as VariantId }
    : { playerId: cardId.slice(0, i), variantId: cardId.slice(i + 2) as VariantId };
}
export const makeCardId = (playerId: string, variantId: VariantId): string => `${playerId}__${variantId}`;

const REGIONS: Region[] = ["EMEA", "Americas", "Pacific", "China"];
const ROLES: RoleId[] = ["Duelista", "Iniciador", "Centinela", "Controlador", "Flex"];
const SERIES: { id: string; label: string; match: (v: VariantId) => boolean }[] = [
  { id: "series-masters", label: "Masters Series", match: (v) => v.startsWith("masters") },
  { id: "series-champions", label: "Champions Series", match: (v) => v.startsWith("champions") },
  { id: "series-ewc", label: "EWC Series", match: (v) => v.startsWith("ewc") },
  { id: "series-icon", label: "Icon & Leyendas", match: (v) => v === "icon-series" || v === "hall-of-fame" || v === "prime" },
];

export interface SearchRow { cardId: string; hay: string }

/** Registro de cartas indexado (inmutable tras construir). */
export class CardRegistry {
  readonly cards: CardDef[];
  readonly total: number;
  private byId = new Map<string, CardDef>();
  private byPlayer = new Map<string, CardDef[]>();
  private byVariant = new Map<VariantId, CardDef[]>();
  private byGroup = new Map<VariantGroup, CardDef[]>();
  private byRegion = new Map<Region, CardDef[]>();
  private byRole = new Map<RoleId, CardDef[]>();
  private playerLookup: (id: string) => Player | undefined;
  private searchIndex: SearchRow[] = [];
  private sets: SetDef[] = [];

  /** Por defecto usa el catálogo vivo; se puede inyectar una instantánea (tests deterministas). */
  constructor(cards: CardDef[] = CARDS, playerLookup: (id: string) => Player | undefined = catalogGetPlayer) {
    this.cards = cards;
    this.total = cards.length;
    this.playerLookup = playerLookup;
    for (const c of cards) {
      this.byId.set(c.id, c);
      push(this.byPlayer, c.playerId, c);
      push(this.byVariant, c.variantId, c);
      const v = getVariant(c.variantId);
      push(this.byGroup, v.group, c);
      const p = playerLookup(c.playerId);
      if (p) { push(this.byRegion, p.region, c); push(this.byRole, c.role ?? p.role, c); }
      this.searchIndex.push({ cardId: c.id, hay: `${p?.nick ?? ""} ${p?.team ?? ""} ${p?.teamTag ?? ""} ${v.label}`.toLowerCase() });
    }
    this.sets = this.buildSets();
  }

  card(cardId: string): CardDef | undefined { return this.byId.get(cardId) ?? catalogGetCard(cardId); }
  player(playerId: string): Player | undefined { return this.playerLookup(playerId); }
  variant(variantId: VariantId): VariantDef { return getVariant(variantId); }
  has(cardId: string): boolean { return this.byId.has(cardId); }

  forPlayer(playerId: string): CardDef[] { return this.byPlayer.get(playerId) ?? []; }
  forVariant(variantId: VariantId): CardDef[] { return this.byVariant.get(variantId) ?? []; }
  forGroup(group: VariantGroup): CardDef[] { return this.byGroup.get(group) ?? []; }
  forRegion(region: Region): CardDef[] { return this.byRegion.get(region) ?? []; }
  /** Cartas cuyo jugador tiene este rol editorial (Fase 3: composición del mazo de duelos). */
  forRole(role: RoleId): CardDef[] { return this.byRole.get(role) ?? []; }
  search(): SearchRow[] { return this.searchIndex; }

  /** Todos los sets/series/temporadas derivados del catálogo. */
  allSets(): SetDef[] { return this.sets; }
  set(id: string): SetDef | undefined { return this.sets.find((s) => s.id === id); }

  private buildSets(): SetDef[] {
    const out: SetDef[] = [];
    // Por EDICIÓN (las 7 del catálogo diseñado, de mayor a menor rareza): la taxonomía de grupos antigua
    // (regional, MVP, ganadores…) ya no tiene cartas y no se ofrece como set.
    const editions = [...this.byVariant.keys()].sort((x, y) => getVariant(y).rank - getVariant(x).rank || getVariant(x).label.localeCompare(getVariant(y).label, "es"));
    for (const e of editions) { const ids = (this.byVariant.get(e) ?? []).map((c) => c.id); if (ids.length) out.push({ id: `edition-${e}`, kind: "group", label: getVariant(e).label, cardIds: ids }); }
    for (const r of REGIONS) { const ids = (this.byRegion.get(r) ?? []).map((c) => c.id); if (ids.length) out.push({ id: `region-${r}`, kind: "region", label: r, cardIds: ids }); }
    for (const role of ROLES) {
      const ids = (this.byRole.get(role) ?? []).map((c) => c.id); // rol de la CARTA (el impreso manda)
      if (ids.length) out.push({ id: `role-${role}`, kind: "role", label: role, cardIds: ids });
    }
    for (const s of SERIES) { const ids = this.cards.filter((c) => s.match(c.variantId)).map((c) => c.id); if (ids.length) out.push({ id: s.id, kind: "series", label: s.label, cardIds: ids }); }
    // Temporada base (única hoy): todo el catálogo. Fases futuras añaden temporadas nuevas.
    out.push({ id: "season-s1", kind: "season", label: t("Temporada 1"), cardIds: this.cards.map((c) => c.id) });
    return out;
  }
}

function push<K>(m: Map<K, CardDef[]>, k: K, c: CardDef): void { const a = m.get(k); if (a) a.push(c); else m.set(k, [c]); }
