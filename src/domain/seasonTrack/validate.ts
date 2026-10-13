/**
 * F83 · VALIDACIÓN DE UNA TEMPORADA ANTES DE PUBLICAR (pura). Publicar es una promesa a todos los jugadores: fechas,
 * solapes (con las temporadas publicadas en BD Y con el calendario heredado del código), curva, recompensas, retos y
 * topes se comprueban aquí; la BD vuelve a imponer forma, solape e inmutabilidad.
 */
import { CONDITION_TYPES } from "@/domain/missionEngine/types";
import { curveValid } from "./curve";
import { SEASON_BADGE_RE, SEASON_ID_RE, type GameSeason } from "./types";

export type SeasonIssueCode =
  | "BAD_ID" | "BAD_NAME" | "NOT_DRAFT" | "BAD_DATES" | "STARTS_IN_PAST" | "TOO_SHORT" | "TOO_LONG" | "BAD_GRACE"
  | "OVERLAP" | "OVERLAP_LEGACY" | "BAD_MAX_LEVEL" | "BAD_CURVE" | "BAD_XP_RULES"
  | "BAD_REWARD_LEVEL" | "DUPLICATE_REWARD_LEVEL" | "BAD_REWARD" | "UNKNOWN_PACK" | "BAD_BADGE" | "REWARD_TOO_BIG"
  | "BAD_CHALLENGE" | "DUPLICATE_CHALLENGE" | "POOL_TOO_SMALL" | "UNSUPPORTED_CONDITION";

export interface SeasonIssue { code: SeasonIssueCode; detail: string }

export interface ValidateCtx {
  now: number;
  /** Otras temporadas PUBLICADAS en BD (sin esta). */
  others: { id: string; startsAt: number; endsAt: number }[];
  /** Calendario heredado del código (`SEASON_CALENDAR`): una temporada F83 no se solapa con el pase heredado. */
  legacy: { id: string; startsAt: number; endsAt: number }[];
  packIds: ReadonlySet<string>;
}

const DAY = 86_400_000;
/** Retos que se pueden cumplir jugando con normalidad (el resto del vocabulario de F73 no se acepta en retos). */
export const CHALLENGE_CONDITIONS = new Set(["MATCH_PLAY", "MATCH_WIN", "TURN_WIN", "WIN_PVE", "WIN_STREAK"]);
/** Topes de cordura por recompensa: un error de contenido no inunda la economía. */
export const MAX_REWARD_CREDITS = 5000;
export const MAX_REWARD_PACKS = 3;

const overlaps = (a: { startsAt: number; endsAt: number }, b: { startsAt: number; endsAt: number }) => a.startsAt < b.endsAt && b.startsAt < a.endsAt;

