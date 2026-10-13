/**
 * CATÁLOGO DE TEAM PACKS — la auditoría de los 24 equipos objetivo, como DATO (Fase 20.2).
 *
 * ────────────────────────── QUÉ ES ESTE FICHERO, Y QUÉ NO ──────────────────────────
 *
 * Es el registro auditable de qué equipos pueden tener un Team Pack y por qué los demás no.
 * **No crea productos, no toca `Player.team`, no lo lee el motor y no decide ningún drop.** Un
 * Team Pack sigue existiendo solo si está en `data/packs.ts`, y su sesgo solo si hay un pool
 * persistido (`npm run content-pools:boost`).
 *
 * Separa las cosas que no hay que confundir:
 *
 *     TEAM REAL            → `requested` (el nombre con el que se pide)
 *     TEAM EN CATÁLOGO     → `identifiers` (los valores MEDIDOS de `Player.team`)
 *     TEAM PACK PRODUCTO   → `packId` presente en `PACKS`
 *     POOL / LINK          → `boost-<packId>` vinculado al sobre (solo existe en la base)
 *     ARTWORK              → `packId` en `PACK_ART_AVAILABLE`
 *
 * ────────────────────────── POR QUÉ HAY DOS NOMBRES PARA UN MISMO EQUIPO ──────────────────────────
 *
 * `PLAYERS` fusiona dos fuentes (`data/players.ts › buildRoster`):
 *
 *   · la SEMILLA editorial, con nombre completo («Gen.G», «Fnatic») y palmarés, y
 *   · el circuito VCT 2026 de VLR, que guarda la ETIQUETA («GEN», «FNC»).
 *
 * Cuando un jugador está en las dos, gana la semilla — también su equipo. Por eso «Gen.G» son
 * t3xture y Meteor (plantilla editorial) y «GEN» los otros siete de 2026, y por eso Meteor, que
 * VLR 2026 sitúa en T1, cuenta como Gen.G. `teamTag` no lo arregla: «Gen.G» lleva `GENG` y «GEN»
 * lleva `GEN`, y en cambio «G2 Gozen» comparte `G2` con G2 Esports siendo otro equipo.
 *
 * Unificar esos valores es una DECISIÓN DE PRODUCTO (¿el sobre rinde homenaje a la plantilla
 * editorial o a la actual?) con impacto en maestría, logros y filtros del mercado. Aquí se
 * detecta y se documenta; no se ejecuta.
 */
import type { PackDef, RarityBucket } from "@/domain/packs/types";
import type { CardDef } from "@/domain/cards/types";
import { PLAYERS } from "./players";
import { CARDS } from "./catalog";
import { PACKS, getPack } from "./packs";
import { PACK_ART_AVAILABLE } from "./packArtwork";
import VLR_ROSTER from "./vlr/players-vct-2026.json";
import { repairMojibake } from "./teamText";
import { isTeamPackCard, teamPackIdentity } from "./teamIdentities";
import { CardRegistry } from "@/collection/registry";
import { BUCKETS, buildPool } from "@/domain/packs/pool";
import { packPlan, packCardClass, ovrTiltWeight, PACK_CLASS_ORDER } from "@/domain/packs/packClass";

export type TeamRegion = NonNullable<PackDef["restrictRegion"]>;
export type TeamPackStatus = "READY" | "PARTIAL" | "BLOCKED";

