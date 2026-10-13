/**
 * FASE 41 · FUZZER HOSTIL DE LA ECONOMÍA (núcleo reutilizable por el script y por los tests).
 *
 * Cada SECUENCIA crea una base en memoria (`MemSupabase`, RPC con el contrato de sus migraciones), da de alta dos
 * cuentas como el trigger real y ejecuta entre 3 y 14 acciones al azar contra los SERVICIOS REALES (`buyPack`,
 * `openPackForUser`, `buyAndOpen`, `claimMission`, `refreshMissions`, `getProgression`, `peekProgression`,
 * `readStarterStatus`, `sandboxPurchase`, `salvageCards`, `buyPrestige`, `award`): reintentos con la misma clave,
 * claves nuevas, ráfagas concurrentes (`Promise.all`), sobres inexistentes/DRAFT/RETIRED, cartas ajenas, recompensas
 * negativas y lecturas que no pueden escribir. Al final (y en los pasos que lo requieren) comprueba las invariantes.
 */
import { MemSupabase, type Row } from "./memSupabase";
import { buyPack, openPackForUser, buyAndOpen } from "../packs";
import { readStarterStatus } from "../starter";
import { claimMission, getProgression, peekProgression, refreshMissions } from "../progression";
import { sandboxPurchase } from "../credits";
import { salvageCards } from "../economy";
import { buyPrestige } from "../prestige";
import { award } from "../rewards";
import { makeRng, type Rng } from "@/sim/rng";
import { STARTER_POLICY } from "@/domain/economy/starter";
import { CURRENT_SEASON } from "@/data/season";
import { masterySets } from "@/domain/collection/mastery";
import { fullBadgeOf, PRESTIGE_TIERS } from "@/domain/collection/prestige";
import { CREDIT_PRODUCTS } from "@/domain/economy/drlCredits";

export const USERS = ["00000000-0000-4000-8000-00000000000a", "00000000-0000-4000-8000-00000000000b"] as const;

export type FuzzAction =
  | "buy_inicial" | "buy_estandar" | "buy_bad_pack" | "open" | "buy_and_open" | "retry_last" | "burst"
  | "play" | "claim_mission" | "refresh" | "get_progression" | "read_only"
  | "sandbox" | "salvage" | "salvage_foreign" | "prestige" | "negative_award";

const ACTIONS: [FuzzAction, number][] = [
  ["buy_inicial", 10], ["buy_estandar", 5], ["buy_bad_pack", 2], ["open", 10], ["buy_and_open", 10], ["retry_last", 8], ["burst", 8],
  ["play", 8], ["claim_mission", 10], ["refresh", 4], ["get_progression", 3], ["read_only", 4],
  ["sandbox", 4], ["salvage", 4], ["salvage_foreign", 2], ["prestige", 3], ["negative_award", 2],
];
const TOTAL_W = ACTIONS.reduce((s, [, w]) => s + w, 0);

export interface Violation { seq: number; invariant: string; detail: string }
export interface FuzzStats { sequences: number; actions: number; byAction: Record<string, number>; okByAction: Record<string, number>; violations: Violation[]; rejected: number; sandboxOpenSequences: number }

const pickAction = (rng: Rng): FuzzAction => {
  let r = rng.next() * TOTAL_W;
  for (const [a, w] of ACTIONS) { r -= w; if (r <= 0) return a; }
  return "open";
};

const PRESTIGE_SET = masterySets().find((s) => fullBadgeOf(s)) ?? null;

