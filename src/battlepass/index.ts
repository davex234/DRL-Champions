// ❄️ FROZEN (Consolidation F1.1, 2026-07-06): motor completo y verificado SIN consumidores de
// producto hoy. Se conserva por valor de roadmap (wire before kill). NO crecer ni integrar
// sin decision explicita. Registro y criterios: docs/FROZEN.md
/**
 * BATTLE PASS, MISSIONS & SEASONAL PROGRESSION ENGINE — API pública (Collection Fase 6/7).
 *
 * Progresión de temporada (pase libre + premium, XP/niveles/tiers, misiones por datos, temporadas con
 * archivo/legacy) ENCIMA de todo el ecosistema. PURA y determinista: devuelve `Reward[]` que el store
 * aplica por la ÚNICA ruta (`applyReward` → PackEngine/Minter/economía). No duplica rewards/economy/
 * collection/craft/marketplace/career: los reutiliza. NO abre presentation/museum/showcase/UI.
 *
 *   Ecosistema → MetricSnapshot → Battle Pass → applyReward → Collection/Economy/…
 */
export * from "./types";
export { PassEngine, freshPassState } from "./engine";
export { levelProgress, levelForXp, xpForLevel } from "./xp";
export { missionProgress, isMissionComplete, assignMission, rollMissions } from "./missions";
export { rewardAt, claimableLevels, isClaimable, trackOf } from "./rewards";
export { snapshotSeason, advanceToSeason } from "./season";
export { migratePassState } from "./migrate";
