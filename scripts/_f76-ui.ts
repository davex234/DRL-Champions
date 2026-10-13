/**
 * F76 · NAVEGADOR REAL sobre la cola ranked (fuera de CI). Chrome headless → BASE_URL; API/BD solo para observar y
 * para hacer de rival. Cuentas QA. Cierra lo que crea con los mecanismos normales (cancelar / abandonar).
 *   BASE_URL=<app> F68_OUT=docs/product/qa/f76-ranked npx tsx scripts/_f76-ui.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { BASE, legalDeck, login, mm, pvp, queueFacts, sleep, type Who } from "./_f76-lib";
import { clickTid, collectErrors, dblTid, goto, loginUi, openBrowser, reload, shot, type Client } from "./_fase68-lib";

const OUT = "docs/product/qa/f76-ranked";
mkdirSync(OUT, { recursive: true });
const results: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail: unknown = "") => {
  const d = typeof detail === "string" ? detail : JSON.stringify(detail);
  results.push({ id, ok, detail: d.slice(0, 600) });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${d.slice(0, 240)}`);
  return ok;
};
const SCREEN = `(() => { const t = document.body.innerText;
  const last = (performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes('/api/game/duel/pvp?matchId=')).pop() || '');
  return { url: location.pathname + location.search,
    searching: /buscando rival/i.test(t),
    arena: !!document.querySelector('[aria-label="Tu mano"]'),
    result: /victoria|derrota|empate/i.test(t) && /buscar otro rival/i.test(t),
    technical: /STALE|MATCH_TERMINAL|INTERNAL|ACTIVE_MATCH|409|500/.test(t),
    syncing: (last.match(/matchId=([0-9a-f-]{36})/) || [])[1] || null }; })()`;
const scr = (c: Client) => c.tab.js<any>(SCREEN);
async function until(c: Client, pred: (s: any) => boolean, ms = 25_000) {
  const t0 = Date.now(); let s: any = null;
  while (Date.now() - t0 < ms) { s = await scr(c).catch(() => null); if (s && pred(s)) return s; await sleep(800); }
  return s;
}
const finish = async (w: Who, id: string) => (await pvp(w, id, { action: "abandon" })).status;
const errs = async (c: Client) => { await collectErrors(c); return c.errors.map((e) => e.text.slice(0, 160)); };

async function main() {
  const [H, F, D] = [await login("H"), await login("F"), await login("D")];
  const deck = { D: await legalDeck(D) };

  // ── U0 · se CONSTRUYE el estado roto: H y D emparejan, D abandona → la entrada de H queda MATCHED → partida terminal ──
  const deckH = await legalDeck(H);
  await Promise.all([mm(H, { action: "enqueue", deckId: deckH }), mm(D, { action: "enqueue", deckId: deck.D })]);
  let m0: string | null = null;
  for (let k = 0; k < 10 && !m0; k++) { const e = (await mm(H)).json?.entry; if (e?.state === "MATCHED") m0 = e.matchId; else await sleep(1500); }
  if (m0) await finish(D, m0);
  const hBefore = queueFacts(H.userId).entries[0];
  check("U0 · estado roto construido: H MATCHED → partida terminal", !!m0 && hBefore?.state === "MATCHED" && hBefore?.mclosed === "ABANDONED", hBefore);

  // ── U1 · JUGAR ranked con un MATCHED MUERTO (H): búsqueda nueva, nunca la partida vieja, sin errores técnicos ──
  const h = await openBrowser("H", 1440, { label: "f76-ui-H" });
  try {
    await loginUi(h, "H");
    await goto(h, "/competitivo", 3000);
    await clickTid(h, "ranked-play-cta");
    const s = await until(h, (x) => x.searching);
    await shot(h, "f76-ui-01-H-jugar-con-matched-muerto");
    check("U1 · MATCHED muerto + JUGAR → «Buscando rival» en cola NUEVA; nunca sincroniza la partida muerta; sin jerga",
      !!s?.searching && s.syncing === null && !s.technical && queueFacts(H.userId).live === 1,
      { before: hBefore, screen: s, live: queueFacts(H.userId).live });
    const e1 = await errs(h); check("U1b · consola sin errores", e1.length === 0, e1);
    await mm(H, { action: "cancel" });
    // ── P · DOBLE CLIC en JUGAR: una sola búsqueda ──
    await goto(h, "/competitivo", 3000);
    await dblTid(h, "ranked-play-cta");
    const s2 = await until(h, (x) => x.searching);
    await sleep(2500);
    check("P1 · doble clic en JUGAR → una sola búsqueda viva", !!s2?.searching && queueFacts(H.userId).live === 1, { live: queueFacts(H.userId).live });
    await mm(H, { action: "cancel" });
    const s3 = await until(h, (x) => !x.searching, 12_000);
    check("O2 · cancelada desde otra sesión: la pantalla deja de buscar sola (sondeo), sin error", !!s3 && !s3.searching && !s3.technical, s3);
  } finally { await h.browser.close().catch(() => null); }

  // ── Q · DOS SESIONES de la MISMA cuenta (pestañas/dispositivos) pulsan JUGAR a la vez ──
  const f1 = await openBrowser("F", 1440, { label: "f76-ui-F1" });
  const f2 = await openBrowser("F", 390, { label: "f76-ui-F2", reduced: true });
  try {
    await Promise.all([loginUi(f1, "F"), loginUi(f2, "F")]);
    await Promise.all([goto(f1, "/competitivo", 3000), goto(f2, "/competitivo", 3000)]);
    await Promise.all([clickTid(f1, "ranked-play-cta"), clickTid(f2, "ranked-play-cta")]);
    const [a, b] = await Promise.all([until(f1, (x) => x.searching), until(f2, (x) => x.searching)]);
    const live = queueFacts(F.userId);
    check("Q1 · dos sesiones JUGAR a la vez → UNA búsqueda; las dos pantallas la muestran", !!a?.searching && !!b?.searching && live.live === 1, { a: a?.searching, b: b?.searching, live: live.live });

    // ── L/AD · emparejar con D (rival por API); las dos sesiones entran en LA partida; F5 la RECUPERA ──
    const eD = await mm(D, { action: "enqueue", deckId: deck.D });
    const inA = await until(f1, (x) => x.arena || !!x.syncing, 30_000);
    const mid = (await mm(F)).json?.entry?.matchId as string | undefined;
    check("L4 · emparejado: la sesión entra en la partida VIVA", !!mid && inA?.syncing === mid, { enq: eD.json?.code, mid: mid?.slice(0, 8), syncing: inA?.syncing?.slice(0, 8) });
    await shot(f1, "f76-ui-02-F-emparejado");
    await reload(f1, 4000);
    const afterF5 = await until(f1, (x) => x.syncing === mid, 20_000);
    check("AD1 · F5 durante la partida ACTIVA → la MISMA partida (no cola nueva)", afterF5?.syncing === mid && !afterF5?.searching && queueFacts(F.userId).live === 0, afterF5);
    const other = await until(f2, (x) => x.syncing === mid, 20_000);
    check("Q2 · la otra sesión también reconecta a ESA partida", other?.syncing === mid, other?.syncing?.slice(0, 8));

    // ── M/AE · la partida termina (D abandona): resultado; URL fijada; F5 sigue mostrando el resultado ──
    if (mid) {
      check("N2 · D abandona", (await finish(D, mid)) === 200);
      const res = await until(f1, (x) => x.result, 25_000);
      await shot(f1, "f76-ui-03-F-resultado");
      check("M1 · al terminar se ve el RESULTADO de esa partida", !!res?.result && res.syncing === mid, res);
      await sleep(1500);
      const urlFixed = await scr(f1);
      check("AE1 · la URL fija la partida terminada (?match=) para que F5 conserve el resultado", urlFixed?.url === `/duelos/pvp?match=${mid}`, urlFixed?.url);
      await reload(f1, 4000);
      const r2 = await until(f1, (x) => x.result, 20_000);
      check("AE2 · F5 en el resultado → mismo resultado, sin volver a buscar, sin presentarlo como activo", !!r2?.result && r2.syncing === mid && !r2.searching && !r2.arena, r2);
      // la otra sesión, sin ?match=, al recargar ya NO recibe la partida muerta de la cola
      await goto(f2, "/duelos/pvp", 4000);
      const fresh = await until(f2, (x) => !x.result && !x.arena, 15_000);
      check("J5 · otra sesión entra en /duelos/pvp después: antesala, NO el resultado viejo", !!fresh && !fresh.result && fresh.syncing === null, fresh);
      // «Buscar otro rival» → cola nueva
      const clicked = await f1.tab.js<boolean>(`(() => { const b = [...document.querySelectorAll('button, a')].find(x => /^buscar otro rival$/i.test((x.textContent||'').trim())); if (!b) return false; b.click(); return true; })()`);
      const again = await until(f1, (x) => x.searching, 20_000);
      check("W3 · «Buscar otro rival» → búsqueda NUEVA (no la partida terminada)", clicked && !!again?.searching && queueFacts(F.userId).live === 1 && again.url === "/duelos/pvp", { clicked, again });
      const e2 = [...await errs(f1), ...await errs(f2)]; check("Q3 · consola sin errores en las dos sesiones", e2.length === 0, e2);
    }
  } finally {
    for (const w of [F, D, H]) { const s = (await mm(w)).json; if (s?.entry?.state === "QUEUED") await mm(w, { action: "cancel" }); if (s?.entry?.state === "MATCHED" && s.entry.matchId) await finish(w, s.entry.matchId); }
    await f1.browser.close().catch(() => null); await f2.browser.close().catch(() => null);
  }
  check("Z3 · limpieza: 0 búsquedas vivas de QA", [F, D, H].every((w) => queueFacts(w.userId).live === 0));
  const failed = results.filter((r) => !r.ok).length;
  writeFileSync(`${OUT}/ui-${BASE.includes("valorosters") ? "prod" : "local"}-${Date.now()}.json`, JSON.stringify({ base: BASE, total: results.length, failed, results }, null, 2) + "\n");
  console.log(`\n${results.length - failed}/${results.length} PASS`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