export async function runSequence(seq: number, stats: FuzzStats): Promise<void> {
  const rng = makeRng(seq * 2654435761 % 2147483647 + 1);
  const db = new MemSupabase();
  const sb = db.client;
  for (const u of USERS) db.seedUser(u);
  const sandboxOpen = rng.next() < 0.1;
  if (sandboxOpen) stats.sandboxOpenSequences++;
  const prevEnv = process.env.NEXUS_SANDBOX_CREDITS;
  if (sandboxOpen) process.env.NEXUS_SANDBOX_CREDITS = "1"; else delete process.env.NEXUS_SANDBOX_CREDITS;
  const fail = (invariant: string, detail: string) => stats.violations.push({ seq, invariant, detail });
  const gestures: string[] = [];
  const gesture = () => { const reuse = gestures.length > 0 && rng.next() < 0.35; const g = reuse ? gestures[Math.floor(rng.next() * gestures.length)] : `g${seq}-${gestures.length}`; if (!reuse) gestures.push(g); return g; };
  let last: (() => Promise<unknown>) | null = null;
  const readyInicialRows = new Map<string, number>();
  const successfulPrestige = new Map<string, number>();

  const steps = 3 + Math.floor(rng.next() * 12);
  try {
    for (let i = 0; i < steps; i++) {
      const u = USERS[rng.next() < 0.5 ? 0 : 1];
      const action = pickAction(rng);
      stats.actions++; stats.byAction[action] = (stats.byAction[action] ?? 0) + 1;
      const packOf = () => (["inicial", "estandar", "premium"] as const)[Math.floor(rng.next() * 3)];
      const g = gesture(); const pk = packOf(); const r0 = rng.next();
      const run = async (): Promise<unknown> => {
        switch (action) {
          case "buy_inicial": return buyPack(sb, u, "inicial", g);
          case "buy_estandar": return buyPack(sb, u, "estandar", g);
          case "buy_bad_pack": {
            const id = ["prime", "team-loud", "no-existe", "../inicial"][Math.floor(rng.next() * 4)];
            const r = await buyPack(sb, u, id, g);
            if (r.ok) fail("pack-no-comprable", `${id} se compró`);
            return r;
          }
          case "open": return openPackForUser(sb, u, pk, g);
          case "buy_and_open": return buyAndOpen(sb, u, r0 < 0.6 ? "inicial" : "estandar", g);
          case "retry_last": return last ? last() : null;
          case "burst": {
            const same = rng.next() < 0.6; const k = 2 + Math.floor(rng.next() * 3);
            const kind = Math.floor(rng.next() * 5);
            // Ráfaga de reclamos de la MISMA misión con progreso real (la carrera que duplicaba XP del pase).
            const mission = kind === 3 ? await pickMission(db, u, rng, true) : "";
            return Promise.all(Array.from({ length: k }, (_, j) => {
              const gg = same ? g : `${g}-${j}`;
              return kind === 0 ? buyPack(sb, u, "inicial", gg) : kind === 1 ? buyAndOpen(sb, u, "inicial", gg) : kind === 2 ? openPackForUser(sb, u, "inicial", gg)
                : kind === 3 ? claimMission(sb, u, mission) : salvageCards(sb, u, db.table("user_cards").filter((c) => c.user_id === u).map((c) => String(c.uid)).slice(0, 6), `salvage:${u}:${gg}`);
            }));
          }
          case "play": {
            const n = 1 + Math.floor(rng.next() * 6);
            for (let j = 0; j < n; j++) db.table("duel_matches").push({ id: `m-${seq}-${i}-${j}`, user_id: u, status: "COMPLETED", winner: rng.next() < 0.5 ? "A" : "B", mode: "PVE" });
            return null;
          }
          case "claim_mission": return claimAny(db, u, rng);
          case "refresh": return refreshMissions(sb, u);
          case "get_progression": return getProgression(sb, u);
          case "read_only": {
            const w = db.writes; const rpcs = db.rpcCalls.length;
            await readStarterStatus(sb, u); await peekProgression(sb, u);
            if (db.writes !== w || db.rpcCalls.filter((x) => x !== "app_content_distribution_snapshot").length !== db.rpcCalls.slice(0, rpcs).filter((x) => x !== "app_content_distribution_snapshot").length) fail("get-sin-escrituras", `writes ${db.writes - w}`);
            return null;
          }
          case "sandbox": {
            const p = CREDIT_PRODUCTS[Math.floor(rng.next() * CREDIT_PRODUCTS.length)];
            const r = await sandboxPurchase(sb, u, p.productId, g);
            if (!sandboxOpen && r.ok) fail("sandbox-cerrada", "concedió con el interruptor cerrado");
            return r;
          }
          case "salvage": {
            // Duplicadas sembradas (se contabilizan aparte en la invariante de cartas).
            const seedCard = db.table("user_cards").find((c) => c.user_id === u);
            if (seedCard && r0 < 0.6) { for (let j = 0; j < 2; j++) { db.table("user_cards").push({ ...seedCard, uid: `seed-${u}-${db.table("_fuzz_seeded").length}`, origin: "seed" }); db.table("_fuzz_seeded").push({ user_id: u }); } }
            const mine = db.table("user_cards").filter((c) => c.user_id === u).map((c) => String(c.uid));
            const pick = mine.filter(() => rng.next() < 0.5);
            return salvageCards(sb, u, pick.length ? pick : ["x"], `salvage:${u}:${g}`);
          }
          case "salvage_foreign": {
            const other = USERS.find((x) => x !== u)!;
            const theirs = db.table("user_cards").filter((c) => c.user_id === other).map((c) => String(c.uid));
            if (!theirs.length) return null;
            const before = db.table("user_cards").filter((c) => c.user_id === other).length;
            const r = await salvageCards(sb, u, theirs.slice(0, 3), `salvage:${u}:${g}`);
            if (db.table("user_cards").filter((c) => c.user_id === other).length !== before) fail("salvage-ajeno", "borró cartas de otro jugador");
            return r;
          }
          case "prestige": {
            if (!PRESTIGE_SET) return null;
            const base = fullBadgeOf(PRESTIGE_SET)!;
            for (const x of USERS) {
              if (!db.table("user_cosmetics").some((c) => c.user_id === x && c.cosmetic_id === base)) db.insertRow("user_cosmetics", { user_id: x, cosmetic_id: base, source: "mastery" });
              if (!db.table("credit_transactions").some((t) => t.user_id === x && t.ref === `qa-fund:${x}`)) fundUser(db, x, 60_000);
            }
            const tier = PRESTIGE_TIERS[0];
            const both = await Promise.all(USERS.map((x) => buyPrestige(sb, x, PRESTIGE_SET.id, tier.id)));
            both.forEach((r, k) => { if (r.ok && r.data?.applied) successfulPrestige.set(USERS[k], (successfulPrestige.get(USERS[k]) ?? 0) + 1); });
            return both;
          }
          case "negative_award": {
            const before = db.table("credit_transactions").length;
            let threw = false;
            try { await award(sb, { userId: u, ref: `neg:${g}`, reason: "fuzz", reward: { credits: -1 - Math.floor(rng.next() * 100_000) } }); } catch { threw = true; }
            if (!threw || db.table("credit_transactions").length !== before) fail("recompensa-negativa", "se concedió una recompensa negativa");
            return null;
          }
        }
      };
      if (action !== "retry_last") last = run;
      const r = await run();
      const results = Array.isArray(r) ? r : [r];
      for (const x of results) {
        if (!x || typeof x !== "object" || !("ok" in (x as Row))) continue;
        if ((x as { ok: boolean }).ok) stats.okByAction[action] = (stats.okByAction[action] ?? 0) + 1; else stats.rejected++;
      }
      // Tras cada paso: el Sobre Inicial gratis nunca se sigue concediendo con plantilla posible (holgura 1 por carrera).
      for (const x of USERS) {
        const st = await readStarterStatus(sb, x);
        const rows = db.table("credit_transactions").filter((t) => t.user_id === x && t.reason === `buy_pack:${STARTER_POLICY.packId}`).length;
        if (st.deckReady) {
          if (!readyInicialRows.has(x)) readyInicialRows.set(x, rows);
          else if (rows > readyInicialRows.get(x)! + 1) fail("starter-tras-plantilla", `${rows - readyInicialRows.get(x)!} concesiones con plantilla posible`);
        }
      }
    }
  } finally {
    if (prevEnv === undefined) delete process.env.NEXUS_SANDBOX_CREDITS; else process.env.NEXUS_SANDBOX_CREDITS = prevEnv;
  }
  checkInvariants(db, seq, sandboxOpen, fail);
  for (const x of USERS) {
    const paid = db.table("credit_transactions").filter((t) => t.user_id === x && String(t.ref).startsWith(`prestige:${x}:`)).length;
    if ((successfulPrestige.get(x) ?? 0) > paid) fail("prestigio-sin-cobro", `${x}: ${successfulPrestige.get(x)} compras, ${paid} cobros`);
  }
  stats.sequences++;
}

