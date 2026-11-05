/**
 * TEMPORADAS DE NEXUS — MODELO CANÓNICO Y CICLO DE VIDA (Fase 34). PURO.
 *
 * Una temporada es un CONTRATO TEMPORAL: `startsAt` y `endsAt` absolutos (UTC). Todo lo demás se DERIVA
 * de esas dos fechas y de UN reloj que pasa quien llama —el servidor—:
 *
 *   UPCOMING  now <  startsAt
 *   ACTIVE    startsAt <= now < endsAt          (el inicio es inclusivo, el final exclusivo)
 *   ENDED     now >= endsAt
 *
 * Y solo para PRESENTACIÓN (no se persiste, no decide nada):
 *
 *   ENDING_SOON  ACTIVE y quedan <= 7 días (ENDING_SOON_MS)
 *   FINAL_DAY    ACTIVE y quedan <  24 horas (FINAL_DAY_MS)
 *
 * No hay booleanos `is_active`/`is_current`: con fechas bien validadas no hacen falta y, si existieran,
 * podrían contradecirlas. Un calendario inválido (fechas mal formadas, `startsAt >= endsAt`, solapes,
 * ids o slugs repetidos) NO se arregla en silencio: `resolveCalendar` devuelve los problemas.
 *
 * Sin `Date.now()`, sin red, sin React.
 */

const DAY_MS = 24 * 3600_000;

/** Umbral de «últimos días»: 7 días exactos antes de `endsAt`. */
export const ENDING_SOON_MS = 7 * DAY_MS;
/** Umbral de «último día»: 24 horas antes de `endsAt`. */
export const FINAL_DAY_MS = DAY_MS;

export interface SeasonCalendarEntry {
  /** Id estable. Para la Temporada 1 es el id del pase (`nexus-s1`): no se renombra nada existente. */
  id: string;
  /** Para URLs (`/temporadas/temporada-1`). */
  slug: string;
  /** Ordinal humano (1, 2…). */
  number: number;
  /** «Temporada 1». */
  name: string;
  /** «Temporada 1 · Ascenso» (el nombre del contenido del pase). */
  displayName: string;
  /** Instante absoluto ISO-8601 con zona (`Z` o `±hh:mm`). Inclusivo. */
  startsAt: string;
  /** Instante absoluto ISO-8601 con zona. Exclusivo. */
  endsAt: string;
  /** Contenido del pase que corresponde a esta temporada (`SeasonDef.id`), o `null`. */
  passSeasonId: string | null;
  /** Clave visual (tema en código), sin blobs de configuración. */
  themeKey: string;
}

export type SeasonStatus = "UPCOMING" | "ACTIVE" | "ENDED";
export type SeasonPresentation = "UPCOMING" | "ACTIVE" | "ENDING_SOON" | "FINAL_DAY" | "ENDED";
/** Dónde está el calendario ahora mismo. `OFF_SEASON`: una terminó y la siguiente no ha empezado (o no existe). */
export type CalendarPhase = "IN_SEASON" | "PRE_SEASON" | "OFF_SEASON" | "NO_SEASONS";

export type SeasonIssueCode = "BAD_DATE" | "INVALID_RANGE" | "OVERLAP" | "DUPLICATE_ID" | "DUPLICATE_SLUG" | "DUPLICATE_NUMBER";
export interface SeasonIssue { code: SeasonIssueCode; seasonId: string; other?: string }

/** ISO con zona explícita. Una fecha sin hora ni zona («2026-10-01») es ambigua y se rechaza. */
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

export function parseInstant(iso: string): number | null {
  if (typeof iso !== "string" || !ISO_WITH_ZONE.test(iso)) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export function validateCalendar(entries: readonly SeasonCalendarEntry[]): SeasonIssue[] {
  const issues: SeasonIssue[] = [];
  const ids = new Set<string>(); const slugs = new Set<string>(); const numbers = new Set<number>();
  const ranges: { id: string; s: number; e: number }[] = [];
  for (const x of entries) {
    if (ids.has(x.id)) issues.push({ code: "DUPLICATE_ID", seasonId: x.id }); ids.add(x.id);
    if (slugs.has(x.slug)) issues.push({ code: "DUPLICATE_SLUG", seasonId: x.id }); slugs.add(x.slug);
    if (numbers.has(x.number)) issues.push({ code: "DUPLICATE_NUMBER", seasonId: x.id }); numbers.add(x.number);
    const s = parseInstant(x.startsAt); const e = parseInstant(x.endsAt);
    if (s === null || e === null) { issues.push({ code: "BAD_DATE", seasonId: x.id }); continue; }
    if (s >= e) { issues.push({ code: "INVALID_RANGE", seasonId: x.id }); continue; }
    ranges.push({ id: x.id, s, e });
  }
  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      const a = ranges[i]; const b = ranges[j];
      if (a.s < b.e && b.s < a.e) issues.push({ code: "OVERLAP", seasonId: a.id, other: b.id });
    }
  }
  return issues;
}

