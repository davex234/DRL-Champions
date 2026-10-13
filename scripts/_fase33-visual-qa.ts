/**
 * FASE 33 · CAPTURAS QA (instrumento `_`, fuera de CI) — `npx tsx scripts/_fase33-visual-qa.ts`
 *
 * Requiere la app servida (`npx next start -p 3005` o `next dev -p 3005`) y nada más: sin Supabase, sin
 * Docker. Escenas del arnés `/design-system/fase33?scene=…` (QA SYNTHETIC; partidas del motor real).
 * Algunas escenas se INTERACTÚAN de verdad (elegir carta/eje, abrir el detalle de un turno, tabular con el
 * teclado, silenciar) para fotografiar el estado que produce la propia pantalla.
 * Guarda en docs/product/qa/fase33/ y escribe el README. `ONLY=a,b` limita escenas.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";

const BASE = process.env.E2E_BASE_URL ?? process.env.BASE_URL ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase33");
mkdirSync(OUT, { recursive: true });

const WIDTHS = { desktop: [1440, 900], tablet: [1024, 800], mobile: [390, 844] } as const;
type Size = keyof typeof WIDTHS;
const ALL: Size[] = ["desktop", "tablet", "mobile"];
const DM: Size[] = ["desktop", "mobile"];

const CLICK_CARD = `(() => { const b = document.querySelector('[aria-label="Tu mano"] button'); b?.click(); return !!b; })()`;
const CLICK_STAT = `(() => { const b = [...document.querySelectorAll('[aria-label="¿Con qué peleas?"] button')][1]; b?.click(); return !!b; })()`;
const SCROLL = (sel: string) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); e?.scrollIntoView({ block: "start" }); return !!e; })()`;
/** La línea de turnos existe dos veces (columna lateral en xl, bajo la mano en el resto): se usa la VISIBLE. */
const VISIBLE_TIMELINE = (what: "scroll" | "click") => `(() => { const b = [...document.querySelectorAll('[aria-label="Línea de turnos"] button:not([disabled])')].find((x) => x.offsetParent !== null); if (!b) return false; ${what === "click" ? "b.click();" : 'b.scrollIntoView({ block: "center" });'} return true; })()`;
const SCROLL_TEXT =(text: string) => `(() => { const e = [...document.querySelectorAll("button, a")].find((x) => x.textContent?.includes(${JSON.stringify(text)})); e?.scrollIntoView({ block: "center" }); return !!e; })()`;

interface Scene { n: string; scene: string; name: string; sizes: Size[]; settle?: number; act?: string[]; reduced?: boolean; path?: string; note?: string }