function fundUser(db: MemSupabase, user: string, credits: number) {
  const p = db.table("profiles").find((r) => r.id === user)!;
  p.credits = Number(p.credits) + credits;
  db.insertRow("credit_transactions", { user_id: user, delta: credits, reason: "qa_fund", ref: `qa-fund:${user}`, balance_after: p.credits, kind: "adjustment" });
}

async function pickMission(db: MemSupabase, u: string, rng: Rng, force: boolean): Promise<string> {
  const sb = db.client;
  let pass = db.table("user_pass").find((r) => r.user_id === u);
  if (!pass) { await getProgression(sb, u); pass = db.table("user_pass").find((r) => r.user_id === u); }
  const missions = ((pass?.state as { missions?: { id: string; metric: string; goal: number }[] } | undefined)?.missions ?? []);
  const m = missions.length ? missions[Math.floor(rng.next() * missions.length)] : null;
  if (m && force) {
    // Progreso REAL de juego (lo que el servidor mide), nunca un «completado» inventado.
    for (let j = 0; j < m.goal; j++) {
      if (m.metric === "duels_played" || m.metric === "duels_won") db.table("duel_matches").push({ id: `f-${u}-${db.table("duel_matches").length}`, user_id: u, status: "COMPLETED", winner: "A", mode: "PVE" });
      // SANEAMIENTO POST F47 · una respuesta de pick’em cuelga de una ENTREGA del jugador: `pickem_answers`
      // no tiene `user_id` (0012). La fixture antigua lo inventaba y por eso el recuento roto «colaba».
      if (m.metric === "picks_made") {
        const sid = `s-${u}`;
        if (!db.table("pickem_submissions").some((r) => r.id === sid)) db.table("pickem_submissions").push({ id: sid, user_id: u, pickem_event_id: "ev-fuzz" });
        db.table("pickem_answers").push({ id: `p-${u}-${db.table("pickem_answers").length}`, submission_id: sid, created_at: new Date().toISOString() });
      }
    }
    if (m.metric === "packs_opened") { const g = db.table("user_game").find((r) => r.user_id === u); if (g) g.packs_opened = Number(g.packs_opened) + m.goal; }
    if (m.metric === "decks_saved") db.table("duel_decks").push({ id: `d-${u}-${db.table("duel_decks").length}`, user_id: u });
    if (m.metric === "region_set") { const p = db.table("profiles").find((r) => r.id === u); if (p) p.region = "EMEA"; }
  }
  return m?.id ?? "d-abrir-1";
}

