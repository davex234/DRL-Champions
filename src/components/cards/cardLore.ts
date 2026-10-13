/**
 * CARD LORE — datos derivados (puros) para el visor de cartas.
 *
 * El catálogo guarda datos REALES (jugador, equipo, stats, variante, palmarés). Algunas
 * secciones del visor (kit recomendado, descripción) se DERIVAN de forma determinista del
 * rol y la rareza — claramente etiquetadas como "recomendado/por rol", sin inventar datos
 * que el juego no tenga. Aislado aquí para poder testarlo y reutilizarlo.
 */
import type { Player, VariantDef, RoleId, AccoladeId } from "@/domain/cards/types";

export interface RoleKit {
  agents: string[];
  abilities: { name: string; desc: string }[];
  traits: string[];
}

export const ROLE_KIT: Record<RoleId, RoleKit> = {
  Duelista: {
    agents: ["Jett", "Raze", "Reyna"],
    abilities: [
      { name: "Entrada agresiva", desc: "Abre los sitios y gana el primer duelo." },
      { name: "Picos de daño", desc: "Convierte ventajas en bajas rápidas." },
    ],
    traits: ["Agresivo", "Entry", "Mecánico"],
  },
  Iniciador: {
    agents: ["Sova", "Fade", "Gekko"],
    abilities: [
      { name: "Recon", desc: "Revela posiciones y habilita la ejecución." },
      { name: "Set-up de equipo", desc: "Prepara la entrada de los duelistas." },
    ],
    traits: ["Información", "Set-up", "Versátil"],
  },
  Centinela: {
    agents: ["Killjoy", "Cypher", "Sage"],
    abilities: [
      { name: "Anclaje", desc: "Sostiene un sitio en solitario." },
      { name: "Control de zona", desc: "Vigila flancos y retrasa retomas." },
    ],
    traits: ["Anclaje", "Control de zona", "Defensivo"],
  },
  Controlador: {
    agents: ["Omen", "Viper", "Astra"],
    abilities: [
      { name: "Humos", desc: "Corta líneas de visión y abre ejecuciones." },
      { name: "Tempo", desc: "Dicta el ritmo de la ronda." },
    ],
    traits: ["Humos", "Tempo", "Estratega"],
  },
  Flex: {
    agents: ["Skye", "Breach", "KAY/O"],
    abilities: [
      { name: "Polivalencia", desc: "Cubre el rol que el equipo necesite." },
      { name: "Liderazgo", desc: "Coordina la estrategia en partida." },
    ],
    traits: ["Adaptable", "Polivalente", "IGL"],
  },
};

export const ACCOLADE_LABEL: Record<AccoladeId, string> = {
  masters: "Participación en Masters",
  champions: "Participación en Champions",
  ewc: "Participación en EWC",
  "masters-winner": "Campeón de Masters",
  "masters-mvp": "MVP de Masters",
  "champions-winner": "Campeón de Champions",
  "champions-mvp": "MVP de Champions",
  "ewc-winner": "Campeón de EWC",
  "ewc-mvp": "MVP de EWC",
  "regional-winner": "Campeón regional",
  "regional-mvp": "MVP regional",
  prime: "Edición Prime",
  "game-changers": "Game Changers",
  icon: "Icon Series",
  "hall-of-fame": "Hall of Fame",
  "tournament-mvp": "MVP de torneo",
  "tournament-champion": "Campeón de torneo",
  "tournament-rookie": "Rookie del torneo",
  "tournament-clutch": "Rey del clutch",
  "tournament-top-acs": "Top ACS",
  "tournament-top-rating": "Top rating",
  "tournament-top-hs": "Top HS%",
  "tournament-top-kills": "Top bajas",
  "tournament-top-assists": "Top asistencias",
};

/** Palmarés legible del jugador (a partir de sus accolades reales). */
export function accoladeLabels(player: Player): string[] {
  return (player.accolades ?? []).map((a) => ACCOLADE_LABEL[a] ?? a);
}

/** Agente recomendado para el rol (determinista, primero del kit). */
export function recommendedAgent(role: RoleId): string {
  return ROLE_KIT[role]?.agents[0] ?? "—";
}

const FLAVOR: { min: number; text: string }[] = [
  { min: 13, text: "Una de las cartas más codiciadas del juego." },
  { min: 9, text: "Pieza de élite para cualquier colección." },
  { min: 5, text: "Carta competitiva de alto valor." },
  { min: 0, text: "Una base sólida para tu plantilla." },
];

/** Descripción generada (determinista) a partir de jugador + variante. */
export function buildDescription(player: Player, variant: VariantDef, teamName: string, role: RoleId = player.role): string {
  const flavor = FLAVOR.find((f) => variant.rank >= f.min)?.text ?? "";
  // `role` = el de la CARTA (catálogo diseñado: el impreso manda); por defecto, el del jugador.
  return `${player.nick} es un ${role} de ${player.region} que compite con ${teamName}. Edición ${variant.label}. ${flavor}`;
}
