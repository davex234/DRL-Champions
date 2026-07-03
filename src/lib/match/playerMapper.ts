/**
 * PLAYER MAPPER — el ÚNICO punto de conversión Carta → jugador de simulación.
 *
 *      Card (OwnedCard + CardDef + Player + Variant)  ──►  RosterEntry  ──►  SimPlayer
 *                         (este módulo)                      (engine.makePlayer)
 *
 * Responsabilidad única y dirección única (Card → Sim, nunca al revés). Aquí —y solo
 * aquí— se traduce el OVR/las 6 stats de la carta a los atributos del motor, se deriva
 * el ADN de identidad (para que "aspas" se comporte como aspas, no solo tenga Aim 97),
 * el rol táctico y la metadata de retransmisión (foto/equipo/rareza).
 *
 * PURO: recibe objetos de dominio ya resueltos; no toca el store ni el catálogo
 * (de eso se encarga `roster.ts`). Sin esto repartido por el proyecto.
 */
import type { CardDef, OwnedCard, Player, PlayerStats, RoleId } from "@/domain/cards/types";
import type { Attributes, Identity, Role, RosterEntry, SimPlayerMeta } from "@/sim";
import { PROFILES, type ArchetypeId } from "@/sim";

/** Insumo del mapper: una carta poseída ya resuelta a sus piezas de dominio. */
export interface CardMappingInput {
  owned: OwnedCard;
  card: CardDef;
  player: Player;
  /** Etiqueta legible de la variante (rareza), p. ej. "Champions MVP". */
  variantLabel: string;
}

const clamp99 = (n: number): number => Math.max(1, Math.min(99, Math.round(n)));
const clamp100 = (n: number): number => Math.max(0, Math.min(100, n));

// ---------------------------------------------------------------------------
// 1) 6 stats de carta  →  4 atributos del motor
// ---------------------------------------------------------------------------
// dmg/scr/com/hs/ast/clu (0-99)  →  aim/gameSense/utility/leadership (0-99).
// Curvas explícitas y tuneables desde un solo sitio.

export function statsToAttributes(s: PlayerStats): Attributes {
  return {
    // Letalidad mecánica: combate (K/D) + headshots + daño.
    aim: clamp99(0.45 * s.com + 0.3 * s.hs + 0.25 * s.dmg),
    // Lectura de juego: puntuación de combate (ACS) + impacto + clutch.
    gameSense: clamp99(0.45 * s.scr + 0.3 * s.com + 0.25 * s.clu),
    // Utilidad: asistencias (juego de equipo) con algo de impacto.
    utility: clamp99(0.7 * s.ast + 0.3 * s.scr),
    // Liderazgo (no hay stat directa): asistencias + clutch + solvencia en combate.
    leadership: clamp99(0.5 * s.ast + 0.25 * s.clu + 0.25 * s.com),
  };
}

// ---------------------------------------------------------------------------
// 2) Rol de agente (Valorant)  →  rol táctico del motor
// ---------------------------------------------------------------------------
const ROLE_MAP: Record<RoleId, Role> = {
  Duelista: "entry",
  Iniciador: "support",
  Controlador: "support",
  Centinela: "anchor",
  Flex: "lurk",
};

export function roleToSimRole(role: RoleId): Role {
  return ROLE_MAP[role] ?? "lurk";
}

// ---------------------------------------------------------------------------
// 3) Carta  →  ADN de identidad (Player Identity Engine)
// ---------------------------------------------------------------------------
// Se parte del arquetipo del rol y se PERTURBA de forma DETERMINISTA por el id del
// jugador y sus stats: dos duelistas distintos juegan distinto, y el MISMO jugador
// siempre produce la MISMA identidad (aspas siempre se comporta como aspas).

function archetypeFor(role: Role, s: PlayerStats): ArchetypeId {
  switch (role) {
    case "igl": return "cerebral-igl";
    case "anchor": return "patient-anchor";
    case "lurk": return "flank-lurker";
    case "support": return "utility-support";
    case "entry":
    default:
      // Duelista con clutch flojo pero pico altísimo → estrella errática.
      return s.clu < 78 && s.dmg >= 88 ? "explosive-star" : "aggressive-duelist";
  }
}

