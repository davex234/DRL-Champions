/**
 * ANÁLISIS DE DECK — química · sinergias · cobertura · fortalezas/debilidades (Collection Fase 3/7).
 *
 * NO inventa un motor de sinergias: COMPONE los existentes.
 *   • Roster real     → `@/lib/match` buildHomeRoster (Player Mapper, misma conversión que el Gameplay).
 *   • Composición     → `@/agents` buildLineup + analyzeComposition (arquetipo/fortalezas/coverage/sinergias).
 *   • Química         → `@/development` freshRelationship + teamChemistry.
 *   • Rating          → `@/store/selectors` squadRating.
 *   • Cobertura roles → `./roles` (reutiliza RoleId + roleToSimRole).
 * Puro y determinista (mismas entradas ⇒ mismo análisis). Nunca toca el Gameplay: solo prepara info.
 */
import type { OwnedCard } from "@/domain/cards/types";
import { getCard, getPlayer } from "@/data/catalog";
import { squadRating } from "@/store/selectors";
import { buildHomeRoster } from "@/lib/match/roster";
import { buildLineup, analyzeComposition, compareCompositions, type AssignInput } from "@/agents";
import { freshRelationship, relKey, teamChemistry } from "@/development";
import type { Relationship } from "@/development";
import type { Identity, RosterEntry } from "@/sim";
import { roleCoverage } from "./roles";
import type { Deck, DeckAnalysis, DeckCompatibility } from "./types";

const EMPTY: DeckAnalysis = {
  starters: 0, rating: 0, chemistry: 50,
  coverage: { byCardRole: { Duelista: 0, Iniciador: 0, Centinela: 0, Controlador: 0, Flex: 0 }, bySimRole: { entry: 0, support: 0, anchor: 0, lurk: 0, igl: 0 }, missing: ["Duelista", "Iniciador", "Centinela", "Controlador", "Flex"], balanced: false },
  archetype: "unknown", archetypeLabel: "—", playstyle: [], strengths: [], weaknesses: [], synergies: [], risks: [], iglUid: null, captainUid: null,
};

/** Roster mapeado + relaciones/coverage de un deck (base compartida de análisis/compatibilidad). */
function resolveDeck(deck: Deck, ownedCards: OwnedCard[]) {
  const byUid = new Map(ownedCards.map((o) => [o.uid, o]));
  const starterOwned = deck.starters.map((u) => byUid.get(u)).filter((o): o is OwnedCard => !!o);
  const { roster } = buildHomeRoster(deck.starters, ownedCards, { iglUid: deck.iglUid });
  const roleIds = starterOwned.map((o) => getPlayer(getCard(o.cardId)!.playerId)?.role).filter((r): r is NonNullable<typeof r> => !!r);
  return { starterOwned, roster, roleIds };
}

const NEUTRAL_SELFBELIEF = 50;

/** Química baseline del quinteto (reutiliza development): afinidad por personalidad, sin historial. */
function baselineChemistry(roster: RosterEntry[]): number {
  const ids = roster.map((r) => r.meta?.playerId ?? r.name);
  const rels: Record<string, Relationship> = {};
  for (let i = 0; i < roster.length; i++) {
    const ri = roster[i];
    for (let j = i + 1; j < roster.length; j++) {
      const rj = roster[j];
      const a = ids[i]!, b = ids[j]!;
      rels[relKey(a, b)] = freshRelationship(a, b, ri!.identity?.selfBelief ?? NEUTRAL_SELFBELIEF, rj!.identity?.selfBelief ?? NEUTRAL_SELFBELIEF);
    }
  }
  return teamChemistry(rels, ids);
}

/** Composición (reutiliza @/agents): asigna agentes al roster y analiza el quinteto. */
function composition(roster: RosterEntry[]) {
  const inputs: AssignInput[] = [];
  const identityByName: Record<string, Identity> = {};
  for (const r of roster) {
    if (!r.identity) continue;                 // el mapper siempre la puebla; guarda de tipos
    inputs.push({ name: r.name, role: r.role, identity: r.identity });
    identityByName[r.name] = r.identity;
  }
  return analyzeComposition(buildLineup(inputs), identityByName);
}

/** Análisis completo del deck. Determinista. */
export function deckAnalysis(deck: Deck, ownedCards: OwnedCard[]): DeckAnalysis {
  const { starterOwned, roster, roleIds } = resolveDeck(deck, ownedCards);
  if (roster.length === 0) return { ...EMPTY, captainUid: deck.captainUid ?? null };

  const comp = composition(roster);
  const iglEntry = roster.find((r) => r.role === "igl");
  return {
    starters: roster.length,
    rating: squadRating(starterOwned),
    chemistry: baselineChemistry(roster),
    coverage: roleCoverage(roleIds),
    archetype: comp.archetype,
    archetypeLabel: comp.archetypeLabel,
    playstyle: comp.playstyle,
    strengths: comp.strengths,
    weaknesses: comp.weaknesses,
    synergies: comp.synergies,
    risks: comp.risks,
    iglUid: deck.iglUid ?? (iglEntry?.meta?.cardUid ?? null),
    captainUid: deck.captainUid ?? null,
  };
}

/** Compatibilidad de un deck frente a otro (reutiliza @/agents compareCompositions). */
export function deckCompatibility(a: Deck, b: Deck, ownedCards: OwnedCard[]): DeckCompatibility {
  const ra = resolveDeck(a, ownedCards).roster;
  const rb = resolveDeck(b, ownedCards).roster;
  if (ra.length === 0 || rb.length === 0) return { favored: "even", margin: 0, notes: ["Deck incompleto."] };
  const m = compareCompositions(composition(ra), composition(rb));
  return { favored: m.edge > 5 ? "a" : m.edge < -5 ? "b" : "even", margin: m.edge, notes: m.recommendations };
}
