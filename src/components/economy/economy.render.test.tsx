/**
 * FASE 41 · ECONOMÍA EN PANTALLA — render de la CTA de sobres, del aviso de tienda cerrada, de las escenas del arnés y
 * contratos de fuente (páginas usan las piezas compartidas; nada de valor de colección, venta ni mercado).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { PackPurchaseCta, packCtaState } from "./PackPurchaseCta";
import { CreditsClosedNotice } from "./CreditsClosedNotice";
import { getPack } from "@/data/packs";
import { formatCredits } from "@/lib/format";
import { ctaKindFor } from "@/components/packs/packCatalog";
import { starterOffer } from "@/lib/economy/starterOffer";
import { DailyLobby } from "@/components/dailyLoop/DailyLobby";
import { buildDailyLoop } from "@/domain/dailyLoop";
import { CARDS, getPlayer } from "@/data/catalog";
import { welcomeCards } from "@/lib/journey/presentation";
import { FASE41_SCENES, SCENES, type HomeScene, type PackScene } from "@/app/design-system/fase41/fixtures";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const noop = () => {};

const renderPack = (name: string) => {
  const s = SCENES[name as keyof typeof SCENES] as PackScene;
  const pack = getPack(s.packId)!;
  const offer = pack.id === "inicial" ? starterOffer({ owned: s.owned, online: s.online, status: s.status }) : null;
  return renderToStaticMarkup(<PackPurchaseCta pack={pack} cta={ctaKindFor(pack)} credits={s.credits} owned={s.owned} offer={offer} busy={false} onAction={noop} />);
};

test("arnés: ≥ 30 escenas, todas con fixture", () => {
  assert.ok(FASE41_SCENES.length >= 30);
  for (const s of FASE41_SCENES) assert.ok(SCENES[s], s);
});

for (const name of FASE41_SCENES.filter((s) => SCENES[s].kind === "pack")) {
  test(`CTA de sobre renderiza · ${name}`, () => {
    const h = renderPack(name);
    assert.match(h, /data-testid="pack-cta"/);
    assert.doesNotMatch(h, /valor de colección|vender|venta rápida|mercado/i);
  });
}

test("starter elegible: botón habilitado «Conseguir Sobre Inicial gratis» y copia del encargo", () => {
  const h = renderPack("starter-claim");
  assert.match(h, /Conseguir Sobre Inicial gratis/);
  assert.doesNotMatch(h, /disabled=""/);
  assert.match(h, /Consigue las cartas que te faltan para completar tu equipo\./);
});

test("starter ya no necesario / tope: botón desactivado con motivo", () => {
  for (const [name, re] of [["starter-not-needed", /ya no es necesario/], ["starter-cap", /Sobre Estándar/]] as const) {
    const h = renderPack(name);
    assert.match(h, /disabled=""/); assert.match(h, re);
  }
});

test("saldo insuficiente: cuánto falta y cómo se gana, sin enlace a la tienda de créditos", () => {
  const h = renderPack("pack-insufficient");
  assert.match(h, new RegExp(`Te faltan ${formatCredits(getPack("estandar")!.price - 420)} créditos`)); // fixture: 420 de saldo
  assert.match(h, /Se ganan jugando/);
  assert.doesNotMatch(h, /tienda\/creditos/);
});

test("estado puro de la CTA: comprar/insuficiente/poseído/evento", () => {
  const est = getPack("estandar")!;
  assert.equal(packCtaState({ pack: est, cta: "buy", credits: est.price, owned: 0, offer: null }).label, "Comprar y abrir");
  assert.equal(packCtaState({ pack: est, cta: "buy", credits: est.price - 1, owned: 0, offer: null }).insufficient, true);
  assert.equal(packCtaState({ pack: est, cta: "buy", credits: 0, owned: 1, offer: null }).label, "Abrir sobre");
  assert.equal(packCtaState({ pack: getPack("masters")!, cta: "event", credits: 0, owned: 0, offer: null }).label, "Ver en eventos");
});

test("tienda de créditos cerrada: aviso con rol status", () => {
  const h = renderToStaticMarkup(<CreditsClosedNotice currency="DRL Credits" />);
  assert.match(h, /role="status"/); assert.match(h, /se ganan jugando/);
});

test("vestíbulo · paso colecciona sin sobres: copia nueva del recorrido", () => {
  const s = SCENES["home-collect-starter"] as HomeScene;
  const h = renderToStaticMarkup(<DailyLobby snap={buildDailyLoop(s.facts)} now={s.facts.now} network="online" journeyDismissed={false} welcomeCards={welcomeCards(CARDS, getPlayer)} />);
  assert.match(h, /Consigue las cartas que te faltan para completar tu equipo\./);
  assert.match(h, /Conseguir Sobre Inicial gratis/);
});

test("vestíbulo · plantilla posible: ya no ofrece Sobre Inicial gratis", () => {
  const s = SCENES["home-deck-ready"] as HomeScene;
  const h = renderToStaticMarkup(<DailyLobby snap={buildDailyLoop(s.facts)} now={s.facts.now} network="online" journeyDismissed={false} welcomeCards={welcomeCards(CARDS, getPlayer)} />);
  assert.doesNotMatch(h, /Conseguir Sobre Inicial gratis/);
});

test("contrato: la ficha de sobre usa la CTA compartida y pregunta al servidor por el Sobre Inicial", () => {
  const page = read("src/app/packs/[packId]/page.tsx");
  assert.match(page, /<PackPurchaseCta /);
  assert.match(page, /fetchStarterStatus\(\)/);
  assert.match(page, /starterOffer\(\{ owned, online, status: starter \}\)/);
});

test("contrato: la ruta de estado del starter es GET puro (sin POST) y sale del token", () => {
  const route = read("src/app/api/game/starter/route.ts");
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.match(route, /readStarterStatus\(session\.admin, session\.userId\)/);
});

test("contrato: la ruta de sobres sigue siendo solo POST y su cuerpo no cambia", () => {
  const route = read("src/app/api/game/packs/route.ts");
  assert.doesNotMatch(route, /export async function GET/);
  // ICON (2026-10-09) · `expectedPrice` (el precio visto) solo puede bloquear el cobro, nunca decidirlo.
  assert.match(route, /const ALLOWED = \["action", "packId", "ref", "expectedPrice"\];/);
});

test("contrato: la tienda de créditos exige el interruptor de servidor para conceder", () => {
  const svc = read("src/server/services/credits.ts");
  assert.match(svc, /if \(!sandboxCreditsEnabled\(\)\) return fail\(SANDBOX_CLOSED, 403\);/);
  assert.match(svc, /env\.NEXUS_SANDBOX_CREDITS === "1"/);
});