const S: Scene[] = [
  { n: "01", scene: "prematch-pve", name: "prematch-pve", sizes: ALL },
  { n: "02", scene: "prematch-ranked", name: "prematch-ranked", sizes: DM },
  { n: "03", scene: "prematch-private", name: "prematch-private", sizes: DM, settle: 2600 },
  { n: "04", scene: "rival-hidden", name: "rival-hidden", sizes: DM },
  { n: "05", scene: "own-team", name: "own-team", sizes: DM },
  // La intro del arnés no se cierra sola (onDone no-op): se fotografía asentada, fuera del fundido del HydrationGate.
  { n: "06", scene: "intro", name: "match-intro", sizes: ALL, settle: 2800 },
  { n: "07", scene: "intro", name: "intro-reduced-motion", sizes: DM, settle: 2800, reduced: true },
  { n: "08", scene: "turn1-attack", name: "turn1-attack", sizes: ALL },
  { n: "09", scene: "turn-defense", name: "turn-defense", sizes: ALL },
  { n: "10", scene: "axis-selection", name: "axis-selection", sizes: DM, act: [CLICK_CARD] },
  { n: "11", scene: "server-axis", name: "server-imposed-axis", sizes: DM },
  { n: "12", scene: "card-selection", name: "card-selection-defense", sizes: DM, act: [CLICK_CARD] },
  { n: "13", scene: "selected-card", name: "selected-card-confirm", sizes: DM, act: [CLICK_CARD, CLICK_STAT] },
  { n: "14", scene: "locked", name: "locked-action", sizes: DM },
  { n: "15", scene: "waiting", name: "waiting-opponent", sizes: DM, settle: 2600 },
  { n: "16", scene: "rival-reveal", name: "rival-reveal", sizes: DM, settle: 2600 },
  { n: "17", scene: "card-vs-card", name: "card-vs-card", sizes: ALL, settle: 2600 },
  { n: "18", scene: "stat-reveal", name: "stat-reveal-midway", sizes: DM, settle: 380 },
  { n: "19", scene: "turn-win", name: "player-wins-turn", sizes: DM, settle: 2600 },
  { n: "20", scene: "turn-loss", name: "rival-wins-turn", sizes: DM, settle: 2600 },
  { n: "21", scene: "turn-draw", name: "turn-draw", sizes: DM, settle: 2600 },
  { n: "22", scene: "ovr-tiebreak", name: "ovr-tiebreak", sizes: DM, settle: 3200, act: [SCROLL('[data-testid="result-story"]')] },
  { n: "23", scene: "stat-tiebreak", name: "total-stat-tiebreak", sizes: DM, settle: 3200, act: [SCROLL('[data-testid="result-story"]')] },
  { n: "24", scene: "score-update", name: "score-update", sizes: DM, settle: 1900 },
  { n: "25", scene: "timeline-partial", name: "timeline-partial", sizes: DM, act: [VISIBLE_TIMELINE("scroll")] },
  { n: "26", scene: "turn-detail", name: "previous-turn-detail", sizes: DM, act: [VISIBLE_TIMELINE("click")] },
  { n: "27", scene: "turn5", name: "turn5", sizes: DM },
  { n: "28", scene: "turn9", name: "turn9", sizes: DM },
  { n: "29", scene: "final-turn", name: "final-turn", sizes: ALL },
  { n: "29b", scene: "match-point", name: "match-point", sizes: DM },
  { n: "30", scene: "match-win", name: "match-win", sizes: ALL, settle: 2600 },
  { n: "31", scene: "match-loss", name: "match-loss", sizes: DM, settle: 2600 },
  { n: "32", scene: "match-draw", name: "match-draw", sizes: DM, settle: 2600 },
  { n: "33", scene: "ranked-result", name: "ranked-result", sizes: ALL, settle: 2600 },
  { n: "34", scene: "rating-positive", name: "rating-delta-positive", sizes: DM, settle: 2600, act: [SCROLL('[data-testid="pvp-rating"]')] },
  { n: "35", scene: "rating-negative", name: "rating-delta-negative", sizes: DM, settle: 2600, act: [SCROLL('[data-testid="pvp-rating"]')] },
  { n: "36", scene: "provisional", name: "provisional-player", sizes: DM, settle: 2600, act: [SCROLL('[data-testid="pvp-rating"]')] },
  { n: "36b", scene: "rating-pending", name: "rating-event-unavailable", sizes: ["desktop"], settle: 2600, act: [SCROLL('[data-testid="pvp-rating"]')] },
  { n: "37", scene: "pve-result", name: "pve-result-story", sizes: DM, settle: 3200, act: [SCROLL('[data-testid="result-story"]')] },
  { n: "38", scene: "private-result", name: "private-result", sizes: DM, settle: 2600 },
  { n: "39", scene: "mvp", name: "card-of-the-match", sizes: DM, settle: 2600, act: [SCROLL("[data-featured]")] },
  { n: "40", scene: "no-mvp", name: "no-card-of-the-match", sizes: ["desktop"], settle: 2600, act: [SCROLL("[data-featured]")] },
  { n: "41", scene: "rewards", name: "rewards-present", sizes: DM, settle: 2600, act: [SCROLL('[aria-label="Recompensa del duelo"]')] },
  { n: "42", scene: "no-reward", name: "no-reward-pvp", sizes: ["desktop"], settle: 3200, act: [SCROLL("[data-reward]")] },
  { n: "43", scene: "rematch", name: "private-rematch", sizes: DM, settle: 2600, act: [SCROLL_TEXT("Revancha")] },
  { n: "44", scene: "search-another", name: "search-another-rival", sizes: DM, settle: 2600, act: [SCROLL_TEXT("Buscar otro rival")] },
  { n: "45", scene: "replay", name: "replay", sizes: ALL },
  { n: "46", scene: "replay-turn1", name: "replay-turn1", sizes: ["desktop"] },
  { n: "47", scene: "replay-middle", name: "replay-middle", sizes: ["desktop"] },
  { n: "48", scene: "replay-final", name: "replay-final", sizes: DM },
  { n: "49", scene: "replay-partial", name: "replay-partial", sizes: DM },
  { n: "50", scene: "replay-unavailable", name: "replay-unavailable", sizes: DM },
  { n: "51", scene: "offline", name: "offline", sizes: DM, settle: 2600 },
  { n: "52", scene: "reconnecting", name: "reconnecting", sizes: DM, settle: 2600 },
  { n: "53", scene: "resync", name: "resync", sizes: DM, settle: 2600 },
  { n: "54", scene: "stale", name: "stale-version", sizes: DM, settle: 2600 },
  { n: "55", scene: "timeout", name: "opponent-timeout", sizes: DM, settle: 2600 },
  { n: "56", scene: "finished-reconnect", name: "match-finished-on-reconnect", sizes: DM, settle: 2600 },
  { n: "57", scene: "backend-error", name: "backend-error", sizes: DM },
  { n: "58", scene: "pvp-attack", name: "mobile-attack", sizes: ["mobile"], settle: 2600 },
  { n: "59", scene: "turn-defense", name: "mobile-defense", sizes: ["mobile"], act: [CLICK_CARD] },
  { n: "60", scene: "stat-reveal", name: "mobile-reveal", sizes: ["mobile"], settle: 520 },
  { n: "61", scene: "turn-win", name: "mobile-resolution", sizes: ["mobile"], settle: 2600 },
  { n: "62", scene: "ranked-result", name: "mobile-result", sizes: ["mobile"], settle: 2600 },
  { n: "63", scene: "replay-final", name: "mobile-replay", sizes: ["mobile"] },
  { n: "64", scene: "tablet", name: "tablet", sizes: ["tablet"] },
  { n: "65", scene: "keyboard", name: "keyboard-flow", sizes: ["desktop"], act: ["__KEYBOARD__"] },
  { n: "66", scene: "sound-off", name: "sound-off", sizes: ["desktop"], settle: 2600, act: [`(() => { const b = document.querySelector('[aria-label="Silenciar sonido"]'); b?.click(); return !!b; })()`] },
  { n: "67", scene: "turn-win", name: "reduced-motion-reveal", sizes: DM, settle: 900, reduced: true },
  { n: "68", scene: "", name: "no-session", sizes: DM, path: "/duelos/jugar", settle: 4000, note: "ruta real /duelos/jugar sin sesión" },
  { n: "69", scene: "invalid-match", name: "invalid-match", sizes: DM },
  { n: "70", scene: "", name: "real-route-smoke", sizes: DM, path: "/duelos", settle: 4000, note: "ruta real /duelos" },
  { n: "70b", scene: "", name: "real-route-pvp", sizes: ["desktop"], path: "/duelos/pvp", settle: 4000, note: "ruta real /duelos/pvp sin sesión" },
  { n: "71", scene: "history-detail", name: "history-to-replay", sizes: DM, settle: 2600 },
  { n: "72", scene: "private-arena", name: "private-arena", sizes: DM, settle: 2600 },
  { n: "73", scene: "intro-pvp", name: "intro-pvp-identity", sizes: ["desktop"], settle: 2800 },
];

