/**
 * DAILY GAME LOOP — PRESENTACIÓN PURA (Fase 36).
 *
 * Traduce la foto del servidor (`DailyLoopSnapshot`) a modelos de pantalla. Sin React, sin red, sin decidir
 * prioridades (ya vienen decididas) y sin `Date.now()` implícito: el reloj llega como parámetro (estimado a
 * partir de `serverNow`). Todo lo que se escribe aquí sale de un dato; lo que no existe, no se enseña.
 */
import type {
  DailyAction, DailyLoopSnapshot, LiveEventFact, SeasonFact, TodayItem, TodayItemStatus,
} from "@/domain/dailyLoop";
import { DAILY_ROUTES, eventRoute } from "@/domain/dailyLoop";
import { countdown } from "@/domain/season/time";
import { remainingText, urgencyOf } from "@/domain/liveService";
import { ns, td, getIntlLocale } from "@/i18n/runtime";

const tr = ns("dailyLoop");

export type HeroVisual = "match" | "challenge" | "claim" | "pickem" | "objective" | "packs" | "team" | "campaign" | "ranked" | "quick" | "live" | "account";
export type HeroTone = "key" | "gold" | "cyan" | "violet" | "green";

export interface HeroModel {
  eyebrow: string;
  title: string;
  detail: string;
  cta: { label: string; href: string; disabled: boolean };
  secondary: { label: string; href: string; disabled: boolean } | null;
  progress: { value: number; max: number; label: string; pct: number } | null;
  visual: HeroVisual;
  tone: HeroTone;
  urgent: boolean;
  count: number | null;
  /** Fase 42 · «¿por qué esto?» (servidor). */
  reason: string | null;
  /** Fase 42 · plazo REAL de la acción (Pick'em, objetivo, recompensa), o `null`. */
  deadline: { label: string; urgency: "NORMAL" | "SOON" | "VERY_SOON" } | null;
}

const VISUAL: Record<DailyAction["id"], HeroVisual> = {
  "resume-ranked": "match", "resume-private": "match", "resume-campaign": "match", "resume-pve": "match", "resume-draft": "match", "resume-draft-run": "campaign",
  challenge: "challenge", claim: "claim", predict: "pickem", objective: "objective",
  "journey-open": "packs", "journey-collect": "packs", "journey-build": "team", "journey-play": "quick", open: "packs", "get-cards": "packs", "create-team": "team", "edit-team": "team",
  campaign: "campaign", ranked: "ranked", quick: "quick", "play-hub": "quick", live: "live", "sign-in": "account", fallback: "quick",
};

export const VISUAL_TONE: Record<HeroVisual, HeroTone> = {
  match: "key", challenge: "cyan", claim: "gold", pickem: "cyan", objective: "cyan", packs: "gold",
  team: "violet", campaign: "key", ranked: "violet", quick: "key", live: "green", account: "key",
};

/** RGB de cada tono (mismos valores que `NextUp`/`TodayPanel`: la paleta del sistema, no una nueva). */
export const TONE_RGB: Record<HeroTone, string> = {
  key: "255,46,99", gold: "255,211,92", cyan: "25,227,255", violet: "123,92,255", green: "63,192,122",
};

/** Acciones que solo navegan (no necesitan el servidor para tener sentido). Se decide por id, nunca por destino. */
export const NAVIGATION_ONLY: ReadonlySet<DailyAction["id"]> = new Set(["sign-in", "play-hub", "fallback"]);

const pct = (value: number, max: number) => (max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0);

/**
 * Botón secundario del héroe: SOLO si aporta algo que la barra «Después» no tiene. Con una acción de jugar, «Ver
 * todos los modos» (`/jugar` elige; la home recomienda). En cualquier otro caso no hay: las siguientes acciones ya
 * están en la barra, y repetirlas junto al CTA principal eran dos botones iguales en dos sitios.
 */
