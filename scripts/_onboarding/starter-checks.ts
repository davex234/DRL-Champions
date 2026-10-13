/**
 * COMPROBACIONES DEL STARTER (investigación 2026-10-11) — `npx tsx scripts/_onboarding/starter-checks.ts [servicio|preicon|cola|all] [N]`
 *
 *   servicio  El SERVICIO REAL de extremo a extremo sobre MemSupabase (alta como `handle_new_user`, `openPackForUser`,
 *             `readStarterStatus`, `buyAndOpen("inicial")` gratis). `crypto.randomInt` se sustituye por un generador con
 *             semilla SOLO en este proceso para que sea reproducible. No toca src.
 *   preicon   Reimplementa aquí el sorteo por clase del Bronce (a) como HOY y (b) como ANTES del «Icon por sobre»
 *             (sin tirada previa, Icon 5 ‰ en la destacada). (a) se contrasta carta a carta con el motor real; con (b)
 *             se repite la simulación del verificador para aislar el salto 369 → 413.
 *   cola      200.000 cuentas con el resolutor real (rol de carta) para acotar la cola.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import nodeCrypto from "node:crypto";
import { CardRegistry } from "../../src/collection/registry";
import { PackEngine } from "../../src/pack/engine";
import { getPack } from "../../src/data/packs";
import { freshPity } from "../../src/domain/packs/pity";
import { classPool } from "../../src/domain/packs/openPack";
import { MAIN_PACK_PLAN, ovrTiltWeight, PACK_CLASS_ORDER, type ClassTable, type PackCardClass } from "../../src/domain/packs/packClass";
import { pickWeighted } from "../../src/domain/packs/weighted";
import { makeRng } from "../../src/sim/rng";
import { deckReadiness, type ReadinessCard } from "../../src/domain/journey";
import { STARTER_POLICY, starterAssistFor } from "../../src/domain/economy/starter";

const section = process.argv[2] ?? "all";
const want = (s: string) => section === "all" || section === s;
const OUT = "logs/onboarding"; mkdirSync(OUT, { recursive: true });
const save = (name: string, data: unknown) => { writeFileSync(`${OUT}/${name}.json`, JSON.stringify(data, null, 1) + "\n"); console.log(`→ ${OUT}/${name}.json`); };
const REG = new CardRegistry(); const ENGINE = new PackEngine(REG);
type Res = (id: string) => ReadinessCard | null;
const mk = (card: boolean): Res => (id) => { const c = REG.card(id); const p = c ? REG.player(c.playerId) : undefined; return c && p ? { playerId: c.playerId, role: card ? (c.role ?? p.role) : p.role, dataVersion: c.dataVersion ?? "", combat: !!c.combat } : null; };
const resolvePlayer = mk(false); const resolveCard = mk(true);
const seedA = (acc: number, k: number) => ((acc * 7919 + k * 104729 + 99) >>> 0) % 2147483647;
const stats = (totals: number[]) => { const s = [...totals].sort((a, b) => a - b); const n = s.length; const q = (p: number) => s[Math.floor(p * (n - 1))]; return { p50: q(0.5), p90: q(0.9), p99: q(0.99), p999: q(0.999), max: s[n - 1], mean: Math.round((100 * s.reduce((a, b) => a + b, 0)) / n) / 100 }; };

async function main() {
  /* ═══════════════════════ PRE-ICON ═══════════════════════ */
  if (want("preicon")) {
    console.log("\n· PRE-ICON (aislar el salto 369 → 413)");
    const pack = getPack("estandar")!; const plan = MAIN_PACK_PLAN.estandar; const pools = classPool(REG, pack, null);
    const weightOf = (c: { ovr: number }) => ovrTiltWeight(plan.ovrTilt, c.ovr);
    const roll = (table: ClassTable, rng: ReturnType<typeof makeRng>): PackCardClass => {
      let total = 0; for (const c of PACK_CLASS_ORDER) total += Math.max(0, table[c]);
      let r = rng.next() * total; let last: PackCardClass = "base";
      for (const c of PACK_CLASS_ORDER) { if (table[c] <= 0) continue; last = c; r -= table[c]; if (r < 0) return c; }
      return last;
    };
    const OLD_FEATURED: ClassTable = { ...plan.featured, icon: 5 }; // 250/400/200/100/30/15/5 = 1000 ‰ (tabla anterior al 2026-10-09)
    const drawBronce = (seed: number, mode: "hoy" | "preicon"): string[] => {
      const rng = makeRng(seed); const out: string[] = [];
      let hasIcon = false;
      if (mode === "hoy") { for (;;) { const x = Math.floor(rng.next() * 4294967296); if (x < 4294960000) { hasIcon = x % 10000 < plan.iconChanceBp!; break; } } }
      for (let i = 0; i < plan.cards; i++) {
        const featured = i === plan.cards - 1;
        const k: PackCardClass = mode === "hoy" ? (featured && hasIcon ? "icon" : roll(featured ? plan.featured : plan.regular, rng)) : roll(featured ? OLD_FEATURED : plan.regular, rng);
        out.push(pickWeighted(pools[k], weightOf, rng).id);
      }
      return out;
    };
    // Fidelidad de la reimplementación: «hoy» ≡ motor real, carta a carta (como multiconjunto: el motor reordena para el revelado).
    let same = 0; const CHK = 5000;
    for (let s = 1; s <= CHK; s++) {
      const mine = drawBronce(s * 7919 + 99, "hoy").sort().join("|");
      const real = ENGINE.draw(pack, { seed: s * 7919 + 99, owned: [], mintCounts: {}, pity: freshPity(), now: 0, assist: null } as never).instances.map((i) => i.cardId).sort().join("|");
      if (mine === real) same++;
    }
    console.log(`  reimplementación «hoy» ≡ motor real: ${same}/${CHK} sobres idénticos`);
    const runV = (mode: "motor" | "hoy" | "preicon", resolve: Res, n = 20_000) => {
      const totals: number[] = []; let trapped = 0;
      for (let acc = 0; acc < n; acc++) {
        const ids: string[] = []; let pity = freshPity(); let k = 0; let opened = 0;
        const open = (id: string) => {
          const seed = seedA(acc, k++);
          if (id === "estandar" && mode !== "motor") ids.push(...drawBronce(seed, mode));
          else { const a = id === "inicial" ? starterAssistFor("inicial", ids, resolve) : null; const r = ENGINE.draw(getPack(id)!, { seed, owned: [], mintCounts: {}, pity, now: 0, assist: a } as never); pity = r.pityAfter; for (const i of r.instances) ids.push(i.cardId); }
          opened++;
        };
        for (const id of ["inicial", "inicial", "inicial", "estandar"]) open(id);
        let extra = 0;
        while (!deckReadiness(ids, resolve).ready && extra < STARTER_POLICY.maxFreeClaims) { open("inicial"); extra++; }
        if (!deckReadiness(ids, resolve).ready) trapped++;
        totals.push(opened);
      }
      return { trapped, ...stats(totals) };
    };
    const res = {
      fidelity: { identical: same, checked: CHK },
      verificador: { motorReal: runV("motor", resolvePlayer), reimplHoy: runV("hoy", resolvePlayer), preIcon: runV("preicon", resolvePlayer) },
      real: { motorReal: runV("motor", resolveCard), preIcon: runV("preicon", resolveCard) },
    };
    console.log(JSON.stringify(res, null, 1));
    save("preicon", res);
  }

  /* ═══════════════════════ COLA ═══════════════════════ */
  if (want("cola")) {
    const n = Number(process.argv[3] ?? 200_000);
    console.log(`\n· COLA (resolutor real, ${n} cuentas por orden)`);
    const res: Record<string, unknown> = {};
    for (const [name, order] of [["inicial-primero", ["inicial", "inicial", "inicial", "estandar"]], ["guia-bronce-primero", ["estandar", "inicial", "inicial", "inicial"]], ["solo-iniciales (nunca abre el Bronce)", ["inicial", "inicial", "inicial"]]] as const) {
      const totals: number[] = []; let trapped = 0; let readyWelcome = 0; const extraHist: Record<number, number> = {};
      for (let acc = 0; acc < n; acc++) {
        const ids: string[] = []; let pity = freshPity(); let k = 0; let opened = 0;
        const open = (id: string) => { const a = id === "inicial" ? starterAssistFor("inicial", ids, resolveCard) : null; const r = ENGINE.draw(getPack(id)!, { seed: seedA(acc, k++), owned: [], mintCounts: {}, pity, now: 0, assist: a } as never); pity = r.pityAfter; for (const i of r.instances) ids.push(i.cardId); opened++; };
        for (const id of order) open(id);
        let extra = 0; if (deckReadiness(ids, resolveCard).ready) readyWelcome++;
        while (!deckReadiness(ids, resolveCard).ready && extra < STARTER_POLICY.maxFreeClaims) { open("inicial"); extra++; }
        if (!deckReadiness(ids, resolveCard).ready) trapped++;
        totals.push(opened); extraHist[extra] = (extraHist[extra] ?? 0) + 1;
      }
      res[name] = { n, trapped, readyAfterWelcomePct: Math.round((10000 * readyWelcome) / n) / 100, ...stats(totals), freeExtraHistogram: extraHist };
      console.log(`  ${name}: ${JSON.stringify(res[name])}`);
    }
    save("cola", res);
  }

  /* ═══════════════════════ SERVICIO REAL (MemSupabase) ═══════════════════════ */
  if (want("servicio")) {
    const n = Number(process.argv[3] ?? 3000);
    console.log(`\n· SERVICIO REAL de extremo a extremo (MemSupabase, ${n} cuentas por orden, randomInt con semilla)`);
    // Generador con semilla en lugar de la aleatoriedad criptográfica del servidor (solo en este proceso).
    let state = 20261011;
    const lcg = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
    const patched = (a: number, b?: number) => { const lo = b === undefined ? 0 : a; const hi = b === undefined ? a : b; return lo + (lcg() % (hi - lo)); };
    (nodeCrypto as unknown as { randomInt: unknown }).randomInt = patched;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require("node:crypto") as { randomInt: unknown }).randomInt = patched;
    const { MemSupabase } = await import("../../src/server/services/testing/memSupabase");
    const { openPackForUser, buyAndOpen } = await import("../../src/server/services/packs");
    const { readStarterStatus } = await import("../../src/server/services/starter");
    const U = "0b0a0d00-0000-4000-8000-000000000001";
    const res: Record<string, unknown> = {};
    const mute = console.error; const mutew = console.warn;
    for (const [name, order] of [["inicial-primero", ["inicial", "inicial", "inicial", "estandar"]], ["guia-bronce-primero", ["estandar", "inicial", "inicial", "inicial"]]] as const) {
      state = 20261011;
      const totals: number[] = []; let trapped = 0; let readyWelcome = 0; let errors = 0; const reasons: Record<string, number> = {}; let firstSeeds = "";
      const creditsLeft: number[] = [];
      for (let acc = 0; acc < n; acc++) {
        const d = new MemSupabase(); d.seedUser(U);
        console.error = () => {}; console.warn = () => {};
        let opened = 0;
        for (const id of order) { const r = await openPackForUser(d.client, U, id, `w${opened}`); if (!r.ok) errors++; else { opened++; if (acc === 0) firstSeeds += r.data.opened.map((c) => c.cardId).join(",") + ";"; } }
        let st = await readStarterStatus(d.client, U);
        if (st.deckReady) readyWelcome++;
        while (!st.deckReady) {
          if (!st.eligible) { trapped++; reasons[st.reason ?? "?"] = (reasons[st.reason ?? "?"] ?? 0) + 1; break; }
          const r = await buyAndOpen(d.client, U, "inicial", `free${opened}`);
          if (!r.ok) { errors++; break; }
          opened++;
          st = await readStarterStatus(d.client, U);
        }
        console.error = mute; console.warn = mutew;
        totals.push(opened);
        creditsLeft.push(Number(d.table("profiles").find((p) => p.id === U)!.credits));
      }
      res[name] = { n, trapped, trapReasons: reasons, errors, readyAfterWelcomePct: Math.round((10000 * readyWelcome) / n) / 100, ...stats(totals), creditsAfter: { min: Math.min(...creditsLeft), max: Math.max(...creditsLeft) }, firstAccountCards: firstSeeds.slice(0, 160) };
      console.log(`  ${name}: ${JSON.stringify(res[name])}`);
    }
    save("servicio", res);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
