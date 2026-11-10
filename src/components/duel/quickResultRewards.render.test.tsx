/**
 * DUEL GAMEPLAY UX 2.0 → RESULTADO ÚNICO · las recompensas del resultado, en UNA línea compacta.
 *
 *   · se pinta SOLO desde el recibo del servidor (`result.rewards.grants`); créditos y XP sumados por asiento;
 *   · lo que no es créditos ni XP (sobre ×N con su arte real, carta, insignia) va en la misma línea con `RewardDisplay`;
 *   · cero recompensas (sin recibo, recibo vacío, partida topada) → la línea NO existe;
 *   · con recibo, la tabla de premios (`award`) no se lee.
 * Las cifras de ejemplo son FIXTURES de prueba, no premios del juego.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MotionConfig } from "framer-motion";
import { QuickMatchResult } from "./QuickMatchResult";
import { fase45Fixtures } from "@/app/design-system/fase45/fixtures";
import { PACKS } from "@/data/packs";
import { packArtwork } from "@/data/packArtwork";
import { CARDS } from "@/data/catalog";
import type { DuelMatchView, MatchRewardReceipt } from "@/lib/duel/types";

const fx = fase45Fixtures();
const noop = () => {};
const withReceipt = (v: DuelMatchView, rewards: MatchRewardReceipt | null | undefined): DuelMatchView =>
  ({ ...v, context: "QUICK", result: { ...v.result!, rewards } });
const html = (v: DuelMatchView) =>
  renderToStaticMarkup(<MotionConfig reducedMotion="never"><QuickMatchResult view={v} onContinue={noop} /></MotionConfig>);
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const PACK = PACKS.find((p) => packArtwork(p.id))!;
const CARD = CARDS.find((c) => c.image)!;

test("UX2 QRR-1 · victoria con recibo: una línea con los créditos y la XP del recibo", () => {
  const h = html(withReceipt(fx.win, { matchId: fx.win.matchId, capped: false, grants: [{ source: "MATCH", reward: { credits: 120, xp: 40 }, points: 0 }] }));
  assert.ok(h.includes('data-testid="duel-result-rewards"'));
  const t = text(h);
  assert.ok(!/Recompensas obtenidas/i.test(t), "sin titular de bloque: la línea se explica sola");
  assert.ok(t.includes("+120") && h.includes('data-field="credits"') && /Créditos/.test(t));
  assert.ok(t.includes("+40") && h.includes('data-field="xp"') && /\bXP\b/.test(t));
  assert.equal((h.match(/<(a|button)\b/g) ?? []).length, 3, "las recompensas no añaden acciones");
});

test("UX2 QRR-1b · varios asientos (partida + primera victoria de campaña): créditos sumados en una sola cifra", () => {
  const h = html(withReceipt(fx.win, { matchId: fx.win.matchId, capped: false, grants: [
    { source: "MATCH", reward: { credits: 120, xp: 40 }, points: 0 },
    { source: "CAMPAIGN_FIRST_CLEAR", reward: { credits: 300 }, points: 0 },
  ] }));
  assert.ok(text(h).includes("+420"));
});

test("UX2 QRR-2 · sobre (arte REAL ×N), carta (CardArt) e insignia (texto)", () => {
  const h = html(withReceipt(fx.win, {
    matchId: fx.win.matchId, capped: false,
    grants: [{ source: "CAMPAIGN_FIRST_CLEAR", reward: { packId: PACK.id, packCount: 2, cardId: CARD.id, cosmetics: ["insignia:torneo"] }, points: 0 }],
  }));
  assert.ok(h.includes(`data-pack-art="${PACK.id}"`) && h.includes(`src="${packArtwork(PACK.id)}"`), "arte real del sobre");
  assert.ok(h.includes("×2"));
  assert.ok(h.includes('data-reward-item="card"'));
  assert.ok(h.includes('data-reward-item="cosmetic"'));
});

test("UX2 QRR-3 · derrota con recibo: también se enseña lo concedido", () => {
  const h = html(withReceipt(fx.loss, { matchId: fx.loss.matchId, capped: false, grants: [{ source: "MATCH", reward: { credits: 25, xp: 10 }, points: 0 }] }));
  assert.ok(h.includes('data-kind="loss"') && h.includes('data-testid="duel-result-rewards"'));
});

for (const [name, rewards] of [
  ["sin recibo (fallo de lectura)", null],
  ["recibo antiguo (sin campo)", undefined],
  ["recibo vacío", { matchId: "m", capped: false, grants: [] }],
  ["partida topada por el cupo", { matchId: "m", capped: true, grants: [] }],
] as const) {
  test(`UX2 QRR-4 · cero recompensas → NO hay sección: ${name}`, () => {
    const h = html(withReceipt(fx.win, rewards as MatchRewardReceipt | null | undefined));
    assert.ok(!h.includes("duel-result-rewards"));
    assert.ok(!/Recompensa|Créditos/i.test(text(h)));
    assert.ok(!h.includes("Sin recompensa"));
  });
}

test("UX2 QRR-5 · la línea sale del recibo, nunca de la tabla (`award`)", () => {
  const h = html({ ...withReceipt(fx.win, null), result: { ...fx.win.result!, rewards: null, award: { points: 9, credits: 999, xp: 99 } } });
  assert.ok(!h.includes("999"), "una cifra de la tabla no se pinta");
  const capped = html({ ...withReceipt(fx.win, null), result: { ...fx.win.result!, rewards: { matchId: "m", capped: true, grants: [] }, award: { points: 9, credits: 999, xp: 99 } } });
  assert.ok(!capped.includes("999"), "partida topada: el recibo vacío manda");
  const src = readFileSync(join(process.cwd(), "src", "lib", "duel", "resultSummary.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(src.includes("r?.rewards?.grants") && !/\baward\b/.test(src));
});
