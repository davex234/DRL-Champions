/**
 * META GAME 2.0 — MODELO DE LECTURA Y AYUDANTES PUROS (Fase 27).
 *
 * `MetaSnapshot` reúne lecturas REALES que ya existían por separado (XP de cuenta, pase, misiones,
 * logros, libro mayor, pasos del bucle) en un solo objeto. **No es una nueva autoridad**: cada
 * cifra la escribió el servidor en su sitio (`profiles.xp`, `user_pass`, `user_achievements`,
 * `credit_transactions`) y aquí solo se compone y se traduce. Nada de este módulo concede,
 * completa ni reclama nada.
 *
 * Sin React, sin red, sin `window`, sin `Date.now()` implícito: el reloj se pasa siempre.
 */
import { levelFromXp, totalXpForLevel } from "./levels";
import { ACHIEVEMENTS } from "./achievements";
import { CURRENT_SEASON } from "@/data/season";
import { describeLedger, packLabel } from "@/domain/pickems/ledger";
import type { MissionKind } from "@/battlepass/types";

/* ───────────────────────────── nivel de cuenta (canónico) ───────────────────────────── */

export interface MetaLevel {
  xp: number;
  level: number;
  xpIntoLevel: number;
  xpForNext: number;
  progress: number;
  /** XP que falta para el siguiente nivel. */
  toNext: number;
  /** XP total acumulada que exige el siguiente nivel. */
  nextTotal: number;
}

/** El nivel de cuenta SIEMPRE sale de `levelFromXp`: no hay tabla paralela ni segunda curva. */
export function accountLevel(xp: number): MetaLevel {
  const i = levelFromXp(Math.max(0, xp));
  return { xp, ...i, toNext: Math.max(0, i.xpForNext - i.xpIntoLevel), nextTotal: totalXpForLevel(i.level + 1) };
}

/** Niveles cruzados entre dos lecturas de XP del servidor (puede ser más de uno). */
export function levelsGained(xpBefore: number, xpAfter: number): number[] {
  const a = levelFromXp(Math.max(0, xpBefore)).level;
  const b = levelFromXp(Math.max(0, xpAfter)).level;
  const out: number[] = [];
  for (let l = a + 1; l <= b; l++) out.push(l);
  return out;
}

/* ───────────────────────────── objetivos ───────────────────────────── */

export type ObjectiveStatus = "EN_PROGRESO" | "PENDIENTE_DE_RECOGER" | "RECOMPENSA_CONSEGUIDA";

export interface MetaObjective {
  id: string;
  label: string;
  kind: MissionKind | string;
  current: number;
  goal: number;
  complete: boolean;
  claimed: boolean;
  rewardCredits: number;
  /** XP del PASE (no de cuenta) que da al reclamarse. */
  xp: number;
  /** Métrica real que mide (`packs_opened`, `duels_won`, `distinct_cards`…). */
  metric: string;
  /** Sobre que da, si lo da. */
  packId: string | null;
  packCount: number;
  /** Reloj lógico de asignación (servidor). Identifica la tanda. */
  assignedAt: number;
  /** Cuándo caduca (fin de su ventana), o `null` si no caduca. Lo fija el servidor. */
  expiresAt: number | null;
}

export function objectiveStatus(o: Pick<MetaObjective, "complete" | "claimed">): ObjectiveStatus {
  if (o.claimed) return "RECOMPENSA_CONSEGUIDA";
  if (o.complete) return "PENDIENTE_DE_RECOGER";
  return "EN_PROGRESO";
}

export const OBJECTIVE_STATUS_LABEL: Record<ObjectiveStatus, string> = {
  EN_PROGRESO: "En progreso",
  PENDIENTE_DE_RECOGER: "Pendiente de recoger",
  RECOMPENSA_CONSEGUIDA: "Recompensa conseguida",
};

export const objectivePct = (o: Pick<MetaObjective, "current" | "goal">): number =>
  o.goal > 0 ? Math.max(0, Math.min(100, (o.current / o.goal) * 100)) : 0;

/** Objetivos activos ordenados: pendientes de recoger, después los más cerca de completarse. */
export function sortObjectives(list: MetaObjective[]): MetaObjective[] {
  return [...list].sort((a, b) =>
    Number(b.complete && !b.claimed) - Number(a.complete && !a.claimed) ||
    Number(a.claimed) - Number(b.claimed) ||
    objectivePct(b) - objectivePct(a) ||
    a.label.localeCompare(b.label));
}

