/**
 * F72.2 · QA REAL DE LAS PISTAS VISUALES (fuera de CI) — navegador real contra :3005, cuenta QA.
 *
 * JUGAR → DUELOS → PARTIDA RÁPIDA → JUGAR → tablero con la mano oculta del rival; a 1440 / 1024 / 390 (normal y
 * reducido): capturas de pantalla completa y del dorso ampliado, pistas en el DOM (tipo, forma, asset, texto visible),
 * ningún rótulo prohibido, determinismo tras recargar y la respuesta de la API sin fugas. Al final abandona la partida.
 * Escribe docs/product/qa/fase72-2/.
 *
 *   npx tsx scripts/_f722-qa.ts [persona=A]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, loginUi, goto, sleep, waitFor, token, api, type Client } from "./_fase68-lib";
import { CardRegistry } from "../src/collection/registry";
import { countryDisplayName, HINT_ICONS_AVAILABLE } from "../src/lib/duel/hintVisuals";
import { TEAM_LOGOS_AVAILABLE } from "../src/data/teamLogos";
import { TEAM_IDENTITIES } from "../src/data/teamIdentities";

/* eslint-disable @typescript-eslint/no-explicit-any */
const P = process.argv[2] ?? "A";
const OUT = join(process.cwd(), "docs/product/qa/fase72-2");
const SHOTS = join(OUT, "shots");
mkdirSync(SHOTS, { recursive: true });
const results: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail = "") => { results.push({ id, ok, detail: detail.slice(0, 500) }); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${detail.slice(0, 240)}`); };
const FORBIDDEN = ["PAC", "TH", "DRG", "FLX", "TR", "US", "INI", "AB", "DUE", "CTRL", "SEN", "CON", "EMEA", "AMER", "CN", "PAÍS", "LIGA", "EQUIPO", "ROL"];

async function reachBoard(c: Client): Promise<boolean> {
  await goto(c, "/jugar", 2500);
  await c.tab.js(`document.querySelector('[data-testid="play-area-cta-DUELS"]')?.click()`);
  await waitFor(c.tab, `location.pathname === '/duelos' && !!document.querySelector('[data-testid="duel-mode-cta-QUICK"]')`, 15000);
  await c.tab.js(`document.querySelector('[data-testid="duel-mode-cta-QUICK"]')?.click()`);
  await sleep(3500);
  if (await c.tab.js<boolean>(`/Comenzar duelo/i.test(document.body.innerText)`)) {
    await c.tab.js(`[...document.querySelectorAll('button')].find(b => /^Comenzar duelo$/i.test((b.innerText||'').trim()))?.click()`);
    await sleep(3000);
  }
  return waitFor(c.tab, `(() => { document.querySelector('[data-f61="moment"]')?.click(); return document.querySelectorAll('[data-testid="rival-hint"]').length > 0 && !document.querySelector('[data-scene="intro"]'); })()`, 30000);
}

const readHints = (c: Client) => c.tab.js<any>(`(() => {
  const hand = document.querySelector('[data-testid="rival-hint"]')?.closest('ol,ul,div[aria-label]') || document.body;
  const hints = [...document.querySelectorAll('[data-testid="rival-hint"]')].map(e => { const a = e.querySelector('[data-hint-art]'); const r = (a || e).getBoundingClientRect();
    return { type: e.getAttribute('data-hint-type'), shape: e.getAttribute('data-hint-shape'), text: (e.innerText || '').trim(), art: (a && a.style.backgroundImage || '').replace(/^url\\("?|"?\\)$/g, ''), w: Math.round(r.width), h: Math.round(r.height) }; });
  const backs = document.querySelectorAll('[aria-label="Mano del rival"] > *, [data-testid="rival-hand"] > *').length;
  return { hints, handText: (hand.innerText || '').trim(), backs };
})()`);

(async () => {
  // ── inventario de assets (lo que el sistema puede pintar hoy)
  const reg = new CardRegistry();
  const isos = [...new Set(reg.cards.map((c) => reg.player(c.playerId)?.country ?? "").filter(Boolean))].sort();
  const inventory = {
    country: { found: isos.filter((i) => countryDisplayName(i)).length, total: isos.length, missing: isos.filter((i) => !countryDisplayName(i)), source: "flagSrc() → flagcdn PNG (mismas banderas de las cartas)" },
    role: { found: [...HINT_ICONS_AVAILABLE].filter((x) => x.startsWith("roles/")), missing: ["duelist", "controller", "initiator", "sentinel"].filter((r) => !HINT_ICONS_AVAILABLE.has(`roles/${r}`)) },
    region: { found: [...HINT_ICONS_AVAILABLE].filter((x) => x.startsWith("regions/")), missing: ["americas", "emea", "pacific", "china"].filter((r) => !HINT_ICONS_AVAILABLE.has(`regions/${r}`)) },
    team: { found: [...TEAM_LOGOS_AVAILABLE], identities: TEAM_IDENTITIES.length, missing: TEAM_IDENTITIES.map((t) => `${t.canonicalId} (${t.tag})`).filter((t) => !TEAM_LOGOS_AVAILABLE.has(t.split(" ")[0])) },
  };
  writeFileSync(join(OUT, "asset-inventory.json"), JSON.stringify(inventory, null, 2) + "\n");
  console.log("inventario:", JSON.stringify({ country: `${inventory.country.found}/${inventory.country.total}`, role: inventory.role.found.length, region: inventory.region.found.length, team: inventory.team.found.length }));

  let firstHints: any = null;
  for (const [width, reduced] of [[1440, false], [1440, true], [1024, false], [390, false], [390, true]] as const) {
    const tag = `${width}${reduced ? "-reduced" : ""}`;
    const c = await openBrowser(P, width, { reduced, label: "f722" });
    try {
      await loginUi(c, P);
      const ok = await reachBoard(c);
      await sleep(1200);
      const r = await readHints(c);
      await c.tab.shot(join(SHOTS, `tablero-${tag}.png`)).catch(() => null);
      const box = await c.tab.js<any>(`(() => { const e = document.querySelector('[data-testid="rival-hint"]'); if (!e) return null; const all = [...document.querySelectorAll('[data-testid="rival-hint"]')].map(x => x.getBoundingClientRect()); const p = { left: Math.min(...all.map(r => r.left)), top: Math.min(...all.map(r => r.top)), width: Math.max(...all.map(r => r.right)) - Math.min(...all.map(r => r.left)), height: Math.max(...all.map(r => r.bottom)) - Math.min(...all.map(r => r.top)) }; return { x: Math.max(0, p.left - 10), y: Math.max(0, p.top - 10), w: p.width + 20, h: p.height + 20 }; })()`);
      if (box) await c.tab.send("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 3 } }).then((s: any) => writeFileSync(join(SHOTS, `mano-rival-${tag}.png`), Buffer.from(s.data, "base64"))).catch(() => null);
      const visible = r.hints.map((h: any) => h.text).join("");
      const tokens = FORBIDDEN.filter((t) => new RegExp(`(^|[^\\p{L}])${t}([^\\p{L}]|$)`, "u").test(r.handText));
      check(`${tag}: tablero con pistas`, ok && r.hints.length > 0, `pistas=${r.hints.length}`);
      check(`${tag}: pistas SOLO imagen (0 caracteres visibles) y asset real`, visible === "" && r.hints.every((h: any) => h.shape && /^https?:|^\//.test(h.art)), JSON.stringify(r.hints.slice(0, 4)));
      check(`${tag}: ningún rótulo prohibido en la mano del rival (PAC, TH, DRG, FLX, TR, US, INI, AB, DUE…)`, tokens.length === 0, `encontrados=${tokens.join(",")} texto=«${r.handText.slice(0, 80)}»`);
      check(`${tag}: reconocible en la carta pequeña (bandera ≥ 18 px de ancho)`, r.hints.every((h: any) => h.w >= 18), JSON.stringify(r.hints.map((h: any) => h.w)));
      const broken = await c.tab.js<number>(`Promise.all([...document.querySelectorAll('[data-hint-art]')].map(e => new Promise(res => { const u = (e.style.backgroundImage || '').replace(/^url\\("?|"?\\)$/g, ''); const i = new Image(); i.onload = () => res(0); i.onerror = () => res(1); i.src = u; }))).then(a => a.reduce((s, x) => s + x, 0))`);
      check(`${tag}: todos los assets de pista cargan (0 rotos)`, broken === 0, `rotos=${broken}`);
      // Determinismo: recargar = mismas pistas en el mismo orden.
      await c.tab.send("Page.reload", {}); await sleep(4000);
      await waitFor(c.tab, `document.querySelectorAll('[data-testid="rival-hint"]').length > 0`, 20000);
      const again = await readHints(c);
      const sig = (x: any) => JSON.stringify(x.hints.map((h: any) => [h.type, h.art]));
      check(`${tag}: recargar da las mismas pistas`, sig(again) === sig(r), `${sig(r).slice(0, 120)}`);
      if (!firstHints) firstHints = r;
      // API: lo que viaja de las ocultas es solo { type, value } (o null).
      const t = await token(P);
      const view = (await api(t, "/api/game/duel", { action: "active" })).json?.view;
      const hs = (view?.rivalHints ?? []) as any[];
      check(`${tag}: API — una entrada por carta oculta, cada una { type, value } o null`, hs.length === view?.rivalRemaining && hs.every((h) => h === null || (Object.keys(h).sort().join() === "type,value" && /^([A-Z]{2}|DUELIST|CONTROLLER|INITIATOR|SENTINEL|AMERICAS|EMEA|PACIFIC|CHINA|[a-z0-9-]+)$/.test(h.value))), JSON.stringify(hs.slice(0, 6)));
      const errs = c.tab.takeErrors();
      check(`${tag}: 0 errores de consola`, errs.length === 0, errs[0] ?? "");
      // Limpieza: la partida rápida no se queda abierta.
      if (view?.matchId) await api(t, "/api/game/duel", { action: "abandon", matchId: view.matchId });
    } finally { await c.browser.close(); }
  }
  writeFileSync(join(OUT, "qa.json"), JSON.stringify({ at: new Date().toISOString(), persona: P, pass: results.filter((r) => r.ok).length, total: results.length, results }, null, 2) + "\n");
  console.log(`f72.2: ${results.filter((r) => r.ok).length}/${results.length}`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})();