async function keyboardFlow(t: Tab): Promise<void> {
  /*
   * El arnés vive dentro del armazón de la app (menús de navegación con desplegables que se abren al
   * enfocarse); la ruta real `/duelos/jugar` es inmersiva y no los tiene. Se parte de la mesa, como
   * quien ya está en la arena, y desde ahí se navega SOLO con Tab/Enter.
   */
  // Chrome sin cabeza no da foco al documento: sin esto, `focus()` y Tab no mueven el foco real.
  await t.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  const key = async (k: "Tab" | "Enter", shift = false) => {
    const base = k === "Tab"
      ? { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: shift ? 8 : 0 }
      : { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" };
    await t.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base, text: undefined });
    if (k === "Enter") await t.send("Input.dispatchKeyEvent", { type: "char", ...base });
    await t.send("Input.dispatchKeyEvent", { type: "keyUp", ...base, text: undefined });
    await sleep(120);
  };
  const where = () => t.js<string>(`(() => { const a = document.activeElement; return a?.closest('[aria-label="Tu mano"]') ? "mano" : a?.closest('[aria-label="¿Con qué peleas?"]') ? "eje" : a?.tagName === "BUTTON" ? "boton:" + (a.textContent ?? "").trim().slice(0, 24) : String(a?.tagName); })()`);
  // Punto de partida: la primera carta de la mano (como quien ya está en la arena).
  await t.js(`document.querySelector('[aria-label="Tu mano"] button')?.focus()`);
  if ((await where()) !== "mano") for (let i = 0; i < 40 && (await where()) !== "mano"; i++) await key("Tab");
  await key("Enter");                                   // elige la carta
  await sleep(450);
  for (let i = 0; i < 12 && (await where()) !== "eje"; i++) await key("Tab", true);   // atrás hasta los ejes
  await key("Enter");                                   // declara el eje enfocado
  await sleep(300);
  for (let i = 0; i < 6 && !(await where()).startsWith("boton:Declarar"); i++) await key("Tab");  // al botón de confirmar
}

