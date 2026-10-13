/**
 * F73 · CIERRE — utilidades del E2E de misiones/proyectos (fuera de CI). Solo cuentas QA.
 * Partidas REALES por la ruta del juego (`/api/game/duel`): las mismas llamadas que hace la interfaz.
 * La BD se LEE (solo lectura) por ssh para comprobar `mission_events` y el progreso guardado.
 */
import { execFileSync } from "node:child_process";
import { api, sleep } from "./_fase68-lib";

export const STATS = ["stronghold", "gamesense", "entryfrag"] as const;
const view = (j: any) => j?.view ?? j;

/** Lectura de la BD del VPS (una consulta SELECT que devuelve UNA línea JSON). */
export function dbRead<T = any>(select: string): T {
  if (!/^\s*select\b/i.test(select) || /;\s*\S/.test(select)) throw new Error("dbRead: solo un SELECT");
  const out = execFileSync("ssh", ["-o", "BatchMode=yes", "-i", `${process.env.USERPROFILE ?? process.env.HOME}/.ssh/id_ed25519`, "nexusadmin@212.95.40.144",
    "docker exec -i supabase_db_DRLCards psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At"], { input: `begin read only; ${select.replace(/;\s*$/, "")}; commit;`, encoding: "utf8" });
  const line = out.split(/\r?\n/).find((l) => l.startsWith("{") || l.startsWith("[")) ?? "null";
  return JSON.parse(line) as T;
}
export const eventsFor = (userId: string, key: string) =>
  dbRead<any[]>(`select coalesce(json_agg(json_build_object('key', event_key, 'kind', kind, 'evidence', evidence, 'at', created_at)), '[]'::json)::text from public.mission_events where user_id = '${userId}' and event_key = '${key.replace(/'/g, "")}'`);
export const progressFor = (userId: string) =>
  dbRead<Record<string, any>>(`select coalesce(json_object_agg(mission_id, json_build_object('p', progress, 'done', completed_at is not null, 'claimed', claimed_at is not null)), '{}'::json)::text from public.user_mission_progress where user_id = '${userId}'`);

export async function active(t: string) { return view((await api(t, "/api/game/duel", { action: "active" })).json); }
export async function matchState(t: string, matchId: string) { return view((await api(t, "/api/game/duel", { action: "state", matchId })).json); }

/** Abandona cualquier partida PvE en curso (para empezar limpio). */
export async function clearActive(t: string) {
  const v = await active(t);
  if (v?.matchId && v.status === "IN_PROGRESS") await api(t, "/api/game/duel", { action: "abandon", matchId: v.matchId });
}

export async function startPve(t: string, deckId: string, difficulty = "EASY") {
  const r = await api(t, "/api/game/duel", { action: "start", deckId, difficulty });
  const v = view(r.json);
  if (r.status !== 200 || !v?.matchId) throw new Error(`start ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
  return v;
}

/** Una decisión humana (la persona elige carta y, si ataca, estadística) con la versión que ve. */
export async function playOne(t: string, v: any) {
  const hand = v.yourHand ?? [];
  const card = hand[Math.floor(Math.random() * hand.length)];
  const body: any = { action: "play", matchId: v.matchId, cardUid: card.uid, expectedVersion: v.stateVersion };
  if (v.youAreAttacker) body.stat = STATS[Math.floor(Math.random() * 3)];
  return api(t, "/api/game/duel", body);
}

/** Juega `humans` decisiones humanas (Infinity = todas) y deja que el reloj juegue el resto; espera al final. */
export async function playMatch(t: string, v0: any, humans = Infinity, maxMs = 12 * 60_000) {
  let v = v0; let played = 0; const t0 = Date.now();
  while (v && v.status === "IN_PROGRESS" && Date.now() - t0 < maxMs) {
    if (played < humans && (v.yourHand ?? []).length) {
      const r = await playOne(t, v);
      if (r.status === 200) { played++; v = view(r.json); continue; }
      await sleep(800); v = await matchState(t, v0.matchId); continue;
    }
    await sleep(3000);
    v = await matchState(t, v0.matchId);
  }
  return { final: v, played, ms: Date.now() - t0 };
}
