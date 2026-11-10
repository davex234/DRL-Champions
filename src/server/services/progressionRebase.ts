/**
 * FASE 36.1 · PLAN Y SQL DEL REBASE DEL CONTADOR DE SOBRES (puro, sin red, sin BD).
 *
 * Entrada: filas exportadas de SOLO LECTURA (`user_pass.state` + los dos contadores + `now()` del servidor).
 * Salida: un plan por usuario (qué misión, baseline de → a, progreso conservado, reinterpretación evitada) y un
 * SQL transaccional que aplica EXACTAMENTE ese plan y aborta si cualquier dato cambió desde la exportación
 * (contadores, baseline, versión). No hay rebase en lecturas de la app: esto se ejecuta una vez, a mano, con backup.
 */
import type { ActiveMission } from "@/battlepass/types";
import { METRIC_VERSIONS } from "@/battlepass/missions";
import { rebaseMission, type MissionRebaseReport } from "@/battlepass/metricRebase";
import { CURRENT_SEASON } from "@/data/season";

export const REBASE_METRIC = "packs_opened";

export interface RebaseSourceRow {
  userId: string;
  seasonId: string;
  state: unknown;
  /** `profiles.packs_opened` (fuente antigua). */
  legacy: number;
  /** `user_game.packs_opened` (fuente vigente); 0 si no hay fila. */
  current: number;
}

export interface RebaseUpdate { id: string; assignedAt: number; fromBaseline: number; toBaseline: number; metricVersion: number }

export interface RebasePlanRow {
  userId: string;
  legacy: number;
  current: number;
  reports: MissionRebaseReport[];
  updates: RebaseUpdate[];
}

