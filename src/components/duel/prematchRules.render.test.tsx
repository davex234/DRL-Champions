/**
 * AJUSTE UX · PRE-PARTIDA — selector de dificultad limpio (solo FÁCIL / NORMAL / DIFÍCIL) y reglas compactas solo
 * en la primera entrada (preferencia por cuenta en el adaptador KV). La persistencia real (F5, otra cuenta) se prueba
 * en navegador con el arnés `/design-system/prematch-rules`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { PreMatch } from "./PreMatch";
import { DIFFICULTY_INFO, type BotDifficulty } from "@/lib/duel/types";
import { duelRulesSeenKey } from "@/lib/duel/rulesIntro";
import { DECK_SECOND as DECK } from "@/app/design-system/fase32/fixtures";

const render = (o: { showRules?: boolean; difficulty?: BotDifficulty } = {}) => renderToStaticMarkup(
  <PreMatch decks={[DECK]} deckId={DECK.id} onDeck={() => undefined} difficulty={o.difficulty ?? "NORMAL"} onDifficulty={() => undefined}
    onStart={() => undefined} busy={false} error={null} onHelp={() => undefined} activeDeckId={DECK.id} showRules={o.showRules} />,
);
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("selector: SOLO Fácil · Normal · Difícil (sin etiqueta, descripción, barras ni párrafo inferior)", () => {
  const h = render({ showRules: false });
  const t = text(h);
  for (const d of ["EASY", "NORMAL", "HARD"] as const) {
    assert.match(h, new RegExp(`data-difficulty="${d}"`), d);
    assert.ok(t.includes(DIFFICULTY_INFO[d].label), DIFFICULTY_INFO[d].label);
    assert.ok(!t.includes(DIFFICULTY_INFO[d].tagline), `sin «${DIFFICULTY_INFO[d].tagline}»`);
    assert.ok(!t.includes(DIFFICULTY_INFO[d].detail), `sin la descripción de ${d}`);
  }
  assert.ok(!/Ningún nivel ve las cartas/.test(t), "sin el párrafo inferior");
  assert.match(h, /class="grid grid-cols-3 gap-2" role="group" aria-label="Dificultad"/, "mismo peso: tres columnas también en móvil");
  assert.match(h, /min-h-\[56px\]/, "objetivo táctil ≥ 44 px");
  assert.ok(h.includes("Comenzar duelo"));
});

test("seleccionada: aria-pressed + barra de acento (no solo color); una sola seleccionada; foco visible", () => {
  const full = render({ difficulty: "HARD", showRules: false });
  const i = full.indexOf('aria-label="Dificultad"');
  const h = full.slice(i, full.indexOf("</section>", i));
  assert.equal((h.match(/aria-pressed="true"/g) ?? []).length, 1, "una sola dificultad elegida");
  assert.match(h, /aria-pressed="true" data-difficulty="HARD"/);
  assert.equal((h.match(/absolute inset-x-3 bottom-0 h-\[3px\]/g) ?? []).length, 1, "la barra solo en la elegida");
  assert.ok(/<button type="button" aria-pressed="(true|false)" data-difficulty="EASY" class="nx-focus/.test(h), "botones nativos con foco visible");
});

test("reglas: se ven con showRules (primera entrada) y desaparecen SIN hueco cuando ya se vieron", () => {
  const first = render({ showRules: true });
  assert.match(first, /data-testid="prematch-rules"/);
  for (const r of ["10 turnos", "Declara y responde", "Gana el valor mayor"]) assert.ok(first.includes(r), r);
  const later = render({ showRules: false });
  assert.ok(!/prematch-rules|10 turnos|Declara y responde|Gana el valor mayor|aria-label="Reglas"/.test(later), "ni el bloque ni su contenedor");
  assert.ok(later.length < first.length);
});

test("persistencia: clave por cuenta en el adaptador KV; la página solo enseña reglas en «show» y marca al pintarlas", () => {
  assert.notEqual(duelRulesSeenKey("aaa-1"), duelRulesSeenKey("bbb-2"), "cada cuenta la suya");
  assert.equal(duelRulesSeenKey("a<b>c"), "duel-rules-seen-abc");
  const page = readFileSync(join(process.cwd(), "src", "app", "duelos", "jugar", "page.tsx"), "utf8");
  assert.ok(page.includes("const rulesIntro = useDuelRulesIntro(me?.id ?? null);"));
  assert.ok(page.includes('showRules={rulesIntro.intro === "show"}') && page.includes("onRulesShown={rulesIntro.markSeen}"));
  const hook = readFileSync(join(process.cwd(), "src", "lib", "duel", "rulesIntro.ts"), "utf8");
  assert.ok(hook.includes('import { getAdapter } from "@/platform/store";'), "mismo adaptador KV que la preferencia de la guía");
  const pm = readFileSync(join(process.cwd(), "src", "components", "duel", "PreMatch.tsx"), "utf8");
  assert.ok(pm.includes("useEffect(() => { onShown?.(); }, [onShown]);"), "se marca DESPUÉS de pintar las reglas, no antes");
});
