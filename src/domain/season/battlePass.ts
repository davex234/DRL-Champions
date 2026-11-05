/**
 * PASE DE BATALLA · MODELO DEL TRACK (puro, sin React) — `/temporada/pase` (Battle Pass cleanup, 2026-10-07).
 *
 * Traduce la vista CANÓNICA del pase (`ProgressionView` de `GET/POST /api/game/progression`, la misma que usa `/logros`)
 * a lo que la pantalla necesita: por nivel, cada carril con su recompensa REAL y su estado. Nada se calcula por su cuenta:
 * «disponible» es exactamente el `claimable` del servidor y «reclamado» su `claimed`; el resto, bloqueado con su motivo.
 * No inventa recompensas: un carril sin recompensa en un nivel no aparece.
 */
import type { PassTrack, ProgressionView } from "@/lib/progression/client";
import type { Reward } from "@/battlepass/types";
import { ns } from "@/i18n/runtime";

const t = ns("season");

export type LaneState = "AVAILABLE" | "CLAIMED" | "LOCKED";

export interface PassLane {
  track: PassTrack;
  /** Nombre del carril en pantalla. */
  label: string;
  reward: Reward;
  state: LaneState;
  /** Por qué está bloqueado (`null` si no lo está). */
  lockReason: string | null;
}

export interface PassLevelRow {
  level: number;
  reached: boolean;
  current: boolean;
  lanes: PassLane[];
}

/** Orden y nombre de los carriles: el gratuito primero, el premium al final. */
export const PASS_LANES: { track: PassTrack; label: string }[] = [
  { track: "free", label: "Gratis" },
  { track: "competitive", label: "Competitivo" },
  { track: "premium", label: "Premium" },
];

const hasReward = (r: Reward | null | undefined): r is Reward =>
  !!r && ((r.credits ?? 0) > 0 || (r.xp ?? 0) > 0 || ((r.packCount ?? 0) > 0 && !!r.packId) || !!r.cardId || (r.cosmetics?.length ?? 0) > 0);

/** ¿Está abierto el carril para esta cuenta? (gratis siempre; competitivo en Oro; premium solo con el derecho real). */
export function laneOpen(view: Pick<ProgressionView, "competitiveUnlocked" | "premium">, track: PassTrack): boolean {
  return track === "free" ? true : track === "competitive" ? view.competitiveUnlocked : view.premium;
}

export function passRows(view: ProgressionView): PassLevelRow[] {
  const rows: PassLevelRow[] = [];
  for (let level = 1; level <= view.season.maxLevel; level++) {
    const lanes: PassLane[] = [];
    for (const { track, label } of PASS_LANES) {
      const entry = view.tracks[track]?.find((l) => l.level === level);
      if (!entry || !hasReward(entry.reward)) continue;
      const open = laneOpen(view, track);
      const state: LaneState = entry.claimed ? "CLAIMED" : entry.claimable ? "AVAILABLE" : "LOCKED";
      const lockReason = state !== "LOCKED" ? null
        : level > view.level ? t("Nivel {level}", { level })
        : !open ? (track === "competitive" ? t("Se abre en Oro") : t("Premium"))
        : t("Bloqueado");
      lanes.push({ track, label, reward: entry.reward, state, lockReason });
    }
    rows.push({ level, reached: level <= view.level, current: level === Math.max(1, view.level), lanes });
  }
  return rows;
}

/** Cuántas recompensas puede reclamar ya (las que el servidor marca `claimable`). */
export function claimableCount(view: ProgressionView): number {
  return PASS_LANES.reduce((n, { track }) => n + (view.tracks[track] ?? []).filter((l) => l.claimable && !l.claimed).length, 0);
}