export interface ObjectiveDelta {
  id: string;
  label: string;
  kind: string;
  goal: number;
  from: number;
  to: number;
  /** Ha pasado a completo entre las dos lecturas. */
  completed: boolean;
}

/**
 * Qué objetivos avanzaron entre DOS LECTURAS DEL SERVIDOR (antes y después de una actividad).
 * Nunca se calcula un progreso aquí: se comparan dos verdades del servidor. Una tanda distinta
 * (`assignedAt` cambió: rotó) no se compara, porque no es el mismo objetivo.
 */
export function objectiveDeltas(before: MetaObjective[], after: MetaObjective[]): ObjectiveDelta[] {
  const prev = new Map(before.map((o) => [`${o.id}@${o.assignedAt}`, o]));
  const out: ObjectiveDelta[] = [];
  for (const o of after) {
    const p = prev.get(`${o.id}@${o.assignedAt}`);
    if (!p || o.claimed) continue;
    if (o.current > p.current) {
      out.push({ id: o.id, label: o.label, kind: String(o.kind), goal: o.goal, from: p.current, to: o.current, completed: o.complete && !p.complete });
    }
  }
  return out.sort((a, b) => Number(b.completed) - Number(a.completed) || (b.to - b.from) - (a.to - a.from));
}

/** Como mucho `max` visibles y «+ N más»: una partida puede tocar varias metas sin llenar la pantalla. */
export function summarizeDeltas<T>(list: T[], max = 3): { shown: T[]; more: number } {
  return { shown: list.slice(0, max), more: Math.max(0, list.length - max) };
}

/* ───────────────────────────── logros ───────────────────────────── */

export type AchievementCategory = "COLECCION" | "PACKS" | "JUEGO" | "COMPETITIVO" | "PICKEMS";

export const CATEGORY_LABEL: Record<AchievementCategory, string> = {
  COLECCION: "Colección", PACKS: "Sobres", JUEGO: "Juego", COMPETITIVO: "Competitivo", PICKEMS: "Pick'ems",
};

/** Categoría DERIVADA del catálogo real: solo existen logros de sobres y de colección. */
export function achievementCategory(id: string): AchievementCategory {
  if (id.startsWith("sobres-")) return "PACKS";
  return "COLECCION";
}

/** Categorías que tienen al menos un logro real, en orden fijo. Ninguna categoría vacía se enseña. */
export function categoriesPresent(ids: readonly string[]): AchievementCategory[] {
  const order: AchievementCategory[] = ["JUEGO", "COLECCION", "PACKS", "COMPETITIVO", "PICKEMS"];
  const present = new Set(ids.map(achievementCategory));
  return order.filter((c) => present.has(c));
}

export type AchievementStatus = "BLOQUEADO" | "EN_PROGRESO" | "PENDIENTE_DE_RECOGER" | "CONSEGUIDO";

export const ACHIEVEMENT_STATUS_LABEL: Record<AchievementStatus, string> = {
  BLOQUEADO: "Bloqueado", EN_PROGRESO: "En progreso", PENDIENTE_DE_RECOGER: "Pendiente de recoger", CONSEGUIDO: "Conseguido",
};

export function achievementStatus(a: { current: number; goal: number; complete: boolean; claimed: boolean }): AchievementStatus {
  if (a.claimed) return "CONSEGUIDO";
  if (a.complete) return "PENDIENTE_DE_RECOGER";
  return a.current > 0 ? "EN_PROGRESO" : "BLOQUEADO";
}

/** No hay logros secretos en el catálogo: si algún día los hay, aquí se decide qué no se revela. */
export const isSecretAchievement = (_id: string): boolean => false;

/* ───────────────────────────── recompensas (libro mayor) ───────────────────────────── */

export type RewardSource = "duel" | "achievement" | "mission" | "pass" | "pickem" | "event" | "starter" | "purchase" | "other";

export const SOURCE_LABEL: Record<RewardSource, string> = {
  duel: "Duelo", achievement: "Logro", mission: "Objetivo", pass: "Pase", pickem: "Pick'ems", event: "Evento", starter: "Bienvenida", purchase: "Compra", other: "Otro",
};

export interface LedgerLike { id: string; delta: number; reason: string; ref: string | null; created_at: string }