export type TeamPackBlocker =
  /** Dos o más valores de `Player.team` CON CARTAS para el mismo equipo. */
  | "IDENTITY_SPLIT"
  /** Un jugador con cartas cuyo equipo en el catálogo y en VLR 2026 no coinciden respecto a este equipo. */
  | "LEGACY_ROSTER"
  /** Nada en el repositorio prueba qué valor actual corresponde a este equipo. No derivable: se declara. */
  | "IDENTITY_UNPROVEN"
  /** No existe en `PACKS`. */
  | "PRODUCT_NOT_CREATED"
  /** Su pool de sesgo no puede existir todavía: `content-pools:boost` solo recorre `PACKS`. */
  | "POOL_PENDING_DB"
  /** Sin fichero en `PACK_ART_AVAILABLE`. No se fabrica sustituto. */
  | "ARTWORK_PENDING"
  /**
   * Catálogo diseñado (2026-09-21): ninguna carta lleva impreso este equipo. Sin cartas del equipo no hay
   * sesgo posible: el sobre no se puede vender (queda DRAFT) y no se inventan cartas para rellenarlo.
   */
  | "NO_TEAM_CARDS"
  /**
   * Hay cartas del equipo, pero el sesgo NO puede subir su probabilidad (cuota con sesgo ≤ ×1,5 la de sin
   * sesgo). El peso solo reordena DENTRO de cada rareza: si las cartas del equipo son toda su rareza, o su
   * rareza pesa 0 en la economía del sobre, ningún peso las hace más probables. Medido con `teamBoostOdds`.
   */
  | "BOOST_INEFFECTIVE"
  /**
   * Con el peso canónico, P(≥1 carta del equipo por sobre) ≥ 99 %: el sesgo se convierte en una garantía,
   * que un Team Pack no es. Medido con `teamBoostOdds`. No se recalibra un peso propio por sobre.
   */
  | "BOOST_IS_GUARANTEE";

export interface TeamPackAuditEntry {
  /** El equipo tal y como lo pide el encargo. */
  requested: string;
  /** Nombre canónico en el catálogo: `data/teams.ts` si lo registra; si no, el valor real de `Player.team`. */
  canonical: string;
  region: TeamRegion;
  /** TODOS los valores de `Player.team` que pertenecen a este equipo, medidos. */
  identifiers: string[];
  /** El valor que usa (o usaría) `PackDef.team`. `null` = no se puede fijar sin una decisión de producto. */
  packTeam: string | null;
  /** Producto existente, o el id que tendría por la convención `team-<slug>`. */
  packId: string;
  status: TeamPackStatus;
  blockers: TeamPackBlocker[];
  note: string;
}

const NEW: TeamPackBlocker[] = ["PRODUCT_NOT_CREATED", "POOL_PENDING_DB", "ARTWORK_PENDING"];

