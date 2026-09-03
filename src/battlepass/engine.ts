/**
 * PASS ENGINE — orquestador del Battle Pass (Collection Fase 6/7).
 *
 * PURO y DETERMINISTA. Opera sobre un `PassState` serializable + un `SeasonDef` (datos). Nunca aplica
 * recompensas ni toca stores: devuelve la lista de `Reward` para que el store las aplique por la ÚNICA
 * ruta (`applyReward`). Reloj lógico y RNG inyectados (sin `Date.now`/`Math.random`). Índices/coste O(1)
 * por operación (sets de niveles reclamados, map de misiones).
 *
 * Operaciones: gainXp · claimReward · claimTrack · unlockPremium · completeMission · refreshMissions ·
 * advanceSeason · archiveSeason · validateSeason · analytics.
 */
import type { Rng } from "@/sim/rng";
import { levelProgress } from "./xp";
import { rollMissions, assignMission, missionProgress } from "./missions";
import { claimableLevels, isClaimable, trackOf } from "./rewards";
import { snapshotSeason, advanceToSeason, freshPassState } from "./season";
import type {
  PassState, PassTrack, SeasonDef, Reward, PassResult, PassEvent, MetricSnapshot, MissionKind,
  PassAnalytics, PassValidation, PassIssue, ActiveMission,
} from "./types";

const clampInt = (n: number): number => Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));

export class PassEngine {
  private state: PassState;
  readonly season: SeasonDef;

  constructor(state: PassState, season: SeasonDef) {
    this.state = { ...state };
    this.season = season;
  }

  snapshot(): PassState {
    return {
      ...this.state,
      claimedFree: [...this.state.claimedFree],
      claimedCompetitive: [...this.state.claimedCompetitive],
      claimedPremium: [...this.state.claimedPremium],
      missions: this.state.missions.map((m) => ({ ...m })),
      archive: [...this.state.archive],
    };
  }
  level(): number { return levelProgress(this.state.xp, this.season).level; }
  progress() { return levelProgress(this.state.xp, this.season); }

  private ok(rewards: Reward[], events: PassEvent[]): PassResult { return { ok: true, state: this.snapshot(), rewards, events }; }
  private fail(error: string): PassResult { return { ok: false, error, state: this.snapshot(), rewards: [], events: [] }; }

  /** Los niveles ya reclamados de un carril. Devuelve el array VIVO: se muta al reclamar. */
  private claimedOf(track: PassTrack): number[] {
    if (track === "premium") return this.state.claimedPremium;
    if (track === "competitive") return this.state.claimedCompetitive;
    return this.state.claimedFree;
  }

  /** ¿Está abierto el carril? El libre siempre; los otros dos, cada uno por su vía. */
  private trackOpen(track: PassTrack): boolean {
    if (track === "premium") return this.state.premium;
    if (track === "competitive") return this.state.competitiveUnlocked;
    return true;
  }

  // ── Reglas de reclamo (compartidas por auto-claim y claim manual) ──
  private claimEligible(reached: number, now: number, tracks: PassTrack[]): { rewards: Reward[]; events: PassEvent[] } {
    const rewards: Reward[] = [];
    const events: PassEvent[] = [];
    for (const track of tracks) {
      if (!this.trackOpen(track)) continue;
      const claimedArr = this.claimedOf(track);
      const t = trackOf(this.season, track);
      for (const lvl of claimableLevels(t, reached, claimedArr)) {
        claimedArr.push(lvl);
        rewards.push(t[lvl]);
        events.push({ type: "reward_claimed", at: now, data: { level: lvl, track } });
      }
    }
    return { rewards, events };
  }

  // ─────────────────────── XP / niveles ───────────────────────

  gainXp(amount: number, now: number): PassResult {
    const before = this.level();
    this.state.xp += clampInt(amount) * (this.state.boost > 0 ? this.state.boost : 1);
    const after = this.level();
    const events: PassEvent[] = [{ type: "xp_gained", at: now, data: { amount: clampInt(amount) } }];
    for (let l = before + 1; l <= after; l++) events.push({ type: "level_up", at: now, data: { level: l } });
    let rewards: Reward[] = [];
    if (this.state.autoClaim && after > before) {
      const c = this.claimEligible(after, now, ["free", "competitive", "premium"]);
      rewards = c.rewards; events.push(...c.events);
    }
    return this.ok(rewards, events);
  }

