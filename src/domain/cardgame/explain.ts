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
import { ns, td } from "@/i18n/runtime";

const t = ns("cardgame");

/** Etiqueta del rol tal y como se muestra. `Controlador` es el «Smoker» del documento de diseño. */
export const ROLE_LABEL: Record<RoleId, string> = {
  Duelista: "Duelista",
  Controlador: "Controlador",
  Iniciador: "Iniciador",
  Centinela: "Centinela",
  Flex: "Flex",
};

/** Frase explicable para un error concreto. */
export function explainDeckError(e: DuelDeckError): string {
  switch (e.code) {
    case "DECK_SIZE": {
      const actual = e.actual ?? 0;
      if (actual < DUEL_DECK_SIZE) {
        const falta = DUEL_DECK_SIZE - actual;
        return falta === 1
          ? t("El mazo debe tener {DUEL_DECK_SIZE} cartas: te falta {n}.", { DUEL_DECK_SIZE, n: falta })
          : t("El mazo debe tener {DUEL_DECK_SIZE} cartas: te faltan {n}.", { DUEL_DECK_SIZE, n: falta });
      }
      return t("El mazo debe tener {DUEL_DECK_SIZE} cartas: tienes {actual}.", { DUEL_DECK_SIZE, actual });
    }
    case "ROLE_COUNT": {
      const role = ROLE_LABEL[e.role ?? "Flex"];
      const expected = e.expected ?? 0;
      const actual = e.actual ?? 0;
      return actual < expected
        ? expected === 1
          ? t("Necesitas {expected} carta de {role}; ahora tienes {actual}.", { expected, role: td(role), actual })
          : t("Necesitas {expected} cartas de {role}; ahora tienes {actual}.", { expected, role: td(role), actual })
        : t("Solo puedes llevar {expected} de {role}; ahora tienes {actual}.", { expected, role: td(role), actual });
    }
    case "DUPLICATE_CARD":
      return t("No puedes usar la misma carta dos veces en el mismo mazo.");
    case "DUPLICATE_PLAYER":
      return t("No puedes llevar dos cartas del mismo jugador, ni siquiera de variantes distintas.");
    case "CARD_NOT_FOUND":
      return t("Una de las cartas del mazo ya no existe en el catálogo.");
    case "CARD_NOT_OWNED":
      return t("Esa carta no pertenece a tu colección.");
    case "CARD_NO_COMBAT":
      return t("Esa carta no tiene estadísticas de combate y no puede jugarse.");
    case "INCOMPATIBLE_DATA_VERSION":
      return t("El mazo mezcla cartas de temporadas distintas ({v}). Todas deben ser de la misma.", { v: (e.versions ?? []).join(", ") });
    case "INVALID_CARD":
      return t("Una de las cartas del mazo no es válida.");
  }
}

/**
 * Resumen del estado del mazo en una frase. Se usa como cabecera del constructor; el detalle por
 * error va aparte.
 */
export function explainDeckValidation(v: DuelDeckValidation): string {
  if (v.valid) return t("Mazo listo para duelo.");
  if (v.errors.length === 1) return explainDeckError(v.errors[0]);
  const faltan = Object.values(v.missingByRole).reduce((a, b) => a + b, 0);
  if (faltan > 0) return faltan === 1 ? t("Te falta {n} carta por colocar.", { n: faltan }) : t("Te faltan {n} cartas por colocar.", { n: faltan });
  return t("El mazo tiene {length} problemas que resolver.", { length: v.errors.length });
}

/** Todos los errores traducidos, sin repetir la misma frase dos veces. */
export function explainAll(v: DuelDeckValidation): string[] {
  return [...new Set(v.errors.map(explainDeckError))];
}
