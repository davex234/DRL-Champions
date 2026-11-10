/**
 * DUEL GAMEPLAY UX 2.0 · «RECOMPENSAS OBTENIDAS» en el resultado mínimo.
 *
 *   · se pinta SOLO desde el recibo del servidor (`result.rewards.grants`), con la pieza común `RewardDisplay`;
 *   · créditos (moneda real), XP de cuenta, sobre (arte real ×N), carta (CardArt) e insignia (texto);
 *   · cero recompensas (sin recibo, recibo vacío, partida topada) → la sección NO existe;
 *   · la tabla de premios (`award`) no se lee aquí.
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

test("UX2 QRR-1 · victoria con recibo: «Recompensas obtenidas» con créditos y XP de cuenta del recibo", () => {
  const h = html(withReceipt(fx.win, { matchId: fx.win.matchId, capped: false, grants: [{ source: "MATCH", reward: { credits: 120, xp: 40 }, points: 0 }] }));
  assert.ok(h.includes('data-testid="quick-result-rewards"'));
  const t = text(h);
  assert.ok(/Recompensas obtenidas/i.test(t));
  assert.ok(t.includes("+120") && h.includes('data-reward-item="credits"'));
  assert.ok(h.includes('data-reward-item="accountXp"') && /XP de cuenta/.test(t), "XP siempre con su nombre");
  assert.equal((h.match(/<(a|button)\b/g) ?? []).length, 2, "las recompensas no añaden acciones");
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
  assert.ok(h.includes('data-kind="loss"') && h.includes('data-testid="quick-result-rewards"'));
});

for (const [name, rewards] of [
  ["sin recibo (fallo de lectura)", null],
  ["recibo antiguo (sin campo)", undefined],
  ["recibo vacío", { matchId: "m", capped: false, grants: [] }],
  ["partida topada por el cupo", { matchId: "m", capped: true, grants: [] }],
] as const) {
  test(`UX2 QRR-4 · cero recompensas → NO hay sección: ${name}`, () => {
    const h = html(withReceipt(fx.win, rewards as MatchRewardReceipt | null | undefined));
    assert.ok(!h.includes("quick-result-rewards"));
    assert.ok(!/Recompensa/i.test(text(h)));
    assert.ok(!h.includes("Sin recompensa"));
  });
}

test("UX2 QRR-5 · la sección sale del recibo, nunca de la tabla (`award`)", () => {
  const h = html({ ...withReceipt(fx.win, null), result: { ...fx.win.result!, rewards: null, award: { points: 9, credits: 999, xp: 99 } } });
  assert.ok(!h.includes("999"), "una cifra de la tabla no se pinta");
  const src = readFileSync(join(process.cwd(), "src", "components", "duel", "QuickMatchResult.tsx"), "utf8");
  assert.ok(src.includes("r.rewards.grants") && !src.includes("award"));
});
