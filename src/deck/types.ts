/**
 * DECK & SQUAD BUILDER — vocabulario compartido (Collection Fase 3/7).
 *
 * El Deck Builder NO juega: es la capa entre Collection y Gameplay que CONSTRUYE la selección de
 * equipo (titulares/suplentes/reservas + capitán/IGL/coach) que después consume el Player Mapper y el
 * Match Engine. NO crea otro modelo de jugador/roster/Team/Identity/Gameplay: reutiliza `@/domain/teams`
 * (composición + `validateTeam`), `@/lib/match` (Player Mapper → `MatchRosters`), `@/collection`
 * (cartas + filtros), `@/agents` (composición/sinergias) y `@/development` (química). Puro y
 * determinista (sin `Math.random`/`Date.now`: id y reloj entran por parámetro).
 *
 *   Collection → Deck Builder → Roster Builder (mapper) → Gameplay → Career → Online
 */
import type { Deck, DeckKind, Team, TeamError, TeamErrorCode, CardRef } from "@/domain/teams/types";
import type { CardView, CardOrigin } from "@/collection";
import type { RoleId } from "@/domain/cards/types";
import type { Role } from "@/sim";

export type { Deck, DeckKind, Team, TeamError, TeamErrorCode, CardRef, CardView, RoleId, Role };
export { DECK_SCHEMA_VERSION, MAX_STARTERS, MAX_SUBS, MAX_RESERVES } from "@/domain/teams/types";

/** Severidad de un problema de deck (los errores invalidan; los avisos no). */
export type IssueLevel = "error" | "warning";
export interface DeckIssue extends TeamError { level: IssueLevel }

/** Clasificación de validez del deck (derivada, no inventa reglas: usa la validación). */
export type DeckValidity =
  | "empty"        // sin titulares
  | "incomplete"   // faltan titulares o hay errores
  | "valid"        // 5 titulares consistentes (jugable)
  | "competitive"; // válido + IGL + cobertura de roles (apto para competitivo)

/** Resultado completo de validar un deck. */
export interface DeckValidation {
  ok: boolean;
  validity: DeckValidity;
  issues: DeckIssue[];
  /** uids de titulares que no se pudieron resolver. */
  missing: string[];
}

/** Insumo mínimo para resolver un uid a su carta (reutiliza CardRef del dominio). */
export interface ResolvedCard extends CardRef {
  ovr: number;
  role: RoleId;
  locked: boolean;
}

// ───────────────────────────── Análisis (sinergias/química/cobertura) ─────────────────────────────

/** Cobertura de roles del quinteto (reutiliza RoleId de la carta y Role del sim; no inventa roles). */
export interface RoleCoverage {
  byCardRole: Record<RoleId, number>;   // Duelista/Iniciador/Centinela/Controlador/Flex
  bySimRole: Record<Role, number>;      // entry/support/anchor/lurk/igl (derivado por el mapper)
  missing: RoleId[];                    // roles del catálogo sin cubrir
  balanced: boolean;                    // ¿reparto sano (no todo duelistas)?
}

/**
 * Análisis del deck: química + sinergias + cobertura + equilibrio + fortalezas/debilidades.
 * TODO se compone de motores existentes (agents/development/identity/selectors); no hay motor nuevo.
 */
export interface DeckAnalysis {
  starters: number;
  rating: number;                       // OVR medio del quinteto (reutiliza squadRating)
  chemistry: number;                    // 0..100 (reutiliza development.teamChemistry)
  coverage: RoleCoverage;
  /** Perfil de composición (reutiliza @/agents analyzeComposition sobre el roster mapeado). */
  archetype: string;
  archetypeLabel: string;
  playstyle: string[];
  strengths: string[];
  weaknesses: string[];
  synergies: string[];
  risks: string[];
  /** Igl elegido para el análisis (uid) — explícito del deck o derivado por liderazgo. */
  iglUid: string | null;
  captainUid: string | null;
}

/** Compatibilidad frente a otro deck (reutiliza @/agents compareCompositions). */
export interface DeckCompatibility {
  favored: "a" | "b" | "even";
  margin: number;
  notes: string[];
}

// ───────────────────────────── Import / export ─────────────────────────────

/** Formato portable de un deck (sin datos de carta: solo la composición por uid). */
export interface DeckExport {
  format: "drl-deck";
  version: number;
  deck: Omit<Team, "createdAt" | "lastUsedAt">;
}

/** Resumen ligero de un deck (listados/UI). */
export interface DeckSummary {
  id: string;
  name: string;
  kind: DeckKind;
  favorite: boolean;
  starters: number;
  validity: DeckValidity;
  rating: number;
}

/** Origen por defecto de un deck importado (para trazabilidad, reutiliza CardOrigin). */
export type DeckSource = CardOrigin;
