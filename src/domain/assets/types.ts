/**
 * DRL ASSET MANAGER — tipos PUROS de dominio.
 *
 * Un asset es cualquier medio gestionado del juego (foto, logo, bandera,
 * plantilla, fondo, animación, efecto…). Cada uno pertenece opcionalmente a un
 * "sujeto" (jugador, equipo, liga, torneo, país, rol, variante) por su id del
 * CATÁLOGO DEL JUEGO — así se busca y se resuelve "la mejor imagen para X".
 */

/** `card_artwork` (0043): la ilustración final de UNA versión de carta, hecha a mano. */
export type AssetKind =
  | "card_artwork"
  | "player_photo"
  | "team_logo"
  | "league_logo"
  | "tournament_logo"
  | "flag"
  | "role"
  | "card_template"
  | "background"
  | "animation"
  | "effect";

export type SubjectType =
  | "card"
  | "player"
  | "team"
  | "league"
  | "tournament"
  | "country"
  | "role"
  | "variant"
  | "none";

export type AssetSource =
  | "riot_media"
  | "event_official"
  | "social"
  | "broadcast_frame"
  | "manual"
  | "upload"
  | "generated";

export type AssetStatus = "pending" | "approved" | "rejected" | "archived";

export interface Asset {
  id: string;
  groupId: string;
  version: number;
  isCurrent: boolean;
  name: string;
  kind: AssetKind;
  subjectType: SubjectType;
  subjectId?: string;
  source: AssetSource;
  quality: number;
  width?: number;
  height?: number;
  format?: string;
  bytes?: number;
  checksum?: string;
  priority: number;
  status: AssetStatus;
  license?: string;
  bucket: string;
  storagePath?: string;
  url?: string;
  capturedAt?: string;
  tags: string[];
  meta: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** Resolución precomputada: el mejor asset disponible para un sujeto. */
export interface BestAsset {
  kind: AssetKind;
  subjectType: SubjectType;
  subjectId: string;
  assetId: string;
  bucket?: string;
  storagePath?: string;
  url?: string;
  width?: number;
  height?: number;
  quality?: number;
  priority?: number;
}

/** Metadatos de cada tipo para poblar el panel (label ES + sujeto esperado). */
export const ASSET_KINDS: { kind: AssetKind; label: string; subjectType: SubjectType }[] = [
  { kind: "player_photo", label: "Foto de jugador", subjectType: "player" },
  { kind: "team_logo", label: "Logo de equipo", subjectType: "team" },
  { kind: "league_logo", label: "Logo de liga", subjectType: "league" },
  { kind: "tournament_logo", label: "Logo de torneo", subjectType: "tournament" },
  { kind: "flag", label: "Bandera", subjectType: "country" },
  { kind: "role", label: "Rol", subjectType: "role" },
  { kind: "card_template", label: "Plantilla de carta", subjectType: "variant" },
  { kind: "background", label: "Fondo", subjectType: "none" },
  { kind: "animation", label: "Animación", subjectType: "none" },
  { kind: "effect", label: "Efecto", subjectType: "none" },
];

export const ASSET_SOURCES: { source: AssetSource; label: string }[] = [
  { source: "riot_media", label: "Riot Media" },
  { source: "event_official", label: "Evento oficial" },
  { source: "broadcast_frame", label: "Frame de retransmisión" },
  { source: "social", label: "Redes sociales" },
  { source: "upload", label: "Subida manual" },
  { source: "manual", label: "Manual" },
  { source: "generated", label: "Generado" },
];

export const ASSET_STATUSES: { status: AssetStatus; label: string }[] = [
  { status: "pending", label: "Pendiente" },
  { status: "approved", label: "Aprobado" },
  { status: "rejected", label: "Rechazado" },
  { status: "archived", label: "Archivado" },
];

export function kindLabel(kind: AssetKind): string {
  return ASSET_KINDS.find((k) => k.kind === kind)?.label ?? kind;
}

/** Sujeto esperado por defecto para un tipo de asset. */
export function subjectTypeForKind(kind: AssetKind): SubjectType {
  return ASSET_KINDS.find((k) => k.kind === kind)?.subjectType ?? "none";
}