/** Hash FNV-1a estable: convierte el id del jugador en una semilla reproducible. */
function hashId(id: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Jitter determinista en [-1, 1] por (id, clave). */
function jitter(id: string, key: string): number {
  const h = hashId(`${id}#${key}`);
  return ((h % 1000) / 1000) * 2 - 1;
}

export function deriveIdentity(player: Player, role: Role, ovr: number): Identity {
  const base = PROFILES[archetypeFor(role, player.stats)];
  const s = player.stats;
  const id = player.id;
  // Copia del arquetipo y ajustes finos por jugador (clamp 0..100).
  return {
    ...base,
    aggression: clamp100(base.aggression + (s.dmg - 80) * 0.2 + jitter(id, "agg") * 6),
    riskAppetite: clamp100(base.riskAppetite + (s.dmg - 80) * 0.15 + jitter(id, "risk") * 6),
    composure: clamp100(base.composure + (s.clu - 78) * 0.25),
    selfBelief: clamp100(base.selfBelief + (ovr - 80) * 0.5),
    consistency: clamp100(base.consistency + (s.com - 82) * 0.25 + jitter(id, "cons") * 10),
    creativity: clamp100(base.creativity + jitter(id, "crea") * 8),
    tradeInstinct: clamp100(base.tradeInstinct + (s.ast - 70) * 0.15),
    utilityLean: clamp100(base.utilityLean + (s.ast - 70) * 0.25),
    clutchFactor: clamp100(base.clutchFactor + (s.clu - 75) * 0.4),
  };
}

// ---------------------------------------------------------------------------
// 4) Metadata de retransmisión (foto/equipo/rareza) — NO afecta a la simulación
// ---------------------------------------------------------------------------
export function resolveImage(player: Player): string {
  return player.image ?? `/players/${player.id}.png`;
}

function buildMeta(input: CardMappingInput): SimPlayerMeta {
  const { owned, card, player, variantLabel } = input;
  return {
    cardUid: owned.uid,
    cardId: card.id,
    playerId: player.id,
    team: player.team,
    teamTag: player.teamTag,
    region: player.region,
    country: player.country,
    variantId: card.variantId,
    variantLabel,
    ovr: card.ovr,
    serial: owned.serial,
    image: resolveImage(player),
  };
}

// ---------------------------------------------------------------------------
// CONVERSIÓN PRINCIPAL: una carta → un RosterEntry completo
// ---------------------------------------------------------------------------
/**
 * Convierte UNA carta en un plano de jugador para el motor. El `forceIgl` lo usa
 * `buildRoster` para designar al líder del equipo (un único IGL por roster).
 */
export function cardToRosterEntry(
  input: CardMappingInput,
  opts: { forceIgl?: boolean } = {},
): RosterEntry {
  const { card, player } = input;
  const attrs = statsToAttributes(card.stats);
  const role: Role = opts.forceIgl ? "igl" : roleToSimRole(player.role);
  const identity = deriveIdentity(player, role, card.ovr);

  if (opts.forceIgl) {
    // El IGL conserva su personalidad pero gana voz de mando y refuerza el shot-calling.
    attrs.leadership = clamp99(Math.max(attrs.leadership, 70));
    identity.leadershipDrive = clamp100(Math.max(identity.leadershipDrive, 80));
    identity.communication = clamp100(Math.max(identity.communication, 75));
  }

  return {
    name: player.nick,           // nombre REAL → fluye a Narrative y Broadcast
    role,
    attrs,
    identity,
    meta: buildMeta(input),
  };
}

/**
 * Convierte CINCO cartas en un roster del motor, designando como IGL al jugador con
 * más liderazgo derivado (garantiza exactamente un shot-caller por equipo). Acepta
 * cualquier nº de cartas (para el rival generado), pero el flujo del entrenador
 * siempre envía 5.
 *
 * `opts.iglUid` (Deck & Squad Builder): fuerza como IGL la carta con ese uid si está
 * presente; si no, se mantiene la elección automática por liderazgo. Aditivo y compatible.
 */
export function buildRoster(inputs: CardMappingInput[], opts: { iglUid?: string } = {}): RosterEntry[] {
  if (inputs.length === 0) return [];

  // IGL explícito (por uid) si se indica y existe; si no, el de mayor liderazgo derivado.
  let iglIndex = opts.iglUid ? inputs.findIndex((i) => i.owned.uid === opts.iglUid) : -1;
  if (iglIndex < 0) {
    const lead = inputs.map((i) => statsToAttributes(i.card.stats).leadership);
    iglIndex = 0;
    for (let i = 1; i < lead.length; i++) if (lead[i] > lead[iglIndex]) iglIndex = i;
  }

  return inputs.map((input, i) => cardToRosterEntry(input, { forceIgl: i === iglIndex }));
}