export function validateSeason(s: Pick<GameSeason, "id" | "name" | "status" | "startsAt" | "endsAt" | "claimUntil" | "maxLevel" | "config">, ctx: ValidateCtx, opts: { publishing?: boolean } = {}): SeasonIssue[] {
  const out: SeasonIssue[] = [];
  const add = (code: SeasonIssueCode, detail = "") => out.push({ code, detail });
  const c = s.config;

  if (!SEASON_ID_RE.test(s.id)) add("BAD_ID", s.id);
  if (!s.name || s.name.trim().length < 3 || s.name.length > 60) add("BAD_NAME");
  if (opts.publishing && s.status !== "DRAFT") add("NOT_DRAFT", s.status);
  if (!(s.endsAt > s.startsAt)) add("BAD_DATES");
  if (opts.publishing && s.startsAt <= ctx.now) add("STARTS_IN_PAST", new Date(s.startsAt).toISOString());
  if (s.endsAt - s.startsAt < 14 * DAY) add("TOO_SHORT");
  if (s.endsAt - s.startsAt > 26 * 7 * DAY) add("TOO_LONG");
  if (!(s.claimUntil >= s.endsAt) || s.claimUntil - s.endsAt > 60 * DAY) add("BAD_GRACE");
  for (const o of ctx.others) if (o.id !== s.id && overlaps(s, o)) add("OVERLAP", o.id);
  for (const l of ctx.legacy) if (overlaps(s, l)) add("OVERLAP_LEGACY", l.id);

  if (!Number.isInteger(s.maxLevel) || s.maxLevel < 5 || s.maxLevel > 100) add("BAD_MAX_LEVEL", String(s.maxLevel));
  if (!c || !Array.isArray(c.levels) || !curveValid(c.levels, s.maxLevel)) add("BAD_CURVE");

  const x = c?.xp;
  const intIn = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
  if (!x || !intIn(x.match?.PVE, 0, 500) || !intIn(x.match?.DRAFT, 0, 500) || !intIn(x.match?.RANKED, 0, 500) || !intIn(x.match?.winBonus, 0, 500)
    || !intIn(x.match?.dailyCap, 0, 5000) || !intIn(x.craft?.amount, 0, 500) || !intIn(x.craft?.dailyCap, 0, 2000) || !intIn(x.collection, 0, 5000)) add("BAD_XP_RULES");

  const seen = new Set<number>();
  for (const r of c?.rewards ?? []) {
    if (!Number.isInteger(r.level) || r.level < 1 || r.level > s.maxLevel) { add("BAD_REWARD_LEVEL", String(r.level)); continue; }
    if (seen.has(r.level)) add("DUPLICATE_REWARD_LEVEL", String(r.level));
    seen.add(r.level);
    const w = r.reward ?? {};
    const keys = Object.keys(w);
    if (!keys.length || keys.some((k) => !["credits", "packId", "packCount", "badge"].includes(k))) { add("BAD_REWARD", `nivel ${r.level}`); continue; }
    if (w.credits !== undefined && !intIn(w.credits, 1, Number.MAX_SAFE_INTEGER)) add("BAD_REWARD", `créditos nivel ${r.level}`);
    if ((w.credits ?? 0) > MAX_REWARD_CREDITS) add("REWARD_TOO_BIG", `nivel ${r.level}: ${w.credits} créditos`);
    if (w.packId !== undefined || w.packCount !== undefined) {
      if (!w.packId || !ctx.packIds.has(w.packId)) add("UNKNOWN_PACK", `${w.packId ?? "∅"} (nivel ${r.level})`);
      if (!intIn(w.packCount, 1, MAX_REWARD_PACKS)) add(w.packCount && w.packCount > MAX_REWARD_PACKS ? "REWARD_TOO_BIG" : "BAD_REWARD", `sobres nivel ${r.level}`);
    }
    if (w.badge !== undefined && !SEASON_BADGE_RE.test(w.badge)) add("BAD_BADGE", w.badge);
  }

  const ids = new Set<string>();
  for (const kind of ["daily", "weekly"] as const) {
    const g = c?.challenges?.[kind];
    if (!g || !intIn(g.count, 1, 10) || !Array.isArray(g.pool)) { add("BAD_CHALLENGE", kind); continue; }
    if (new Set(g.pool.map((p) => p.family)).size < g.count) add("POOL_TOO_SMALL", `${kind}: ${g.pool.length} retos, ${new Set(g.pool.map((p) => p.family)).size} familias para ${g.count}`);
    for (const ch of g.pool) {
      if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(ch.id ?? "")) add("BAD_CHALLENGE", String(ch.id));
      if (ids.has(ch.id)) add("DUPLICATE_CHALLENGE", ch.id);
      ids.add(ch.id);
      if (!ch.condition || !(CONDITION_TYPES as readonly string[]).includes(ch.condition.type) || !CHALLENGE_CONDITIONS.has(ch.condition.type)) add("UNSUPPORTED_CONDITION", `${ch.id}: ${ch.condition?.type ?? "∅"}`);
      if (!intIn(ch.target, 1, 500) || !intIn(ch.xp, 1, 5000) || !ch.label?.trim() || !ch.family?.trim()) add("BAD_CHALLENGE", ch.id);
    }
  }
  return out;
}
