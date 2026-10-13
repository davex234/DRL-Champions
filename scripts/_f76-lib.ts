/**
 * F76 · RANKED QUEUE HARDENING — utillaje de los instrumentos (fuera de CI).
 *
 * Login por el camino que usa un navegador (`<BASE>/auth/v1`, same-origin), API real con Bearer y lecturas de BD
 * en SOLO LECTURA por ssh (`begin read only`). SOLO cuentas QA de F68/F69 (`@example.invalid`): aborta con la cuenta
 * del usuario. Credenciales en scratchpads de sesiones anteriores (nunca en el repo).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { PERSONA_FILES, USER_ACCOUNT_PREFIX, sleep } from "./_fase68-lib";

export { sleep };
export const BASE = process.env.BASE_URL ?? "https://valorosters.com";
/** De dónde sale Supabase para el login: por defecto el mismo origen que la app (como el navegador). */
const SB = process.env.F76_SB ?? BASE;
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export interface Who { p: string; userId: string; token: string }

export async function login(p: string): Promise<Who> {
  const c = JSON.parse(readFileSync(PERSONA_FILES[p], "utf8")) as { email: string; password: string; userId: string };
  if (String(c.userId).startsWith(USER_ACCOUNT_PREFIX) || !/@example\.invalid$/.test(c.email)) throw new Error(`persona ${p}: no es QA`);
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify({ email: c.email, password: c.password }) });
  const j = await r.json() as any;
  if (!j.access_token) throw new Error(`login ${p}: ${j.error_description ?? r.status}`);
  if (j.user?.id !== c.userId) throw new Error(`login ${p}: id inesperado`);
  return { p, userId: c.userId, token: j.access_token };
}

export interface Res { status: number; json: any; ms: number }
export async function api(w: Who | null, path: string, body?: unknown): Promise<Res> {
  for (let i = 0; i < 6; i++) {
    const t0 = Date.now();
    const r = await fetch(`${BASE}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { ...(w ? { authorization: `Bearer ${w.token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await r.json().catch(() => null);
    if (r.status === 429) { await sleep(Number(r.headers.get("retry-after") ?? 3) * 1000 + 300); continue; }
    return { status: r.status, json, ms: Date.now() - t0 };
  }
  throw new Error(`429 persistente en ${path}`);
}

export const mm = (w: Who, body?: unknown) => api(w, "/api/game/duel/matchmaking", body);
export const pvp = (w: Who, matchId: string, body?: unknown) =>
  body === undefined ? api(w, `/api/game/duel/pvp?matchId=${matchId}`) : api(w, "/api/game/duel/pvp", { matchId, ...(body as object) });

/** Un SELECT que devuelve UNA fila json (o null). Transacción de solo lectura: no puede escribir. */
export function dbJson<T = any>(select: string): T {
  if (!/^\s*select\b/i.test(select) || /;\s*\S/.test(select)) throw new Error("dbJson: solo un SELECT");
  const out = execFileSync("ssh", ["-o", "BatchMode=yes", "-i", `${process.env.USERPROFILE ?? process.env.HOME}/.ssh/id_ed25519`, "nexusadmin@212.95.40.144",
    "docker exec -i supabase_db_DRLCards psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At"], { input: `begin read only; ${select.replace(/;\s*$/, "")}; commit;`, encoding: "utf8" });
  const line = out.split(/\r?\n/).find((l) => l.startsWith("{") || l.startsWith("[")) ?? "null";
  return JSON.parse(line) as T;
}

/** Foto de la cola del usuario + la partida a la que apunte cada entrada. */
export function queueFacts(userId: string): { entries: any[]; live: number } {
  if (!/^[0-9a-f-]{36}$/.test(userId)) throw new Error("uuid");
  return dbJson(`select json_build_object(
    'entries', coalesce((select json_agg(x order by x.updated desc) from (
       select left(q.id::text,8) id, q.state, q.closed_reason reason, left(q.match_id::text,8) match, q.updated_at updated,
              m.status mstatus, m.closed_reason mclosed
         from duel_pvp_queue q left join duel_matches m on m.id = q.match_id
        where q.user_id = '${userId}' order by q.updated_at desc limit 4) x), '[]'::json),
    'live', (select count(*) from duel_pvp_queue where user_id = '${userId}' and state in ('QUEUED','PAIRING')))::jsonb`);
}

/** Primer equipo legal del usuario (lo que haría JUGAR). */
export async function legalDeck(w: Who): Promise<string> {
  const r = await api(w, "/api/game/duels");
  const d = (r.json?.decks ?? []).find((x: any) => x.valid);
  if (!d) throw new Error(`${w.p}: sin equipo legal (${r.status})`);
  return d.id;
}