export const TEAM_PACK_AUDIT: TeamPackAuditEntry[] = [
  // ═══════════════════════════ EMEA ═══════════════════════════
  {
    requested: "Team Heretics", canonical: "Team Heretics", region: "EMEA",
    identifiers: ["Team Heretics", "TH"], packTeam: "Team Heretics", packId: "team-heretics",
    status: "PARTIAL", blockers: ["IDENTITY_SPLIT"],
    note: "Producto vivo. Catálogo diseñado: el sesgo sigue al equipo IMPRESO (TH), así que cubre las 11 cartas de la plantilla —benjy y wo0t («Team Heretics») con riens, boo, koshmaras y comeback—. Los dos valores de `Player.team` siguen existiendo en los datos.",
  },
  {
    requested: "Fnatic", canonical: "Fnatic", region: "EMEA",
    identifiers: ["Fnatic", "FNC"], packTeam: "Fnatic", packId: "team-fnatic",
    status: "PARTIAL", blockers: ["IDENTITY_SPLIT", "LEGACY_ROSTER"],
    note: "Producto vivo. Catálogo diseñado: el sesgo sigue al equipo IMPRESO (FNATIC): 6 cartas —boaster, alfajer, kaajak, crashies, veqaj—. Derke y Chronicle («Fnatic» en la semilla) llevan VIT impreso y cloud (FNC) lleva GX: no entran.",
  },
  {
    requested: "Team Liquid", canonical: "Team Liquid", region: "EMEA",
    identifiers: ["TL", "Team Liquid"], packTeam: "TL", packId: "team-liquid",
    status: "READY", blockers: [], // El artwork oficial llegó (2026-09-22) y era el último bloqueo.
    note: "11 cartas con TL impreso (medido hoy con `teamCardsInCatalog`; el 14 de la auditoría 20.2 es anterior al catálogo diseñado). «Team Liquid» (leo) no tiene cartas, así que no divide nada. Fase 20.5: producto DRAFT creado; ACTIVO al llegar su arte oficial.",
  },
  {
    requested: "Karmine Corp", canonical: "Karmine Corp", region: "EMEA",
    identifiers: ["KC", "Karmine Corp"], packTeam: "KC", packId: "team-karmine",
    status: "READY", blockers: [], // El artwork oficial llegó (2026-09-22) y era el último bloqueo.
    note: "4 cartas con KC impreso (medido hoy; el 10 de la auditoría 20.2 es anterior al catálogo diseñado). Con el sesgo, P(≥1 del equipo) = 0,40 por sobre: sube la probabilidad sin prometer nada. «Karmine Corp» (scream) no tiene cartas. Producto ACTIVO al llegar su arte oficial.",
  },
  {
    requested: "Gentle Mates", canonical: "M8", region: "EMEA",
    identifiers: ["M8"], packTeam: "M8", packId: "team-m8",
    status: "PARTIAL", blockers: ["ARTWORK_PENDING"], // Fase 20.5 Ola 2: producto DRAFT + pool creados; falta artwork.
    note: "10 cartas elegibles en EMEA. glyph figura en Americas en los datos y queda fuera por `restrictRegion`. El nombre completo no está en el catálogo: se usa la etiqueta real.",
  },
  {
    requested: "FUT", canonical: "FUT", region: "EMEA",
    identifiers: ["FUT"], packTeam: "FUT", packId: "team-fut",
    status: "PARTIAL", blockers: ["ARTWORK_PENDING"], // Fase 20.5 Ola 2: producto DRAFT + pool creados; falta artwork.
    note: "10 cartas elegibles en EMEA.",
  },
  // ═══════════════════════════ AMERICAS ═══════════════════════════
  {
    requested: "G2 Esports", canonical: "G2", region: "Americas",
    identifiers: ["G2"], packTeam: "G2", packId: "team-g2",
    status: "READY", blockers: [],
    note: "Producto vivo, con artwork y pool `boost-team-g2` (Fase 20). «G2 Gozen» comparte la etiqueta G2 pero es otro equipo y no se mezcla. Solo comunes y poco comunes: la tienda ya lo dice.",
  },
  {
    requested: "Leviatán", canonical: "Leviatán", region: "Americas",
    identifiers: ["LEV"], packTeam: "LEV", packId: "team-lev",
    status: "PARTIAL", blockers: ["ARTWORK_PENDING"], // Fase 20.5 Ola 3: producto DRAFT + pool creados; falta artwork.
    note: "10 cartas elegibles, TODAS poco comunes. Fase 20.5 Ola 3: producto DRAFT creado (packId team-lev).",
  },
  {
    requested: "NRG", canonical: "NRG", region: "Americas",
    identifiers: ["NRG"], packTeam: "NRG", packId: "team-nrg",
    status: "PARTIAL", blockers: [...NEW],
    note: "Catálogo diseñado: las 16 cartas de NRG son de la plantilla actual (demon1 ya no tiene carta), así que no hay roster heredado. El producto no existe: crearlo es decisión de producto.",
  },
  {
    requested: "100 Thieves", canonical: "100T", region: "Americas",
    identifiers: ["100T"], packTeam: "100T", packId: "team-100t",
    status: "PARTIAL", blockers: ["ARTWORK_PENDING"], // Fase 20.5 Ola 2: producto DRAFT + pool creados; falta artwork.
    note: "10 cartas elegibles en Americas.",
  },
  {
    requested: "LOUD", canonical: "LOUD", region: "Americas",
    identifiers: ["LOUD"], packTeam: "LOUD", packId: "team-loud",
    status: "PARTIAL", blockers: ["ARTWORK_PENDING"], // Fase 20.5 Ola 1: producto DRAFT + pool creados; falta artwork.
    note: "16 cartas elegibles en Americas. Fase 20.5: producto DRAFT creado.",
  },
  {
    requested: "Sentinels", canonical: "Sentinels", region: "Americas",
    identifiers: ["Sentinels", "SEN"], packTeam: null, packId: "team-sentinels",
    status: "BLOCKED", blockers: ["IDENTITY_SPLIT", "LEGACY_ROSTER", ...NEW],
    note: "«Sentinels» (semilla: tenz, zekken, johnqt, sacy — 11 cartas) y «SEN» (2026 — 8 cartas). zekken figura en MIBR en VLR 2026.",
  },
  // ═══════════════════════════ PACIFIC ═══════════════════════════
  {
    requested: "Paper Rex", canonical: "Paper Rex", region: "Pacific",
    identifiers: ["PRX"], packTeam: "PRX", packId: "team-prx",
    status: "PARTIAL", blockers: ["ARTWORK_PENDING"], // Fase 20.5 Ola 2: producto DRAFT + pool creados; falta artwork.
    note: "10 cartas elegibles en Pacific.",
  },
  {
    requested: "T1", canonical: "T1", region: "Pacific",
    identifiers: ["T1"], packTeam: "T1", packId: "team-t1",
    status: "BLOCKED", blockers: ["LEGACY_ROSTER", ...NEW],
    note: "«T1» tiene 4 jugadores en el catálogo, pero Meteor y BuZz —T1 en VLR 2026— cuentan como Gen.G y DRX por la semilla. Un sobre hoy dejaría fuera a dos de sus jugadores actuales.",
  },
  {
    requested: "Nongshim RedForce", canonical: "NS", region: "Pacific",
    identifiers: ["NS"], packTeam: "NS", packId: "team-ns",
    status: "PARTIAL", blockers: ["ARTWORK_PENDING"], // Fase 20.5 Ola 2: producto DRAFT + pool creados; falta artwork.
    note: "10 cartas elegibles en Pacific.",
  },
  {
    requested: "Gen.G", canonical: "Gen.G", region: "Pacific",
    identifiers: ["Gen.G", "GEN"], packTeam: null, packId: "team-geng",
    status: "BLOCKED", blockers: ["IDENTITY_SPLIT", "LEGACY_ROSTER", ...NEW],
    note: "«Gen.G» = t3xture, Meteor (semilla, 12 cartas). «GEN» = karon, ash, lakia, raxcal, efina, zynx, kitae (VLR 2026, 14 cartas). t3xture es GEN en VLR 2026 y Meteor es T1.",
  },
  {
    requested: "DRX", canonical: "DRX", region: "Pacific",
    identifiers: ["DRX"], packTeam: null, packId: "team-drx",
    status: "BLOCKED", blockers: ["IDENTITY_UNPROVEN", "LEGACY_ROSTER", ...NEW],
    note: "«DRX» solo existe en la semilla (zest, mako, buzz). VLR 2026 no tiene la etiqueta DRX: mako figura en «KRX» y buzz en T1. Nada en el repositorio prueba que KRX sea DRX.",
  },
  {
    requested: "Global Esports", canonical: "GE", region: "Pacific",
    identifiers: ["GE"], packTeam: "GE", packId: "team-ge",
    status: "PARTIAL", blockers: ["ARTWORK_PENDING"], // Fase 20.5 Ola 2: producto DRAFT + pool creados; falta artwork.
    note: "10 cartas elegibles en Pacific.",
  },
  // ═══════════════════════════ CHINA ═══════════════════════════
  {
    requested: "Edward Gaming", canonical: "EDward Gaming", region: "China",
    identifiers: ["EDward Gaming", "EDG"], packTeam: null, packId: "team-edg",
    status: "BLOCKED", blockers: ["IDENTITY_SPLIT", ...NEW],
    note: "«EDward Gaming» (semilla: chichoo, nobody, zmjjkk) y «EDG» (2026) tienen cartas; las 9 llevan EDG impreso. Sigue dividido en `Player.team` y el producto no existe: decisión de producto.",
  },
  {
    requested: "TYLOO", canonical: "TYL", region: "China",
    identifiers: ["TYL"], packTeam: "TYL", packId: "team-tyl",
    status: "BLOCKED", blockers: ["ARTWORK_PENDING", "BOOST_INEFFECTIVE"], // producto DRAFT de la Ola 2: no se vende
    note: "Catálogo diseñado: sus 5 cartas (TYL impreso) son las 5 épicas de China (Champions S). El regional China pesa 0 épicas, así que salen con un 0 %; y aunque pesaran, serían TODA la rareza épica y el sesgo, que solo reordena dentro de cada rareza, no las haría más probables. Ningún peso lo arregla sin cambiar las rarezas del Sobre China vivo. Sigue DRAFT; pools = los canónicos (34 + 5).",
  },
  {
    requested: "Bilibili Gaming", canonical: "BLG", region: "China",
    identifiers: ["BLG"], packTeam: "BLG", packId: "team-blg",
    status: "BLOCKED", blockers: ["ARTWORK_PENDING", "NO_TEAM_CARDS"], // producto DRAFT de la Ola 1: no se vende
    note: "Catálogo diseñado (2026-09-21): ninguna carta lleva BLG impreso. El producto se queda en DRAFT —no se vende ni se abre por la ruta pública— y no se inventan cartas. Su rival de campaña se sustituyó (rtc-2).",
  },
  {
    requested: "Xi Lai Gaming", canonical: "XLG", region: "China",
    identifiers: ["XLG"], packTeam: "XLG", packId: "team-xlg",
    status: "BLOCKED", blockers: ["ARTWORK_PENDING", "BOOST_IS_GUARANTEE"], // producto DRAFT de la Ola 2: no se vende
    note: "10 cartas elegibles de 34 en China, todas poco comunes: 10 de las 29 poco comunes del sobre. Sin sesgo ya sale una en el 87,9 % de los sobres; con el peso canónico ×5, en el 99,8 %: una garantía. Decisión (2026-09-21): no se usa un peso propio por sobre. Sigue DRAFT; pools = los canónicos (34 + 10 × 5).",
  },
  {
    requested: "Trace Esports", canonical: "TE", region: "China",
    identifiers: ["TE"], packTeam: "TE", packId: "team-te",
    status: "BLOCKED", blockers: ["ARTWORK_PENDING", "NO_TEAM_CARDS"], // producto DRAFT de la Ola 1: no se vende
    note: "Catálogo diseñado (2026-09-21): ninguna carta lleva TE impreso. El producto se queda en DRAFT —no se vende ni se abre por la ruta pública— y no se inventan cartas. Su rival de campaña se sustituyó (rtc-2).",
  },
  {
    requested: "JD Gaming", canonical: "JDG", region: "China",
    identifiers: ["JDG"], packTeam: "JDG", packId: "team-jdg",
    status: "BLOCKED", blockers: ["ARTWORK_PENDING", "NO_TEAM_CARDS"], // producto DRAFT de la Ola 1: no se vende
    note: "Catálogo diseñado (2026-09-21): ninguna carta lleva JDG impreso. El producto se queda en DRAFT —no se vende ni se abre por la ruta pública— y no se inventan cartas. Su rival de campaña se sustituyó (rtc-2).",
  },
];

