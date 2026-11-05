/**
 * CUSTOM GAMES — tipos (Online Fase 5/7).
 *
 * Partidas privadas con slots de observador/coach/árbitro y ajustes (side swap, restart, buy
 * infinito, pausa). PRODUCE una `MatchConfig` del ÚNICO Online Core (no crea otro Lobby/Match).
 * Autoridad: host configura; árbitro pausa/expulsa; observadores/coach limitados. PLANO/DETERMINISTA.
 */
import type { Region } from "@/domain/cards/types";

export type SlotKind = "player" | "observer" | "coach" | "referee";
export type CustomPrivacy = "private" | "password" | "open";
export type CustomState = "config" | "ready_check" | "in_match" | "ended";

export interface CustomSlot { index: number; kind: SlotKind; side: "home" | "away" | null; userId: string | null; name: string | null; ready: boolean; bot: boolean }

export interface CustomSettings {
  privacy: CustomPrivacy;
  password: string | null;
  observerSlots: number;
  coachSlots: number;
  refereeSlots: number;
  seed: number;
  firstTo: number;          // rondas para ganar
  economy: "normal" | "infinite" | "off";  // infinite/off ⇒ buy infinito (economía desactivada)
  sideSwapAllowed: boolean;
  mode: string;
  region: Region;
}

export interface CustomControls { paused: boolean; roundRestarts: number; matchRestarts: number }

export interface CustomGame {
  id: string;
  hostId: string;
  settings: CustomSettings;
  slots: CustomSlot[];
  state: CustomState;
  controls: CustomControls;
  createdAt: number;
}
