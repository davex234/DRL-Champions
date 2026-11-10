/**
 * PISTAS DE LAS CARTAS OCULTAS DEL RIVAL (F71).
 *
 * Cada carta que el rival aún no ha jugado lleva EXACTAMENTE UNA pista pública: su país, su liga
 * (región), su equipo o su rol. Es información de presentación: no entra en el motor, ni en los bots,
 * ni en el combate, ni en la economía. Los bots no la leen.
 *
 * ─────────────────────── LAS TRES GARANTÍAS ───────────────────────
 *
 *  1. DETERMINISTA. El tipo de pista sale de un hash estable (FNV-1a de 32 bits) de
 *     `matchKey + ":" + uid`. La misma carta, en la misma partida, lleva la misma pista siempre y
 *     para cualquiera que mire (los dos jugadores de un PvP ven la misma). Sin `Math.random`, sin
 *     reloj y sin azar del cliente.
 *  2. SIN FUGAS. Cada pista es `{ type, value }` y nada más: ni uid, ni cardId, ni playerId, ni
 *     nick, ni foto, ni OVR, ni estadísticas, ni edición, ni serie, ni variante.
 *  3. EL ORDEN NO DELATA EL MAZO. La lista se ordena por otro hash de la carta, no por su posición
 *     en el mazo ni en la mano.
 *
 * Se calcula SIEMPRE en el servidor, donde está el mazo entero: el PvE en `server/services/duels`
 * y el PvP en `projectMatchFor`. El cliente solo recibe la lista ya hecha.
 *
 * F72.2 · PUERTO `HintVisual`. El valor que viaja es el id del ASSET que se va a pintar (ISO, rol oficial, liga VCT,
 * logo del equipo), no el texto de la carta. El puerto devuelve `null` si ese asset no existe y el tipo se salta igual
 * que un campo vacío: MISMO hash, MISMO orden cíclico. Por defecto es la identidad (dominio puro, pruebas); el
 * servidor pasa `visualHintValue` (`lib/duel/hintVisuals`).
 */
import type { DuelMatch, Side } from "./match";
import type { DuelDeckCard } from "./types";

export type HintType = "COUNTRY" | "REGION" | "TEAM" | "ROLE";

/** Orden canónico de los tipos. Si el campo elegido está vacío se pasa al SIGUIENTE (cíclico). */
export const HINT_TYPES: readonly HintType[] = ["COUNTRY", "REGION", "TEAM", "ROLE"];

export interface HiddenCardHint {
  type: HintType;
  value: string;
}

/** Puerto para el país: el dominio no conoce el catálogo de jugadores (lo pasa el servidor). */
export type CountryOf = (playerId: string) => string | null | undefined;
export const NO_COUNTRY: CountryOf = () => "";

/**
 * Puerto de representación: campo crudo → id del asset a pintar, o `null` si no se puede pintar (se salta el tipo).
 * F72.3: recibe también la carta (en el SERVIDOR) para resolver su equipo IMPRESO por `cardId`; lo que sale sigue siendo
 * solo el id del asset.
 */
export type HintVisual = (type: HintType, raw: string, card?: HintSource) => string | null;
export const RAW_VISUAL: HintVisual = (_type, raw) => raw || null;

/** Lo único que una pista puede mirar de una carta (`cardId` solo lo lee el puerto visual; nunca viaja). */
export type HintSource = Pick<DuelDeckCard, "uid" | "playerId" | "team" | "region" | "role"> & { cardId?: string };

/** FNV-1a de 32 bits. Estable, sin dependencias y sin `crypto`: el dominio sigue siendo puro. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function rawFor(type: HintType, card: HintSource, countryOf: CountryOf): string {
  switch (type) {
    case "COUNTRY": return String(countryOf(card.playerId) ?? "").trim().toUpperCase();
    case "REGION": return String(card.region ?? "").trim();
    case "TEAM": return String(card.team ?? "").trim();
    case "ROLE": return String(card.role ?? "").trim();
  }
}

/** La pista de UNA carta, o `null` si la carta no tiene ningún campo con valor (no ocurre: todas tienen rol). */
export function hintForCard(matchKey: string, card: HintSource, countryOf: CountryOf = NO_COUNTRY, visual: HintVisual = RAW_VISUAL): HiddenCardHint | null {
  const start = fnv1a32(`${matchKey}:${card.uid}`) % HINT_TYPES.length;
  for (let k = 0; k < HINT_TYPES.length; k++) {
    const type = HINT_TYPES[(start + k) % HINT_TYPES.length];
    const raw = rawFor(type, card, countryOf);
    const value = raw ? visual(type, raw, card) : null;
    if (value) return { type, value };
  }
  return null;
}

/**
 * Las pistas de un conjunto de cartas ocultas, en un orden que NO sigue el del mazo. UNA entrada por carta: `null`
 * cuando esa carta no tiene ninguna pista representable (F72.2: dorso normal). Así la lista sigue cuadrando con las
 * cartas ocultas y una carta sin pista no apaga las de las demás; `null` no revela nada.
 *
 * El orden lo da un segundo hash por carta (`…:order`); los empates, que con 32 bits son casi
 * imposibles, se rompen por tipo y valor, nunca por posición.
 */