/**
 * Valores de `Player.team` que se PARECEN a un equipo objetivo y NO lo son. Declarados para que
 * ningún agrupador por etiqueta los mezcle por accidente.
 */
export const TEAM_LOOKALIKES: Record<string, string> = {
  "G2 Gozen": "Comparte la etiqueta G2 con G2 Esports, pero es otro equipo.",
};

/** Team Packs vivos que no están entre los 24 objetivo. Auditados, no tocados. */
export const TEAM_PACKS_OUTSIDE_TARGETS: Record<string, string> = {
  "team-navi": "NAVI no está en la lista de la Fase 20.2. Producto de la Fase 20, identidad única («NAVI»).",
};

/** Busca por nombre pedido, canónico o identificador. `undefined` si el equipo no está auditado. */
export function teamPackAudit(name: string): TeamPackAuditEntry | undefined {
  const k = name.trim().toLowerCase();
  if (!k) return undefined;
  return TEAM_PACK_AUDIT.find((e) =>
    e.requested.toLowerCase() === k || e.canonical.toLowerCase() === k
    || e.identifiers.some((i) => i.toLowerCase() === k));
}

// ═══════════════════════════ DETECTORES — derivados de los datos, no declarados ═══════════════════════════

/** Cartas del catálogo de un valor de `Player.team`. */
export function cardsForTeamValue(team: string): number {
  const ids = new Set(PLAYERS.filter((p) => p.team === team).map((p) => p.id));
  return CARDS.filter((c) => ids.has(c.playerId)).length;
}