async function main(): Promise<void> {
  const only = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
  const b = await launch({ width: 1440, height: 900 });
  const t = b.tab;
  const rows: { file: string; width: number; what: string; checks: string }[] = [];
  const errors: string[] = [];
  try {
    for (const s of S) {
      if (only && !only.has(s.scene) && !only.has(s.n) && !only.has(s.name)) continue;
      await t.setMedia([{ name: "prefers-reduced-motion", value: s.reduced ? "reduce" : "no-preference" }]);
      for (const size of s.sizes) {
        const [w, h] = WIDTHS[size];
        await t.resize(w, h);
        const url = s.path ? `${BASE}${s.path}` : `${BASE}/design-system/fase33?scene=${s.scene}`;
        const acting = Boolean(s.act?.length);
        await t.goto(url, acting ? 2400 : s.settle ?? 2400);
        const checks: string[] = [];
        for (const a of s.act ?? []) {
          if (a === "__KEYBOARD__") { await keyboardFlow(t); checks.push("teclado"); continue; }
          checks.push(String(await t.js<boolean>(a)));
          await sleep(450);
        }
        if (acting) await sleep(s.settle && s.settle > 2400 ? s.settle - 2400 : 500);
        const phase = await t.js<string | null>(`document.querySelector("[data-phase]")?.getAttribute("data-phase") ?? null`);
        const overflow = await t.js<number>(`Math.max(0, document.documentElement.scrollWidth - window.innerWidth)`);
        const file = `${s.n}-${s.name}-${w}.png`;
        await t.shot(join(OUT, file));
        rows.push({ file, width: w, what: s.note ?? `scene=${s.scene}${s.reduced ? " · reduced-motion" : ""}`, checks: [phase ? `fase ${phase}` : "", overflow ? `⚠ desborde ${overflow}px` : "", ...checks.filter((c) => c !== "true")].filter(Boolean).join(" · ") });
        errors.push(...t.takeErrors().filter((e) => !/players\/.*\.(png|webp)|404|ERR_CONNECTION_REFUSED|supabase|Failed to load resource/i.test(e)).map((e) => `${file}: ${e}`));
      }
    }
    const readme = [
      "# QA visual · Fase 33 — Match Experience 3.0",
      "",
      "QA SYNTHETIC: partidas del MOTOR REAL (dos bots, cartas reales del catálogo) proyectadas con `projectMatchFor` + `buildMatchView`; jugadores, amistades y asientos de rating inventados. Sin servidor, sin Supabase, sin Docker.",
      "Generadas con `npx tsx scripts/_fase33-visual-qa.ts` contra la app en :3005, escenas de `/design-system/fase33?scene=…`. Las escenas 10, 12, 13, 26, 59, 65 y 66 se INTERACTÚAN (clic en carta/eje, detalle de turno, teclado, silencio). Movimiento activado salvo `07-*` y `67-*` (prefers-reduced-motion). `68`, `70`, `70b` son rutas reales sin sesión.",
      "Si una escena muestra la franja «QA SYNTHETIC · … fabricado», ese resultado no salió de ninguna semilla y se fabricó con la forma exacta de `DuelResultView`.",
      "",
      "| captura | ancho | escena | comprobaciones |",
      "|---|---|---|---|",
      ...rows.map((r) => `| \`${r.file}\` | ${r.width} | ${r.what} | ${r.checks} |`),
      "",
      `Errores de consola propios (sin 404 de fotos ni Supabase ausente): ${errors.length}.`,
      ...errors.slice(0, 20).map((e) => `- ${e}`),
      "",
    ].join("\n");
    if (!only) writeFileSync(join(OUT, "README.md"), readme);
    console.log(rows.map((r) => `${r.file}  ${r.checks}`).join("\n"));
    console.log(`\ncapturas: ${rows.length} · errores de consola propios: ${errors.length}`);
    for (const e of errors.slice(0, 20)) console.log("  ✗", e);
  } finally {
    await b.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
