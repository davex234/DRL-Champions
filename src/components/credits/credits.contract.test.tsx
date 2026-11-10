import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { PAYMENTS_ENABLED } from "@/config/monetization";
import { activeProducts } from "@/domain/economy/drlCredits";
import { sandboxCreditsEnabled } from "@/server/services/credits";
import { CreditPackCard, CreditsHero } from "./CreditsPieces";
import { packBadge } from "./creditsView";

/**
 * DRL CREDITS · CONTRATO (Fase 49.1). La página se ve como una tienda, pero no cobra, no concede y no inventa
 * precios mientras no exista pasarela.
 */
const read = (...p: string[]) => readFileSync(join(process.cwd(), "src", ...p), "utf8");
const PAGE = read("app", "tienda", "creditos", "page.tsx");
const PIECES = read("components", "credits", "CreditsPieces.tsx");
const products = activeProducts();

test("PAGOS · siguen apagados, y la pantalla no llama a ninguna compra ni devolución de créditos", () => {
  assert.equal(PAYMENTS_ENABLED, false);
  // Solo el código: los comentarios explican precisamente que estas vías NO se usan.
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const src of [code(PAGE), code(PIECES)]) {
    assert.ok(!/purchaseCredits|refundCredits|sandboxPurchase|sandboxRefund/.test(src), "la interfaz no concede créditos");
    assert.ok(!/fetch\(\s*["'`]\/api\/game\/credits["'`]\s*,\s*\{\s*method:\s*["']POST/.test(src));
  }
  assert.match(PAGE, /paymentsOpen=\{PAYMENTS_ENABLED\}/, "los botones dependen del interruptor real");
  // Y la guarda de la Fase 18.1: sin `sandbox: true` del servidor, no hay catálogo.
  assert.match(PAGE, /view\.sandbox !== true/);
});

test("PRODUCCIÓN · la compra de prueba del servidor NUNCA se abre en una build de producción", () => {
  assert.equal(sandboxCreditsEnabled({ NEXUS_SANDBOX_CREDITS: "1", NODE_ENV: "production" }), false);
  assert.equal(sandboxCreditsEnabled({ NODE_ENV: "production" }), false);
  assert.equal(sandboxCreditsEnabled({}), false);
  // Solo en pruebas locales explícitas (el fuzzer económico la usa).
  assert.equal(sandboxCreditsEnabled({ NEXUS_SANDBOX_CREDITS: "1", NODE_ENV: "test" }), true);
});

test("PAQUETE · cantidad real como texto, su imagen propia, «€ · Por anunciar» y «Próximamente» desactivado", () => {
  for (const [i, p] of products.entries()) {
    const html = renderToStaticMarkup(<CreditPackCard product={p} badge={packBadge(p, products)} index={i} paymentsOpen={PAYMENTS_ENABLED} />);
    const amount = new Intl.NumberFormat("es-ES", { useGrouping: "always" }).format(p.credits);
    assert.ok(html.includes(`>${amount}<`), `${p.productId}: la cantidad ${amount} existe como texto`);
    assert.ok(html.includes(`src="/store/credits/${p.productId.replace("drlc-", "")}.webp"`), `${p.productId}: su arte`);
    assert.match(html, /loading="lazy"/);
    assert.match(html, /alt="[^"]*DRL Credits: /);
    assert.match(html, /Por anunciar/);
    assert.match(html, /<button[^>]*disabled=""[^>]*>Próximamente<\/button>/);
    assert.ok(!/\d+,\d{2}\s*€|€\s*\d/.test(html), `${p.productId}: precio en euros inventado`);
    assert.ok(!/line-through|<s>|<del>/.test(html), `${p.productId}: precio tachado`);
    assert.ok(!/Cerrada/.test(html));
  }
});

test("HÉROE · saldo como texto real, arte con prioridad y el aviso de pagos visible antes de cualquier acción", () => {
  const html = renderToStaticMarkup(<CreditsHero balance={7260} balanceLabel="Tu saldo" />);
  assert.match(html, /7\.260/);
  assert.match(html, /src="\/store\/credits\/hero\.webp"/);
  assert.match(html, /fetchPriority="high"|fetchpriority="high"/i);
  assert.match(html, /Pagos con dinero real: próximamente\./);
  assert.match(html, /Hoy no se cobra nada/);
  // Nada de afirmaciones de pago que hoy serían falsas.
  assert.ok(!/Compra segura|Pago seguro|Acreditación instantánea/i.test(html));
});

test("ANTI-GRAMÁTICA · sin tamaños fuera de escala, z-index arbitrarios ni hex sueltos en las piezas", () => {
  const body = PIECES.split("*/").slice(1).join("*/");
  assert.ok(!/text-\[\d+(\.\d+)?px\]/.test(body));
  assert.ok(!/z-\[\d+\]/.test(body));
  assert.deepEqual(body.match(/#[0-9a-fA-F]{6}\b/g) ?? [], []);
});