async function claimAny(db: MemSupabase, u: string, rng: Rng) {
  return claimMission(db.client, u, await pickMission(db, u, rng, rng.next() < 0.7));
}

export function checkInvariants(db: MemSupabase, seq: number, sandboxOpen: boolean, fail: (i: string, d: string) => void): void {
  const ledger = db.table("credit_transactions");
  for (const u of USERS) {
    const p = db.table("profiles").find((r) => r.id === u)!;
    const credits = Number(p.credits);
    const sum = ledger.filter((t) => t.user_id === u).reduce((s, t) => s + Number(t.delta), 0);
    if (credits < 0) fail("saldo-no-negativo", `${u}: ${credits}`);
    if (credits !== sum) fail("saldo-igual-libro-mayor", `${u}: perfil ${credits} ≠ libro ${sum}`);
    const refs = ledger.filter((t) => t.user_id === u).map((t) => String(t.ref));
    if (new Set(refs).size !== refs.length) fail("clave-unica-libro", u);
    for (const pk of db.table("user_packs").filter((r) => r.user_id === u)) if (Number(pk.qty) < 0) fail("sobres-no-negativos", `${u}:${pk.pack_id}`);
    const inicial = ledger.filter((t) => t.user_id === u && t.reason === `buy_pack:${STARTER_POLICY.packId}`).length;
    if (inicial > STARTER_POLICY.maxFreeClaims) fail("tope-starter", `${u}: ${inicial}`);
    // Misiones: una vez por tanda (id + assignedAt).
    const tandas = new Map<string, number>();
    let ledgerXp = 0;
    for (const t of ledger.filter((x) => x.user_id === u && x.reason === "mission_reward")) {
      const [, , id, assignedAt] = String(t.ref).split(":");
      const k = `${id}:${assignedAt}`; tandas.set(k, (tandas.get(k) ?? 0) + 1);
      ledgerXp += CURRENT_SEASON.missionPool.find((m) => m.id === id)?.xp ?? 0;
    }
    for (const [k, n] of tandas) if (n > 1) fail("mision-una-vez-por-tanda", `${u}:${k} ×${n}`);
    const pass = db.table("user_pass").find((r) => r.user_id === u);
    const xp = Number((pass?.state as { xp?: number } | undefined)?.xp ?? 0);
    if (xp > ledgerXp) fail("xp-pase-sin-pago", `${u}: xp ${xp} > pagado ${ledgerXp}`);
    // Cartas = aperturas − recicladas.
    const opened = db.table("economy_ops").filter((o) => o.user_id === u && o.kind === "open_pack").reduce((s, o) => s + ((o.result as { uids: string[] }).uids.length), 0);
    const salvaged = db.table("economy_ops").filter((o) => o.user_id === u && o.kind === "salvage").reduce((s, o) => s + Number((o.result as { salvaged: number }).salvaged), 0);
    const cards = db.table("user_cards").filter((c) => c.user_id === u).length;
    // Cartas = abiertas − recicladas + sembradas por el fuzzer (duplicadas para ejercitar el reciclaje).
    const seeded = db.table("_fuzz_seeded").filter((r) => r.user_id === u).length;
    if (cards !== opened - salvaged + seeded) fail("cartas-cuadran", `${u}: ${cards} ≠ ${opened} − ${salvaged} + ${seeded}`);
    if (!sandboxOpen && ledger.some((t) => t.user_id === u && String(t.reason).startsWith("sandbox_purchase"))) fail("sandbox-cerrada", u);
    // Prestigio: todo cosmético de prestigio tiene su cobro con clave del PROPIO jugador.
    for (const c of db.table("user_cosmetics").filter((r) => r.user_id === u && r.source === "prestige")) {
      if (!ledger.some((t) => t.user_id === u && t.reason === `prestige:${c.cosmetic_id}` && String(t.ref).startsWith(`prestige:${u}:`))) fail("prestigio-cobrado", `${u}:${c.cosmetic_id}`);
    }
  }
  const opsRefs = db.table("economy_ops").map((o) => String(o.ref));
  if (new Set(opsRefs).size !== opsRefs.length) fail("clave-unica-ops", `seq ${seq}`);
}

export function newStats(): FuzzStats {
  return { sequences: 0, actions: 0, byAction: {}, okByAction: {}, violations: [], rejected: 0, sandboxOpenSequences: 0 };
}
