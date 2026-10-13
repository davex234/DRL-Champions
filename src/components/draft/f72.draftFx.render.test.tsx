/**
 * F72 · DRAFT CON ESPECTÁCULO SIN TAPAR LA CARTA + MOVIMIENTO REDUCIDO.
 *
 * «The card is the asset»: dentro del botón de cada opción solo está la cara canónica (`PlayerCard`); aura, anillo,
 * chispas y luz de suelo son hermanos DETRÁS (`-z-10`, sin eventos). La presencia sale de la rareza REAL de la edición
 * y no toca datos. Con movimiento reducido no hay chispas y la transición de página no deja `transform` (que rompía
 * la barra `fixed` de CONFIRMAR en el Chrome del usuario, que reporta `prefers-reduced-motion: reduce`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { DraftOption, DRAFT_PRESENCE, draftPresence } from "./DraftCards";
import { getCard, getPlayer, CARDS } from "@/data/catalog";
import { draftCardDTO } from "@/domain/draft/snapshot";
import { CardRegistry } from "@/collection/registry";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const REG = new CardRegistry();
const dto = (id: string) => draftCardDTO(id, REG)!;

test("F72 FX1 · dentro del botón de la carta solo está la carta: los efectos van DETRÁS (hermanos, -z-10, sin eventos)", () => {
  const card = dto(CARDS[0].id);
  const h = renderToStaticMarkup(<DraftOption card={card} index={0} selected dimmed={false} disabled={false} onSelect={() => undefined} />);
  const btn = h.match(/<button[^>]*aria-label="Opción 1:[^"]*"[^>]*>([\s\S]*?)<\/button>/);
  assert.ok(btn, "la carta es el botón");
  assert.ok(!/draft-aura|draft-sparks|rounded-\[50%\]/.test(btn![1]), "ningún efecto dentro de la carta");
  const aura = h.match(/<span[^>]*data-testid="draft-aura"[^>]*>/)![0];
  assert.match(aura, /pointer-events-none/);
  assert.match(aura, /-z-10/);
  assert.ok(h.indexOf('data-testid="draft-aura"') < h.indexOf('aria-label="Opción 1:'), "el aura se pinta antes (detrás) de la carta");
});

test("F72 FX2 · la presencia escala con la rareza REAL de la edición y no toca OVR ni stats", () => {
  const order = ["common", "uncommon", "rare", "epic", "legendary"] as const;
  for (let i = 1; i < order.length; i++) assert.ok(DRAFT_PRESENCE[order[i]].aura > DRAFT_PRESENCE[order[i - 1]].aura);
  assert.equal(DRAFT_PRESENCE.common.spark, 0);
  const c = CARDS.find((x) => getCard(x.id) && getPlayer(x.playerId))!;
  const before = JSON.stringify(dto(c.id));
  draftPresence(c.variantId);
  assert.equal(JSON.stringify(dto(c.id)), before);
  // Solo presentación: el módulo de efectos no conoce probabilidades, pool ni stats.
  const src = read("src/components/draft/DraftCards.tsx");
  assert.ok(!/odds|weight|pool\b|statBoost|\.ovr\s*=|combat\[[^\]]+\]\s*=/.test(src.slice(src.indexOf("export const DRAFT_PRESENCE"), src.indexOf("export function RosterStrip"))));
});

test("F72 FX3 · movimiento reducido: sin chispas continuas y la transición de página vuelve a la identidad (no rompe `fixed`)", () => {
  const cards = read("src/components/draft/DraftCards.tsx");
  assert.match(cards, /const reduced = useReducedMotion\(\);\s+if \(reduced \|\| n === 0\) return null;/);
  const screen = read("src/components/draft/DraftGauntletScreen.tsx");
  assert.ok(screen.includes('<MotionConfig reducedMotion="user">'));
  const pt = read("src/components/layout/PageTransition.tsx");
  assert.ok(pt.includes("const IDENTITY = { y: 0, scale: 1 } as const;"));
  assert.ok(pt.includes("animate={reduced ? { ...m.animate, ...IDENTITY } : m.animate}"));
  const hub = read("src/components/modes/DuelModesHub.tsx");
  assert.ok(hub.includes('<MotionConfig reducedMotion="user">'));
});

test("F72 FX4 · ninguna luz con silueta de caja detrás de la carta (aura, pulso y suelo son elipses)", () => {
  const src = read("src/components/draft/DraftCards.tsx");
  const fx = src.slice(src.indexOf("export function DraftOption"), src.indexOf("export function RosterStrip"));
  assert.ok(!/boxShadow/.test(fx), "sin box-shadow (dibuja un rectángulo)");
  for (const id of ["draft-aura", "draft-pulse"]) assert.ok(new RegExp(`data-testid="${id}"[^>]*`).exec(fx)?.[0].includes("rounded-[50%]"), id);
});