  setBoost(mult: number): void { this.state.boost = mult > 0 ? mult : 1; }
  setAutoClaim(on: boolean): void { this.state.autoClaim = on; }

  // ─────────────────────── Reclamos ───────────────────────

  claimReward(level: number, track: PassTrack, now: number): PassResult {
    if (!this.trackOpen(track)) {
      return this.fail(track === "premium" ? "Premium no desbloqueado" : "Carril competitivo no desbloqueado");
    }
    const t = trackOf(this.season, track);
    const reached = this.level();
    const claimedArr = this.claimedOf(track);
    if (!isClaimable(t, level, reached, claimedArr)) return this.fail("Nivel no reclamable");
    claimedArr.push(level);
    return this.ok([t[level]], [{ type: "reward_claimed", at: now, data: { level, track } }]);
  }

  claimTrack(track: PassTrack, now: number): PassResult {
    if (!this.trackOpen(track)) {
      return this.fail(track === "premium" ? "Premium no desbloqueado" : "Carril competitivo no desbloqueado");
    }
    const c = this.claimEligible(this.level(), now, [track]);
    return this.ok(c.rewards, [...c.events, { type: "track_claimed", at: now, data: { track, count: c.rewards.length } }]);
  }

  unlockPremium(now: number): PassResult {
    if (this.state.premium) return this.fail("Premium ya desbloqueado");
    this.state.premium = true;
    return this.ok([], [{ type: "premium_unlocked", at: now }]);
  }

  /**
   * Abre el carril competitivo. Lo llama QUIEN CONOCE los puntos del jugador —el
   * servidor—, porque el motor es puro y no sabe nada de su perfil. Aquí solo se guarda
   * la decisión, igual que con el premium.
   */
  unlockCompetitive(now: number): PassResult {
    if (this.state.competitiveUnlocked) return this.fail("Carril competitivo ya desbloqueado");
    this.state.competitiveUnlocked = true;
    return this.ok([], [{ type: "competitive_unlocked", at: now }]);
  }

  // ─────────────────────── Misiones ───────────────────────

  /** Asigna definiciones concretas de misión (seasonal/event/special), fijando baseline. */
  addMissions(defIds: string[], snapshot: MetricSnapshot, now: number): PassResult {
    const have = new Set(this.state.missions.map((m) => m.id));
    for (const id of defIds) {
      const def = this.season.missionPool.find((m) => m.id === id);
      if (def && !have.has(id)) this.state.missions.push(assignMission(def, snapshot, now));
    }
    return this.ok([], [{ type: "missions_refreshed", at: now, data: { added: defIds.length } }]);
  }

  /** Sortea un nuevo set de misiones de un tipo (reemplaza las de ese tipo). Determinista (RNG). */
  refreshMissions(kind: MissionKind, count: number, snapshot: MetricSnapshot, rng: Rng, now: number): PassResult {
    this.state.missions = this.state.missions.filter((m) => m.kind !== kind);
    for (const def of rollMissions(this.season.missionPool, kind, count, rng)) this.state.missions.push(assignMission(def, snapshot, now));
    return this.ok([], [{ type: "missions_refreshed", at: now, data: { kind, count } }]);
  }

