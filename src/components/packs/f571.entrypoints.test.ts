/**
 * FASE 57.1 · HOTFIX «LA APERTURA REAL NO HA CAMBIADO» — contratos de ENTRADA PRODUCTIVA.
 *
 * Todos los CTA legítimos de apertura llevan a UNA sola ruta (`/abrir/[packId]`) que monta UNA sola ceremonia
 * (`PackOpeningExperience` → `PackStage` + `CardReveal` de la Fase 57). Ninguna otra pantalla productiva monta un
 * escenario de apertura, y no existe una segunda implementación a la que caer.
 *
 * La causa raíz del hotfix NO era de rutas (esto ya se cumplía): era el modo de movimiento reducido (ver M1b en
 * `f57.packOpening.test.tsx`). Estos contratos existen para que nunca aparezca un segundo camino.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const walk = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap((f) => {
  const rel = `${dir}/${f}`;
  return statSync(join(ROOT, rel)).isDirectory() ? walk(rel) : /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [rel] : [];
});
const PROD = walk("src").filter((f) => !f.includes("/design-system/"));

test("E1 · la ruta de apertura monta la ceremonia canónica y nada más", () => {
  const page = code(read("src/app/abrir/[packId]/page.tsx"));
  assert.ok(page.includes("<PackOpeningExperience packId={packId} />"));
  const exp = code(read("src/components/packs/PackOpeningExperience.tsx"));
  assert.ok(exp.includes("<PackStage") && exp.includes("<HeroReveal") && exp.includes("<RestReveal") && exp.includes("<PackSummary")); // F81
  const stage = read("src/components/packs/PackStage.tsx");
  for (const m of ['data-testid="ceremony-pack"', "data-tear-half", "RUPTURE_REDUCED_MS = 1600", "<SealedPack pack={pack} cutProgress={lifted ? 0 : cutProgress} width={width} ceremony torn={torn} />"]) {
    assert.ok(stage.includes(m), `PackStage F57: ${m}`);
  }
});

test("E2 · TIENDA → /abrir/<sobre> (compra y «Abrir ahora»)", () => {
  assert.ok(code(read("src/app/tienda/page.tsx")).includes("router.push(`/abrir/${packId}`);"));
  const card = code(read("src/components/packs/PackStoreCard.tsx"));
  assert.ok(card.includes("router.push(`/abrir/${pack.id}`)"));
});

test("E3 · INVENTARIO / MIS SOBRES → /abrir/<sobre>", () => {
  assert.ok(code(read("src/components/packs/PackOpenStage.tsx")).includes("href={`/abrir/${packId}`}"));
  assert.ok(code(read("src/app/inventario/page.tsx")).includes("href={`/abrir/${packId}`}"));
  assert.ok(code(read("src/components/packs/MyPacks.tsx")).includes("href={`/abrir/${pack.id}`}"));
  // `PackOpenStage` es la PUERTA del inventario (un enlace), no una ceremonia: no monta escenario ni revelado.
  assert.ok(!/<PackStage|<CardReveal|openPackOutcome|apiOpenPack/.test(code(read("src/components/packs/PackOpenStage.tsx"))));
});

test("E4 · FICHA DEL SOBRE y recorrido del jugador → /abrir/<sobre>", () => {
  const ficha = code(read("src/app/packs/[packId]/page.tsx"));
  assert.ok(ficha.includes("router.push(`/abrir/${pack!.id}`)"));
  assert.ok(code(read("src/domain/journey/index.ts")).includes("packRoute: (packId: string) => `/abrir/${encodeURIComponent(packId)}`"));
});

test("E5 · UNA sola ceremonia: fuera de la ruta y de los arneses QA, nadie más monta escenario, revelado ni apertura", () => {
  for (const f of PROD) {
    const c = code(read(f));
    if (f !== "src/components/packs/PackOpeningExperience.tsx") {
      assert.ok(!/<PackStage\b|<CardReveal\b/.test(c), `${f} monta piezas de la ceremonia`);
    }
    if (f !== "src/app/abrir/[packId]/page.tsx" && f !== "src/components/packs/PackOpeningExperience.tsx") {
      assert.ok(!/<PackOpeningExperience\b/.test(c), `${f} monta la ceremonia fuera de su ruta`);
    }
    if (!["src/lib/game/sync.ts", "src/components/packs/PackOpeningExperience.tsx", "src/lib/game/api.ts", "src/lib/game/client.ts"].includes(f)) {
      assert.ok(!/openPackOutcome\(/.test(c), `${f} abre sobres por su cuenta`);
    }
  }
  // No sobreviven restos de la ceremonia anterior (la rotura congelada de F38 era su pieza propia).
  assert.ok(!/FrozenRupture/.test(read("src/components/packs/PackStage.tsx")));
});