export function heroModel(snap: DailyLoopSnapshot, opts: { offline?: boolean; now?: number } = {}): HeroModel {
  const a = snap.primaryAction;
  const visual = VISUAL[a.id] ?? "quick";
  const offline = !!opts.offline;
  const secondary = a.kind === "play" && a.href !== DAILY_ROUTES.play && snap.signedIn
    ? { label: tr("Ver todos los modos"), href: DAILY_ROUTES.play, disabled: false }
    : null;
  return {
    eyebrow: a.eyebrow,
    title: a.title,
    detail: a.detail,
    // Solo la cuenta y el hub de modos (acciones de NAVEGACIÓN) siguen activos sin red; el resto necesita servidor.
    cta: { label: a.cta, href: a.href, disabled: offline && !NAVIGATION_ONLY.has(a.id) },
    secondary,
    progress: a.progress ? { ...a.progress, pct: pct(a.progress.value, a.progress.max) } : null,
    visual,
    tone: VISUAL_TONE[visual],
    urgent: !!a.urgent,
    count: typeof a.count === "number" && a.count > 0 ? a.count : null,
    reason: a.reason ?? null,
    deadline: (() => {
      const now = opts.now ?? snap.serverNow;
      const u = urgencyOf(a.endsAt ?? null, now); const left = remainingText(a.endsAt ?? null, now);
      if (!u || !left || u === "NORMAL") return null;
      return { label: a.kind === "predict" ? tr("Cierra en {left}", { left: td(left) }) : tr("Se renueva en {left}", { left: td(left) }), urgency: u };
    })(),
  };
}

/* ───────────────────────────── hoy ───────────────────────────── */

export const TODAY_STATUS_LABEL: Record<TodayItemStatus, string> = {
  CLAIMABLE: "Reclamar", NEAR: "Casi completado", IN_PROGRESS: "En progreso", PENDING: "Pendiente", AVAILABLE: "Disponible",
};

/** «Caduca en 5 h» / «Caduca en 2 días», desde el reloj del servidor. `null` si no caduca o ya caducó. */
export function expiresLabel(expiresAt: number | null, now: number): string | null {
  if (expiresAt === null || expiresAt <= now) return null;
  const c = countdown(expiresAt, now);
  if (c.days > 0) return tr("Caduca en {days, plural, one {# día} other {# días}}", { days: c.days });
  if (c.hours > 0) return tr("Caduca en {hours} h", { hours: c.hours });
  return tr("Caduca en {Math} min", { Math: Math.max(1, c.minutes) });
}

export interface TodayRow extends TodayItem { statusLabel: string; expires: string | null; pct: number | null }

export function todayRows(snap: DailyLoopSnapshot, now: number): TodayRow[] {
  return snap.today.map((i) => ({
    ...i, statusLabel: TODAY_STATUS_LABEL[i.status], expires: expiresLabel(i.expiresAt, now),
    pct: i.progress ? pct(i.progress.value, i.progress.max) : null,
  }));
}

/* ───────────────────────────── temporada ───────────────────────────── */

export interface SeasonModel {
  name: string;
  statusLabel: string;
  timeLabel: string | null;
  elapsedPct: number;
  pass: { levelLabel: string; xpLabel: string; pct: number; nextReward: string | null } | null;
  account: { levelLabel: string; xpLabel: string; pct: number } | null;
  objectivesLabel: string | null;
  endingSoon: boolean;
}

const SEASON_STATUS: Record<SeasonFact["presentation"], string> = {
  UPCOMING: "Próximamente", ACTIVE: "En curso", ENDING_SOON: "Últimos días", FINAL_DAY: "Último día", ENDED: "Finalizada",
};

function durationLabel(ms: number): string {
  const c = countdown(ms, 0);
  if (c.days > 0) return tr("{n, plural, one {{n} día} other {{n} días}}", { n: c.days });
  if (c.hours > 0) return `${c.hours} h`;
  return `${Math.max(1, c.minutes)} min`;
}

