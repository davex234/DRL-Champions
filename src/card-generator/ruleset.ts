/**
 * DEFAULT RULESET v1 (Fase 4) — SOLO DATOS. Espejo de la política editorial ya vigente en el
 * proyecto: premios del Analyzer → accolades `tournament-*` EXISTENTES (que `variantsForAccolade`
 * ya convierte en variantes), hechos históricos/narrativos → badges. Cero ifs por jugador; las
 * accolades fuertes (icon/hall-of-fame) NUNCA se conceden automáticamente (solo override).
 */
import type { RuleSet } from "./types";

export const DEFAULT_RULESET: RuleSet = {
  id: "default",
  version: 1,
  rules: [
    // ── Accolades por premio objetivo del Analyzer ──
    { id: "mvp-award", priority: 100, when: { source: "award", kind: "mvp" }, grant: { accolade: "tournament-mvp" } },
    { id: "champion-roster", priority: 95, when: { source: "narrativeTag", kind: "champion", teamScope: "roster" }, grant: { accolade: "tournament-champion" } },
    { id: "best-rookie", priority: 90, when: { source: "award", kind: "best-rookie" }, grant: { accolade: "tournament-rookie" } },
    { id: "best-clutch", priority: 90, when: { source: "award", kind: "best-clutch" }, grant: { accolade: "tournament-clutch" } },
    // ── Accolades por liderato estadístico del torneo ──
    { id: "leader-rating", priority: 85, when: { source: "leader", kind: "rating" }, grant: { accolade: "tournament-top-rating" } },
    { id: "leader-acs", priority: 85, when: { source: "leader", kind: "acs" }, grant: { accolade: "tournament-top-acs" } },
    { id: "leader-hs", priority: 85, when: { source: "leader", kind: "hsPct" }, grant: { accolade: "tournament-top-hs" } },
    { id: "leader-kills", priority: 85, when: { source: "leader", kind: "kills" }, grant: { accolade: "tournament-top-kills" } },
    { id: "leader-assists", priority: 85, when: { source: "leader", kind: "assists" }, grant: { accolade: "tournament-top-assists" } },
    // ── Élite con muestra suficiente (usa la PerformanceConfidence de F3 como puerta) ──
    { id: "elite-prime", priority: 80, when: { source: "playerReport", kind: "rating", minValue: 90, minConfidence: "high" }, grant: { accolade: "prime" } },
    // ── Badges históricos (HistoricalContext F3) ──
    { id: "badge-first-title", priority: 50, when: { source: "historicalTag", kind: "first-title" }, grant: { badge: "first-title" } },
    { id: "badge-legend", priority: 50, when: { source: "historicalTag", kind: "three-titles" }, grant: { badge: "legend" } },
    { id: "badge-b2b", priority: 50, when: { source: "historicalTag", kind: "back-to-back-champion" }, grant: { badge: "back-to-back-champion" } },
    { id: "badge-career-high", priority: 50, when: { source: "historicalTag", kind: "career-high" }, grant: { badge: "career-high" } },
    { id: "badge-debut", priority: 50, when: { source: "historicalTag", kind: "debut-lan" }, grant: { badge: "debut" } },
    // ── Badges narrativos (NarrativeTags F3) ──
    { id: "badge-perfect-run", priority: 40, when: { source: "narrativeTag", kind: "perfect-run" }, grant: { badge: "perfect-run" } },
    { id: "badge-reverse-sweep", priority: 40, when: { source: "narrativeTag", kind: "reverse-sweep" }, grant: { badge: "reverse-sweep" } },
    { id: "badge-dark-horse", priority: 40, when: { source: "narrativeTag", kind: "dark-horse" }, grant: { badge: "dark-horse" } },
    { id: "badge-undefeated", priority: 40, when: { source: "narrativeTag", kind: "undefeated" }, grant: { badge: "undefeated" } },
  ],
};
