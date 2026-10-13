/**
 * IDENTIDAD DE EQUIPO — ACTUAL vs. HISTÓRICA (Fase 20.3).
 *
 * ────────────────────────── QUÉ RESUELVE, Y QUÉ NO ──────────────────────────
 *
 * Hoy `Player.team` (y `content_players.team`) es UN string que significa dos cosas a la vez:
 * «el equipo del jugador HOY» y «el equipo con el que existe esta carta HISTÓRICA». La Fase 20.3
 * lo separa en dos conceptos EXPLÍCITOS, **sin reescribir ningún dato**:
 *
 *     CURRENT_TEAM_IDENTITY    → a qué equipo canónico pertenece un alias por el roster ACTUAL
 *     HISTORICAL_TEAM_CONTEXT  → un alias que se refiere al equipo pero NO es fuente de roster actual
 *
 * **Esta capa solo RESUELVE; nunca MODIFICA.** No toca `content_players.team`, ni `content_cards`,
 * ni `content_card_versions`, ni `user_cards`, ni `card_mints`, ni `market_listings`, ni la
 * maestría. No fusiona identidades. No crea Team Packs. Es una fuente de verdad de solo lectura
 * construida sobre datos que YA existen en el proyecto (`data/teamPackCatalog.ts`, auditado y con
 * tests en la Fase 20.2, y el roster VLR 2026 ya importado).
 *
 * ────────────────────────── LAS REGLAS DE PRODUCTO QUE CODIFICA ──────────────────────────
 *
 *   · La identidad ACTUAL la determina el roster VLR 2026 (`currentAliases`).
 *   · Las cartas existentes conservan su contexto HISTÓRICO (`historicalAliases`).
 *   · **Gen.G y GEN se mantienen SEPARADOS y UNVERIFIED** (decisión 10). Son dos entradas y
 *     NINGUNA lista el alias de la otra: `resolve("GEN")` y `resolve("Gen.G")` nunca coinciden.
 *   · Ningún alias ambiguo se resuelve «por defecto» a un equipo (decisión 11): si un alias
 *     perteneciera a más de una identidad, `resolve` devuelve `undefined`, no elige.
 *   · No se inventan identidades: el registro cubre exactamente los equipos que la auditoría de
 *     la Fase 20.2 soporta (los 24 objetivo), más NAVI (Team Pack vivo) y el parecido `G2 Gozen`.
 *     Cualquier otro valor de `Player.team` (AG, BST, MIBR, …) resuelve a `undefined` — seguro,
 *     no una identidad falsa.
 *
 * `status` («verified»/«unverified») se mantiene alineado con el estado de la auditoría 20.2
 * (`data/teamPackCatalog.ts`): BLOCKED ⇒ unverified. Lo verifica `teamIdentities.test.ts`, así
 * que no es una etiqueta a mano que pueda quedarse mintiendo.
 */
import { TEAM_PACK_AUDIT } from "./teamPackCatalog";
import type { TeamRegion } from "./teamPackCatalog";
import { repairMojibake } from "./teamText";

export type IdentityStatus = "verified" | "unverified";

export interface TeamIdentity {
  /** Id canónico estable (kebab-case). No es el `packId`; es la identidad del EQUIPO. */
  canonicalId: string;
  /** Nombre para mostrar. También es un alias resoluble por nombre. */
  displayName: string;
  /** Etiqueta corta. */
  tag: string;
  region: TeamRegion;
  /**
   * Valores de `Player.team` cuyos jugadores son, por el roster VLR 2026, ESTE equipo HOY.
   * Es la base de `CURRENT_TEAM_IDENTITY`. Puede estar vacío si no hay un roster actual
   * verificable (p. ej. `Gen.G` editorial, o `DRX`, que VLR 2026 no tiene).
   */
  currentAliases: string[];
  /**
   * Valores de `Player.team` que se refieren a este equipo pero NO son una fuente limpia de
   * roster actual: nombres editoriales/heredados, o strings «impuros» que mezclan jugadores de
   * varios equipos actuales. Es la base de `HISTORICAL_TEAM_CONTEXT`.
   */
  historicalAliases: string[];
  status: IdentityStatus;
  /** Si `unverified`, POR QUÉ. Obligatorio cuando `status === "unverified"`. */
  unverifiedReason?: string;
}