export interface RosterDiscrepancy { playerId: string; catalogTeam: string; vlrTeam: string; cards: number }

interface VlrRow { nick: string; team: string }

/**
 * DISCREPANCIAS SEMILLA ↔ VLR 2026: jugadores con cartas cuyo `Player.team` no es el equipo que
 * les da VLR. Es el detector que encuentra Gen.G/GEN — `teamTag` no puede, porque las dos
 * etiquetas son distintas.
 */
export function rosterDiscrepancies(): RosterDiscrepancy[] {
  // La descarga trae mojibake (KRÜ): se repara igual que al construir `PLAYERS`, o saldría una discrepancia falsa.
  const byNick = new Map((VLR_ROSTER as VlrRow[]).map((r) => [repairMojibake(r.nick).trim().toLowerCase(), { ...r, team: repairMojibake(r.team) }]));
  const cards = new Map<string, number>();
  for (const c of CARDS) cards.set(c.playerId, (cards.get(c.playerId) ?? 0) + 1);
  const out: RosterDiscrepancy[] = [];
  for (const p of PLAYERS) {
    const v = byNick.get(p.nick.trim().toLowerCase());
    const n = cards.get(p.id) ?? 0;
    if (v?.team && v.team !== p.team && n > 0) out.push({ playerId: p.id, catalogTeam: p.team, vlrTeam: v.team, cards: n });
  }
  return out.sort((a, b) => a.playerId.localeCompare(b.playerId));
}

