/**
 * FASE 68 · CLOSED BETA — regresiones de la guía encontradas jugando (render estático con datos del catálogo REAL).
 *
 * BUG F68-001: en el resumen de un Sobre Inicial la guía proponía «Abrir el siguiente sobre» con un ENLACE a
 * `/abrir/inicial`, la URL en la que ya estaba el jugador. Next no vuelve a montar la página por un enlace a la misma
 * ruta: el botón no hacía nada y la primera sesión quedaba atascada (el instrumento de F63 lo tapaba navegando por URL).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { DUEL_ROLES } from "@/domain/cardgame";
import { buildOnboarding, NO_FLAGS, type OnboardingFlags } from "@/domain/onboarding";
import type { JourneyFacts, RoleShortage } from "@/domain/journey";
import { OnboardingPackNext } from "./FirstCardLesson";
import { isSameRoute } from "./OnboardingKit";

const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} } as never;
const R = (el: React.ReactElement) => renderToStaticMarkup(<AppRouterContext.Provider value={router}>{el}</AppRouterContext.Provider>);
const NOW = Date.parse("2026-09-27T12:00:00Z");
const roles = (have: number): RoleShortage[] => DUEL_ROLES.map((role) => ({ role, have, need: 2 }));
const J = (o: Partial<JourneyFacts> = {}): JourneyFacts => ({
  ownedCards: 0, packsOpened: 0, matchesCompleted: 0, unopenedPacks: 4, firstPackId: "inicial",
  decks: { total: 0, valid: 0, firstInvalid: null }, readyDeck: null, readiness: { ready: false, dataVersion: null, roles: roles(0), shortages: roles(0) }, ...o,
});
const view = (j: Partial<JourneyFacts> = {}, f: Partial<OnboardingFlags> = {}) =>
  buildOnboarding({ journey: J(j), flags: { ...NO_FLAGS, ...f }, starter: { credits: 6000, packs: [{ packId: "estandar", qty: 1 }, { packId: "inicial", qty: 3 }] } });
// Estado real medido en la beta: 2 sobres abiertos (Bronce + 1 Inicial), quedan 2 Iniciales.
const midPacks = () => view({ packsOpened: 2, ownedCards: 10, unopenedPacks: 2 }, { startedAt: NOW });

test("F68 B001 · la guía propone abrir OTRO Sobre Inicial: su destino es /abrir/inicial (la misma pantalla del resumen)", () => {
  const v = midPacks();
  assert.equal(v.current, "collection");
  assert.equal(v.next?.href, "/abrir/inicial");
});

test("F68 B001 · en /abrir/inicial el paso siguiente es un BOTÓN que reinicia la ceremonia, no un enlace muerto a la misma URL", () => {
  const h = R(<OnboardingPackNext view={midPacks()} here={{ href: "/abrir/inicial", run: () => undefined }} />);
  assert.match(h, /<button[^>]*data-testid="onboarding-cta"[^>]*data-here=""/);
  assert.ok(!/href="\/abrir\/inicial"/.test(h), "ningún enlace a la pantalla actual");
});

test("F68 B001 · desde OTRA pantalla (u otro sobre) sigue siendo un enlace normal", () => {
  assert.match(R(<OnboardingPackNext view={midPacks()} />), /href="\/abrir\/inicial"[^>]*data-testid="onboarding-cta"|data-testid="onboarding-cta"[^>]*href="\/abrir\/inicial"/);
  assert.match(R(<OnboardingPackNext view={midPacks()} here={{ href: "/abrir/estandar", run: () => undefined }} />), /href="\/abrir\/inicial"/);
});

test("F68 B001 · isSameRoute ignora query, hash y barra final; sin `here` nunca es la misma ruta", () => {
  const here = { href: "/abrir/inicial", run: () => undefined };
  assert.equal(isSameRoute("/abrir/inicial", here), true);
  assert.equal(isSameRoute("/abrir/inicial/", here), true);
  assert.equal(isSameRoute("/abrir/inicial?x=1#y", here), true);
  assert.equal(isSameRoute("/abrir/estandar", here), false);
  assert.equal(isSameRoute("/abrir/inicial", undefined), false);
});

test("F68 B001 · contrato: la pantalla de apertura pasa su bucle «abrir otro» a las dos piezas de la guía", () => {
  const src = readFileSync(join(process.cwd(), "src/components/packs/PackOpeningExperience.tsx"), "utf8");
  assert.match(src, /<FirstCardLesson card=\{best\.card\} view=\{guide\} here=\{guideHere\} \/>/);
  assert.match(src, /<OnboardingPackNext view=\{guide\} here=\{guideHere\} \/>/);
  assert.match(src, /guideHere = useMemo\(\(\) => \(\{ href: `\/abrir\/\$\{packId\}`, run: \(\) => reopenRef\.current\(\) \}\)/);
  assert.match(src, /reopenRef\.current = openAnother;/);
});