export function statusAt(startsAtMs: number, endsAtMs: number, now: number): SeasonStatus {
  if (now < startsAtMs) return "UPCOMING";
  if (now < endsAtMs) return "ACTIVE";
  return "ENDED";
}

export function presentationAt(startsAtMs: number, endsAtMs: number, now: number): SeasonPresentation {
  const s = statusAt(startsAtMs, endsAtMs, now);
  if (s !== "ACTIVE") return s;
  const left = endsAtMs - now;
  if (left < FINAL_DAY_MS) return "FINAL_DAY";
  if (left <= ENDING_SOON_MS) return "ENDING_SOON";
  return "ACTIVE";
}

export interface ResolvedSeason extends SeasonCalendarEntry {
  startsAtMs: number;
  endsAtMs: number;
  status: SeasonStatus;
  presentation: SeasonPresentation;
  durationMs: number;
  /** Tiempo transcurrido dentro de la ventana (0 antes de empezar, `durationMs` al terminar). */
  elapsedMs: number;
  /** Lo que queda hasta `endsAt` (0 si terminó). */
  remainingMs: number;
  /** Lo que queda hasta `startsAt` (0 si ya empezó). */
  startsInMs: number;
}

export type CalendarResolution =
  | { ok: true; phase: CalendarPhase; current: ResolvedSeason | null; next: ResolvedSeason | null; previous: ResolvedSeason | null; seasons: ResolvedSeason[] }
  | { ok: false; issues: SeasonIssue[] };

export function resolveSeason(x: SeasonCalendarEntry, now: number): ResolvedSeason {
  const startsAtMs = parseInstant(x.startsAt)!;
  const endsAtMs = parseInstant(x.endsAt)!;
  const durationMs = endsAtMs - startsAtMs;
  return {
    ...x, startsAtMs, endsAtMs,
    status: statusAt(startsAtMs, endsAtMs, now),
    presentation: presentationAt(startsAtMs, endsAtMs, now),
    durationMs,
    elapsedMs: Math.min(durationMs, Math.max(0, now - startsAtMs)),
    remainingMs: Math.max(0, endsAtMs - now),
    startsInMs: Math.max(0, startsAtMs - now),
  };
}

/**
 * LA respuesta canónica a «¿qué temporada está activa?», con el reloj que se pase (el del servidor).
 * Con el calendario validado (sin solapes) hay como mucho UNA temporada ACTIVE.
 */
export function resolveCalendar(entries: readonly SeasonCalendarEntry[], now: number): CalendarResolution {
  const issues = validateCalendar(entries);
  if (issues.length > 0) return { ok: false, issues };
  const seasons = entries.map((x) => resolveSeason(x, now)).sort((a, b) => a.startsAtMs - b.startsAtMs);
  const current = seasons.find((s) => s.status === "ACTIVE") ?? null;
  const next = seasons.find((s) => s.status === "UPCOMING") ?? null;
  const ended = seasons.filter((s) => s.status === "ENDED");
  const previous = ended[ended.length - 1] ?? null;
  const phase: CalendarPhase = seasons.length === 0 ? "NO_SEASONS"
    : current ? "IN_SEASON"
      : previous ? "OFF_SEASON" : "PRE_SEASON";
  return { ok: true, phase, current, next, previous, seasons };
}

/** Búsqueda estricta por id o slug dentro de una resolución válida. */
export function findResolved(seasons: readonly ResolvedSeason[], key: string): ResolvedSeason | null {
  return seasons.find((s) => s.id === key || s.slug === key) ?? null;
}

/** Id/slug aceptables en la URL: minúsculas, dígitos y guiones, 1–40. */
export const SEASON_KEY = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export const PRESENTATION_LABEL: Record<SeasonPresentation, string> = {
  UPCOMING: "Próximamente",
  ACTIVE: "En curso",
  ENDING_SOON: "Últimos 7 días",
  FINAL_DAY: "Último día",
  ENDED: "Finalizada",
};

export const PHASE_LABEL: Record<CalendarPhase, string> = {
  IN_SEASON: "Temporada en curso",
  PRE_SEASON: "La temporada aún no ha empezado",
  OFF_SEASON: "Entre temporadas",
  NO_SEASONS: "Sin temporada configurada",
};