/**
 * Los bloqueos que los DATOS imponen a una entrada. La declaración tiene que coincidir con esto
 * (salvo `IDENTITY_UNPROVEN`, que es la ausencia de una prueba y no se puede medir).
 */
export function derivedBlockers(entry: TeamPackAuditEntry): TeamPackBlocker[] {
  const ids = new Set(entry.identifiers);
  const out: TeamPackBlocker[] = [];
  if (entry.identifiers.filter((i) => cardsForTeamValue(i) > 0).length >= 2) out.push("IDENTITY_SPLIT");
  if (rosterDiscrepancies().some((d) => ids.has(d.catalogTeam) !== ids.has(d.vlrTeam))) out.push("LEGACY_ROSTER");
  if (!PACKS.some((p) => p.id === entry.packId)) out.push("PRODUCT_NOT_CREATED", "POOL_PENDING_DB");
  if (!PACK_ART_AVAILABLE.has(entry.packId)) out.push("ARTWORK_PENDING");
  if (teamCardsInCatalog(entry) === 0) out.push("NO_TEAM_CARDS");
  else {
    const odds = teamBoostOdds(entry);
    if (odds && odds.boosted <= odds.unboosted * BOOST_MIN_LIFT) out.push("BOOST_INEFFECTIVE");
    else if (odds && odds.atLeastOne >= BOOST_GUARANTEE_AT) out.push("BOOST_IS_GUARANTEE");
  }
  return out;
}