/** `null` sin temporada en el calendario. No se inventa la siguiente: solo se nombra si el calendario la trae. */
export function seasonModel(snap: DailyLoopSnapshot, now: number): SeasonModel | null {
  const s = snap.season?.current ?? snap.season?.next ?? null;
  if (!s) return null;
  const status = s.startsAtMs > now ? "UPCOMING" : s.endsAtMs <= now ? "ENDED" : s.status;
  const timeLabel = status === "UPCOMING" ? tr("Empieza en {v}", { v: durationLabel(s.startsAtMs - now) })
    : status === "ACTIVE" ? tr("Quedan {v}", { v: durationLabel(s.endsAtMs - now) }) : null;
  const pass = snap.season?.pass && snap.season.current ? {
    levelLabel: tr("Pase · nivel {level} de {maxLevel}", { level: snap.season.pass.level, maxLevel: snap.season.pass.maxLevel }),
    xpLabel: tr("{xpIntoLevel} / {xpForNext} XP del pase", { xpIntoLevel: snap.season.pass.xpIntoLevel, xpForNext: snap.season.pass.xpForNext }),
    pct: pct(snap.season.pass.progress, 1),
    nextReward: snap.season.pass.nextReward ? tr("Nivel {level}: {label}", { level: snap.season.pass.nextReward.level, label: td(snap.season.pass.nextReward.label) }) : null,
  } : null;
  const account = snap.player ? {
    levelLabel: tr("Cuenta · nivel {level}", { level: snap.player.level }),
    xpLabel: tr("{xpIntoLevel} / {xpForNext} XP de cuenta", { xpIntoLevel: snap.player.xpIntoLevel, xpForNext: snap.player.xpForNext }),
    pct: pct(snap.player.progress, 1),
  } : null;
  const o = snap.objectives;
  const objectivesLabel = o && (o.daily.total + o.weekly.total) > 0
    ? [o.daily.total ? `Diarios ${o.daily.done}/${o.daily.total}` : null, o.weekly.total ? `Semanales ${o.weekly.done}/${o.weekly.total}` : null].filter(Boolean).join(" · ")
    : null;
  return {
    name: s.name,
    statusLabel: status === s.status ? SEASON_STATUS[s.presentation] : SEASON_STATUS[status === "UPCOMING" ? "UPCOMING" : status === "ENDED" ? "ENDED" : "ACTIVE"],
    timeLabel,
    elapsedPct: pct(Math.min(Math.max(now - s.startsAtMs, 0), s.endsAtMs - s.startsAtMs), s.endsAtMs - s.startsAtMs),
    pass: status === "ENDED" ? null : pass,
    account,
    objectivesLabel,
    endingSoon: s.presentation === "ENDING_SOON" || s.presentation === "FINAL_DAY",
  };
}

/* ───────────────────────────── competitivo ───────────────────────────── */

export interface CompetitiveModel {
  ratingLabel: string;
  positionLabel: string | null;
  stateLabel: "Sin partidas" | "Provisional" | "Clasificado";
  recordLabel: string | null;
  form: { letter: "V" | "D" | "E"; label: string }[];
  placement: { value: number; max: number } | null;
}

const FORM: Record<"WIN" | "LOSS" | "DRAW", { letter: "V" | "D" | "E"; label: string }> = {
  WIN: { letter: "V", label: "Victoria" }, LOSS: { letter: "D", label: "Derrota" }, DRAW: { letter: "E", label: "Empate" },
};

export function competitiveModel(snap: DailyLoopSnapshot, placementGames: number): CompetitiveModel | null {
  const c = snap.competitive;
  if (!c) return null;
  if (c.rating === null || c.gamesPlayed === 0) {
    return { ratingLabel: tr("Sin rating todavía"), positionLabel: null, stateLabel: /* i18n-id */ "Sin partidas", recordLabel: null, form: [], placement: { value: 0, max: placementGames } };
  }
  return {
    ratingLabel: `${c.rating}`,
    positionLabel: c.position !== null ? `#${c.position} de ${c.rankedTotal}` : null,
    stateLabel: c.provisional ? "Provisional" : "Clasificado",
    recordLabel: `${c.wins}V · ${c.losses}D${c.draws ? ` · ${c.draws}E` : ""}`,
    form: c.recent.slice(0, 5).map((r) => FORM[r]),
    placement: c.provisional ? { value: c.gamesPlayed, max: placementGames } : null,
  };
}

/* ───────────────────────────── campaña ───────────────────────────── */

export interface CampaignModel {
  statusLabel: "Sin empezar" | "En curso" | "Completada";
  progressLabel: string;
  pct: number;
  next: { label: string; chapter: string; href: string } | null;
}

export function campaignModel(snap: DailyLoopSnapshot): CampaignModel | null {
  const c = snap.campaign;
  if (!c) return null;
  return {
    statusLabel: c.complete ? "Completada" : c.completed === 0 ? /* i18n-id */ "Sin empezar" : /* i18n-id */ "En curso",
    progressLabel: `${c.completed} / ${c.total}`,
    pct: pct(c.completed, c.total),
    next: !c.complete && c.next ? { label: tr("{name} · contra {team}", { name: td(c.next.name), team: c.next.team }), chapter: tr("Capítulo {n}", { n: c.next.chapterOrder }), href: `${DAILY_ROUTES.campaign}?node=${encodeURIComponent(c.next.nodeId)}` } : null,
  };
}

/* ───────────────────────────── directo ───────────────────────────── */

export type LiveBadge = "EN DIRECTO" | "EN CURSO" | "PRÓXIMAMENTE" | "FINALIZADO" | "DEMO";

export interface LiveCardModel {
  id: string;
  name: string;
  badge: LiveBadge;
  isLive: boolean;
  line: string | null;
  href: string;
  demo: boolean;
}

export const formatWhen = (iso: string | null): string | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleString(getIntlLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });
};

