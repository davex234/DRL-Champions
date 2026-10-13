/**
 * DUEL GAMEPLAY UX 2.0 · E2E EN NAVEGADOR CONTRA PRODUCCIÓN (instrumento de operador, fuera de CI y de la release).
 *
 *   QA_CREDS_DIR=… QA_SB=https://valorosters.com QA_ANON=… BASE_URL=https://valorosters.com npx tsx scripts/_duelux2-prod-browser.mts K
 *
 * Persona QA (nunca davex ni ValoRosters): login real → /duelos/jugar → «Comenzar duelo» → partida rápida con clics reales.
 *   · ningún reloj en pantalla; > 30 s sin tocar nada → mismo turno, misma mano, ninguna jugada automática;
 *   · cuando el bot compromete su carta: boca abajo (sin imagen), y la carta que luego se revela NO está en el DOM, en el
 *     árbol accesible ni en el almacenamiento del navegador antes de responder;
 *   · resultado: «Recompensas obtenidas» con los créditos del recibo del servidor; F5 la mantiene. Capturas 1440 y 390.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, loginUi, goto, reload, playOneUi, token, api, sleep, waitFor, type Client } from "./_fase68-lib";

const OUT = join(process.cwd(), "docs/product/qa/duel-ux-2/prod-browser");
mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` ${JSON.stringify(detail)?.slice(0, 300)}`}`);
};
const P = process.argv[2] ?? "K";
const t = await token(P);
// El id de CARTA del catálogo puede estar legítimamente en el almacenamiento si TÚ también la tienes en tu colección (caché
// de inventario): se excluyen los ids de carta que posees. Los uids (instancias), el jugador y el nick se siguen exigiendo.
const ownedCardIds = new Set<string>(((await api(t, "/api/game/state")).json?.ownedCards ?? []).map((c: any) => c.cardId ?? c.card_id).filter(Boolean));

const c: Client = await openBrowser(P, 1440, { label: `ux2-prod-${P}` });
const SNAP = `(() => ({
  html: document.documentElement.outerHTML,
  storage: JSON.stringify({ l: Object.entries(localStorage).filter(([k]) => !k.includes('auth-token')), s: Object.entries(sessionStorage) }),
  turn: (document.body.innerText.match(/TURNO\\s*(\\d+)/i) || [])[1] || null,
  hand: [...document.querySelectorAll('[aria-label="Tu mano"] button')].length,
  timer: document.querySelectorAll('[data-testid="turn-timer"], [role="timer"]').length,
  committed: (() => { const e = document.querySelector('[data-testid="rival-committed"]'); if (!e) return null; const hint = e.querySelector('[data-testid="rival-committed-hint"] img[data-hint-art]'); const role = e.querySelector('[data-testid="role-mark"]'); return { imgs: e.querySelectorAll('img:not([data-hint-art])').length, hintSrc: hint ? hint.getAttribute('src') : null, hintOk: hint ? hint.complete && hint.naturalWidth > 0 : null, role: role ? role.textContent.trim() : null, label: e.getAttribute('aria-label'), text: [...e.querySelectorAll('*')].filter((n) => !n.closest('[data-testid="role-mark"]') && n.childNodes.length && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())).map((n) => n.textContent.trim()).join(' ') }; })(),
  topSrcs: [...document.querySelectorAll('[data-testid="rival-hint"] img[data-hint-art]')].map((i) => i.getAttribute('src')),
}))()`;
try {
  check("login real por /cuenta", await loginUi(c, P));
  // Una partida previa abierta no es de esta prueba.
  const act = await api(t, "/api/game/duel", { action: "active" });
  if (act.json?.view?.matchId) await api(t, "/api/game/duel", { action: "abandon", matchId: act.json.view.matchId });
  await goto(c, "/duelos/jugar", 3000);
  await c.tab.js(`(() => { const b = [...document.querySelectorAll('button')].find(x => /^(Entendido|Vale|Cerrar)$/i.test((x.textContent||'').trim())); if (b) b.click(); })()`).catch(() => null);
  await sleep(500);
  const started = await c.tab.js<boolean>(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Comenzar duelo/i.test(x.textContent||'') && !x.disabled); if (!b) return false; b.click(); return true; })()`);
  check("«Comenzar duelo»", started);
  check("tablero listo", await waitFor(c.tab, `[...document.querySelectorAll('[aria-label="Tu mano"] button')].some(b => !b.disabled) && !document.querySelector('[data-scene="intro"]')`, 40000));
  const s0 = await c.tab.js<any>(SNAP);
  check("ningún reloj de decisión en pantalla", s0.timer === 0, s0.timer);
  await c.tab.shot(join(OUT, "A-pve-sin-reloj-1440.png")).catch(() => null);
  console.log("esperando 40 s sin tocar nada…");
  await sleep(40_000);
  const s1 = await c.tab.js<any>(SNAP);
  const matchId: string | undefined = (await api(t, "/api/game/duel", { action: "active" })).json?.view?.matchId;
  const v1 = matchId ? (await api(t, "/api/game/duel", { action: "state", matchId })).json?.view : null;
  check("tras > 30 s: mismo turno, misma mano, sin reloj", s1.turn === s0.turn && s1.hand === s0.hand && s1.timer === 0, { s0: [s0.turn, s0.hand], s1: [s1.turn, s1.hand, s1.timer] });
  check("tras > 30 s: el servidor tampoco movió nada", !!v1 && v1.history.length === 0 && v1.yourUsed.length === 0 && (v1.timeouts ?? []).length === 0 && v1.turnDeadlineAt === null, v1 && { h: v1.history.length, used: v1.yourUsed.length, to: v1.timeouts, d: v1.turnDeadlineAt });

  // Partida con clics; antes de cada respuesta a un ataque del bot se guarda lo que había en el navegador.
  const committed: { turn: number; html: string; storage: string; a11y: string }[] = [];
  let shotB = false;
  for (let i = 0; i < 14; i++) {
    const st = matchId ? (await api(t, "/api/game/duel", { action: "state", matchId })).json?.view : null;
    if (!st || st.status !== "IN_PROGRESS") break;
    if (!st.youAreAttacker && st.pendingRival) {
      await waitFor(c.tab, `!!document.querySelector('[data-testid="rival-committed"]')`, 15000);
      const s = await c.tab.js<any>(SNAP);
      const ax = await c.tab.send("Accessibility.getFullAXTree", {}).catch(() => null) as any;
      committed.push({ turn: st.turn, html: s.html, storage: s.storage, a11y: JSON.stringify(ax ?? "") });
      const p = st.pendingRival;
      check(`T${st.turn} · carta comprometida boca abajo: sin cara ni texto de la carta`, !!s.committed && s.committed.imgs === 0 && s.committed.text === "", s.committed);
      check(`T${st.turn} · reverso con la pista (${p.hint?.type ?? "sin pista"}) y el rol (${p.role}) de esa carta`,
        (!p.hint || (!!s.committed.hintSrc && s.committed.hintOk === true && s.topSrcs.includes(s.committed.hintSrc))) && (!p.role || !!s.committed.role) && /boca abajo/.test(s.committed.label ?? ""),
        { committed: s.committed, p });
      if (!shotB) { await c.tab.shot(join(OUT, "B-carta-oculta-1440.png")).catch(() => null); shotB = true; }
    }
    const r = await playOneUi(c);
    if (r !== "played") { check(`jugada T${st.turn}`, false, r); break; }
    await sleep(2500);
    if (committed.length === 1 && committed[0].turn === st.turn) await c.tab.shot(join(OUT, "C-revelada-1440.png")).catch(() => null);
    await c.tab.js(`document.querySelector('[data-f61="moment"]')?.click()`).catch(() => null);
  }
  const fin = matchId ? (await api(t, "/api/game/duel", { action: "state", matchId })).json?.view : null;
  check("la partida terminó", !!fin && fin.status !== "IN_PROGRESS", fin?.status);
  check("el bot comprometió al menos una carta durante la partida", committed.length > 0, committed.length);
  for (const k of committed) {
    const turn = fin.history.find((h: any) => h.number === k.turn);
    const card = fin.rivalUsed.find((x: any) => x.uid === turn?.rival.uid);
    const own = new Set([...fin.yourUsed, ...fin.yourHand].flatMap((x: any) => [x.uid, x.cardId, x.playerId, x.nick]));
    if (card?.cardId && ownedCardIds.has(card.cardId)) own.add(card.cardId);
    const secrets = [card?.uid, card?.cardId, card?.playerId, card?.nick].filter((x) => x && !own.has(x)) as string[];
    // uid e id de carta: subcadena exacta. Nick e id de jugador (pueden ser cortos, p. ej. «ara» ⊂ «para»): palabra
    // completa, sin distinguir mayúsculas.
    const hit = (txt: string, s: string) => s === card?.uid || s === card?.cardId
      ? txt.includes(s)
      : new RegExp(`(?<![\\p{L}\\p{N}_-])${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_-])`, "iu").test(txt);
    const where = secrets.flatMap((s) => [["DOM", k.html], ["a11y", k.a11y], ["storage", k.storage]].filter(([, txt]) => hit(txt, s)).map(([w]) => `${w}:${s}`));
    check(`T${k.turn} · la carta luego revelada no estaba en DOM, árbol accesible ni almacenamiento (${secrets.length} claves: uid, jugador, nick + id de carta si no la posees)`, secrets.length >= 3 && where.length === 0, { where, secrets: secrets.length });
  }

  // Resultado.
  await waitFor(c.tab, `!!document.querySelector('[data-scene="result"]')`, 30000);
  await sleep(1500);
  const rw = fin?.result?.rewards;
  const credits = (rw?.grants ?? []).reduce((s: number, g: any) => s + (g.reward?.credits ?? 0), 0);
  const res = await c.tab.js<any>(`(() => { const r = document.querySelector('[data-testid="quick-result-rewards"]'); return { has: !!r, text: r ? r.textContent : '', kind: document.querySelector('[data-result="quick"]')?.dataset.kind ?? null }; })()`);
  console.log(`RECIBO ${JSON.stringify(rw)} · UI ${JSON.stringify(res)}`);
  if ((rw?.grants ?? []).length > 0) check("«Recompensas obtenidas» con los créditos del recibo", res.has && /Recompensas obtenidas/i.test(res.text) && res.text.includes(`+${credits.toLocaleString("es-ES")}`), res);
  else check("recibo sin concesiones → sin sección", !res.has, res);
  await c.tab.shot(join(OUT, `${res.kind === "loss" ? "F-derrota" : "E-victoria"}-recompensas-1440.png`)).catch(() => null);
  await reload(c, 4000);
  const res2 = await c.tab.js<any>(`(() => { const r = document.querySelector('[data-testid="quick-result-rewards"]'); return { has: !!r, text: r ? r.textContent : '' }; })()`);
  check("F5: el resultado sigue enseñando el mismo recibo", res2.has === res.has && res2.text === res.text, { res, res2 });
  await c.tab.resize(390, 844, 1);
  await sleep(1200);
  const narrow = await c.tab.js<number>(`document.documentElement.scrollWidth - innerWidth`);
  check("390: sin desbordamiento horizontal", narrow <= 0, narrow);
  await c.tab.shot(join(OUT, "E-resultado-390.png")).catch(() => null);
  const errs = c.tab.takeErrors().filter((e: string) => !/status of (401|503)/.test(e) && !/api\/telemetry/.test(e));
  check("consola limpia", errs.length === 0, errs.slice(0, 5));
} finally { await c.browser.close().catch(() => null); }
writeFileSync(join(OUT, "result.json"), JSON.stringify({ at: new Date().toISOString(), pass, fail }, null, 1));
console.log(`\nDUEL UX 2.0 PROD BROWSER: ${pass}/${pass + fail}`);
process.exitCode = fail ? 1 : 0;