/**
 * Peso de sesgo de una carta del equipo frente al 1 del resto. Es el mismo valor que crea
 * `content-pools-boost.ts` (lo comprueba `teamPackCatalog.test`): uno para todos los Team Packs.
 */
export const TEAM_BOOST_WEIGHT = 5;
/** El sesgo tiene que multiplicar la cuota del equipo por más de esto (misma regla que el test de distribución). */
export const BOOST_MIN_LIFT = 1.5;
/** A partir de aquí P(≥1 carta del equipo) es una garantía, no «más probabilidad». */
export const BOOST_GUARANTEE_AT = 0.99;

export interface TeamBoostOdds {
  /** Probabilidad por carta de que sea del equipo, sin sesgo (pool base, peso 1). */
  unboosted: number;
  /** Lo mismo con el pool de sesgo (`TEAM_BOOST_WEIGHT`). */
  boosted: number;
  /** P(≥1 carta del equipo en el sobre) con sesgo. */
  atLeastOne: number;
}

/**
 * Probabilidades EXACTAS del sesgo de un Team Pack con la matemática del motor: `rollBucket` reparte por
 * los pesos del sobre entre las rarezas con cartas, y `pickWeighted` elige dentro de la rareza por el
 * peso de cada carta (equipo = `TEAM_BOOST_WEIGHT`, resto = 1). Los Team Packs no declaran garantías,
 * así que las cartas del sobre son independientes. `null` si la entrada no tiene sobre ni propuesta.
 */
export function teamBoostOdds(entry: TeamPackAuditEntry): TeamBoostOdds | null {
  const pack = getPack(entry.packId) ?? proposedTeamPack(entry);
  if (!pack?.team) return null;
  const registry = new CardRegistry(CARDS);
  // Pack Opening 3.1 · con plan por ranuras (todos los de equipo), la misma matemática del motor por clase: cada hueco
  // elige clase con la tabla de su ranura y carta con peso = sesgo × inclinación por OVR.
  const plan = packPlan(pack.id);
  if (plan) {
    const { flat } = buildPool(registry, pack);
    const isTeam = (c: CardDef) => isTeamPackCard(c, registry.player(c.playerId), pack.team);
    const slotP = (table: typeof plan.regular, boost: number) => {
      const tot = PACK_CLASS_ORDER.reduce((a, k) => a + table[k], 0) || 1;
      let p = 0;
      for (const k of PACK_CLASS_ORDER) {
        if (table[k] <= 0) continue;
        const cs = flat.filter((c) => packCardClass(c) === k);
        let all = 0, team = 0;
        for (const c of cs) { const w = ovrTiltWeight(plan.ovrTilt, c.ovr) * (isTeam(c) ? boost : 1); all += w; if (isTeam(c)) team += w; }
        if (all > 0) p += (table[k] / tot) * (team / all);
      }
      return p;
    };
    const n = plan.cards;
    const avg = (boost: number) => ((n - 1) * slotP(plan.regular, boost) + slotP(plan.featured, boost)) / n;
    const atLeastOne = 1 - Math.pow(1 - slotP(plan.regular, TEAM_BOOST_WEIGHT), n - 1) * (1 - slotP(plan.featured, TEAM_BOOST_WEIGHT));
    return { unboosted: avg(1), boosted: avg(TEAM_BOOST_WEIGHT), atLeastOne };
  }
  const { pool } = buildPool(registry, pack);
  const usable = BUCKETS.filter((b) => pool[b].length > 0);
  const total = usable.reduce((s, b) => s + Math.max(0, pack.weights[b] ?? 0), 0);
  if (total <= 0) return { unboosted: 0, boosted: 0, atLeastOne: 0 };
  let unboosted = 0;
  let boosted = 0;
  for (const b of usable) {
    const pb = Math.max(0, pack.weights[b] ?? 0) / total;
    const n = pool[b].length;
    const t = pool[b].filter((c) => isTeamPackCard(c, registry.player(c.playerId), pack.team)).length;
    unboosted += pb * (t / n);
    boosted += pb * ((TEAM_BOOST_WEIGHT * t) / (TEAM_BOOST_WEIGHT * t + (n - t)));
  }
  return { unboosted, boosted, atLeastOne: 1 - Math.pow(1 - boosted, pack.cardCount) };
}