/**
 * EL REGISTRO. Un equipo por entrada. Los alias salen medidos de `data/players.ts`
 * (valores reales de `Player.team`) y la clasificación actual/histórico del cruce
 * semilla ↔ VLR 2026 documentado en `docs/product/fase-20-3-identidad-report.md`.
 */
export const TEAM_IDENTITIES: TeamIdentity[] = [
  // ═══════════════════════ EMEA ═══════════════════════
  {
    canonicalId: "team-heretics", displayName: "Team Heretics", tag: "TH", region: "EMEA",
    // benjy/wo0t («Team Heretics») y riens/boo/koshmaras («TH») son todos TH en VLR 2026.
    currentAliases: ["TH", "Team Heretics"], historicalAliases: [], status: "verified",
  },
  {
    canonicalId: "fnatic", displayName: "Fnatic", tag: "FNC", region: "EMEA",
    // «FNC» es el roster actual limpio. «Fnatic» (semilla) es impuro: Derke y Chronicle son VIT en VLR 2026.
    currentAliases: ["FNC"], historicalAliases: ["Fnatic"], status: "verified",
  },
  {
    canonicalId: "team-liquid", displayName: "Team Liquid", tag: "TL", region: "EMEA",
    currentAliases: ["TL"], historicalAliases: ["Team Liquid"], status: "verified",
  },
  {
    canonicalId: "karmine-corp", displayName: "Karmine Corp", tag: "KC", region: "EMEA",
    currentAliases: ["KC"], historicalAliases: ["Karmine Corp"], status: "verified",
  },
  {
    canonicalId: "m8", displayName: "M8", tag: "M8", region: "EMEA",
    currentAliases: ["M8"], historicalAliases: [], status: "verified",
  },
  {
    canonicalId: "fut", displayName: "FUT", tag: "FUT", region: "EMEA",
    currentAliases: ["FUT"], historicalAliases: [], status: "verified",
  },
  // ═══════════════════════ AMERICAS ═══════════════════════
  {
    canonicalId: "g2", displayName: "G2", tag: "G2", region: "Americas",
    currentAliases: ["G2"], historicalAliases: [], status: "verified",
  },
  {
    canonicalId: "leviatan", displayName: "Leviatán", tag: "LEV", region: "Americas",
    currentAliases: ["LEV"], historicalAliases: [], status: "verified",
  },
  {
    canonicalId: "nrg", displayName: "NRG", tag: "NRG", region: "Americas",
    // Catálogo diseñado: demon1 ya no tiene carta; las 16 de NRG son de la plantilla actual (auditoría: PARTIAL).
    currentAliases: ["NRG"], historicalAliases: [], status: "verified",
  },
  {
    canonicalId: "100t", displayName: "100T", tag: "100T", region: "Americas",
    currentAliases: ["100T"], historicalAliases: [], status: "verified",
  },
  {
    canonicalId: "loud", displayName: "LOUD", tag: "LOUD", region: "Americas",
    currentAliases: ["LOUD"], historicalAliases: [], status: "verified",
  },
  {
    canonicalId: "sentinels", displayName: "Sentinels", tag: "SEN", region: "Americas",
    // «SEN» es el roster VLR 2026; «Sentinels» (semilla) mezcla SEN y MIBR (zekken es MIBR en VLR 2026).
    currentAliases: ["SEN"], historicalAliases: ["Sentinels"], status: "unverified",
    unverifiedReason: "«Sentinels» (semilla) y «SEN» (2026) coexisten con cartas; zekken es MIBR en VLR 2026. Auditoría 20.2: BLOCKED.",
  },
  // ═══════════════════════ PACIFIC ═══════════════════════
  {
    canonicalId: "paper-rex", displayName: "Paper Rex", tag: "PRX", region: "Pacific",
    currentAliases: ["PRX"], historicalAliases: [], status: "verified",
  },
  {
    canonicalId: "t1", displayName: "T1", tag: "T1", region: "Pacific",
    currentAliases: ["T1"], historicalAliases: [], status: "unverified",
    unverifiedReason: "VLR 2026 sitúa en T1 a Meteor y BuZz, que la semilla guarda bajo Gen.G y DRX. Auditoría 20.2: BLOCKED.",
  },
  {
    canonicalId: "ns", displayName: "NS", tag: "NS", region: "Pacific",
    currentAliases: ["NS"], historicalAliases: [], status: "verified",
  },
  {
    // Gen.G editorial (t3xture, Meteor). SEPARADO de GEN por decisión 10. Sin roster actual verificable aquí.
    canonicalId: "gen-g", displayName: "Gen.G", tag: "GENG", region: "Pacific",
    currentAliases: [], historicalAliases: ["Gen.G"], status: "unverified",
    unverifiedReason: "Separado de «GEN» hasta que la identidad actual sea verificable (decisión 10). VLR 2026: t3xture→GEN, Meteor→T1.",
  },
  {
    // GEN (roster VLR 2026). SEPARADO de Gen.G por decisión 10. NO lista «Gen.G» como alias.
    canonicalId: "gen", displayName: "GEN", tag: "GEN", region: "Pacific",
    currentAliases: ["GEN"], historicalAliases: [], status: "unverified",
    unverifiedReason: "Se mantiene separado de «Gen.G» hasta verificar que son la misma entidad (decisión 10). Sin merge.",
  },
  {
    canonicalId: "drx", displayName: "DRX", tag: "DRX", region: "Pacific",
    currentAliases: [], historicalAliases: ["DRX"], status: "unverified",
    unverifiedReason: "VLR 2026 no tiene la etiqueta DRX: mako→KRX, buzz→T1. Nada prueba que KRX sea DRX. Auditoría 20.2: BLOCKED (identidad no probada).",
  },
  {
    canonicalId: "ge", displayName: "GE", tag: "GE", region: "Pacific",
    currentAliases: ["GE"], historicalAliases: [], status: "verified",
  },
  // ═══════════════════════ CHINA ═══════════════════════
  {
    canonicalId: "edward-gaming", displayName: "EDward Gaming", tag: "EDG", region: "China",
    // «EDG» es el roster VLR 2026; «EDward Gaming» (semilla) es impuro (haodong es TEC en VLR 2026).
    currentAliases: ["EDG"], historicalAliases: ["EDward Gaming"], status: "unverified",
    unverifiedReason: "«EDward Gaming» (semilla) y «EDG» (2026) coexisten con cartas; haodong es TEC en VLR 2026. Auditoría 20.2: BLOCKED.",
  },
  {
    canonicalId: "tyl", displayName: "TYL", tag: "TYL", region: "China",
    currentAliases: ["TYL"], historicalAliases: [], status: "verified",
  },
  {
    canonicalId: "blg", displayName: "BLG", tag: "BLG", region: "China",
    currentAliases: ["BLG"], historicalAliases: [], status: "unverified",
    unverifiedReason: "Catálogo diseñado (2026-09-21): ninguna carta lleva BLG impreso. Auditoría: BLOCKED (NO_TEAM_CARDS).",
  },
  {
    canonicalId: "xlg", displayName: "XLG", tag: "XLG", region: "China",
    currentAliases: ["XLG"], historicalAliases: [], status: "verified",
  },
  {
    canonicalId: "te", displayName: "TE", tag: "TE", region: "China",
    currentAliases: ["TE"], historicalAliases: [], status: "unverified",
    unverifiedReason: "Catálogo diseñado (2026-09-21): ninguna carta lleva TE impreso. Auditoría: BLOCKED (NO_TEAM_CARDS).",
  },
  {
    canonicalId: "jdg", displayName: "JDG", tag: "JDG", region: "China",
    currentAliases: ["JDG"], historicalAliases: [], status: "unverified",
    unverifiedReason: "Catálogo diseñado (2026-09-21): ninguna carta lleva JDG impreso. Auditoría: BLOCKED (NO_TEAM_CARDS).",
  },
  // ═══════════════════════ FUERA DE LOS 24 OBJETIVO ═══════════════════════
  {
    // Team Pack vivo (Fase 20). Identidad única, sin split.
    canonicalId: "navi", displayName: "NAVI", tag: "NAVI", region: "EMEA",
    currentAliases: ["NAVI"], historicalAliases: [], status: "verified",
  },
  {
    // Parecido de G2 Esports: MISMA etiqueta (G2), OTRA entidad. Declarado para que nunca se
    // confunda con `g2`. No comparte ningún alias con él.
    canonicalId: "g2-gozen", displayName: "G2 Gozen", tag: "G2", region: "Americas",
    currentAliases: ["G2 Gozen"], historicalAliases: [], status: "unverified",
    unverifiedReason: "Comparte la etiqueta G2 con G2 Esports pero es otra entidad. Sin cartas; no se fusiona.",
  },
  // ═══════════════════════ CATÁLOGO DISEÑADO (2026-09-21) ═══════════════════════
  /*
   * Los equipos de las 331 cartas de `Cartas\` que no estaban en el registro. Cada entrada es UN valor de
   * `Player.team` de la descarga VLR 2026 (roster actual por construcción): sirven para agrupar y mostrar
   * la colección, la maestría y los logros con una identidad canónica. Quedan `unverified` porque no
   * pasaron la auditoría de roster de la Fase 20.2: NO son rivales de campaña ni Team Packs. Los nombres
   * completos son alias de búsqueda, nunca de otro equipo. No se fusiona nada (Gen.G ≠ GEN, DRX ≠ KRX).
   */
  ...([
    ["c9", "Cloud9", "C9", "Americas", ["C9"], ["Cloud9"]],
    ["eg", "Evil Geniuses", "EG", "Americas", ["EG"], ["Evil Geniuses"]],
    ["envy", "ENVY", "ENVY", "Americas", ["ENVY"], []],
    ["furia", "FURIA", "FUR", "Americas", ["FUR"], ["FURIA"]],
    // La descarga guarda «KRÃœ» (mojibake de «KRÜ»): `normalizeAlias` lo repara antes de comparar.
    ["kru", "KRÜ Esports", "KRÜ", "Americas", ["KRÜ"], ["KRÜ Esports"]],
    ["mibr", "MIBR", "MIBR", "Americas", ["MIBR"], []],
    ["bbl", "BBL Esports", "BBL", "EMEA", ["BBL"], ["BBL Esports"]],
    ["eternal-fire", "Eternal Fire", "EF", "EMEA", ["EF"], ["Eternal Fire"]],
    ["giantx", "GIANTX", "GX", "EMEA", ["GX"], ["GIANTX"]],
    ["pcific", "PCIFIC Esports", "PCF", "EMEA", ["PCF"], ["PCIFIC Esports"]],
    ["vitality", "Team Vitality", "VIT", "EMEA", ["VIT"], ["Team Vitality"]],
    ["detonation-focusme", "DetonatioN FocusMe", "DFM", "Pacific", ["DFM"], ["DetonatioN FocusMe"]],
    ["full-sense", "FULL SENSE", "FS", "Pacific", ["FS"], ["FULL SENSE"]],
    ["krx", "KRX", "KRX", "Pacific", ["KRX"], []],
    ["rrq", "Rex Regum Qeon", "RRQ", "Pacific", ["RRQ"], ["Rex Regum Qeon"]],
    ["team-secret", "Team Secret", "TS", "Pacific", ["TS"], ["Team Secret"]],
    ["vl", "VL", "VL", "Pacific", ["VL"], []],
    ["zeta-division", "ZETA DIVISION", "ZETA", "Pacific", ["ZETA"], ["ZETA DIVISION"]],
    ["all-gamers", "All Gamers", "AG", "China", ["AG"], ["All Gamers"]],
    ["dragon-ranger-gaming", "Dragon Ranger Gaming", "DRG", "China", ["DRG"], ["Dragon Ranger Gaming"]],
  ] as const).map(([canonicalId, displayName, tag, region, current, full]): TeamIdentity => ({
    canonicalId, displayName, tag, region, currentAliases: [...current], historicalAliases: [...full], status: "unverified",
    unverifiedReason: "Equipo del catálogo diseñado fuera de la auditoría de roster 20.2: identidad para colección, maestría y logros; no es rival de campaña ni Team Pack.",
  })),
];

