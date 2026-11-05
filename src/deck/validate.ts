/**
 * VALIDACIÓN DE DECKS (Collection Fase 3/7).
 *
 * REUTILIZA `validateTeam` de `@/domain/teams` (nombre/5 titulares/cartas repetidas/uids repetidos/
 * cartas inexistentes/titular-en-suplentes) y le AÑADE la capa de escuadra: capitán/IGL/coach válidos,
 * solape de reservas, cupos de banquillo/reservas y cobertura de roles. Clasifica la validez del deck
 * (empty/incomplete/valid/competitive) sin inventar reglas nuevas. Puro y determinista.
 */
import { validateTeam, MAX_SUBS, MAX_RESERVES } from "@/domain/teams/types";
import { roleCoverage } from "./roles";
import type { Deck, DeckIssue, DeckValidation, DeckValidity, ResolvedCard, TeamError, RoleId } from "./types";

const err = (e: TeamError): DeckIssue => ({ ...e, level: "error" });
const warn = (e: TeamError): DeckIssue => ({ ...e, level: "warning" });

/**
 * Valida un deck contra la colección. `resolve` traduce un uid a su carta resuelta (o null si no
 * existe/no es del usuario). Devuelve TODOS los problemas + la clasificación de validez.
 */
export function validateDeck(deck: Deck, resolve: (uid: string) => ResolvedCard | null): DeckValidation {
  const issues: DeckIssue[] = validateTeam(deck, resolve).map(err);   // reutiliza la validación base
  const missing: string[] = [];

  const starterSet = new Set(deck.starters);
  const subs = deck.subs ?? [];
  const reserves = deck.reserves ?? [];

  // Resolución + roles de los titulares (para cobertura). Registra faltantes.
  const roles: RoleId[] = [];
  for (const uid of deck.starters) {
    const r = resolve(uid);
    if (!r) { missing.push(uid); continue; }
    roles.push(r.role);
  }

  // Capitán / IGL deben ser titulares; coach NO puede ser titular.
  if (deck.captainUid && !starterSet.has(deck.captainUid)) issues.push(err({ code: "CAPTAIN_NOT_STARTER", message: "El capitán debe ser un titular." }));
  if (deck.iglUid && !starterSet.has(deck.iglUid)) issues.push(err({ code: "IGL_NOT_STARTER", message: "El IGL debe ser un titular." }));
  if (deck.coachUid && starterSet.has(deck.coachUid)) issues.push(err({ code: "COACH_IN_STARTERS", message: "El coach no puede ser además titular." }));

  // Reservas: sin solape con titulares/suplentes; cupos.
  const subSet = new Set(subs);
  if (reserves.some((u) => starterSet.has(u) || subSet.has(u))) issues.push(err({ code: "RESERVE_OVERLAP", message: "Una reserva no puede estar en titulares/suplentes." }));
  if (subs.length > MAX_SUBS) issues.push(err({ code: "TOO_MANY_SUBS", message: `Demasiados suplentes: ${subs.length}/${MAX_SUBS}.` }));
  if (reserves.length > MAX_RESERVES) issues.push(err({ code: "TOO_MANY_RESERVES", message: `Demasiadas reservas: ${reserves.length}/${MAX_RESERVES}.` }));

  // Cobertura de roles (aviso, no invalida): un quinteto sano cubre varios roles.
  const coverage = roleCoverage(roles);
  if (deck.starters.length === 5 && !coverage.balanced) issues.push(warn({ code: "MISSING_ROLE_COVERAGE", message: "Cobertura de roles pobre (equipo desequilibrado)." }));

  const errors = issues.filter((i) => i.level === "error");
  const ok = errors.length === 0;
  return { ok, validity: classify(deck, ok, coverage.balanced), issues, missing };
}

function classify(deck: Deck, ok: boolean, balanced: boolean): DeckValidity {
  if (deck.starters.length === 0) return "empty";
  if (!ok || deck.starters.length !== 5) return "incomplete";
  // Válido y jugable. "competitive" si además cubre roles y tiene IGL designado.
  return balanced && !!deck.iglUid ? "competitive" : "valid";
}

/** ¿El deck es jugable (sin errores, 5 titulares)? */
export function isPlayable(v: DeckValidation): boolean {
  return v.ok && (v.validity === "valid" || v.validity === "competitive");
}