/** Cartas del catálogo cuyo equipo IMPRESO es el de esta entrada (la regla del sesgo, `isTeamPackCard`). */
export function teamCardsInCatalog(entry: TeamPackAuditEntry): number {
  const team = entry.packTeam ?? entry.canonical;
  if (!teamPackIdentity(team)) return 0;
  const byId = new Map(PLAYERS.map((p) => [p.id, p]));
  return CARDS.filter((c) => isTeamPackCard(c, byId.get(c.playerId), team)).length;
}

/**
 * La clasificación. READY sin bloqueos. BLOCKED si la identidad no está probada, o si el producto
 * no existe y crearlo exigiría decidir quién es el equipo. PARTIAL todo lo demás.
 */
export function deriveStatus(blockers: TeamPackBlocker[], productExists: boolean): TeamPackStatus {
  if (blockers.length === 0) return "READY";
  if (blockers.includes("IDENTITY_UNPROVEN")) return "BLOCKED";
  if (blockers.includes("NO_TEAM_CARDS")) return "BLOCKED";
  if (blockers.includes("BOOST_INEFFECTIVE") || blockers.includes("BOOST_IS_GUARANTEE")) return "BLOCKED";
  if (!productExists && (blockers.includes("IDENTITY_SPLIT") || blockers.includes("LEGACY_ROSTER"))) return "BLOCKED";
  return "PARTIAL";
}

// ═══════════════════════════ ECONOMÍA — derivada, no inventada ═══════════════════════════

/**
 * La regla de la Fase 20: un Team Pack es un sobre DIRIGIDO y comparte la economía del sobre
 * REGIONAL de su región (precio, cartas y pesos). No hay un punto de precio propio.
 *
 * Para China eso significa 0 épicas y 0 legendarias, porque el regional China las declara a
 * cero (Fase 13). El precio final sigue siendo decisión de producto (informe de la Fase 20).
 */
export function teamPackEconomics(region: TeamRegion): Pick<PackDef, "price" | "cardCount" | "weights"> {
  const regional = getPack(region.toLowerCase());
  if (!regional || regional.restrictRegion !== region || regional.team) {
    throw new Error(`No hay sobre regional para ${region}: la economía no se puede derivar`);
  }
  return {
    price: regional.price,
    cardCount: regional.cardCount,
    weights: { ...regional.weights } as Record<RarityBucket, number>,
  };
}

/**
 * EL SOBRE QUE SE CREARÍA para una entrada viable. Propuesta, NO catálogo: no se añade a `PACKS`
 * y nada en el juego lo lee. `null` si la entrada no tiene `packTeam` decidible.
 */
export function proposedTeamPack(entry: TeamPackAuditEntry): PackDef | null {
  if (!entry.packTeam) return null;
  return {
    id: entry.packId,
    name: `Sobre ${entry.canonical}`,
    description: `Más probabilidad de cartas de ${entry.canonical}. Sortea entre jugadores de ${entry.region}.`,
    ...teamPackEconomics(entry.region),
    restrictRegion: entry.region,
    team: entry.packTeam,
    accent: "#19e3ff",
    tag: "Equipo",
  };
}