export function hiddenCardHints(
  matchKey: string,
  hiddenCards: readonly HintSource[],
  countryOf: CountryOf = NO_COUNTRY,
  visual: HintVisual = RAW_VISUAL,
): (HiddenCardHint | null)[] {
  return hintRows(matchKey, hiddenCards, countryOf, visual).map(({ hint }) => (hint ? { type: hint.type, value: hint.value } : null));
}

/**
 * DUEL GAMEPLAY UX 2.0 · el ROL canónico de cada carta oculta, en el MISMO orden que `hiddenCardHints` (misma pasada,
 * mismo orden por hash): la carta i-ésima del reverso tiene su pista y su rol. No añade información estratégica: un
 * equipo lleva siempre 2 cartas de cada rol y las ya jugadas son públicas, así que los roles que le quedan al rival ya
 * se deducían; aquí solo se dibujan. Nunca uid, jugador, OVR ni estadísticas.
 */
export function hiddenCardRoles(
  matchKey: string,
  hiddenCards: readonly HintSource[],
  countryOf: CountryOf = NO_COUNTRY,
  visual: HintVisual = RAW_VISUAL,
): (HintSource["role"] | null)[] {
  return hintRows(matchKey, hiddenCards, countryOf, visual).map(({ role }) => role ?? null);
}

function hintRows(
  matchKey: string,
  hiddenCards: readonly HintSource[],
  countryOf: CountryOf,
  visual: HintVisual,
): { hint: HiddenCardHint | null; role: HintSource["role"] | null }[] {
  const rows: { order: number; hint: HiddenCardHint | null; role: HintSource["role"] | null }[] = [];
  for (const c of hiddenCards) {
    rows.push({ order: fnv1a32(`${matchKey}:${c.uid}:order`), hint: hintForCard(matchKey, c, countryOf, visual), role: c.role ?? null });
  }
  const typeIdx = (h: HiddenCardHint | null) => (h ? HINT_TYPES.indexOf(h.type) : HINT_TYPES.length);
  const val = (h: HiddenCardHint | null) => h?.value ?? "";
  rows.sort((a, b) =>
    a.order - b.order
    || typeIdx(a.hint) - typeIdx(b.hint)
    || (val(a.hint) < val(b.hint) ? -1 : val(a.hint) > val(b.hint) ? 1 : 0));
  // Objetos nuevos con solo dos campos: nada de la carta viaja por referencia.
  return rows.map(({ hint, role }) => ({ hint: hint ? { type: hint.type, value: hint.value } : null, role }));
}

/**
 * Las cartas del rival de `viewer` que aún no se han jugado, sobre el estado AUTORITATIVO (completo).
 * Incluye la que el rival acaba de comprometer atacando: sigue contando en su mano (`rivalRemaining`) hasta que se
 * cierre el turno. DUEL GAMEPLAY UX 2.0 · esa carta va boca abajo, y por eso NO se saca de aquí: si su pista y su rol
 * desaparecieran del reverso al comprometerla, se deducirían por diferencia.
 */
export function rivalUnplayedCards(match: DuelMatch, viewer: Side): DuelDeckCard[] {
  const rivalSnap = viewer === "A" ? match.snapshotB : match.snapshotA;
  const used = new Set(viewer === "A" ? match.usedB : match.usedA);
  return rivalSnap.cards.filter((c) => !used.has(c.uid));
}

/** Pistas del rival de `viewer`. La clave es el id de la partida: la misma para los dos jugadores. */
export function rivalHintsFor(match: DuelMatch, viewer: Side, countryOf: CountryOf = NO_COUNTRY, visual: HintVisual = RAW_VISUAL): (HiddenCardHint | null)[] {
  return hiddenCardHints(match.id, rivalUnplayedCards(match, viewer), countryOf, visual);
}

/** DUEL GAMEPLAY UX 2.0 · roles de las cartas ocultas del rival de `viewer`, alineados con `rivalHintsFor`. */
export function rivalRolesFor(match: DuelMatch, viewer: Side, countryOf: CountryOf = NO_COUNTRY, visual: HintVisual = RAW_VISUAL): (HintSource["role"] | null)[] {
  return hiddenCardRoles(match.id, rivalUnplayedCards(match, viewer), countryOf, visual);
}

/**
 * AJUSTE · PISTA DE LA CARTA COMPROMETIDA. El rival de `viewer` atacó y comprometió su carta (boca abajo hasta que
 * respondas): de ella viajan SOLO su pista pública y su rol canónico, por la MISMA función y con la MISMA clave
 * (`hintForCard(match.id, …)`) que pinta esa carta en la fila superior. Pista central = pista de arriba, por construcción.
 * Objetos nuevos de dos campos: ni uid, ni jugador, ni OVR, ni cifras. `null` si no hay carta comprometida del rival.
 */
export function committedRivalHint(
  match: DuelMatch,
  viewer: Side,
  countryOf: CountryOf = NO_COUNTRY,
  visual: HintVisual = RAW_VISUAL,
): { hint: HiddenCardHint | null; role: HintSource["role"] | null } | null {
  if (match.attacker === null || match.attacker === viewer || !match.draft.attackerStat || !match.draft.attackerCardUid) return null;
  const card = rivalUnplayedCards(match, viewer).find((c) => c.uid === match.draft.attackerCardUid);
  if (!card) return null;
  const h = hintForCard(match.id, card, countryOf, visual);
  return { hint: h ? { type: h.type, value: h.value } : null, role: card.role ?? null };
}
