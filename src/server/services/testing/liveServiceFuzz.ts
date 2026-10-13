/**
 * FASE 42 · FUZZER TEMPORAL DEL LIVE SERVICE (servicios reales sobre `MemSupabase`, reloj del servidor controlado).
 *
 * Una secuencia = 1 cuenta (a veces 2 «pestañas» que actúan a la vez) durante días de reloj simulado: lecturas del
 * vestíbulo (`getDailyLoop`), lecturas del pase (`peekProgression`), avances de reloj (a veces a 30 s de un reset y
 * cruzándolo), partidas y aperturas reales (filas con marca del servidor), reclamos (incluidos dobles a la vez),
 * materializaciones (`getProgression`, `refreshMissions`) y relojes de cliente desfasados / otra zona horaria.
 *
 * Invariantes: una misión se cobra como mucho una vez por tanda; ningún cobro fuera de su ventana; saldo = Σ libro y ≥ 0;
 * las lecturas no escriben; lo que enseña la lectura es lo que se materializa; nunca una tanda híbrida; el importe
 * cobrado es el de la definición; el reloj del cliente no cambia nada del servidor.
 */
import { MemSupabase } from "./memSupabase";
import { peekProgression, getProgression, claimMission, refreshMissions } from "../progression";
import { getDailyLoop } from "../dailyLoop";
import { makeRng, type Rng } from "@/sim/rng";
import { CURRENT_SEASON } from "@/data/season";
import { periodWindow } from "@/domain/progression/periods";
import { estimateServerNow } from "@/domain/season/time";

const DAY = 86_400_000; const HOUR = 3_600_000;
export interface TemporalStats { sequences: number; actions: number; byAction: Record<string, number>; claimsPaid: number; resetsCrossed: number; violations: { seq: number; invariant: string; detail: string }[] }
export const newTemporalStats = (): TemporalStats => ({ sequences: 0, actions: 0, byAction: {}, claimsPaid: 0, resetsCrossed: 0, violations: [] });

const ACTIONS = ["read_home", "read_pass", "advance", "reset_edge", "play", "open", "claim", "double_claim", "ensure", "refresh", "client_skew"] as const;
type A = (typeof ACTIONS)[number];
const W: Record<A, number> = { read_home: 10, read_pass: 8, advance: 8, reset_edge: 5, play: 14, open: 8, claim: 14, double_claim: 6, ensure: 5, refresh: 4, client_skew: 4 };
const TOTAL = Object.values(W).reduce((a, b) => a + b, 0);
const pickA = (rng: Rng): A => { let r = rng.next() * TOTAL; for (const a of ACTIONS) { r -= W[a]; if (r <= 0) return a; } return "read_home"; };

