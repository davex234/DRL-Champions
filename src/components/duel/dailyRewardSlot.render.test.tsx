/**
 * CORE GAME LOOP · el cupo diario: del recibo del servidor (`rewards.daily`), neutral, y nada sin dato.
 *
 * RESULTADO ÚNICO · el resultado solo lo dice cuando EXPLICA la ausencia de recompensa (tope agotado); el cupo normal
 * («k de 20 hoy») ya no se enseña en el resultado. El texto (`dailyRewardText`) no cambia.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MotionConfig } from "framer-motion";
import { QuickMatchResult } from "./QuickMatchResult";
import { DailyRewardSlot, dailyRewardText } from "./DailyRewardSlot";
import { fase45Fixtures } from "@/app/design-system/fase45/fixtures";
import type { DuelMatchView, MatchRewardReceipt } from "@/lib/duel/types";

const fx = fase45Fixtures();
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const quick = (rewards: MatchRewardReceipt | null | undefined) => renderToStaticMarkup(
  <MotionConfig reducedMotion="never"><QuickMatchResult view={{ ...fx.win, context: "QUICK", result: { ...fx.win.result!, rewards } } as DuelMatchView} onContinue={() => {}} /></MotionConfig>,
);

test("CL-D1 · cupo ocupado: el resultado enseña la recompensa y NO el contador del cupo (mensaje secundario)", () => {
  const h = quick({ matchId: "m", capped: false, grants: [{ source: "MATCH", reward: { credits: 220, xp: 110 }, points: 14 }], daily: { slot: 7, cap: 20 } });
  assert.ok(h.includes('data-testid="duel-result-rewards"'));
  assert.ok(!h.includes('data-testid="daily-reward-slot"'));
  assert.doesNotMatch(text(h), /Partida con recompensa 7 de 20 hoy/);
  // El texto, si se enseña, sigue siendo neutral.
  assert.doesNotMatch(dailyRewardText({ slot: 7, cap: 20 }).line, /te quedan|solo quedan|¡|date prisa|no te lo pierdas/i);
});

test("CL-D2 · tope agotado: lo dice, dice que se puede seguir jugando y cuándo vuelve (sin bloque de recompensas)", () => {
  const h = quick({ matchId: "m", capped: true, grants: [], daily: { slot: null, cap: 20 } });
  assert.ok(!h.includes("duel-result-rewards"), "nada concedido → no hay recompensas");
  assert.ok(h.includes('data-capped="true"'));
  const t = text(h);
  assert.match(t, /Tope diario alcanzado: 20 partidas con recompensa/);
  assert.match(t, /Puedes seguir jugando/);
  assert.match(t, /00:00 UTC/);
});

test("CL-D3 · sin dato del servidor (Draft, PvP, partida antigua, lectura fallida) no se pinta nada", () => {
  for (const r of [null, undefined, { matchId: "m", capped: false, grants: [] }] as const) {
    assert.equal(renderToStaticMarkup(<DailyRewardSlot receipt={r as MatchRewardReceipt | null | undefined} />), "");
  }
});

test("CL-D4 · el texto sale del dato: cap y k del recibo, nada escrito a mano", () => {
  assert.equal(dailyRewardText({ slot: 3, cap: 25 }).line, "Partida con recompensa 3 de 25 hoy");
  assert.match(dailyRewardText({ slot: null, cap: 25 }).line, /25 partidas/);
  const src = readFileSync(join(process.cwd(), "src/components/duel/DailyRewardSlot.tsx"), "utf8");
  assert.doesNotMatch(src, /\b20\b/, "el tope no se escribe en la UI");
  for (const f of ["QuickMatchResult.tsx", "ResultScreen.tsx"]) {
    assert.match(readFileSync(join(process.cwd(), "src/components/duel", f), "utf8"), /dailyCapReached\(r\) \? <DailyRewardSlot receipt=\{r\.rewards\}/, f);
  }
});