// ════════════════════════════ NORMALIZACIÓN ════════════════════════════

/**
 * Clave de comparación de un alias: minúsculas, sin diacríticos, sin caracteres no
 * alfanuméricos. «Leviatán»→«leviatan», «Team Heretics»→«teamheretics», «Gen.G»→«geng»,
 * «GEN»→«gen». Nótese que «Gen.G» y «GEN» siguen SIENDO CLAVES DISTINTAS: la normalización
 * no los fusiona.
 */
export function normalizeAlias(alias: string): string {
  // Primero se deshace el mojibake de la descarga («KRÃœ» → «KRÜ»); un texto sano no cambia.
  return repairMojibake(alias)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

/** Slug estable, idéntico al de `domain/collection/mastery` — para razonar sobre `setId` sin renombrarlos. */
export function identitySlug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ════════════════════════════ ÍNDICE Y AMBIGÜEDAD ════════════════════════════

/**
 * `clave normalizada → identidades que la reclaman`. Un alias que aparezca en DOS identidades
 * queda con una lista de longitud > 1, y la resolución lo tratará como AMBIGUO (no elige). Se
 * construye una sola vez. Incluye, por identidad: sus alias actuales, sus históricos, su
 * `displayName` y su `canonicalId` — así se puede resolver por cualquiera de ellos.
 */
const ALIAS_INDEX: Map<string, TeamIdentity[]> = (() => {
  const idx = new Map<string, TeamIdentity[]>();
  const add = (key: string, id: TeamIdentity): void => {
    const norm = normalizeAlias(key);
    if (!norm) return;
    const list = idx.get(norm) ?? [];
    if (!list.includes(id)) list.push(id);
    idx.set(norm, list);
  };
  for (const id of TEAM_IDENTITIES) {
    for (const a of id.currentAliases) add(a, id);
    for (const a of id.historicalAliases) add(a, id);
    add(id.displayName, id);
    add(id.canonicalId, id);
  }
  return idx;
})();

/** Índice por `canonicalId` (siempre único). */
const BY_CANONICAL: Map<string, TeamIdentity> = new Map(TEAM_IDENTITIES.map((i) => [i.canonicalId, i]));

// ════════════════════════════ RESOLUCIÓN — SOLO LECTURA, DETERMINISTA ════════════════════════════

/**
 * Resuelve un alias a su identidad de equipo. **Seguro ante todo:**
 *   · alias desconocido        → `undefined` (nunca una identidad falsa)
 *   · alias ambiguo (≥2)       → `undefined` (nunca elige uno «por defecto»)
 *   · casing/formato/acentos   → normalizado antes de comparar
 *   · cadena vacía / espacios  → `undefined`
 *
 * Determinista: la misma entrada devuelve siempre la misma identidad (o `undefined`).
 */
export function resolveTeamIdentity(alias: string | null | undefined): TeamIdentity | undefined {
  if (!alias) return undefined;
  const hits = ALIAS_INDEX.get(normalizeAlias(alias));
  if (!hits || hits.length !== 1) return undefined; // desconocido o ambiguo
  return hits[0];
}

/** Identidad por su id canónico exacto. `undefined` si no existe. */
export function teamIdentityById(canonicalId: string): TeamIdentity | undefined {
  return BY_CANONICAL.get(canonicalId);
}

/** ¿A qué identidades podría referirse este alias? Vacío si ninguno; longitud > 1 = ambiguo. */
export function candidateIdentities(alias: string | null | undefined): TeamIdentity[] {
  if (!alias) return [];
  return [...(ALIAS_INDEX.get(normalizeAlias(alias)) ?? [])];
}

/** ¿Es este alias ambiguo (reclamado por más de una identidad)? */
export function isAmbiguousAlias(alias: string | null | undefined): boolean {
  return candidateIdentities(alias).length > 1;
}

/**
 * CURRENT_TEAM_IDENTITY de un alias: la identidad **solo si** el alias es una de sus
 * `currentAliases` (es decir, fuente de roster ACTUAL). Un alias histórico o desconocido
 * devuelve `undefined`. Es lo que un Team Pack futuro debe usar para decidir elegibilidad por
 * roster actual, sin dejar entrar cartas por su contexto histórico.
 */
export function currentTeamIdentity(alias: string | null | undefined): TeamIdentity | undefined {
  const id = resolveTeamIdentity(alias);
  if (!id) return undefined;
  const norm = normalizeAlias(alias!);
  return id.currentAliases.some((a) => normalizeAlias(a) === norm) ? id : undefined;
}

/**
 * HISTORICAL_TEAM_CONTEXT de un alias: la identidad **solo si** el alias es uno de sus
 * `historicalAliases`. No convierte un alias histórico en equipo actual (decisión: un nombre
 * histórico nunca se interpreta como roster actual).
 */
export function historicalTeamContext(alias: string | null | undefined): TeamIdentity | undefined {
  const id = resolveTeamIdentity(alias);
  if (!id) return undefined;
  const norm = normalizeAlias(alias!);
  return id.historicalAliases.some((a) => normalizeAlias(a) === norm) ? id : undefined;
}

/** ¿Es este alias una fuente de roster ACTUAL de alguna identidad? */
export function isCurrentAlias(alias: string | null | undefined): boolean {
  return currentTeamIdentity(alias) !== undefined;
}

/** ¿Es este alias un contexto HISTÓRICO de alguna identidad? */
export function isHistoricalAlias(alias: string | null | undefined): boolean {
  return historicalTeamContext(alias) !== undefined;
}

/**
 * `setId` de maestría que le corresponde a un alias, EXACTAMENTE con el formato que hoy usa
 * `domain/collection/mastery` (`equipo:${slug(team)}`). Existe para poder mapear identidad →
 * conjunto de maestría **sin renombrar** los `setId` ya reclamados en `user_achievements`.
 * NO cambia la maestría; solo la referencia.
 */
export function masterySetIdForAlias(alias: string): string {
  return `equipo:${identitySlug(alias)}`;
}

// ════════════════════════════ EQUIPO CANÓNICO PARA AGRUPAR Y MOSTRAR ════════════════════════════

/**
 * El equipo de un valor de `Player.team`, tal y como lo agrupan y enseñan colección, maestría, logros y
 * sobres: su identidad canónica si resuelve sin ambigüedad (TH y «Team Heretics» → Team Heretics; «KRÃœ» →
 * KRÜ Esports); si no, el propio texto reparado, con una clave `raw:` que NUNCA coincide con una identidad.
 * Es la ÚNICA función que debe decidir si dos cartas son «del mismo equipo».
 */
export function canonicalTeam(team: string | null | undefined): { key: string; label: string; identity: TeamIdentity | undefined } {
  const t = repairMojibake((team ?? "").trim());
  if (!t) return { key: "raw:?", label: "Sin equipo", identity: undefined };
  const identity = resolveTeamIdentity(t);
  return identity ? { key: identity.canonicalId, label: identity.displayName, identity } : { key: `raw:${t}`, label: t, identity: undefined };
}

/** ¿Son estos dos valores de `Player.team` el MISMO equipo canónico? Dos textos sin identidad solo si son iguales. */
export function sameTeam(a: string | null | undefined, b: string | null | undefined): boolean {
  return canonicalTeam(a).key === canonicalTeam(b).key;
}

// ════════════════════════════ EQUIPO IMPRESO EN LA CARTA ════════════════════════════

/**
 * Las 41 etiquetas de equipo impresas en las 331 cartas del catálogo diseñado (prefijo del fichero de
 * `Cartas\`) → identidad canónica. Es una tabla EXACTA, no pasa por `normalizeAlias`: «GenG» normalizaría
 * igual que «Gen.G» y chocaría con la separación de la decisión 10, y aquí no hay nada que adivinar.
 *
 * Lo que las cartas prueban (medido 2026-09-21, ver `docs/product/catalog-post-replace-report.md`):
 *   · «FNATIC» se imprimió para la plantilla FNC y para los semilla «Fnatic» que VLR sitúa en FNC.
 *   · «GenG» se imprimió para los jugadores «GEN» de VLR 2026 y para t3xture: la marca es Gen.G.
 *   · «DRX» se imprimió para los jugadores «KRX» de VLR 2026 (beyn, free1ng, hermes, hyunmin) y mako.
 *   · Derke y Chronicle (semilla «Fnatic») llevan «VIT»; Meteor y BuZz, «T1»; cloud (FNC), «GX».
 */
export const PRINTED_TEAM_IDENTITY: Readonly<Record<string, string>> = {
  "100T": "100t", AG: "all-gamers", BBL: "bbl", C9: "c9", DFM: "detonation-focusme", DRG: "dragon-ranger-gaming",
  DRX: "drx", EDG: "edward-gaming", EF: "eternal-fire", EG: "eg", ENVY: "envy", FNATIC: "fnatic", FS: "full-sense",
  FUR: "furia", FUT: "fut", G2: "g2", GE: "ge", GM8: "m8", GX: "giantx", GenG: "gen-g", KC: "karmine-corp",
  "KRÜ": "kru", LEV: "leviatan", LOUD: "loud", MIBR: "mibr", NAVI: "navi", NRG: "nrg", NS: "ns", PCF: "pcific",
  PRX: "paper-rex", RRQ: "rrq", SEN: "sentinels", T1: "t1", TH: "team-heretics", TL: "team-liquid", TS: "team-secret",
  TYL: "tyl", VIT: "vitality", VL: "vl", XLG: "xlg", ZETA: "zeta-division",
};

/** Identidad del equipo IMPRESO en una etiqueta de carta. `undefined` si la etiqueta no está en la tabla. */
export function printedTeamIdentity(tag: string | null | undefined): TeamIdentity | undefined {
  if (!tag) return undefined;
  const id = PRINTED_TEAM_IDENTITY[repairMojibake(tag.trim())];
  return id ? BY_CANONICAL.get(id) : undefined;
}

/**
 * EL EQUIPO DE UNA CARTA para colección, maestría, logros y Team Packs: el impreso si la carta lo trae
 * (catálogo diseñado), si no el del jugador. Nunca mezcla: dos cartas son del mismo equipo si y solo si
 * sus claves coinciden. El roster ACTUAL (campaña) sigue siendo `currentTeamIdentity(Player.team)`.
 */
export function canonicalCardTeam(card: { team?: string }, player: { team?: string } | undefined): { key: string; label: string; identity: TeamIdentity | undefined } {
  const printed = printedTeamIdentity(card.team);
  if (printed) return { key: printed.canonicalId, label: printed.displayName, identity: printed };
  return canonicalTeam(card.team ?? player?.team);
}

/** Identidad del equipo de un Team Pack (`PackDef.team`): etiqueta impresa o alias del registro. */
export function teamPackIdentity(packTeam: string | null | undefined): TeamIdentity | undefined {
  return printedTeamIdentity(packTeam) ?? resolveTeamIdentity(packTeam);
}

/**
 * ¿Es esta carta «del equipo» de un Team Pack? Sí si el equipo canónico de la CARTA (el impreso) es la
 * identidad del sobre. Es la regla ÚNICA del sesgo (`content-pools:boost`) y de la auditoría: «Sobre
 * Fnatic» sube las cartas con FNATIC impreso, no las de Derke con VIT aunque su `Player.team` sea «Fnatic».
 */
export function isTeamPackCard(card: { team?: string }, player: { team?: string } | undefined, packTeam: string | null | undefined): boolean {
  const id = teamPackIdentity(packTeam);
  return !!id && canonicalCardTeam(card, player).key === id.canonicalId;
}
