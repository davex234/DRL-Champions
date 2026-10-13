/**
 * DECK & SQUAD BUILDER ENGINE — orquestador (Collection Fase 3/7).
 *
 * Capa ENTRE Collection y Gameplay. Compone validación (`@/domain/teams` + squad), análisis (agents/
 * development), filtros (Collection) y el handoff al Player Mapper. NO posee cartas/roster/Player/Team/
 * Gameplay: los reutiliza. Puro y determinista (id/reloj entran por parámetro en las mutaciones).
 *
 *   Collection → DeckEngine → Roster (Player Mapper) → Gameplay → Career → Online
 */
import type { OwnedCard } from "@/domain/cards/types";
import { getCard, getPlayer } from "@/data/catalog";
import { squadRating } from "@/store/selectors";
import { CollectionEngine, type CardView, type FilterSpec } from "@/collection";
import type { RivalDifficulty } from "@/lib/match/roster";
import { validateDeck, isPlayable } from "./validate";
import { deckAnalysis, deckCompatibility } from "./analysis";
import { deckCandidates, filterOwnedInstances, type DeckFilterOpts, type OwnedInstanceFilter } from "./filters";
import { deckToRosters, deckToHomeRoster } from "./roster";
import type { Deck, DeckAnalysis, DeckCompatibility, DeckSummary, DeckValidation, ResolvedCard } from "./types";

export class DeckEngine {
  private byUid: Map<string, OwnedCard>;
  private col: CollectionEngine;
  readonly lockedUids: Set<string>;

  constructor(private ownedCards: OwnedCard[] = [], opts: { collection?: CollectionEngine; lockedUids?: Set<string> } = {}) {
    this.byUid = new Map(ownedCards.map((o) => [o.uid, o]));
    this.col = opts.collection ?? new CollectionEngine(ownedCards);
    this.lockedUids = opts.lockedUids ?? new Set();
  }

  /** Resuelve un uid a su carta poseída (o null). Reutiliza el catálogo; no duplica datos de carta. */
  resolve = (uid: string): ResolvedCard | null => {
    const owned = this.byUid.get(uid);
    if (!owned) return null;
    const card = getCard(owned.cardId);
    if (!card) return null;
    const player = getPlayer(card.playerId);
    if (!player) return null;
    return { uid, playerId: card.playerId, ovr: card.ovr, role: card.role ?? player.role, locked: this.lockedUids.has(uid) };
  };

  validate(deck: Deck): DeckValidation { return validateDeck(deck, this.resolve); }
  isPlayable(deck: Deck): boolean { return isPlayable(this.validate(deck)); }
  analyze(deck: Deck): DeckAnalysis { return deckAnalysis(deck, this.ownedCards); }
  compatibility(a: Deck, b: Deck): DeckCompatibility { return deckCompatibility(a, b, this.ownedCards); }

  // ── Filtros del builder (reutilizan Collection) ──
  candidates(spec: FilterSpec, opts?: DeckFilterOpts): CardView[] { return deckCandidates(this.col, spec, opts); }
  ownedInstances(f: OwnedInstanceFilter): OwnedCard[] { return filterOwnedInstances(this.col, this.ownedCards, { lockedUids: this.lockedUids, ...f }); }
  /** Mejor uid poseído de una carta (menor nº de serie) para autocompletar una selección. */
  bestUidFor(cardId: string): string | null {
    const insts = this.col.ownership().instancesOf(cardId);
    if (!insts.length) return null;
    return [...insts].sort((a, b) => (a.serial ?? Infinity) - (b.serial ?? Infinity))[0].uid;
  }

  // ── Handoff a Gameplay (Player Mapper) ──
  toRosters(deck: Deck, seed: number, difficulty: RivalDifficulty = "normal") { return deckToRosters(deck, this.ownedCards, seed, difficulty); }
  homeRoster(deck: Deck) { return deckToHomeRoster(deck, this.ownedCards); }

  /** Resumen ligero de un deck (listados/UI). */
  summary(deck: Deck): DeckSummary {
    const starterOwned = deck.starters.map((u) => this.byUid.get(u)).filter((o): o is OwnedCard => !!o);
    return {
      id: deck.id, name: deck.name, kind: deck.kind ?? "custom", favorite: !!deck.favorite,
      starters: deck.starters.length, validity: this.validate(deck).validity, rating: squadRating(starterOwned),
    };
  }
}
