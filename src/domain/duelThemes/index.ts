/**
 * F71 · TEMÁTICAS DE DUELO — dominio PURO (sin red, sin BD, sin reloj propio).
 *
 * Una temática es SOLO visual: el fondo del recinto del duelo. No toca stats, turnos, recompensas, rating,
 * emparejamiento ni economía (el motor ni la importa).
 *
 * Almacenamiento (sin migración): cada tema vive en una fila de `assets` de tipo `background` (tipo admitido por
 * la BD desde 0007), con sus datos en `assets.meta.duelTheme`. El fondo es SIEMPRE un asset del CMS (id), nunca
 * una ruta libre.
 *
 * Selección (determinista, para un instante `now`):
 *   1. EVENTO: temas `active`, no marcados por defecto, con ventana válida (sin inicio o inicio ≤ now; sin fin o
 *      fin > now) → mayor `priority` → inicio más reciente → `slug` alfabético.
 *   2. DEFAULT del panel: el tema `active` marcado `isDefault` (como mucho uno).
 *   3. DEFAULT de código: la arena de siempre (`CODE_DEFAULT_THEME`). Nunca hay duelo sin fondo.
 * Un tema cuyo asset no esté aprobado o no tenga URL no es candidato (cae al siguiente).
 */

export type DuelThemeStatus = "active" | "inactive";

export interface DuelThemeMeta {
  slug: string;
  name: string;
  status: DuelThemeStatus;
  startAt: string | null;
  endAt: string | null;
  priority: number;
  isDefault: boolean;
  /** Revisión para concurrencia optimista del panel. */
  rev: number;
}

/** Un tema tal y como lo lee el servidor: sus datos + el estado y las URLs de su asset. */
export interface DuelThemeRecord extends DuelThemeMeta {
  id: string;
  assetStatus: string;
  wide: string | null;
  narrow: string | null;
}

/** Lo que recibe el cliente: únicamente lo necesario para pintar. */
export interface ActiveDuelTheme {
  id: string;
  slug: string;
  name: string;
  wide: string;
  narrow: string;
  source: "event" | "panel-default" | "code-default";
}

export const CODE_DEFAULT_THEME: ActiveDuelTheme = {
  id: "default",
  slug: "default",
  name: "NEXUS Champions",
  wide: "/game/arenas/nexus-champions/stage-1920.webp",
  narrow: "/game/arenas/nexus-champions/stage-960.webp",
  source: "code-default",
};

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const NAME_RE = /^[\p{L}\p{N} .,:'·&()\-]{2,60}$/u;

const ms = (iso: string | null): number | null => {
  if (iso == null) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : NaN;
};

/** ¿Está el tema en su ventana de fechas en `now`? (sin fechas = siempre). */
export function inWindow(t: Pick<DuelThemeMeta, "startAt" | "endAt">, now: number): boolean {
  const s = ms(t.startAt), e = ms(t.endAt);
  if (Number.isNaN(s) || Number.isNaN(e)) return false;
  return (s == null || s <= now) && (e == null || e > now);
}

const usable = (t: DuelThemeRecord) => t.status === "active" && t.assetStatus === "approved" && !!t.wide;

const toActive = (t: DuelThemeRecord, source: ActiveDuelTheme["source"]): ActiveDuelTheme => ({
  id: t.id, slug: t.slug, name: t.name, wide: t.wide!, narrow: t.narrow ?? t.wide!, source,
});

export function selectDuelTheme(themes: readonly DuelThemeRecord[], now: number): ActiveDuelTheme {
  const events = themes
    .filter((t) => usable(t) && !t.isDefault && inWindow(t, now))
    .sort((a, b) =>
      b.priority - a.priority
      || (ms(b.startAt) ?? -Infinity) - (ms(a.startAt) ?? -Infinity)
      || a.slug.localeCompare(b.slug));
  if (events[0]) return toActive(events[0], "event");
  const panelDefault = themes.filter((t) => usable(t) && t.isDefault).sort((a, b) => a.slug.localeCompare(b.slug))[0];
  if (panelDefault) return toActive(panelDefault, "panel-default");
  return CODE_DEFAULT_THEME;
}

/** Entrada del panel. Devuelve el meta normalizado o el primer problema (texto para el admin). */
export function validateThemeInput(input: Record<string, unknown>): { ok: true; meta: Omit<DuelThemeMeta, "rev"> } | { ok: false; error: string } {
  const slug = typeof input.slug === "string" ? input.slug.trim() : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!SLUG_RE.test(slug) || slug === "default") return { ok: false, error: "Slug inválido (a-z, 0-9 y guiones; «default» está reservado)" };
  if (!NAME_RE.test(name)) return { ok: false, error: "Nombre inválido (2–60 caracteres)" };
  const status = input.status === "active" || input.status === "inactive" ? input.status : null;
  if (!status) return { ok: false, error: "Estado inválido" };
  const date = (v: unknown): string | null | undefined => {
    if (v == null || v === "") return null;
    if (typeof v !== "string") return undefined;
    const t = Date.parse(v);
    return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
  };
  const startAt = date(input.startAt), endAt = date(input.endAt);
  if (startAt === undefined || endAt === undefined) return { ok: false, error: "Fecha inválida" };
  if (startAt && endAt && Date.parse(endAt) <= Date.parse(startAt)) return { ok: false, error: "La fecha de fin debe ser posterior a la de inicio" };
  const priority = Number(input.priority ?? 0);
  if (!Number.isInteger(priority) || priority < 0 || priority > 1000) return { ok: false, error: "Prioridad inválida (0–1000)" };
  const isDefault = input.isDefault === true;
  if (isDefault && (startAt || endAt)) return { ok: false, error: "El tema por defecto no lleva fechas" };
  return { ok: true, meta: { slug, name, status, startAt, endAt, priority, isDefault } };
}

/** Lee el meta de tema de un `assets.meta` (o null si la fila no es un tema). */
export function themeMetaOf(meta: unknown): DuelThemeMeta | null {
  const t = (meta as { duelTheme?: unknown } | null)?.duelTheme as Partial<DuelThemeMeta> | undefined;
  if (!t || typeof t.slug !== "string" || typeof t.name !== "string") return null;
  return {
    slug: t.slug, name: t.name, status: t.status === "active" ? "active" : "inactive",
    startAt: typeof t.startAt === "string" ? t.startAt : null, endAt: typeof t.endAt === "string" ? t.endAt : null,
    priority: Number.isInteger(t.priority) ? Number(t.priority) : 0, isDefault: t.isDefault === true,
    rev: Number.isInteger(t.rev) ? Number(t.rev) : 0,
  };
}
