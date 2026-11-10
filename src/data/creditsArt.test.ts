import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CREDITS_ART } from "./creditsArt";
import { activeProducts, CREDIT_PRODUCTS } from "@/domain/economy/drlCredits";
import { creditsArtFor, packBadge, CREDITS_HERO_ART } from "@/components/credits/creditsView";

/**
 * DRL CREDITS · LA REGLA VISUAL (Fase 49.1): cuantos más créditos, más monedas. Si alguien cambia un asset de
 * paquete, reordena el catálogo o regenera el arte, esto dice si la imagen sigue contando la verdad.
 */
const products = activeProducts();

test("CANTIDADES · los cinco paquetes siguen siendo 1.000 / 2.800 / 5.000 / 13.500 / 28.000", () => {
  assert.deepEqual(products.map((p) => [p.productId, p.credits]), [
    ["drlc-starter", 1000], ["drlc-basic", 2800], ["drlc-popular", 5000], ["drlc-large", 13500], ["drlc-ultimate", 28000],
  ]);
});

test("ARTE · cada paquete tiene SU imagen (por id), existe, es WebP y pesa poco", () => {
  const files = new Set<string>();
  for (const p of products) {
    const art = creditsArtFor(p.productId);
    assert.ok(art, `${p.productId}: sin arte`);
    assert.equal(art!.file, `/store/credits/${p.productId.replace("drlc-", "")}.webp`);
    assert.ok(!files.has(art!.file), `${art!.file} repetido`);
    files.add(art!.file);
    const path = join(process.cwd(), "public", art!.file);
    assert.ok(existsSync(path), path);
    assert.equal(readFileSync(path).subarray(8, 12).toString("ascii"), "WEBP");
    assert.equal(statSync(path).size, art!.bytes, `${art!.file}: el manifiesto no es el del fichero (regenera)`);
    assert.ok(art!.bytes < 150 * 1024, `${art!.file}: ${art!.bytes} bytes`);
  }
  assert.ok(existsSync(join(process.cwd(), "public", CREDITS_HERO_ART.file)));
  assert.ok(CREDITS_HERO_ART.bytes < 400 * 1024);
});

test("PROGRESIÓN · más créditos ⇒ ESTRICTAMENTE más monedas; cofre en Large y cofre premium en Ultimate", () => {
  const byCredits = [...products].sort((a, b) => a.credits - b.credits).map((p) => creditsArtFor(p.productId)!);
  for (let i = 1; i < byCredits.length; i++) {
    assert.ok(byCredits[i].coins > byCredits[i - 1].coins, `${byCredits[i].id} (${byCredits[i].coins}) no supera a ${byCredits[i - 1].id} (${byCredits[i - 1].coins})`);
  }
  // Y a simple vista: el mayor tiene muchísimas más que el menor.
  assert.ok(byCredits.at(-1)!.coins >= byCredits[0].coins * 20);
  assert.deepEqual(byCredits.map((a) => a.chest), ["none", "none", "none", "standard", "premium"]);
});

test("ETIQUETAS · «Más elegido» es la del catálogo y «Mayor paquete» se deriva del de más créditos", () => {
  const badges = Object.fromEntries(products.map((p) => [p.productId, packBadge(p, products)]));
  assert.equal(badges["drlc-popular"], "Más elegido");
  assert.equal(badges["drlc-ultimate"], "Mayor paquete");
  assert.equal(badges["drlc-starter"], null);
  assert.equal(CREDIT_PRODUCTS.filter((p) => p.active).length, 5);
});
