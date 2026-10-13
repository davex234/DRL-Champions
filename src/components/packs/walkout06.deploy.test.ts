/**
 * WALKOUT 0.6 · despliegue en el VPS — contrato de lo que la release lleva a producción.
 *
 *   D01 el despliegue nace APAGADO · D02 la prueba local (localStorage) no cuenta en producción · D03 la vista previa
 *   protegida vive bajo /admin (AdminGuard) y no toca store, servidor ni economía · D04 los assets del walkout son
 *   rutas relativas servidas por la app (sin localhost ni rutas de Windows) y con licencia · D05 metadataBase del
 *   origen público (og:image ya no apunta a localhost) · D06 sin PCFSoftShadowMap (retirado en three 0.182+)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PACK_WALKOUT_3D_ENABLED } from "@/config/features";
import { packWalkoutAllowed } from "@/domain/walkout/packWalkout";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

test("D01 · PACK_WALKOUT_3D_ENABLED = «all» desde Walkout 0.7 (nació en «off» en 0.6)", () => {
  assert.equal(PACK_WALKOUT_3D_ENABLED, "all");
});

test("D02 · en producción, ni la prueba local (localStorage) ni el arnés QA encienden el walkout", () => {
  assert.equal(packWalkoutAllowed({ rollout: "off", admin: null, devOptIn: true, production: true, qa: true }), false);
  assert.equal(packWalkoutAllowed({ rollout: "admins", admin: null, devOptIn: true, production: true, qa: true }), false);
  const src = read("src/components/packs/PackOpeningExperience.tsx");
  assert.match(src, /if \(process\.env\.NODE_ENV === "production"\) return;\s*\n\s*try \{ setDevOptIn\(window\.localStorage/);
});

test("D03 · /admin/walkout: protegida por el layout de /admin y sin ningún camino hacia la economía", () => {
  const page = read("src/app/admin/walkout/page.tsx");
  assert.match(read("src/app/admin/layout.tsx"), /<AdminGuard>/);
  for (const banned of [/useGameStore/, /lib\/game\/sync/, /openPackOutcome/, /\bfetch\(/, /\/api\//, /PackOpeningExperience/, /localStorage/]) {
    assert.ok(!banned.test(page), `la vista previa no debe usar ${banned}`);
  }
  assert.match(page, /packWalkoutQueue\(buildRevealPlan\(toOpenedInstances\(f81Results\(/, "misma cola que la apertura real");
});

test("D04 · assets del walkout: relativos, presentes en public/ y con licencia", () => {
  const human = read("src/components/walkout/human3d.ts");
  const urls = [...human.matchAll(/"(\/walkout\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(urls.length >= 2, "rutas de los modelos");
  for (const u of urls) assert.ok(existsSync(join(process.cwd(), "public", u)), `${u} existe en public/`);
  for (const f of readdirSync(join(process.cwd(), "public/walkout/human")).filter((n) => n.endsWith(".gltf"))) {
    const g = JSON.parse(read(`public/walkout/human/${f}`)) as { buffers?: { uri?: string }[]; images?: { uri?: string }[] };
    for (const r of [...(g.buffers ?? []), ...(g.images ?? [])]) {
      if (!r.uri) continue;
      assert.ok(!/^(https?:|file:|[a-z]:\\|\/)/i.test(r.uri), `${f}: ${r.uri} debe ser relativo`);
      assert.ok(existsSync(join(process.cwd(), "public/walkout/human", r.uri)), `${f}: falta ${r.uri}`);
    }
  }
  assert.ok(existsSync(join(process.cwd(), "public/walkout/human/LICENSE-ASSETS.txt")));
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : /\.tsx?$/.test(e.name) && !e.name.includes(".test.") ? [join(d, e.name)] : []);
  for (const f of [...walk(join(process.cwd(), "src/components/walkout")), ...walk(join(process.cwd(), "src/lib/walkout")), join(process.cwd(), "src/components/packs/PackWalkout.tsx")]) {
    assert.ok(!/localhost|127\.0\.0\.1|[A-Z]:\\\\/.test(readFileSync(f, "utf8")), `${f} sin localhost ni rutas de Windows`);
  }
});

test("D05 · metadataBase = origen público (NEXT_PUBLIC_SITE_URL)", () => {
  assert.match(read("src/app/layout.tsx"), /metadataBase: siteOrigin\(\)/);
  assert.match(read("src/app/layout.tsx"), /new URL\(process\.env\.NEXT_PUBLIC_SITE_URL\)/);
});

test("D06 · stage3d no usa PCFSoftShadowMap", () => {
  assert.ok(!/THREE.PCFSoftShadowMap/.test(read("src/components/walkout/stage3d.ts")));
  assert.match(read("src/components/walkout/stage3d.ts"), /shadowMap.type = THREE.PCFShadowMap/);
});

test("D07 · /admin/walkout se pinta: una escena por cada una del arnés, con su número real de walkouts y el estado del interruptor", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { default: Page } = await import("@/app/admin/walkout/page");
  const { WALKOUT_SCENES, f81Results } = await import("@/app/design-system/fase81/fixtures");
  const { buildRevealPlan, toOpenedInstances } = await import("@/domain/packs/reveal");
  const { packWalkoutQueue } = await import("@/domain/walkout/packWalkout");
  const { CARDS, getCard, getPlayer } = await import("@/data/catalog");
  const html = renderToStaticMarkup(createElement(Page));
  assert.match(html, /data-rollout="all"/);
  assert.match(html, /ALL — todos los jugadores/);
  assert.ok(!/admin-walkout-stage/.test(html), "nada se reproduce hasta elegir escena");
  for (const s of Object.keys(WALKOUT_SCENES) as (keyof typeof WALKOUT_SCENES)[]) {
    const n = packWalkoutQueue(buildRevealPlan(toOpenedInstances(f81Results(s)), null, { cards: CARDS, getCard, getPlayer }).order).length;
    assert.match(html, new RegExp(`data-testid="admin-walkout-scene-${s}"`), s);
    assert.ok(html.includes(n === 0 ? "sin especiales (apertura de siempre)" : `${n} walkout${n === 1 ? "" : "s"}`), `${s}: ${n}`);
  }
});