  /**
   * Completa/reclama una misión SI su métrica ha alcanzado el goal. Suma su XP al pase (puede subir de
   * nivel y auto-reclamar). Repetible ⇒ re-baseline; si no ⇒ queda reclamada. Devuelve mission.reward +
   * cualquier recompensa de nivel desbloqueada.
   */
  completeMission(id: string, snapshot: MetricSnapshot, now: number): PassResult {
    const mission = this.state.missions.find((m) => m.id === id);
    if (!mission) return this.fail("Misión no activa");
    if (mission.claimed) return this.fail("Misión ya reclamada");
    if (missionProgress(mission, snapshot) < mission.goal) return this.fail("Misión no completada");

    const def = this.season.missionPool.find((m) => m.id === id);
    const reward = def?.reward ?? {};
    const xp = def?.xp ?? 0;

    // Repetible: re-baseline para volver a empezar; si no, marcar reclamada.
    if (def?.repeatable) mission.baseline = snapshot[mission.metric] ?? mission.baseline + mission.goal;
    else mission.claimed = true;
    this.state.missionsCompleted += 1;

    const events: PassEvent[] = [{ type: "mission_completed", at: now, data: { id } }, { type: "mission_claimed", at: now, data: { id } }];
    const rewards: Reward[] = [reward];
    // XP de la misión (puede subir de nivel → auto-claim).
    const xpRes = this.gainXp(xp, now);
    rewards.push(...xpRes.rewards);
    events.push(...xpRes.events);
    return this.ok(rewards, events);
  }

  // ─────────────────────── Temporadas ───────────────────────

  /** Archiva la temporada actual (legacy/historic) sin avanzar. */
  archiveSeason(now: number): PassResult {
    this.state.archive = [...this.state.archive, snapshotSeason(this.state, this.season, now)];
    return this.ok([], [{ type: "season_archived", at: now, data: { seasonId: this.state.seasonId } }]);
  }

  /** Avanza a la siguiente temporada: archiva + soft reset (el historial nunca se pierde). */
  advanceSeason(nextSeasonId: string, now: number): PassResult {
    this.state = advanceToSeason(this.state, this.season, nextSeasonId, now);
    return this.ok([], [{ type: "season_advanced", at: now, data: { from: this.season.id, to: nextSeasonId } }]);
  }

  // ─────────────────────── Validación / analytics ───────────────────────

  validateSeason(): PassValidation {
    const issues: PassIssue[] = [];
    const s = this.state;
    if (s.xp < 0) issues.push({ code: "NEG_XP", message: "XP negativa" });
    const reached = this.level();
    if (reached < 0 || reached > this.season.maxLevel) issues.push({ code: "BAD_LEVEL", message: "Nivel fuera de rango" });
    const dupF = new Set(s.claimedFree).size !== s.claimedFree.length;
    const dupP = new Set(s.claimedPremium).size !== s.claimedPremium.length;
    if (dupF || dupP) issues.push({ code: "DUP_CLAIM", message: "Nivel reclamado dos veces" });
    if (s.claimedFree.some((l) => l > reached) || s.claimedPremium.some((l) => l > reached)) issues.push({ code: "CLAIM_TOO_HIGH", message: "Reclamado un nivel no alcanzado" });
    if (!s.premium && s.claimedPremium.length > 0) issues.push({ code: "PREMIUM_CLAIM", message: "Reclamo premium sin desbloqueo" });
    if (!s.competitiveUnlocked && s.claimedCompetitive.length > 0) issues.push({ code: "COMPETITIVE_CLAIM", message: "Reclamo competitivo sin desbloqueo" });
    if (s.claimedCompetitive.some((l) => l > reached)) issues.push({ code: "CLAIM_TOO_HIGH", message: "Reclamado un nivel no alcanzado" });
    if (new Set(s.missions.map((m) => m.id)).size !== s.missions.length) issues.push({ code: "DUP_MISSION", message: "Misión duplicada" });
    return { ok: issues.length === 0, issues };
  }

  analytics(): PassAnalytics {
    const p = this.progress();
    return {
      seasonId: this.state.seasonId, level: p.level, maxLevel: this.season.maxLevel, xp: this.state.xp,
      percentComplete: Math.round((p.level / this.season.maxLevel) * 100),
      premium: this.state.premium,
      claimedFree: this.state.claimedFree.length,
      claimedCompetitive: this.state.claimedCompetitive.length,
      claimedPremium: this.state.claimedPremium.length,
      missionsActive: this.state.missions.filter((m) => !m.claimed).length, missionsCompleted: this.state.missionsCompleted,
      seasonsArchived: this.state.archive.length,
    };
  }
}

export { freshPassState };