export interface RewardEntry {
  id: string;
  at: string;
  source: RewardSource;
  label: string;
  /** Créditos del asiento (puede ser 0: p. ej. un duelo topado o un sobre del pase). */
  credits: number;
  /** Sobre concedido, cuando la DEFINICIÓN de la recompensa lo dice (misión, pase, escalón). */
  pack: { packId: string; count: number; label: string } | null;
  /** XP asociada cuando la DEFINICIÓN la fija (misión: XP del pase; escalón de Pick'ems: XP de cuenta). `null` si no se puede saber del asiento. */
  xp: number | null;
  ref: string | null;
}

const DUEL_LABEL: Record<string, string> = { win: "Duelo ganado", loss: "Duelo perdido", draw: "Duelo empatado" };

/**
 * Traduce UN asiento del libro mayor a una entrada legible. Las cifras son las del asiento; los
 * sobres y la XP solo se añaden cuando la definición referida por `ref` los fija de forma
 * determinista (misión del pool, nivel del carril, escalón de Pick'ems). Nunca se infiere una
 * fuente que el `reason` no diga.
 */
export function describeReward(row: LedgerLike): RewardEntry {
  const base = { id: row.id, at: row.created_at, credits: Math.max(0, row.delta), pack: null, xp: null, ref: row.ref };
  const r = row.reason;

  const duel = /^duel_(capped_)?(win|loss|draw)$/.exec(r);
  if (duel) {
    return { ...base, source: "duel", label: `${DUEL_LABEL[duel[2]]}${duel[1] ? " · tope diario, sin pago" : ""}` };
  }
  if (r === "achievement") {
    const id = (row.ref ?? "").replace(/^achievement:/, "");
    const def = ACHIEVEMENTS.find((a) => a.id === id);
    return { ...base, source: "achievement", label: def ? `Logro · ${def.name}` : "Logro" };
  }
  if (r === "mission_reward") {
    // ref = mission:<season>:<id>:<ts>[#i]
    const parts = (row.ref ?? "").split("#")[0].split(":");
    const def = CURRENT_SEASON.missionPool.find((m) => m.id === parts[2]);
    return {
      ...base, source: "mission", label: def ? `Objetivo · ${def.label}` : "Objetivo",
      pack: def?.reward.packId ? { packId: def.reward.packId, count: def.reward.packCount ?? 1, label: packLabel(def.reward.packId) } : null,
      xp: def ? def.xp : null,
    };
  }
  if (r === "pass_reward") {
    // ref = pass:<season>:<track>:<level>[#i]
    const parts = (row.ref ?? "").split("#")[0].split(":");
    const track = parts[2] as "free" | "competitive" | "premium" | undefined;
    const level = Number(parts[3]);
    const t = track === "premium" ? CURRENT_SEASON.premium : track === "competitive" ? CURRENT_SEASON.competitive ?? {} : CURRENT_SEASON.free;
    const reward = Number.isFinite(level) ? t[level] : undefined;
    const trackLabel = track === "competitive" ? "competitivo" : track === "premium" ? "de aspecto" : "libre";
    return {
      ...base, source: "pass", label: Number.isFinite(level) ? `Pase · nivel ${level} (carril ${trackLabel})` : "Pase",
      pack: reward?.packId ? { packId: reward.packId, count: reward.packCount ?? 1, label: packLabel(reward.packId) } : null,
    };
  }
  if (r.startsWith("pickem_reward:")) {
    const d = describeLedger(r, row.ref);
    return {
      ...base, source: "pickem", label: d.label,
      pack: d.tier?.reward.packId ? { packId: d.tier.reward.packId, count: d.tier.reward.packCount ?? 1, label: packLabel(d.tier.reward.packId) } : null,
      xp: d.tier?.reward.xp ?? null,
    };
  }
  if (r.startsWith("event_challenge:")) return { ...base, source: "event", label: "Desafío de evento" };
  if (r === "starter_grant") return { ...base, source: "starter", label: "Créditos de bienvenida" };
  if (r.startsWith("buy_pack:")) return { ...base, source: "purchase", label: describeLedger(r, row.ref).label, credits: 0 };
  return { ...base, source: "other", label: r };
}

export const isRewardEntry = (e: Pick<RewardEntry, "source">): boolean =>
  e.source !== "purchase" && e.source !== "other";

/** Las últimas recompensas, del libro mayor, tal cual. */
export function rewardHistory(rows: LedgerLike[], limit = 8): RewardEntry[] {
  return rows.map(describeReward).filter(isRewardEntry).slice(0, limit);
}

