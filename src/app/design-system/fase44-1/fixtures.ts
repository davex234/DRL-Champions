/**
 * ARNÉS QA · FASE 44.1 — ESCENAS (QA SYNTHETIC). Inmersión: mundos, lobby, bóveda, cámara de sobres, salas, música,
 * efectos, scroll y movimiento reducido. Cada escena monta las piezas REALES de la fase con datos inventados.
 */
import type { EnvironmentVariant } from "@/design/environment";

export const SECTIONS_441 = [
  "AMBIENT WORLDS", "LOBBY", "COLLECTION VAULT", "PACK CHAMBER", "LOADOUT ROOM", "CAMPAIGN", "DRAFT", "RANKED", "SEASON",
  "MUSIC", "SFX", "SCROLL", "REDUCED MOTION",
] as const;
export type Section441 = (typeof SECTIONS_441)[number];

export interface Fase441Scene {
  id: string;
  section: Section441;
  note: string;
  /** Mundo que se monta detrás de la escena. */
  world: EnvironmentVariant;
}

const f = (section: Section441, id: string, world: EnvironmentVariant, note: string): Fase441Scene => ({ id, section, world, note });

export const FASE441_SCENES: Fase441Scene[] = [
  ...(["lobby", "collection", "packs", "loadout", "campaign", "draft", "ranked", "season", "match", "events", "profile", "world"] as const)
    .map((v) => f("AMBIENT WORLDS", `world-${v}`, v, `mundo «${v}» sin interfaz: capas L0–L3 y su arquitectura`)),
  f("LOBBY", "lobby", "lobby", "vestíbulo con escenario JUGAR, modos y la fila de hoy"),
  f("LOBBY", "lobby-focus-quick", "lobby", "modo PvE apuntado: el mundo se tiñe de cian"),
  f("LOBBY", "lobby-focus-ranked", "lobby", "ranked apuntado: magenta"),
  f("LOBBY", "lobby-focus-campaign", "lobby", "campaña apuntada: azul profundo"),
  f("LOBBY", "lobby-focus-draft", "lobby", "draft apuntado: ámbar"),
  f("COLLECTION VAULT", "vault-legendary", "collection", "bóveda: pieza legendaria en vitrina"),
  f("COLLECTION VAULT", "vault-epic", "collection", "bóveda: pieza épica"),
  f("COLLECTION VAULT", "vault-rare", "collection", "bóveda: pieza rara"),
  f("PACK CHAMBER", "chamber", "packs", "cámara: sobre en su pedestal, sala en reposo"),
  f("PACK CHAMBER", "chamber-dim", "packs", "cámara apagada: el momento antes de abrir"),
  f("LOADOUT ROOM", "loadout", "loadout", "sala táctica de equipos"),
  f("CAMPAIGN", "campaign", "campaign", "mapa del circuito"),
  f("DRAFT", "draft", "draft", "cámara de draft (tríptico)"),
  f("RANKED", "ranked", "ranked", "escenario competitivo (escalera)"),
  f("SEASON", "season", "season", "horizonte de temporada"),
  f("MUSIC", "music", "lobby", "director de música: contextos, fundidos, duck, override y estado del motor"),
  f("SFX", "sfx", "lobby", "todos los efectos del catálogo y los ajustes de música/efectos"),
  f("SCROLL", "scroll", "lobby", "página larga + hoja + diálogo: el scroll vuelve siempre"),
  f("REDUCED MOTION", "reduced", "lobby", "mundo estático (activar «reducir movimiento» en el sistema o en DevTools)"),
];
