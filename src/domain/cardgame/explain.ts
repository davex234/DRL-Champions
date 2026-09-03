/**
 * DUELOS — traducción de errores a lenguaje de producto (Fase 3).
 *
 * Los códigos de `DuelDeckError` son identificadores de dominio y NO se muestran nunca al jugador.
 * Aquí, y solo aquí, se convierten en frases que una persona entiende. Ninguna pantalla debe
 * inventar sus propios textos: si un error no se explica bien, se arregla en este fichero.
 *
 * Nunca se produce un "Mazo inválido" sin contexto.
 */
import type { DuelDeckError, DuelDeckValidation, RoleId } from "./types";
import { DUEL_DECK_SIZE } from "./types";

/** Etiqueta del rol tal y como se muestra. `Controlador` es el «Smoker» del documento de diseño. */
export const ROLE_LABEL: Record<RoleId, string> = {
  Duelista: "Duelista",
  Controlador: "Controlador",
  Iniciador: "Iniciador",
  Centinela: "Centinela",
  Flex: "Flex",
};

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Frase explicable para un error concreto. */
export function explainDeckError(e: DuelDeckError): string {
  switch (e.code) {
    case "DECK_SIZE": {
      const actual = e.actual ?? 0;
      if (actual < DUEL_DECK_SIZE) {
        const falta = DUEL_DECK_SIZE - actual;
        return `El mazo debe tener ${DUEL_DECK_SIZE} cartas: te ${plural(falta, "falta", "faltan")} ${falta}.`;
      }
      return `El mazo debe tener ${DUEL_DECK_SIZE} cartas: tienes ${actual}.`;
    }
    case "ROLE_COUNT": {
      const role = ROLE_LABEL[e.role ?? "Flex"];
      const expected = e.expected ?? 0;
      const actual = e.actual ?? 0;
      return actual < expected
        ? `Necesitas ${expected} ${plural(expected, "carta", "cartas")} de ${role}; ahora tienes ${actual}.`
        : `Solo puedes llevar ${expected} de ${role}; ahora tienes ${actual}.`;
    }
    case "DUPLICATE_CARD":
      return "No puedes usar la misma carta dos veces en el mismo mazo.";
    case "DUPLICATE_PLAYER":
      return "No puedes llevar dos cartas del mismo jugador, ni siquiera de variantes distintas.";
    case "CARD_NOT_FOUND":
      return "Una de las cartas del mazo ya no existe en el catálogo.";
    case "CARD_NOT_OWNED":
      return "Esa carta no pertenece a tu colección.";
    case "CARD_NO_COMBAT":
      return "Esa carta no tiene estadísticas de combate y no puede jugarse.";
    case "INCOMPATIBLE_DATA_VERSION":
      return `El mazo mezcla cartas de temporadas distintas (${(e.versions ?? []).join(", ")}). Todas deben ser de la misma.`;
    case "INVALID_CARD":
      return "Una de las cartas del mazo no es válida.";
  }
}

/**
 * Resumen del estado del mazo en una frase. Se usa como cabecera del constructor; el detalle por
 * error va aparte.
 */
export function explainDeckValidation(v: DuelDeckValidation): string {
  if (v.valid) return "Mazo listo para duelo.";
  if (v.errors.length === 1) return explainDeckError(v.errors[0]);
  const faltan = Object.values(v.missingByRole).reduce((a, b) => a + b, 0);
  if (faltan > 0) return `Te ${plural(faltan, "falta", "faltan")} ${faltan} ${plural(faltan, "carta", "cartas")} por colocar.`;
  return `El mazo tiene ${v.errors.length} problemas que resolver.`;
}

/** Todos los errores traducidos, sin repetir la misma frase dos veces. */
export function explainAll(v: DuelDeckValidation): string[] {
  return [...new Set(v.errors.map(explainDeckError))];
}