/**
 * «EN DIRECTO» SOLO con un partido en directo. Evento activo sin partido en juego → «EN CURSO». Fase 42: un evento de
 * demostración activo nunca se anuncia «EN DIRECTO» (QA real: datos semilla con un partido `live` residual) → «DEMO».
 */
export function liveBadge(e: Pick<LiveEventFact, "lifecycle" | "liveCount"> & { isDemo?: boolean }): LiveBadge {
  if (e.lifecycle === "ACTIVE" && e.isDemo) return "DEMO";
  if (e.lifecycle === "ACTIVE") return e.liveCount > 0 ? /* i18n-id */ "EN DIRECTO" : /* i18n-id */ "EN CURSO";
  return e.lifecycle === "UPCOMING" ? /* i18n-id */ "PRÓXIMAMENTE" : /* i18n-id */ "FINALIZADO";
}

export function liveCard(e: LiveEventFact): LiveCardModel {
  const badge = liveBadge(e);
  const vs = (a: string | null, b: string | null) => `${a ?? tr("Por determinar")} vs ${b ?? tr("Por determinar")}`;
  const line = badge === "EN DIRECTO" && e.liveMatch
    ? `${vs(e.liveMatch.teamA, e.liveMatch.teamB)}${e.liveMatch.scoreA !== null && e.liveMatch.scoreB !== null ? ` · ${e.liveMatch.scoreA}-${e.liveMatch.scoreB}` : ""}`
    : e.nextMatch
      ? tr("Próximo: {match}", { match: `${vs(e.nextMatch.teamA, e.nextMatch.teamB)}${formatWhen(e.nextMatch.startTime) ? ` · ${formatWhen(e.nextMatch.startTime)}` : ""}` })
      : badge === "PRÓXIMAMENTE" && formatWhen(e.startDate) ? tr("Empieza {when}", { when: formatWhen(e.startDate) }) : null;
  return { id: e.id, name: e.name, badge, isLive: badge === "EN DIRECTO", line, href: eventRoute(e.id), demo: e.isDemo };
}

export function liveModel(snap: DailyLoopSnapshot): { featured: LiveCardModel | null; upcoming: LiveCardModel | null; pickemPending: number } | null {
  if (!snap.live) return null;
  const featured = snap.live.featured ? liveCard(snap.live.featured) : null;
  const upcoming = snap.live.upcoming && snap.live.upcoming.id !== snap.live.featured?.id ? liveCard(snap.live.upcoming) : null;
  return { featured, upcoming, pickemPending: snap.live.pickemPending };
}

/* ───────────────────────────── sobres · colección · logros ───────────────────────────── */

export interface StashModel {
  packs: { label: string; cta: { label: string; href: string } } | null;
  collection: { label: string; pct: number; detail: string } | null;
  achievements: { label: string; detail: string | null; href: string; claimable: boolean } | null;
}

export function stashModel(snap: DailyLoopSnapshot): StashModel {
  const n = snap.packs?.unopened ?? null;
  const packs = n === null ? null : n > 0
    ? { label: tr("Tienes {n} {v}", { n, v: n === 1 ? tr("sobre sin abrir") : tr("sobres sin abrir") }), cta: { label: n === 1 ? tr("Abrir sobre") : tr("Abrir {n} sobres", { n }), href: DAILY_ROUTES.inventory } }
    : { label: tr("No tienes sobres por abrir"), cta: { label: tr("Ver sobres"), href: DAILY_ROUTES.packs } };
  const col = snap.collection;
  const collection = col ? {
    label: tr("{distinct} / {catalog} cartas distintas", { distinct: col.distinct, catalog: col.catalog }),
    pct: pct(col.distinct, col.catalog),
    detail: `${col.owned} ${col.owned === 1 ? tr("carta en total") : tr("cartas en total")}`,
  } : null;
  const a = snap.achievements;
  const achievements = a ? a.claimable > 0
    ? { label: `${a.claimable} ${a.claimable === 1 ? tr("logro por reclamar") : tr("logros por reclamar")}`, detail: tr("{claimed} de {total} conseguidos", { claimed: a.claimed, total: a.total }), href: DAILY_ROUTES.claims, claimable: true }
    : a.near
      ? { label: a.near.name, detail: `${a.near.current} / ${a.near.goal}`, href: DAILY_ROUTES.claims, claimable: false }
      : { label: tr("{claimed} de {total} logros", { claimed: a.claimed, total: a.total }), detail: null, href: DAILY_ROUTES.claims, claimable: false } : null;
  return { packs, collection, achievements };
}
