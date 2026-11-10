import { ns } from "@/i18n/runtime";

const t = ns("pickems");

/**
 * F87.2 · ELEGIBILIDAD PARA RECIBIR RECOMPENSAS de Pick'ems 2.0 (anti-farmeo mínimo y proporcionado).
 *
 * Separa dos cosas que no deben mezclarse:
 *   · RENDIMIENTO (escalón): lo que el jugador ha logrado prediciendo. Nunca se toca.
 *   · ELEGIBILIDAD de la CUENTA para recibir el premio: madurez mínima de la cuenta.
 * Cualquiera con sesión puede predecir, puntuar y salir en la clasificación; solo el COBRO exige elegibilidad.
 *
 * Política v1 (`reward-eligibility-v1`), evaluada en el PRIMER CIERRE del ámbito (instante fijo, conocido de antemano):
 *   · la cuenta existía al menos 7 días antes del primer cierre, Y
 *   · tenía al menos 3 partidas COMPLETADAS (o empatadas) en modos con rival del servidor (PvE, Draft, ranked) antes
 *     del primer cierre. Las partidas privadas entre amigos NO cuentan (dos cuentas propias se las jugarían entre sí).
 * Señales SOLO del servidor: `auth.users.created_at` y `duel_matches` liquidadas por el motor. Ni IP, ni dispositivo,
 * ni teléfono, ni correo (F77 no es requisito).
 *
 * Autoridad: la BD (`app_pickem_reward_eligibility`, 0073) y el disparador del reclamo. Este módulo es el ESPEJO puro
 * para explicarlo en la interfaz y probar las fronteras; el cliente nunca decide.
 */

export const REWARD_ELIGIBILITY_V1 = "reward-eligibility-v1" as const;

export interface EligibilityPolicy {
  id: string;
  /** Días mínimos de antigüedad de la cuenta en el instante de referencia (primer cierre). */
  minAccountAgeDays: number;
  /** Partidas completadas mínimas antes del instante de referencia. */
  minCompletedMatches: number;
  /** Modos que cuentan (lista blanca: un modo nuevo no cuenta hasta que se decida). */
  countedModes: readonly string[];
  /** Estados de partida que cuentan como jugada. */
  countedStatuses: readonly string[];
}

/** Registro de políticas conocidas. Una política desconocida → nadie es elegible (falla cerrada). */
export const ELIGIBILITY_POLICIES: Readonly<Record<string, EligibilityPolicy>> = {
  [REWARD_ELIGIBILITY_V1]: {
    id: REWARD_ELIGIBILITY_V1, minAccountAgeDays: 7, minCompletedMatches: 3,
    countedModes: ["PVE", "DRAFT_GAUNTLET", "PVP"], countedStatuses: ["COMPLETED", "DRAW"],
  },
};

export const policyOf = (id: string | null | undefined): EligibilityPolicy | null => (id ? ELIGIBILITY_POLICIES[id] ?? null : null);

export type EligibilityCode =
  | "ELIGIBLE" | "ACCOUNT_TOO_NEW" | "NOT_ENOUGH_MATCHES" | "ACCOUNT_TOO_NEW_AND_NOT_ENOUGH_MATCHES"
  | "POLICY_MISSING" | "NO_REFERENCE" | "NO_ACCOUNT";

export interface Eligibility {
  eligible: boolean;
  code: EligibilityCode;
  policy: string | null;
  /** Primer cierre del ámbito: el instante en que se evalúa (y a partir del cual ya no cambia). */
  referenceAt: string | null;
  /** Desde cuándo la cuenta cumple la antigüedad. */
  ageOkFrom: string | null;
  matches: number;
  matchesRequired: number;
  /** true = ya pasó el primer cierre: el resultado es definitivo. */
  final: boolean;
}

export interface EligibilityInput {
  policyId: string | null | undefined;
  accountCreatedAt: string | null;
  /** Partidas que cuentan, terminadas ANTES de min(referencia, ahora). */
  completedMatches: number;
  referenceAt: string | null;
  now: number;
}

const DAY = 86_400_000;

