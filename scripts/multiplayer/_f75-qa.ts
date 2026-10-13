/**
 * F66 · utillaje común de los instrumentos multijugador (fuera de CI). SOLO cuentas QA: aborta si le llega la cuenta del
 * usuario. Credenciales en ficheros del scratchpad (nunca en el repo); aquí solo se leen.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3005";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
// F87 · QA_SB / QA_ANON: Supabase público de producción y su clave anon PÚBLICA (la de .env.local es anterior a F77-S1).
const SB = process.env.QA_SB || process.env.F75_SB || env.SUPABASE_INTERNAL_URL || env.NEXT_PUBLIC_SUPABASE_URL, ANON = process.env.QA_ANON || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const USER_ACCOUNT_PREFIX = "2f86cbe8";
/** F87 · cuentas REALES que ningún instrumento puede usar: davex (#NB2Z9BM), ValoRosters (#H5ND8K7) y la antigua personal. */
export const REAL_ACCOUNT_PREFIXES = ["2f86cbe8", "3befce61", "b7ccff02"];
export const isRealAccount = (id: unknown): boolean => REAL_ACCOUNT_PREFIXES.some((p) => String(id ?? "").startsWith(p));
/** F87 · `QA_CREDS_DIR=<dir>`: credenciales QA nuevas como `<dir>/<persona>.json` (las de A–K se borraron el 2026-10-05). */
const credFile = (name: string, fallback: string | undefined): string => (process.env.QA_CREDS_DIR ? join(process.env.QA_CREDS_DIR, `${name}.json`) : String(fallback));
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const uuid = () => randomUUID();

const TMP = process.env.TEMP ?? "C:/Users/david/AppData/Local/Temp";
const SP = (session: string, f: string) => join(TMP, "claude/C--NEXUS-CENTRAL-DRLCards", session, "scratchpad", f);
/** Cuentas QA conocidas (fichero de credenciales de la sesión que las creó). */
export const QA_FILES: Record<string, string> = {
  A: SP("287155d6-0740-47dd-baa7-edb43491b4e3", "f45-qa-creds.json"),
  B: SP("738eeaef-6ef7-4f65-abd1-2ca435caa596", "qa352-creds.json"),
  C: SP("bf089a0a-88d0-408c-a67f-d51d19745e4d", "f64-regress-creds.json"),
  D: SP("bf089a0a-88d0-408c-a67f-d51d19745e4d", "f63-n1-creds.json"),
  E: SP("bf089a0a-88d0-408c-a67f-d51d19745e4d", "f63-n2-creds.json"),
  F: SP("bf089a0a-88d0-408c-a67f-d51d19745e4d", "f63-n3-creds.json"),
  G: SP("bf089a0a-88d0-408c-a67f-d51d19745e4d", "f63-n1b-creds.json"),
};

export interface Who { name: string; userId: string; email: string; password: string; token: string }

export function creds(name: string): { email: string; password: string; userId: string } {
  const c = JSON.parse(readFileSync(credFile(name, QA_FILES[name]), "utf8"));
  if (isRealAccount(c.userId)) throw new Error("ESA ES LA CUENTA DEL USUARIO: prohibido");
  return c;
}

/** Una SESIÓN nueva (otro token): dos llamadas = dos pestañas/dispositivos de la misma cuenta. */
export async function login(name: string): Promise<Who> {
  const c = creds(name);
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify({ email: c.email, password: c.password }) });
  const j = await r.json() as { access_token?: string; user?: { id: string }; error_description?: string };
  if (!j.access_token) throw new Error(`login ${name}: ${j.error_description ?? r.status}`);
  if (isRealAccount(j.user?.id)) throw new Error("ESA ES LA CUENTA DEL USUARIO: prohibido");
  return { name, userId: j.user!.id, email: c.email, password: c.password, token: j.access_token };
}

