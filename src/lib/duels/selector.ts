/**
 * F72 · DUELOS 2.0 — EL SELECTOR DE MODO (presentación PURA).
 *
 * `/duelos` = ELEGIR MODO → VER LO MÍNIMO → JUGAR. Seleccionar un modo no navega: lo marca y enseña, dentro de su
 * propia tarjeta, lo imprescindible (rango del competitivo, entrada y premios del draft) y UN botón grande. Aquí se
 * decide qué botón es; los datos llegan del servidor (meta, competitivo, equipos, draft) y los destinos siguen siendo
 * los de siempre: la partida rápida, la cola ranked (`/duelos/pvp?buscar=`), el reto social y Draft Gauntlet.
 */
import { DUEL_MODE_IDS, type DraftModeFacts, type DuelModeId, type GameModeCard, type ModeStatus } from "@/lib/campaign/presentation";
import { DRAFT_MATCH_HREF, DRAFT_ROUTE, GAUNTLET_STAGES } from "@/domain/draft/rules";
import { editDeckHref, rankedPlayHref, type RankedGate, type StandingState } from "@/domain/pvpLadder/ranked";
import type { RankChip } from "@/domain/ranked/config";
import { ns, getIntlLocale } from "@/i18n/runtime";

const t = ns("duels");

/** Estados en reposo: el botón corto del modo. En cualquier otro manda el de `gameModes()` (retomar, sesión…). */
const RESTING: ReadonlySet<ModeStatus> = new Set(["DISPONIBLE", "PROVISIONAL"]);

export type SelectorCta =
  | { kind: "link"; label: string; href: string }
  | { kind: "enter"; label: string; fee: number; disabled: boolean; reason: string | null }
  | { kind: "wait"; label: string };

export const isDuelModeId = (v: unknown): v is DuelModeId => typeof v === "string" && (DUEL_MODE_IDS as readonly string[]).includes(v);

/** `?modo=` de la URL → modo seleccionado. Si no, el que tenga una partida abierta; si no, PARTIDA RÁPIDA. */
export function initialDuelMode(cards: readonly GameModeCard[], requested: string | null | undefined): DuelModeId {
  const q = (requested ?? "").toUpperCase();
  if (isDuelModeId(q)) return q;
  const open = cards.find((c) => c.status === "EN PARTIDA" && isDuelModeId(c.id));
  return open ? (open.id as DuelModeId) : "QUICK";
}

/** Lo que el competitivo enseña dentro de su tarjeta. Solo datos del servidor (`CompetitiveSnapshot` → escalera). */
export interface RankedInline {
  state: StandingState;
  /** Puesto en la escalera (solo clasificado). */
  position: number | null;
  rating: number;
  placementPlayed: number;
  placementTotal: number;
  first: boolean;
  /** F84 · rango de la temporada competitiva (derivado en el servidor), solo clasificado. */
  rank?: RankChip | null;
}

export function rankedHeadline(r: RankedInline): { big: string; label: string } {
  if (r.state === "UNRANKED") return { big: t("Sin clasificar"), label: t("Rating {rating}", { rating: r.rating }) };
  if (r.state === "PLACEMENT") return { big: t("Colocación {placementPlayed}/{placementTotal}", { placementPlayed: r.placementPlayed, placementTotal: r.placementTotal }), label: t("Rating {rating}", { rating: r.rating }) };
  // F84 · clasificado = el RANGO (Titular II…); el puesto del Top, si lo hay, acompaña al rating.
  if (r.rank) return { big: r.rank.label, label: t("Rating {rating}{v}", { rating: r.rating, v: r.position !== null ? ` · Top #${r.position}` : "" }) };
  return { big: r.position !== null ? `#${r.position}` : t("Clasificado"), label: t("Rating {rating}", { rating: r.rating }) };
}

/** Botón del competitivo: sin pasar por `/competitivo`. La puerta (equipo legal, partida abierta) es la de F55. */
export function rankedCta(card: GameModeCard, gate: RankedGate | null | "error"): SelectorCta {
  if (!RESTING.has(card.status)) return { kind: "link", label: card.cta.label, href: card.cta.href };
  if (gate === "error") return { kind: "link", label: t("Ver competitivo"), href: "/competitivo" };
  if (!gate) return { kind: "wait", label: t("Preparando…") };
  switch (gate.kind) {
    case "READY": return { kind: "link", label: t("Jugar"), href: rankedPlayHref(gate.deck.id) };
    case "RESUME": return { kind: "link", label: t("Continuar partida"), href: `/duelos/pvp?match=${gate.matchId}` };
    case "NO_DECKS": return { kind: "link", label: t("Crear equipo"), href: editDeckHref(null) };
    case "INVALID_DECK": return { kind: "link", label: t("Completar equipo"), href: editDeckHref(gate.deck.id) };
    default: return { kind: "link", label: t("Ver competitivo"), href: "/competitivo" };
  }
}

const fmt = (n: number) => new Intl.NumberFormat(getIntlLocale(), { useGrouping: "always" } as Intl.NumberFormatOptions).format(n);
export const creditsLabel = fmt;

/**
 * Botón de Draft Gauntlet. Run activa y pagada → CONTINUAR (nunca cobra). Sin run, o con la entrada sin cobrar →
 * ENTRAR · coste (la entrada la cobra el servidor al confirmar). `credits` es solo para avisar antes: manda el servidor.
 */
export function draftCta(card: GameModeCard, facts: DraftModeFacts | null | "loading" | undefined, fee: number, credits: number | null): SelectorCta {
  if (card.status === "INICIA SESIÓN" || card.status === "NO DISPONIBLE") return { kind: "link", label: card.cta.label, href: card.cta.href };
  if (facts === "loading" || facts === undefined) return { kind: "wait", label: t("Preparando…") };
  if (!facts || !facts.available) return { kind: "link", label: card.cta.label, href: card.cta.href };
  if (facts.status && !facts.entryPending) {
    return { kind: "link", label: t("Continuar"), href: facts.status === "IN_MATCH" ? DRAFT_MATCH_HREF : DRAFT_ROUTE };
  }
  const short = credits !== null && credits < fee;
  return { kind: "enter", label: t("Entrar · {fee}", { fee: fmt(fee) }), fee, disabled: short, reason: short ? t("Te faltan {v} créditos", { v: fmt(fee - credits!) }) : null };
}

/** Progreso real de una run activa, corto: «Draft 3/10» o «2/5 victorias». */
export function draftProgress(facts: DraftModeFacts | null | "loading" | undefined): string | null {
  if (!facts || facts === "loading" || !facts.status || facts.entryPending) return null;
  if (facts.status === "DRAFTING") return t("Draft {pick}/10", { pick: facts.pick });
  return t("{wins}/{total} victorias", { wins: facts.wins ?? Math.max(0, facts.stage - 1), total: GAUNTLET_STAGES });
}
