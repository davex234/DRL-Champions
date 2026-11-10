/**
 * PROYECCIÓN PRIVADA (Bloque 7.2).
 *
 * El problema, tal cual lo encontró la auditoría: `duel_matches.state` contiene los DOS
 * snapshots, así que la fila entera es el mazo secreto de ambos. Hoy es inocuo porque el
 * cliente no puede leer la fila (RLS deniega todo y no hay endpoint que la devuelva), pero en
 * PvP el rival es una persona con su propia sesión legítima, y «no se lo enviamos» deja de ser
 * una garantía si la frontera vive en React.
 *
 * Aquí se establece la frontera EN SERVIDOR:
 *
 *     SERVER STATE   (DuelMatch completo, ambos snapshots, ambos RNG)
 *          ├── proyección para A  →  su mazo entero + del de B solo lo ya jugado
 *          └── proyección para B  →  su mazo entero + del de A solo lo ya jugado
 *
 * NO es un `toPublicView` alternativo. `toPublicView` construye el MODELO DE VISTA que consume
 * la pantalla de duelos PvE (listas de elegibles, historial, textos). Esto es otra cosa y de
 * otra capa: una REDACCIÓN del estado, que devuelve un `DuelMatch` legítimo —el mismo tipo—
 * con lo que el espectador no tiene derecho a ver ya eliminado. Se puede volver a proyectar,
 * serializar o pasar al motor sin conversiones.
 *
 * Regla de visibilidad, que es la del propio juego y no una invención:
 *   · Tus cartas: todas.
 *   · Las del rival: solo las que ya ha jugado (turnos cerrados). DUEL GAMEPLAY UX 2.0 · la carta que el rival acaba
 *     de COMPROMETER atacando ya NO es pública: de ella solo se sabe la estadística declarada (la respuesta la impone la
 *     tabla). Ni la carta en su snapshot, ni su uid en `draft`. Se revela cuando el defensor ya comprometió su respuesta
 *     (el turno se cierra y pasa a `used*` y al historial).
 *   · Semillas y estado del generador: de nadie. Nunca viajan.
 */
import type { DuelDeckSnapshot, DuelMatch, Side } from "../match";
import { rivalHintsFor, rivalRolesFor, committedRivalHint, NO_COUNTRY, RAW_VISUAL, type CountryOf, type HiddenCardHint, type HintVisual } from "../hints";
import type { RoleId } from "../../cards/types";

const other = (s: Side): Side => (s === "A" ? "B" : "A");

/**
 * Recorta el snapshot del rival a lo que el espectador puede ver.
 *
 * Se conserva la FORMA del snapshot (mismo objeto, mismos campos) y solo se filtra `cards`:
 * quien reciba esto sigue sabiendo cuántas cartas quedan —eso es público, se cuentan sobre la
 * mesa— pero no CUÁLES.
 */
function redactSnapshot(snap: DuelDeckSnapshot, visibleUids: ReadonlySet<string>): DuelDeckSnapshot {
  return {
    ...snap,
    cards: snap.cards.filter((c) => visibleUids.has(c.uid)),
    /*
     * El barrido de seguridad del Bloque 7.3 encontró que el `deckId` y el `deckName` del rival
     * viajaban en cada respuesta. Ninguno de los dos hace falta para jugar: el id es un
     * identificador interno de un recurso de OTRA persona y el nombre es texto que ella escribió.
     * No eran explotables —`duel_decks` deniega la lectura ajena por RLS— pero tampoco tenían
     * por qué salir, y la regla de este bloque es que la proyección sea explícita, no una lista
     * negra. Se vacían.
     */
    deckId: "",
    deckName: "",
  };
}

/**
 * Proyecta el estado autoritativo para UN bando.
 *
 * Devuelve un `DuelMatch` con el snapshot del rival ya redactado. El resto del estado
 * —marcador, turno, fase, atacante, historial— es público por definición: son hechos que los
 * dos jugadores han presenciado.
 */
/**
 * F71 · El estado proyectado lleva, además, las PISTAS de las cartas ocultas del rival (una por
 * carta: país, liga, equipo o rol). Se calculan AQUÍ, con el mazo entero todavía en la mano, y
 * viajan ya hechas: el cliente nunca recibe las cartas para calcularlas él.
 */
export type ProjectedDuelMatch = DuelMatch & { rivalHints?: (HiddenCardHint | null)[]; rivalRoles?: (RoleId | null)[]; rivalCommitted?: { hint: HiddenCardHint | null; role: RoleId | null } | null };

export function projectMatchFor(match: DuelMatch, viewer: Side, countryOf: CountryOf = NO_COUNTRY, visual: HintVisual = RAW_VISUAL): ProjectedDuelMatch {
  const rival = other(viewer);
  const rivalUsed = rival === "A" ? match.usedA : match.usedB;

  // Solo lo ya jugado (turnos cerrados). La carta comprometida y aún no revelada NO entra.
  const visible = new Set<string>(rivalUsed);

  const redacted = redactSnapshot(rival === "A" ? match.snapshotA : match.snapshotB, visible);
  // Sobre el estado COMPLETO (antes de redactar) y con el id de la partida: la misma para A y B.
  const rivalHints = rivalHintsFor(match, viewer, countryOf, visual);
  const rivalRoles = rivalRolesFor(match, viewer, countryOf, visual);
  // AJUSTE · de la carta que el rival comprometió atacando, SOLO su pista y su rol (los mismos de la fila superior).
  const rivalCommitted = committedRivalHint(match, viewer, countryOf, visual);
  /*
   * DUEL GAMEPLAY UX 2.0 · el borrador del turno tampoco delata la carta oculta: el uid de la carta comprometida por el
   * rival (atacando o defendiendo) se borra. La estadística atacante se conserva: es pública y la necesita quien responde.
   */
  const draft = {
    ...match.draft,
    ...(match.attacker === rival ? { attackerCardUid: null } : {}),
    ...(match.attacker !== null && match.attacker !== rival ? { defenderCardUid: null, defenderStat: null } : {}),
  };

  return rival === "A"
    ? { ...match, snapshotA: redacted, draft, rivalHints, rivalRoles, rivalCommitted }
    : { ...match, snapshotB: redacted, draft, rivalHints, rivalRoles, rivalCommitted };
}

/**
 * ¿Filtra este estado alguna carta secreta del rival?
 *
 * Es la comprobación inversa, para los tests y para cualquier verificación futura: dado un
 * estado que se va a ENVIAR a `viewer`, ¿aparece alguna carta del rival que no debería?
 * Devuelve los uids indebidos, vacío si la proyección es correcta.
 */
export function leakedUids(projected: DuelMatch, viewer: Side, authoritative: DuelMatch): string[] {
  const rival = other(viewer);
  const rivalUsed = rival === "A" ? authoritative.usedA : authoritative.usedB;
  // DUEL GAMEPLAY UX 2.0 · solo las jugadas: la carta comprometida y no revelada también es una fuga (snapshot o draft).
  const allowed = new Set<string>(rivalUsed);
  const sent = rival === "A" ? projected.snapshotA : projected.snapshotB;
  const leaks = sent.cards.map((c) => c.uid).filter((uid) => !allowed.has(uid));
  for (const uid of [projected.draft.attackerCardUid, projected.draft.defenderCardUid]) {
    if (uid && !allowed.has(uid) && (rival === "A" ? authoritative.snapshotA : authoritative.snapshotB).cards.some((c) => c.uid === uid)) leaks.push(uid);
  }
  return leaks;
}
