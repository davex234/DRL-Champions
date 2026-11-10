/**
 * FASE 63 · CONTRATO DEL STARTER (instrumento `_`, fuera de CI). Sin red ni BD: motor real + catálogo real + pools de la
 * foto F58.1. Escribe `docs/product/qa/fase63-onboarding/starter-contract.json`.
 *
 *   npx tsx scripts/_fase63-starter.ts [n=20000]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dbDistribution, starterStats, STARTER_GRANT } from "../src/domain/onboarding/starterMath";

import { STARTER_POLICY, ECONOMY_VERSION } from "../src/domain/economy/starter";
import { getPack } from "../src/data/packs";
import { TOTAL_CARDS } from "../src/data/catalog";

const n = Number(process.argv[2] ?? 20000);
const OUT = join(process.cwd(), "docs/product/qa/fase63-onboarding");
mkdirSync(OUT, { recursive: true });
const alta = readFileSync(join(process.cwd(), "supabase/migrations/0011_server_authority.sql"), "utf8");
const i = alta.indexOf("create or replace function public.handle_new_user()");
const t0 = Date.now();
const runs = [];
for (const order of ["guide", "inicial-first"] as const) {
  runs.push({ pools: "codigo", ...starterStats(n, order) });
  runs.push({ pools: "bd-f58.1", ...starterStats(n, order, dbDistribution()) });
}
const doc = {
  at: new Date().toISOString(),
  source: {
    trigger: "supabase/migrations/0011_server_authority.sql · handle_new_user (verificado vivo en la BD del VPS el 2026-09-26: contiene 'inicial' y 6000; profiles.credits default 6000)",
    triggerSql: alta.slice(i, alta.indexOf("end; $$;", i) + 8),
  },
  grant: STARTER_GRANT,
  packs: STARTER_GRANT.packs.map((p) => { const d = getPack(p.packId)!; return { id: d.id, name: d.name, price: d.price, cardCount: d.cardCount, exists: true }; }),
  assist: { policy: STARTER_POLICY, economyVersion: ECONOMY_VERSION },
  catalog: TOTAL_CARDS,
  changed: false,
  verdict: "VÁLIDO: los dos sobres del alta existen en el catálogo actual (Sobre Inicial y Sobre Bronce = id estandar). No se toca el starter.",
  simulation: { n, ms: Date.now() - t0, runs },
};
writeFileSync(join(OUT, "starter-contract.json"), JSON.stringify(doc, null, 2));
console.log(JSON.stringify(runs.map((r) => ({ order: r.order, pools: r.pools, ready: r.readyRate, valid: r.validRate, welcomeOnly: r.readyWithWelcomeOnly, extra: r.freeExtra })), null, 1));
