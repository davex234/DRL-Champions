/**
 * AJUSTE · PISTA EN LA CARTA RIVAL OCULTA — la ranura central de la mesa (MatchBoard real).
 *
 *   · antes de la revelación: reverso + la MISMA pista (mismo asset) y el MISMO rol que esa carta tiene en la fila
 *     superior; ni nombre, ni OVR, ni cifras, ni cara de la carta;
 *   · pista limpia (placa neutra debajo, `<img>` original encima y lo último que se pinta);
 *   · la fila superior no cambia (sigue con sus 10 − jugadas reversos con pista);
 *   · sin carta comprometida, no hay pista central.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { MotionConfig } from "framer-motion";
import { MatchBoard } from "./MatchBoard";
import { qaSnapshot, qaSimulate, qaView } from "@/lib/duel/qaSimulation";
import { hintPresentation } from "@/lib/duel/hintDisplay";
import { ROLE_ABBR } from "@/lib/flags";
import { fnv1a32 } from "@/domain/cardgame/hints";

const mine = qaSnapshot(0, "qa-you", "QA · Equipo");
const rival = qaSnapshot(1, "qa-rival", "QA · Rival");
const noop = () => {};
const html = (v: ReturnType<typeof qaView>) =>
  renderToStaticMarkup(<MotionConfig reducedMotion="never"><MatchBoard view={v} onPlay={noop} busy={false} error={null} onDismissError={noop} /></MotionConfig>);

/** El elemento HTML completo (etiquetas equilibradas) que contiene el atributo dado. */
function element(h: string, attr: string): string {
  const start = h.lastIndexOf("<", h.indexOf(attr));
  const tag = /^<(\w+)/.exec(h.slice(start))![1];
  const re = new RegExp(`<(/?)${tag}(?=[\\s>/])[^>]*?(/?)>`, "g");
  re.lastIndex = start;
  let depth = 0;
  for (let mm = re.exec(h); mm; mm = re.exec(h)) {
    if (mm[2]) continue;
    depth += mm[1] ? -1 : 1;
    if (depth === 0) return h.slice(start, re.lastIndex);
  }
  return h.slice(start);
}

/** Partidas en las que el rival acaba de comprometer su carta atacando, con pista representable. */
function committedCases() {
  const out: { m: ReturnType<typeof qaSimulate>; v: ReturnType<typeof qaView> }[] = [];
  for (const seed of [3, 5, 7, 9, 11, 13, 17, 21])
    for (const t of [0, 1, 2, 3, 5]) {
      const m = qaSimulate(mine, rival, t, seed % 2 ? "B" : "A", seed, true);
      const v = qaView(m);
      if (v.pendingRival) out.push({ m, v });
    }
  return out;
}

test("AJUSTE R1 · la carta central lleva la pista y el rol de ESA carta en la fila superior (mismo asset, misma sigla)", () => {
  const cases = committedCases();
  assert.ok(cases.length >= 3, `casos: ${cases.length}`);
  let withArt = 0;
  for (const { m, v } of cases) {
    const uid = m.draft.attackerCardUid!;
    const order = m.snapshotB.cards.filter((c) => !m.usedB.includes(c.uid)).sort((x, y) => fnv1a32(`${m.id}:${x.uid}:order`) - fnv1a32(`${m.id}:${y.uid}:order`));
    const i = order.findIndex((c) => c.uid === uid);
    assert.deepEqual(v.pendingRival!.hint, v.rivalHints[i]);
    assert.equal(v.pendingRival!.role, v.rivalRoles![i]);
    const h = html(v);
    const central = element(h, 'data-testid="rival-committed"');
    const p = v.pendingRival!.hint ? hintPresentation(v.pendingRival!.hint) : null;
    if (p) {
      withArt++;
      assert.ok(central.includes('data-testid="rival-committed-hint"') && central.includes(`src="${p.src}"`), "mismo asset que arriba");
      assert.ok(h.split(`src="${p.src}"`).length - 1 >= 2, "y ese asset está también en la fila superior");
      // Limpia: la imagen es lo último del pie del reverso.
      assert.match(central, /data-hint-plate[^>]*><\/span><img data-hint-art/);
    }
    if (v.pendingRival!.role) assert.ok(central.includes(`>${ROLE_ABBR[v.pendingRival!.role]}<`), "el rol, en texto canónico");
    // Nada de la carta: ni su nombre, ni cifras, ni OVR, ni su cara.
    const secret = m.snapshotB.cards.find((c) => c.uid === uid)!;
    assert.ok(!h.includes(secret.uid) && !h.includes(secret.cardId), "ni uid ni id de carta en el DOM");
    const centralText = central.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    assert.ok(!central.includes(secret.playerName) && !/\b\d{2}\b/.test(centralText), `ni nombre ni cifras en la carta central: «${centralText}» (${central.length} B)`);
    assert.ok(!central.includes("/cards/") && !central.includes("data-card-face"), "ni la cara de la carta");
    assert.match(central, /aria-label="Carta del rival, boca abajo hasta que respondas[^"]*"/);
  }
  assert.ok(withArt > 0, "al menos un caso con bandera/logo");
});

test("AJUSTE R2 · la fila superior no cambia y sin carta comprometida no hay pista central", () => {
  const { v } = committedCases()[0];
  const h = html(v);
  const top = (h.match(/data-testid="rival-hint"/g) ?? []).length;
  assert.equal(top, v.rivalHints.filter((x) => x && hintPresentation(x)).length, "las pistas de arriba, una por carta oculta, como antes");
  const idle = qaView(qaSimulate(mine, rival, 0, "A", 7, true));
  assert.equal(idle.pendingRival, null);
  assert.ok(!html(idle).includes("rival-committed-hint"));
});
