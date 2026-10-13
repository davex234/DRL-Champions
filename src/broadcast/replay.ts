/**
 * REPLAY / HIGHLIGHTS — NO crea un replay engine. Extrae los MOMENTOS destacados del
 * partido reutilizando los detectores existentes (moments + combat events + narrative
 * timeline) y, opcionalmente, los récords del Living World (`@/world` history) para los
 * hitos históricos. Cada clip apunta a su ronda para poder reproducirla. PURO.
 */
import type { MatchState } from "../match";
import { detectRoundMoments } from "../lib/match/moments";
import { detectCombatEvents } from "../combat2";
import type { WorldHistory } from "../world";
import { ns } from "@/i18n/runtime";

const t = ns("broadcast");

export type HighlightKind =
  | "ace" | "clutch" | "1vx" | "triple" | "wallbang" | "one_tap" | "perfect_execute"
  | "perfect_retake" | "flawless" | "thrifty" | "key_moment" | "historic_transfer" | "record";

export interface HighlightClip {
  id: string;
  kind: HighlightKind;
  label: string;
  round: number;        // 0 = nivel mundo
  team?: "home" | "away";
  magnitude: number;
  source: "match" | "world";
  detail?: string;
  name?: string;
}

const MOMENT_KIND: Record<string, HighlightKind> = {
  ace: "ace", team_ace: "ace", clutch: "clutch", flawless: "flawless", thrifty: "thrifty", eco_win: "thrifty",
};
const COMBAT_KIND: Partial<Record<string, HighlightKind>> = {
  one_tap: "one_tap", wallbang: "wallbang", low_hp_clutch: "clutch", survived_1hp: "clutch",
  perfect_crossfire: "key_moment", double_swing: "triple", hero_save: "key_moment",
};

/** Extrae los highlights del partido (+ récords del mundo si se pasan). */
export function extractHighlights(match: MatchState, worldHistory?: WorldHistory): HighlightClip[] {
  const out: HighlightClip[] = [];
  const homeNames = new Set(match.config.rosters.home.map((r) => r.name));

  // Momentos de producción por ronda.
  match.rounds.forEach((round, i) => {
    const n = i + 1;
    for (const b of detectRoundMoments(match, round)) {
      const kind = MOMENT_KIND[b.kind];
      if (!kind) continue;
      out.push({ id: `h:m:${n}:${b.kind}`, kind, label: b.label, round: n, magnitude: b.priority, source: "match", detail: b.sub });
    }
  });

  // Eventos de combate de calidad (one tap / wallbang / clutch a 1hp…).
  for (const e of detectCombatEvents(match.rounds, homeNames)) {
    const kind = COMBAT_KIND[e.type];
    if (!kind) continue;
    out.push({ id: `h:c:${e.round}:${e.type}:${e.name ?? ""}`, kind, label: e.type.replace(/_/g, " "), round: e.round, team: e.team, magnitude: e.magnitude, source: "match", name: e.name });
  }

  // Momentos clave del Narrative Engine (timeline del partido).
  if (match.narrative) {
    for (const km of match.narrative.keyMoments.slice(0, 6)) {
      out.push({ id: `h:k:${km.event.id}`, kind: "key_moment", label: km.why, round: km.event.round, team: km.event.favors === "A" ? "home" : "away", magnitude: km.event.impact, source: "match", name: km.event.participants[0]?.name });
    }
  }

  // Hitos históricos del Living World (reutiliza el Timeline/records del mundo).
  if (worldHistory) {
    const tr = worldHistory.records["transfer"];
    if (tr) out.push({ id: `h:w:transfer`, kind: "historic_transfer", label: t("Fichaje récord"), round: 0, magnitude: 95, source: "world", detail: `${tr.holder} (${tr.value})` });
    for (const key of ["dynasty", "clutch"]) {
      const r = worldHistory.records[key];
      if (r) out.push({ id: `h:w:${key}`, kind: "record", label: key === "dynasty" ? t("Dinastía histórica") : t("Mejor clutch"), round: 0, magnitude: 90, source: "world", detail: `${r.holder}` });
    }
  }

  // Ordena por magnitud y deduplica por id.
  const seen = new Set<string>();
  return out.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
    .sort((a, b) => b.magnitude - a.magnitude);
}