/* ───────────────────────────── hoy en NEXUS ───────────────────────────── */

export type TodayKind = "resume" | "run" | "challenge" | "claim" | "predict" | "objective" | "open" | "build" | "play" | "explore";

export interface TodayAction {
  id: string;
  kind: TodayKind;
  label: string;
  detail: string;
  href: string;
  count?: number;
  urgent?: boolean;
  /**
   * Fase 36 · paso de PRIMERA SESIÓN que bloquea todo lo demás (sin ninguna carta y con sobres: no se
   * puede jugar, ni construir, ni tiene sentido predecir antes de ver una carta). Se ordena justo detrás
   * de `resume`: una partida a medias sigue mandando. Es la regla de la Fase 15 (`loop.ts`, prioridad 0)
   * llevada a la prioridad única; no es un segundo motor.
   */
  ftue?: boolean;
  /**
   * Fase 42 · urgencia DERIVADA de un fin real (`endsAt` del servidor) por quien construye el candidato. Solo un
   * Pick'em, objetivo o recompensa que termina «muy pronto» (≤ 2 h) sube por encima de las recompensas sin plazo.
   */
  urgency?: "NORMAL" | "SOON" | "VERY_SOON" | null;
}

/**
 * Prioridad de HOY, fija y pura:
 *   partida a medias > reto privado pendiente (Fase 29) > recompensa pendiente > Pick'em abierto >
 *   objetivo casi completo > sobre por abrir > equipo incompleto > jugar > circuito.
 */
const RANK: Record<TodayKind, number> = { resume: 0, challenge: 1, claim: 2, predict: 3, objective: 4, open: 5, build: 6, play: 7, explore: 8, run: 0.7 };

/** Fase 42 · lo que caduca «muy pronto» con fin real va entre el reto privado y las recompensas sin plazo. */
export const EXPIRING_RANK = 1.5;
const DEADLINE_KINDS: ReadonlySet<TodayKind> = new Set(["predict", "objective", "claim"]);

/**
 * Rango efectivo de una acción: el de su tipo; «justo detrás de retomar» si es un bloqueo de primera sesión; y
 * (Fase 42) 1,5 si termina muy pronto de verdad. Retomar una partida (0) nunca pierde contra nada.
 */
export const todayRank = (a: Pick<TodayAction, "kind" | "ftue" | "urgency">): number =>
  a.ftue ? RANK.resume + 0.5 : a.urgency === "VERY_SOON" && DEADLINE_KINDS.has(a.kind) ? Math.min(RANK[a.kind], EXPIRING_RANK) : RANK[a.kind];

/**
 * Un objetivo sigue VIVO si su ventana no ha terminado. Una tanda diaria/semanal caducada se borra entera
 * al rotar (`PassEngine.refreshMissions` filtra por tipo), incluidas las completas sin reclamar: proponer
 * «Reclamar» o «Casi completado» sobre ella sería prometer algo que desaparece al abrir Logros.
 */
export const liveObjective = (o: Pick<MetaObjective, "expiresAt">, now: number): boolean => o.expiresAt === null || o.expiresAt > now;

/** Un objetivo «casi» completo: la mitad o más, sin terminar, sin reclamar (y vivo, si se da el reloj). */
export function nearObjective(objectives: MetaObjective[], now?: number): MetaObjective | null {
  const cands = objectives.filter((o) => !o.complete && !o.claimed && o.goal > 0 && objectivePct(o) >= 50 && (now === undefined || liveObjective(o, now)));
  cands.sort((a, b) => objectivePct(b) - objectivePct(a) || (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity) || a.id.localeCompare(b.id));
  return cands[0] ?? null;
}

/**
 * EL ORDEN ÚNICO (Fase 36). Ordena por `todayRank` y deja UNA acción por tipo. El desempate dentro del mismo
 * rango es el ORDEN DE ENTRADA (el `sort` de JS es estable): quien construye los candidatos decide, por
 * escrito, cuál va antes (p. ej. PvP a medias antes que PvE a medias). Home, temporada y Daily Loop lo usan.
 */
export function orderToday<T extends TodayAction>(list: readonly T[], max = 4): T[] {
  const seen = new Set<TodayKind>();
  return [...list]
    .sort((a, b) => todayRank(a) - todayRank(b))
    .filter((s) => (seen.has(s.kind) ? false : (seen.add(s.kind), true)))
    .slice(0, max);
}