export interface RebaseExposure {
  /** Misiones que la reinterpretación ingenua habría dado por COMPLETAS sin serlo. */
  falselyCompleted: { userId: string; id: string; credits: number; passXp: number; packs: number }[];
  /** Progreso regalado (suma de naive − carried) en misiones activas. */
  giftedProgress: number;
  credits: number;
  passXp: number;
  packs: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const short = (id: string) => id.slice(0, 8);

function missionsOf(state: unknown): ActiveMission[] {
  const raw = (state as { missions?: unknown } | null)?.missions;
  if (!Array.isArray(raw)) return [];
  return raw.filter((m): m is ActiveMission =>
    !!m && typeof m === "object" && typeof (m as ActiveMission).id === "string" && typeof (m as ActiveMission).metric === "string"
    && typeof (m as ActiveMission).goal === "number" && typeof (m as ActiveMission).baseline === "number" && typeof (m as ActiveMission).assignedAt === "number");
}

export function planPackRebase(rows: readonly RebaseSourceRow[], now: number): RebasePlanRow[] {
  return rows.map((row) => {
    if (!UUID.test(row.userId)) throw new Error(`userId no válido: ${short(row.userId)}`);
    const reports: MissionRebaseReport[] = [];
    const updates: RebaseUpdate[] = [];
    for (const m of missionsOf(row.state)) {
      if (m.metric !== REBASE_METRIC) continue;
      const r = rebaseMission(m, { [REBASE_METRIC]: { legacy: row.legacy, current: row.current } }, now);
      reports.push(r.report);
      if (r.report.outcome === "REBASED") {
        updates.push({ id: m.id, assignedAt: m.assignedAt, fromBaseline: m.baseline, toBaseline: r.mission.baseline, metricVersion: METRIC_VERSIONS[REBASE_METRIC] });
      }
    }
    return { userId: row.userId, legacy: row.legacy, current: row.current, reports, updates };
  });
}

/** Lo que habría pasado cambiando la fuente SIN rebase (baseline antigua contra contador nuevo). No concede nada. */
export function naiveExposure(plan: readonly RebasePlanRow[]): RebaseExposure {
  const out: RebaseExposure = { falselyCompleted: [], giftedProgress: 0, credits: 0, passXp: 0, packs: 0 };
  for (const row of plan) {
    for (const r of row.reports) {
      if (r.outcome !== "REBASED" || r.naive === null || r.carried === null) continue;
      out.giftedProgress += Math.max(0, r.naive - r.carried);
      if (r.naive >= r.goal && r.carried < r.goal) {
        const def = CURRENT_SEASON.missionPool.find((d) => d.id === r.id);
        const credits = def?.reward.credits ?? 0; const passXp = def?.xp ?? 0; const packs = def?.reward.packId ? def.reward.packCount ?? 1 : 0;
        out.falselyCompleted.push({ userId: short(row.userId), id: r.id, credits, passXp, packs });
        out.credits += credits; out.passXp += passXp; out.packs += packs;
      }
    }
  }
  return out;
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const num = (n: number) => {
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error(`número no entero: ${n}`);
  return String(n);
};

/**
 * SQL de UNA transacción. `probe` termina en ROLLBACK; `apply` en COMMIT. Por usuario con cambios:
 *   1. aborta si `user_game.packs_opened` o `profiles.packs_opened` no valen lo exportado;
 *   2. reescribe SOLO los elementos de `missions` que casan por id + assignedAt + baseline + sin versión;
 *   3. aborta si no se actualizó exactamente una fila o si alguna misión planificada no quedó como se esperaba.
 * Nada más cambia: ni otras misiones, ni `claimed`, ni XP, ni créditos, ni sobres.
 */
export function buildRebaseSql(plan: readonly RebasePlanRow[], mode: "probe" | "apply"): string {
  const changed = plan.filter((r) => r.updates.length > 0);
  const blocks = changed.map((row) => {
    const u = lit(row.userId);
    const cases = row.updates.map((x) =>
      `      when e.m->>'id' = ${lit(x.id)} and (e.m->>'assignedAt')::numeric = ${num(x.assignedAt)} and (e.m->>'baseline')::numeric = ${num(x.fromBaseline)} and not (e.m ? 'metricVersion') and e.m->>'metric' = ${lit(REBASE_METRIC)}\n` +
      `        then e.m || jsonb_build_object('baseline', ${num(x.toBaseline)}, 'metricVersion', ${num(x.metricVersion)})`).join("\n");
    const checks = row.updates.map((x) =>
      `  if not exists (select 1 from public.user_pass p, jsonb_array_elements(p.state->'missions') m where p.user_id = ${u} and m->>'id' = ${lit(x.id)} and (m->>'assignedAt')::numeric = ${num(x.assignedAt)} and (m->>'baseline')::numeric = ${num(x.toBaseline)} and (m->>'metricVersion')::int = ${num(x.metricVersion)}) then raise exception 'VERIFY ${short(row.userId)} ${x.id}'; end if;`).join("\n");
    return [
      `  -- usuario ${short(row.userId)}: ${row.updates.length} misión(es)`,
      `  if coalesce((select packs_opened from public.user_game where user_id = ${u}), 0) <> ${num(row.current)} then raise exception 'DRIFT user_game ${short(row.userId)}'; end if;`,
      `  if coalesce((select packs_opened from public.profiles where id = ${u}), 0) <> ${num(row.legacy)} then raise exception 'DRIFT profiles ${short(row.userId)}'; end if;`,
      `  update public.user_pass p set state = jsonb_set(p.state, '{missions}', (`,
      `    select coalesce(jsonb_agg(case`,
      cases,
      `      else e.m end order by e.ord), '[]'::jsonb)`,
      `    from jsonb_array_elements(p.state->'missions') with ordinality as e(m, ord)))`,
      `  where p.user_id = ${u};`,
      `  get diagnostics n = row_count;`,
      `  if n <> 1 then raise exception 'ROWCOUNT ${short(row.userId)} %', n; end if;`,
      checks,
    ].join("\n");
  });
  return [
    "\\set ON_ERROR_STOP 1",
    `-- FASE 36.1 · rebase del contador de sobres · modo ${mode.toUpperCase()} · ${changed.length} usuario(s), ${changed.reduce((s, r) => s + r.updates.length, 0)} misión(es)`,
    "begin;",
    "set local lock_timeout = '5s';",
    "set local statement_timeout = '60s';",
    "do $rb$",
    "declare n int;",
    "begin",
    ...(blocks.length ? blocks : ["  null;"]),
    "end $rb$;",
    `select 'after', left(p.user_id::text, 8), m->>'id', m->>'kind', 'baseline=' || (m->>'baseline'), 'metricVersion=' || coalesce(m->>'metricVersion', '-'), 'claimed=' || (m->>'claimed') from public.user_pass p, jsonb_array_elements(p.state->'missions') m where m->>'metric' = ${lit(REBASE_METRIC)} order by 2, 3;`,
    mode === "apply" ? "commit;" : "rollback;",
    "",
  ].join("\n");
}