/** Espejo exacto de `app_pickem_reward_eligibility` (0073). */
export function evaluateEligibility(x: EligibilityInput): Eligibility {
  const p = policyOf(x.policyId);
  const base = { policy: p?.id ?? null, referenceAt: x.referenceAt, ageOkFrom: null, matches: x.completedMatches, matchesRequired: p?.minCompletedMatches ?? 0, final: false };
  if (!p) return { ...base, eligible: false, code: "POLICY_MISSING" };
  const ref = x.referenceAt ? Date.parse(x.referenceAt) : NaN;
  if (!Number.isFinite(ref)) return { ...base, eligible: false, code: "NO_REFERENCE" };
  const created = x.accountCreatedAt ? Date.parse(x.accountCreatedAt) : NaN;
  if (!Number.isFinite(created)) return { ...base, eligible: false, code: "NO_ACCOUNT", final: x.now >= ref };
  const ageOkFrom = created + p.minAccountAgeDays * DAY;
  const ageOk = ageOkFrom <= ref;
  const matchesOk = x.completedMatches >= p.minCompletedMatches;
  const code: EligibilityCode = ageOk && matchesOk ? "ELIGIBLE" : !ageOk && !matchesOk ? "ACCOUNT_TOO_NEW_AND_NOT_ENOUGH_MATCHES" : !ageOk ? "ACCOUNT_TOO_NEW" : "NOT_ENOUGH_MATCHES";
  return { ...base, ageOkFrom: new Date(ageOkFrom).toISOString(), eligible: code === "ELIGIBLE", code, final: x.now >= ref };
}

/** Requisito en palabras (sin detalles internos de abuso). */
export function requirementText(p: EligibilityPolicy | null): string {
  if (!p) return t("Este Pick'em no tiene definidos los requisitos para recibir premios.");
  return t("Para recibir premios, tu cuenta debe tener al menos {minAccountAgeDays} días y {minCompletedMatches} partidas jugadas antes del primer cierre del Pick'em.", { minAccountAgeDays: p.minAccountAgeDays, minCompletedMatches: p.minCompletedMatches });
}

/** Mensaje para el jugador según el código (no culpabiliza; dice qué falta). */
export function eligibilityMessage(e: Eligibility): string {
  switch (e.code) {
    case "ELIGIBLE": return e.final ? t("Tu cuenta cumple los requisitos para recibir recompensas.") : t("Tu cuenta cumple los requisitos para recibir recompensas en este Pick'em.");
    case "ACCOUNT_TOO_NEW": return t("Puedes participar, pero esta cuenta todavía no cumple los requisitos para recibir recompensas: es demasiado reciente para este Pick'em.");
    case "NOT_ENOUGH_MATCHES": return e.final
      ? t("Puedes participar, pero esta cuenta todavía no cumple los requisitos para recibir recompensas: no tenía suficientes partidas jugadas antes del primer cierre.")
      : t("Puedes participar, pero esta cuenta todavía no cumple los requisitos para recibir recompensas: te faltan {Math} partida(s) antes del primer cierre.", { Math: Math.max(0, e.matchesRequired - e.matches) });
    case "ACCOUNT_TOO_NEW_AND_NOT_ENOUGH_MATCHES": return t("Puedes participar, pero esta cuenta todavía no cumple los requisitos para recibir recompensas.");
    default: return t("Puedes participar, pero esta cuenta todavía no cumple los requisitos para recibir recompensas.");
  }
}

/** Etiqueta corta para el panel de admin (sin datos personales). */
export const ELIGIBILITY_LABEL: Record<EligibilityCode, string> = {
  ELIGIBLE: "Elegible",
  ACCOUNT_TOO_NEW: "Cuenta demasiado reciente",
  NOT_ENOUGH_MATCHES: "Pocas partidas",
  ACCOUNT_TOO_NEW_AND_NOT_ENOUGH_MATCHES: "Reciente y pocas partidas",
  POLICY_MISSING: "Sin política de elegibilidad",
  NO_REFERENCE: "Sin primer cierre",
  NO_ACCOUNT: "Cuenta inexistente",
};