export function todayActions(input: { steps: TodayAction[]; objectives: MetaObjective[]; max?: number; now?: number }): TodayAction[] {
  const list = input.steps.filter((s) => s.kind !== "objective");
  const near = nearObjective(input.objectives, input.now);
  if (near) {
    list.push({
      id: `objective-${near.id}`, kind: "objective", label: "Continúa tu objetivo",
      detail: `${near.label} · ${near.current} / ${near.goal}`, href: "/misiones",
      urgent: near.expiresAt !== null,
    });
  }
  return orderToday(list, input.max ?? 4);
}

/** La recomendación única de la home («CONTINUAR»): la primera acción de hoy, con su verbo. */
export function continueCta(actions: TodayAction[]): { label: string; href: string; kind: TodayKind } | null {
  const a = actions[0];
  if (!a) return null;
  const label: Record<TodayKind, string> = {
    resume: "Retoma tu duelo",
    run: "Vuelve a tu Draft",
    challenge: "Responde al reto",
    claim: "Reclama tus recompensas",
    predict: "Haz tus Pick'ems",
    objective: "Continúa tu objetivo",
    open: a.count && a.count > 0 ? `Abre tus ${a.count} ${a.count === 1 ? "sobre" : "sobres"}` : "Abre tus sobres",
    build: "Completa tu equipo",
    play: "Juega un duelo",
    explore: "Sigue el circuito",
  };
  return { label: label[a.kind], href: a.href, kind: a.kind };
}

/* ───────────────────────────── primera sesión / vuelta ───────────────────────────── */

export interface FtueStep { id: string; label: string; done: boolean; href: string }

export interface FtueState {
  /** Cuenta sin actividad: ni sobres abiertos ni duelos jugados. */
  isNew: boolean;
  steps: FtueStep[];
}

export function ftueState(input: { packsOpened: number; duelsPlayed: number; hasValidDeck: boolean; level: number; unopenedPacks: number }): FtueState {
  const steps: FtueStep[] = [
    { id: "open", label: "Abre tu primer sobre", done: input.packsOpened > 0, href: input.unopenedPacks > 0 ? "/inventario" : "/packs" },
    { id: "deck", label: "Crear mi primer equipo", done: input.hasValidDeck, href: "/duelos/mazos" },
    { id: "duel", label: "Juega tu primer duelo", done: input.duelsPlayed > 0, href: "/duelos/jugar" },
    { id: "level", label: "Progresa: sube de nivel", done: input.level > 1, href: "/cuenta?seccion=progresion" },
  ];
  return { isNew: input.packsOpened === 0 && input.duelsPlayed === 0, steps };
}

/* ───────────────────────────── eventos para avisos (identidad estable) ───────────────────────────── */

export type ProgressEventKind = "LEVEL_UP" | "OBJECTIVE_COMPLETE" | "ACHIEVEMENT" | "PACK_REWARD";

export interface ProgressEvent { id: string; kind: ProgressEventKind; text: string }

/**
 * Eventos surgidos ENTRE DOS LECTURAS del servidor durante la interacción actual. La identidad es
 * estable (nivel, id+tanda, id) para que un aviso no se repita en cada sondeo o render. No hay
 * acuse en el servidor, así que solo se usan diferencias observadas en esta sesión: nunca se
 * esconde una recompensa histórica detrás del aviso.
 */
export function progressEvents(before: MetaEventsInput, after: MetaEventsInput): ProgressEvent[] {
  const out: ProgressEvent[] = [];
  for (const l of levelsGained(before.xp, after.xp)) out.push({ id: `level:${l}`, kind: "LEVEL_UP", text: `¡Nivel ${l}!` });
  for (const d of objectiveDeltas(before.objectives, after.objectives)) {
    if (d.completed) out.push({ id: `objective:${d.id}:${after.objectives.find((o) => o.id === d.id)?.assignedAt ?? 0}`, kind: "OBJECTIVE_COMPLETE", text: `Objetivo completado · ${d.label}` });
  }
  const prevDone = new Set(before.achievements.filter((a) => a.complete).map((a) => a.id));
  for (const a of after.achievements) {
    if (a.complete && !prevDone.has(a.id)) out.push({ id: `achievement:${a.id}`, kind: "ACHIEVEMENT", text: `Logro conseguido · ${a.name}` });
  }
  return out;
}

export interface MetaEventsInput {
  xp: number;
  objectives: MetaObjective[];
  achievements: { id: string; name: string; complete: boolean }[];
}