export async function runTemporalSequence(seq: number, stats: TemporalStats): Promise<void> {
  const rng = makeRng((seq * 2246822519) % 2147483647 + 1);
  const U = `fa42fa42-0000-4000-8000-${String(seq % 1e12).padStart(12, "0")}`;
  const db = new MemSupabase(); const sb = db.client;
  const realNow = Date.now;
  let clock = Date.UTC(2026, 8, 8) + Math.floor(rng.next() * 60) * DAY + Math.floor(rng.next() * 24) * HOUR;
  Date.now = () => clock;
  const fail = (invariant: string, detail: string) => stats.violations.push({ seq, invariant, detail });
  try {
    db.seedUser(U);
    db.table("profiles")[0].created_at = new Date(clock - 3 * DAY).toISOString();
    db.table("duel_decks").push({ id: "d1", user_id: U });
    let n = 0;
    const steps = 6 + Math.floor(rng.next() * 12);
    for (let i = 0; i < steps; i++) {
      const a = pickA(rng);
      stats.actions++; stats.byAction[a] = (stats.byAction[a] ?? 0) + 1;
      switch (a) {
        case "read_home": case "read_pass": {
          const w = db.writes; const before = JSON.stringify(db.table("user_pass"));
          if (a === "read_home") {
            const r = await getDailyLoop(sb, U, { now: clock, timeoutMs: 10_000 });
            if (!r.ok) fail("lectura-home", r.error ?? "");
            const s = r.data;
            if (s?.service) {
              for (const c of [...s.service.today, ...s.service.thisWeek]) if (c.endsAt !== null && c.endsAt <= clock) fail("tanda-vigente", `${c.id} caducada en la foto`);
              if (s.service.resets.dailyEndsAt !== periodWindow("daily", clock)!.endsAt) fail("reset-servidor", "fin diario distinto del servidor");
            }
          } else {
            const p = await peekProgression(sb, U, clock);
            // Lo que se ve = lo que se materializa (mismo instante).
            const seen = (p.data?.state.missions ?? []).map((m) => `${m.id}:${m.assignedAt}:${m.baseline}`).sort().join();
            const shadow = new MemSupabase(); shadow.tables = JSON.parse(JSON.stringify(db.tables));
            await getProgression(shadow.client, U);
            const stored = ((shadow.table("user_pass")[0]?.state as { missions?: { id: string; assignedAt: number; baseline: number }[] } | undefined)?.missions ?? []).map((m) => `${m.id}:${m.assignedAt}:${m.baseline}`).sort().join();
            if (seen !== stored) fail("lectura-igual-materializacion", `${seen} ≠ ${stored}`);
          }
          if (db.writes !== w || JSON.stringify(db.table("user_pass")) !== before) fail("lectura-sin-escrituras", `${db.writeLog.slice(w).join(",")}`);
          break;
        }
        case "advance": {
          const d = Math.floor(rng.next() * 3) === 0 ? Math.floor(rng.next() * 4) * DAY : Math.floor(rng.next() * 12 * 60) * 60_000;
          if (periodWindow("daily", clock + d)!.startsAt !== periodWindow("daily", clock)!.startsAt) stats.resetsCrossed++;
          clock += d; break;
        }
        case "reset_edge": {
          const end = periodWindow(rng.next() < 0.7 ? "daily" : "weekly", clock)!.endsAt;
          clock = end - 30_000;
          // Home abierta justo antes del reset y relectura justo después: converge sin escribir.
          const r1 = await getDailyLoop(sb, U, { now: clock, timeoutMs: 10_000 });
          clock = end + 5_000; stats.resetsCrossed++;
          const w = db.writes;
          const r2 = await getDailyLoop(sb, U, { now: clock, timeoutMs: 10_000 });
          if (db.writes !== w) fail("reset-sin-escrituras", "la lectura tras el reset escribió");
          const t2 = r2.data?.service?.today ?? [];
          if (t2.some((c) => c.endsAt !== null && c.endsAt <= clock)) fail("reset-converge", "tanda vieja tras el reset");
          if ((r1.data?.service?.resets.dailyEndsAt ?? 0) === (r2.data?.service?.resets.dailyEndsAt ?? 0) && end === periodWindow("daily", end - 1)!.endsAt) fail("reset-converge", "el fin diario no avanzó");
          break;
        }
        case "play": {
          const k = 1 + Math.floor(rng.next() * 3);
          for (let j = 0; j < k; j++) { clock += 60_000; db.table("duel_matches").push({ id: `m${seq}-${n++}`, user_id: U, status: "COMPLETED", winner: rng.next() < 0.5 ? "A" : "B", mode: "PVE", updated_at: new Date(clock).toISOString() }); }
          break;
        }
        case "open": {
          clock += 30_000;
          db.table("economy_ops").push({ ref: `open-${seq}-${n++}`, user_id: U, kind: "open_pack", result: { uids: [], packId: "estandar" }, created_at: new Date(clock).toISOString() });
          const g = db.table("user_game")[0]; g.packs_opened = Number(g.packs_opened) + 1;
          break;
        }
        case "claim": case "double_claim": {
          const p = await peekProgression(sb, U, clock);
          const list = (p.data?.view.missions ?? []).filter((m) => m.kind === "daily" || m.kind === "weekly");
          const target = list.find((m) => m.complete && !m.claimed) ?? list[Math.floor(rng.next() * Math.max(1, list.length))];
          if (!target) break;
          if (a === "double_claim") await Promise.all([claimMission(sb, U, target.id), claimMission(sb, U, target.id)]);
          else await claimMission(sb, U, target.id);
          break;
        }
        case "ensure": await getProgression(sb, U); break;
        case "refresh": await refreshMissions(sb, U); break;
        case "client_skew": {
          // Reloj del cliente −5 min / +5 min / −2 h / +2 h u otra zona: el servidor no recibe ninguna hora.
          const skew = [-5 * 60_000, 5 * 60_000, -2 * HOUR, 2 * HOUR, 9 * HOUR][Math.floor(rng.next() * 5)];
          const r = await getDailyLoop(sb, U, { now: clock, timeoutMs: 10_000 });
          const serverNow = r.data?.serverNow ?? clock;
          const est = estimateServerNow({ serverNow, receivedAt: clock + skew }, clock + skew + 1_000);
          if (Math.abs(est - (serverNow + 1_000)) > 1) fail("reloj-cliente-ignorado", `estimado ${est - serverNow}`);
          break;
        }
      }
    }
    // Invariantes finales.
    const ledger = db.table("credit_transactions").filter((t) => t.user_id === U);
    const credits = Number(db.table("profiles")[0].credits);
    if (credits !== ledger.reduce((s, t) => s + Number(t.delta), 0)) fail("saldo-libro", `${credits}`);
    if (credits < 0) fail("saldo-no-negativo", String(credits));
    const seen = new Map<string, number>();
    for (const t of ledger.filter((x) => x.reason === "mission_reward")) {
      const [, , id, assignedAt] = String(t.ref).split(":");
      const def = CURRENT_SEASON.missionPool.find((m) => m.id === id);
      const k = `${id}:${assignedAt}`; seen.set(k, (seen.get(k) ?? 0) + 1);
      if (def && Number(t.delta) !== (def.reward.credits ?? 0)) fail("importe-de-definicion", `${id} ${t.delta}`);
      if (def && (def.kind === "daily" || def.kind === "weekly")) {
        const at = Date.parse(String(t.created_at));
        if (periodWindow(def.kind, at)!.startsAt !== Number(assignedAt)) fail("cobro-en-su-ventana", `${id} fuera de su ventana`);
      }
      stats.claimsPaid++;
    }
    for (const [k, c] of seen) if (c > 1) fail("sin-doble-diaria", `${k} ×${c}`);
    const state = db.table("user_pass")[0]?.state as { missions?: { kind: string; assignedAt: number }[] } | undefined;
    for (const kind of ["daily", "weekly"]) {
      const at = new Set((state?.missions ?? []).filter((m) => m.kind === kind).map((m) => m.assignedAt));
      if (at.size > 1) fail("sin-tanda-hibrida", `${kind}: ${[...at].join(",")}`);
    }
    stats.sequences++;
  } finally {
    Date.now = realNow;
  }
}
