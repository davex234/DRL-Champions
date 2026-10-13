/**
 * F72.4 · EVIDENCIA ESTÁTICA (fuera de CI, solo lectura): probabilidades del detalle por producto frente a su fuente del
 * servidor, catálogo antes/después (qué información sale de la tarjeta) e invariantes de regresión.
 *   npx tsx scripts/_f724-evidence.ts
 */
import { readdirSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveStore } from "../src/domain/store/resolve";
import { getPack } from "../src/data/packs";
import { CARDS } from "../src/data/catalog";
import { packStats } from "../src/data/packStats";
import { mainPackDistribution } from "../src/domain/packs/packClass";
import { catalogPrice, productName, productOdds } from "../src/components/store/storeView";
import { TACTICAL_AGENTS } from "../src/domain/tactics/roster";
import { GLOBAL_MARKET_ENABLED } from "../src/config/features";
import { PAYMENTS_ENABLED } from "../src/config/monetization";

const OUT = join(process.cwd(), "docs/product/qa/fase72-4");
mkdirSync(OUT, { recursive: true });
const w = (f: string, o: unknown) => writeFileSync(join(OUT, f), JSON.stringify(o, null, 2) + "\n");
const view = resolveStore(Date.now());
const all = [...view.packs, ...view.boxes, ...view.cards, ...view.bundles];

w("probabilities.json", {
  rule: "detalle = productOdds(product) = packOddsFor(pack, packStats(pack.id), equipo) — la misma llamada que /packs/[packId]",
  sources: {
    "class-table": "mainPackDistribution(packId): la tabla con la que openPack sortea cada hueco (línea principal)",
    measured: "PACK_STATS: 20.000 aperturas con el motor real (revalidado por packStats.test contra openPack)",
    weights: "pesos declarados normalizados (sin medición; hoy solo el Sobre Inicial, regalo con regla propia)",
  },
  products: all.filter((p) => p.kind !== "CARD").map((p) => ({
    productId: p.productId, name: productName(p),
    tables: productOdds(p).map((g) => ({
      packId: g.packId, source: g.source, ui: g.rows.map((r) => `${r.label} ${r.pct}`),
      server: g.source === "class-table" ? mainPackDistribution(g.packId) : g.source === "measured" ? packStats(g.packId)?.drawn : getPack(g.packId)?.weights,
    })),
  })),
});

w("catalog-after.json", {
  products: all.map((p) => ({ productId: p.productId, kind: p.kind, card: { name: productName(p), price: catalogPrice(p).text, cta: p.status !== "AVAILABLE" ? "Ver" : catalogPrice(p).text === "Gratis" ? "Conseguir" : "Comprar", badges: [p.badge, p.status === "COMING_SOON" ? "Próximamente" : null].filter(Boolean) } })),
  removedFromCard: ["categoría y nº de cartas («NEXUS · 5 cartas aleatorias»)", "probabilidades/clases con % (7 líneas en la línea principal)", "rarezas posibles (resto de sobres)", "precio en euros «€ · Por anunciar»", "contenido de caja («10 × Sobre … · 50 cartas», «Se guardan sin abrir…»)", "contenido de pack (tagline + lista de sobres/cartas/créditos)", "edición · rareza · equipo de la carta", "«Comprar o abrir»/«Ver detalles» → «Comprar»/«Ver»"],
  movedTo: "detalle de compra (PurchaseDetails): todo lo anterior + saldo y saldo después",
});

w("regression.json", {
  cards: CARDS.length, agents: TACTICAL_AGENTS.length,
  migrationHeadOnDisk: readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort().pop(),
  migrationsAfter0058: readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql") && f > "0058_hardening_grants.sql"),
  marketplaceEnabled: GLOBAL_MARKET_ENABLED, paymentsEnabled: PAYMENTS_ENABLED,
  pricesUnchanged: view.packs.every((p) => p.options.find((o) => o.method === "GAME_CURRENCY")?.price === getPack(p.packId!)!.price),
  f724Touched: ["src/components/store/*", "src/app/tienda/page.tsx", "src/app/tienda/store.css", "scripts/ops/browser-gate.ts (regex del botón)"],
  notTouched: "packs.ts, packClass.ts, packStats.ts, openPack.ts, odds.ts, storeCatalog.ts, resolve.ts, server/services/*, motor de duelo, economía, migraciones",
  heroConfigUnchanged: readFileSync("src/data/storeCatalog.ts", "utf8").includes("Las épicas de la temporada"),
});
console.log("evidencia F72.4 escrita");