export interface ApiRes { status: number; json: any; ms: number }
/** Llamada a la app real. Obedece 429 (espera Retry-After) salvo `noRetry` (para medir el límite). */
export async function api(who: Who | null, path: string, body?: unknown, opts: { noRetry?: boolean; signal?: AbortSignal } = {}): Promise<ApiRes> {
  for (let i = 0; i < 10; i++) {
    const t = Date.now();
    const r = await fetch(`${BASE}${path}`, {
      method: body === undefined ? "GET" : "POST", signal: opts.signal,
      headers: { ...(who ? { authorization: `Bearer ${who.token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.status === 429 && !opts.noRetry) { await sleep(Math.max(1, Number(r.headers.get("retry-after") ?? 3)) * 1000); continue; }
    const text = await r.text(); let json: any = null; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, json, ms: Date.now() - t };
  }
  throw new Error(`429 persistente en ${path}`);
}

export const pvpGet = (w: Who, matchId: string, extra = "") => api(w, `/api/game/duel/pvp?matchId=${matchId}${extra}`);
export const mm = (w: Who, body?: unknown) => api(w, "/api/game/duel/matchmaking", body);

/** Primer equipo válido (el activo si lo es). */
export async function validDeck(w: Who): Promise<{ id: string; name: string } | null> {
  const d = (await api(w, "/api/game/duels")).json;
  const decks = (d?.decks ?? []) as any[];
  return decks.find((x) => x.valid && x.id === d.activeDeckId) ?? decks.find((x) => x.valid) ?? null;
}

/** Jugada legal para `w` desde SU vista redactada (o null si no le toca). */
export function legalMove(snap: any, k = 0): { cardUid: string; stat?: string } | null {
  if (!snap?.isYourTurn) return null;
  const side = snap.yourSide as "A" | "B";
  const m = snap.match;
  const mine = side === "A" ? m.snapshotA : m.snapshotB;
  const used = new Set<string>(side === "A" ? m.usedA : m.usedB);
  const hand = (mine?.cards ?? []).filter((c: any) => !used.has(c.uid));
  if (!hand.length) return null;
  const c = hand[k % hand.length];
  if (m.attacker !== side) return { cardUid: c.uid };
  const best = (["stronghold", "gamesense", "entryfrag"] as const).reduce((a, b) => (c.combat[b] > c.combat[a] ? b : a));
  return { cardUid: c.uid, stat: best };
}

/** Lo que dos jugadores deben ver IGUAL (salvo información privada): turno, marcador, turnos resueltos, estado. */
export function publicFacts(snap: any) {
  const m = snap?.match;
  if (!m) return null;
  return {
    version: snap.stateVersion, lifecycle: snap.lifecycle, turn: m.currentTurn, scoreA: m.scoreA, scoreB: m.scoreB, ties: m.ties,
    turns: (m.turns ?? []).map((t: any) => `${t.attacker}:${t.attackerStat}:${t.defenderStat}:${t.outcome ?? ""}`).join("|"),
    result: m.result ? { winner: m.result.winner, isDraw: m.result.isDraw, scoreA: m.result.scoreA, scoreB: m.result.scoreB, decidedBy: m.result.combat?.decidedBy } : null,
    closedBySide: snap.closedBySide ?? null,
  };
}

/** Recalcula el resultado desde los enfrentamientos resueltos con las reglas vigentes (duel-combat-2). */
export function recomputeFromHistory(result: any) {
  const c = result?.combat;
  if (!c) return null;
  let a = 0, b = 0;
  for (const e of c.encounters ?? []) { if (e.a.value > e.b.value) a++; else if (e.b.value > e.a.value) b++; }
  let winner: string | null, by: string;
  if (a !== b) { winner = a > b ? "A" : "B"; by = "SCORE"; }
  else if (c.tiebreak && c.tiebreak.sumOvrA !== c.tiebreak.sumOvrB) { winner = c.tiebreak.sumOvrA > c.tiebreak.sumOvrB ? "A" : "B"; by = "OVR_TIEBREAK"; }
  else if (c.statTotalA !== c.statTotalB) { winner = c.statTotalA > c.statTotalB ? "A" : "B"; by = "STAT_MARGIN"; }
  else { winner = null; by = "NONE"; }
  const bonus = by === "OVR_TIEBREAK" ? 1 : 0;
  return { winner, decidedBy: by, scoreA: a + (winner === "A" ? bonus : 0), scoreB: b + (winner === "B" ? bonus : 0), agrees: winner === c.winner && by === c.decidedBy && a + (winner === "A" ? bonus : 0) === c.scoreA && b + (winner === "B" ? bonus : 0) === c.scoreB };
}

export const rating = async (w: Who) => {
  const j = (await api(w, "/api/game/competitive")).json;
  return { rating: j?.self?.rating?.rating ?? null, games: j?.self?.rating?.gamesPlayed ?? null };
};
export const credits = async (w: Who) => {
  const j = (await api(w, "/api/game/state")).json;
  return { credits: j?.credits ?? null, xp: j?.xp ?? null };
};
