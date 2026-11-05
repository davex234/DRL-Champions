/**
 * F72.3 · QA REAL DE LAS PISTAS CON ASSETS LOCALES (fuera de CI) — Chrome real contra :3005, cuenta QA.
 *
 * Por anchura (1440 / 1024 / 390): JUGAR → DUELOS → PARTIDA RÁPIDA → tablero; busca (reintentando partidas nuevas, sin
 * inventar nada) una mano rival con pista COUNTRY y TEAM a la vez; capturas del tablero, de la mano y de un dorso de cada
 * tipo; 0 texto, 0 imágenes rotas, 0 recursos de otro host (Resource Timing de TODA la sesión), 0 errores de consola;
 * recargar y RECONECTAR (navegador nuevo, sesión nueva) = mismas pistas; API `{type,value}|null`.
 * En 1440 además juega la partida entera por la API: cada carta que el rival revela se recalcula con el algoritmo del
 * servidor (mismo hash, mismo resolvedor) y tiene que ser la pista que se vio mientras estaba oculta, y desaparecer de la
 * mano al revelarse. Así se demuestra el fallback de los equipos SIN logo con cartas reales. Abandona lo que abre.
 *
 *   npx tsx scripts/_f723-qa.ts [persona=A] [anchuras=1440,1024,390]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, loginUi, goto, sleep, waitFor, token, api, type Client } from "./_fase68-lib";
import { hintForCard } from "../src/domain/cardgame/hints";
import { visualHintValue } from "../src/lib/duel/hintVisuals";
import { HINT_TEAM_LOGOS } from "../src/data/teamLogos";
import { getCard, getPlayer } from "../src/data/catalog";
import { canonicalCardTeam } from "../src/data/teamIdentities";

const P = process.argv[2] ?? "A";
const WIDTHS = (process.argv[3] ?? "1440,1024,390").split(",").map(Number);
const OUT = join(process.cwd(), process.env.F723_OUT ?? "docs/product/qa/fase72-3");
const SHOTS = join(OUT, "shots");
mkdirSync(SHOTS, { recursive: true });
const ORIGIN = process.env.BASE_URL ?? "http://127.0.0.1:3005";

const RT = `(() => { try { performance.setResourceTimingBufferSize(20000); } catch {} })();`;

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
  return boardReady(c);
}
const boardReady = (c: Client, ms = 30000) => waitFor(c.tab, `(() => { document.querySelector('[data-f61="moment"]')?.click(); return document.querySelectorAll('[data-testid="rival-hint"]').length > 0 && !document.querySelector('[data-scene="intro"]'); })()`, ms);

const readHints = (c: Client) => c.tab.js<any>(`(() => {
  const els = [...document.querySelectorAll('[data-testid="rival-hint"]')];
  const hints = els.map(e => { const a = e.querySelector('[data-hint-art]'); const r = (a || e).getBoundingClientRect(); const cs = a ? getComputedStyle(a) : null;
    // F72.8 · la pista es un <img> (antes fondo CSS): «img» = alguna OTRA imagen (una foto), que no debe haber.
    return { type: e.getAttribute('data-hint-type'), shape: e.getAttribute('data-hint-shape'), text: (e.innerText || '').trim(), img: !!e.querySelector('img:not([data-hint-art])'),
      art: (a && a.getAttribute('src')) || '', size: cs && cs.objectFit, pos: cs && cs.objectPosition, w: Math.round(r.width), h: Math.round(r.height) }; });
  const hand = els[0]?.parentElement?.closest('[aria-label]');
  return { hints, handText: hand ? (hand.innerText || '').trim() : '', path: location.pathname };
})()`);
const sig = (x: any) => JSON.stringify(x.hints.map((h: any) => [h.type, h.art]).sort());

/** Todo recurso pedido por la página (fetch, css, imágenes de fondo…) que no sea del propio origen. */
const foreignResources = (c: Client) => c.tab.js<any>(`(() => { const all = performance.getEntriesByType('resource').map(e => e.name);
  return { total: all.length, hintAssets: all.filter(u => /\\/(flags|hints)\\//.test(u)), foreign: all.filter(u => !u.startsWith(location.origin) && !u.startsWith('data:') && !u.startsWith('blob:')) }; })()`);

// F72.8 · rota = el <img> no cargó (naturalWidth 0) o lo ocultó su onError.
const brokenArt = (c: Client) => c.tab.js<number>(`[...document.querySelectorAll('img[data-hint-art]')].filter(i => !(i.complete && i.naturalWidth > 0) || i.style.visibility === 'hidden').length`);

async function shotEl(c: Client, selector: string, file: string, pad = 10, scale = 3) {
  const box = await c.tab.js<any>(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(selector)})]; if (!els.length) return null; const rs = els.map(e => e.getBoundingClientRect());
    const l = Math.min(...rs.map(r => r.left)), t = Math.min(...rs.map(r => r.top)); return { x: Math.max(0, l - ${pad}), y: Math.max(0, t - ${pad}), width: Math.max(...rs.map(r => r.right)) - l + ${pad * 2}, height: Math.max(...rs.map(r => r.bottom)) - t + ${pad * 2} }; })()`);
  if (!box) return false;
  const s = await c.tab.send("Page.captureScreenshot", { format: "png", clip: { ...box, scale } }).catch(() => null);
  if (s?.data) writeFileSync(join(SHOTS, file), Buffer.from(s.data, "base64"));
  return !!s?.data;
}

const countryOf = (pid: string) => getPlayer(pid)?.country ?? "";
const printedTeam = (cardId: string) => { const d = getCard(cardId); return d ? canonicalCardTeam(d, getPlayer(d.playerId)).key : "?"; };
const recompute = (matchId: string, c: any) => hintForCard(matchId, { uid: c.uid, cardId: c.cardId, playerId: c.playerId, team: c.team, region: c.region, role: c.role }, countryOf, visualHintValue);
const key = (h: any) => (h ? `${h.type}:${h.value}` : "null");

(async () => {
  const t = await token(P);
  const duel = (body: any) => api(t, "/api/game/duel", body);
  const all: any = {};
  for (const width of WIDTHS) {
    const results: { id: string; ok: boolean; detail: string }[] = [];
    const check = (id: string, ok: boolean, detail = "") => { results.push({ id, ok, detail: detail.slice(0, 600) }); console.log(`${ok ? "PASS" : "FAIL"} [${width}] ${id} ${detail.slice(0, 200)}`); };
    const errors: string[] = [];
    const foreign: string[] = []; const hintAssets = new Set<string>();
    const out: any = { width, persona: P, at: new Date().toISOString() };
    // Partida limpia: si quedó una abierta de otra ejecución, se retira.
    const stale = (await duel({ action: "active" })).json?.view?.matchId;
    if (stale) await duel({ action: "abandon", matchId: stale });

    let c = await openBrowser(P, width, { label: "f723" });
    await c.tab.send("Page.addScriptToEvaluateOnNewDocument", { source: RT });
    try {
      await loginUi(c, P);
      // 1 · Buscar una mano rival que mezcle COUNTRY y TEAM (partidas reales; si una no lo da, se abandona y otra).
      let r: any = null; let view: any = null; const tried: string[] = [];
      for (let attempt = 0; attempt < 6; attempt++) {
        const ok = await reachBoard(c);
        await sleep(1200);
        r = await readHints(c);
        view = (await duel({ action: "active" })).json?.view;
        tried.push(`${view?.matchId}:${r.hints.map((h: any) => h.type[0]).join("")}`);
        if (ok && r.hints.some((h: any) => h.type === "TEAM") && r.hints.some((h: any) => h.type === "COUNTRY")) break;
        if (view?.matchId) await duel({ action: "abandon", matchId: view.matchId });
      }
      out.matchAttempts = tried;
      out.matchId = view?.matchId;
      out.boardPath = r.path;
      out.hints = r.hints;
      errors.push(...c.tab.takeErrors());
      await c.tab.shot(join(SHOTS, `tablero-${width}.png`)).catch(() => null);
      await shotEl(c, '[data-testid="rival-hint"]', `mano-rival-${width}.png`);
      const iC = r.hints.findIndex((h: any) => h.type === "COUNTRY"), iT = r.hints.findIndex((h: any) => h.type === "TEAM");
      for (const [i, name] of [[iC, "country"], [iT, "team"]] as const) {
        if (i < 0) continue;
        await c.tab.js(`(() => { document.querySelectorAll('[data-f723]').forEach(e => e.removeAttribute('data-f723')); document.querySelectorAll('[data-testid="rival-hint"]')[${i}]?.setAttribute('data-f723', '1'); })()`);
        await shotEl(c, '[data-f723="1"]', `dorso-${name}-${width}.png`, 6, 4);
      }
      const types = r.hints.map((h: any) => h.type);
      check("A · pista COUNTRY: solo bandera LOCAL (/flags/*.svg, forma flag)", iC >= 0 && r.hints.filter((h: any) => h.type === "COUNTRY").every((h: any) => h.shape === "flag" && /^\/flags\/[a-z]{2}\.svg$/.test(h.art)), JSON.stringify(r.hints[iC] ?? null));
      check("B · pista TEAM: solo logo LOCAL (/hints/teams/<canonicalId>.png, forma logo)", iT >= 0 && r.hints.filter((h: any) => h.type === "TEAM").every((h: any) => h.shape === "logo" && /^\/hints\/teams\/[a-z0-9-]+\.png$/.test(h.art) && HINT_TEAM_LOGOS.has(h.art.split("/").pop().replace(".png", ""))), JSON.stringify(r.hints[iT] ?? null));
      check("C · varias cartas ocultas a la vez con mezcla real de banderas y logos", r.hints.length >= 2 && types.includes("COUNTRY") && types.includes("TEAM"), `${r.hints.length} pistas: ${types.join(",")} · intentos=${tried.length}`);
      check("H · 0 texto en las pistas y en la mano oculta (sin ISO, tag, nombre ni abreviatura)", r.hints.every((h: any) => h.text === "" && !h.img) && !/[A-Za-zÀ-ÿ]{2,}/.test(r.handText.replace(/El rival tiene \d+ cartas ocultas/i, "")), `handText=«${r.handText.slice(0, 80)}»`);
      check("legible y proporcionado (contain, centrado; bandera ≥ 18 px, logo ≥ 18 px, caja del logo cuadrada)", r.hints.every((h: any) => /contain/.test(h.size) && /50% 50%/.test(h.pos) && h.w >= 18 && (h.shape !== "logo" || Math.abs(h.w - h.h) <= 1) && (h.shape !== "flag" || Math.abs(h.w / h.h - 4 / 3) < 0.08)), JSON.stringify(r.hints.map((h: any) => `${h.shape}:${h.w}x${h.h}`)));
      const broken = await brokenArt(c);
      check("I · 0 imágenes rotas", broken === 0, `rotas=${broken}`);
      // API · lo que viaja de las ocultas.
      const hs = (view?.rivalHints ?? []) as any[];
      check("API · una entrada por carta oculta, cada una { type, value } o null; valor = id de asset local", hs.length === view?.rivalRemaining && hs.every((h) => h === null || (Object.keys(h).sort().join() === "type,value" && (h.type === "COUNTRY" ? /^[A-Z]{2}$/.test(h.value) : h.type === "TEAM" && HINT_TEAM_LOGOS.has(h.value)))), JSON.stringify(hs));
      out.apiHints = hs;
      // 2 · Recargar (E).
      await c.tab.send("Page.reload", {}); await sleep(3500);
      await boardReady(c, 20000);
      const again = await readHints(c);
      check("E · recargar = mismas pistas", sig(again) === sig(r), sig(again).slice(0, 160));
      const res1 = await foreignResources(c);
      foreign.push(...res1.foreign); res1.hintAssets.forEach((u: string) => hintAssets.add(u));
      errors.push(...c.tab.takeErrors());
      // 3 · Reconectar (F): navegador nuevo, login nuevo, misma ruta de la partida.
      await c.browser.close();
      c = await openBrowser(P, width, { label: "f723-reconnect" });
      await c.tab.send("Page.addScriptToEvaluateOnNewDocument", { source: RT });
      await loginUi(c, P);
      await goto(c, r.path, 3000);
      if (!(await boardReady(c, 20000))) await reachBoard(c);
      const re = await readHints(c);
      const reView = (await duel({ action: "active" })).json?.view;
      check("F · reconectar (navegador y sesión nuevos) = misma partida y mismas pistas", reView?.matchId === view?.matchId && sig(re) === sig(r) && JSON.stringify(reView?.rivalHints) === JSON.stringify(hs), `match=${reView?.matchId === view?.matchId}`);

      // 4 · (1440) Revelar: jugar la partida entera y recalcular cada carta revelada.
      if (width === WIDTHS[0] && view?.matchId) {
        const seenHidden: string[] = hs.map(key);
        const revealLog: any[] = []; let v = reView; let guard = 0; let removalOk = true; let domOk = true;
        while (v && v.status === "IN_PROGRESS" && guard++ < 40) {
          const before = (v.rivalHints ?? []).map(key);
          const card = v.yourHand?.[0];
          if (!card) break;
          const body: any = { action: "play", matchId: v.matchId, cardUid: card.uid, expectedVersion: v.stateVersion };
          if (v.youAreAttacker) body.stat = "gamesense";
          const res = await duel(body);
          if (res.status !== 200) console.log(`  play ${res.status} ${JSON.stringify(res.json).slice(0, 200)} phase=${v.phase} attacker=${v.youAreAttacker}`);
          const nv = res.json?.view ?? (await duel({ action: "active" })).json?.view;
          if (!nv) break;
          const revealed = [...(nv.rivalUsed ?? []), ...(nv.pendingRival ? [nv.pendingRival.card] : [])].filter((x: any) => !revealLog.some((y) => y.uid === x.uid));
          for (const rc of revealed) {
            const h = recompute(nv.matchId, rc);
            const team = printedTeam(rc.cardId);
            revealLog.push({ uid: rc.uid, cardId: rc.cardId, team, teamHasLogo: HINT_TEAM_LOGOS.has(team), country: countryOf(rc.playerId), recomputed: h, seenWhileHidden: seenHidden.includes(key(h)) });
          }
          const after = (nv.rivalHints ?? []).map(key);
          if (nv.status === "IN_PROGRESS" && after.length !== nv.rivalRemaining) removalOk = false;
          // La pista de lo que sale de la mano oculta (pasa a `rivalUsed`) sale de la lista: antes − usadas = después. La carta
          // que el rival acaba de DECLARAR (`pendingRival`) sigue contando como oculta hasta cerrar el turno (contrato F71).
          const newlyUsed = (nv.rivalUsed ?? []).filter((x: any) => !(v.rivalUsed ?? []).some((y: any) => y.uid === x.uid));
          if (newlyUsed.length && nv.status === "IN_PROGRESS") {
            const rest = [...before];
            for (const rc of newlyUsed) { const k = key(recompute(nv.matchId, rc)); const i = rest.indexOf(k); if (i >= 0) rest.splice(i, 1); else removalOk = false; }
            if (JSON.stringify([...rest].sort()) !== JSON.stringify([...after].sort())) removalOk = false;
          }
          v = nv;
          if (guard === 2 && v.status === "IN_PROGRESS") {
            // G en el DOM: tras revelarse, el tablero pinta tantas pistas como cartas siguen ocultas.
            await c.tab.send("Page.reload", {}); await sleep(3500); await boardReady(c, 20000);
            const dom = await readHints(c);
            domOk = dom.hints.length === v.rivalRemaining;
            await c.tab.shot(join(SHOTS, `tras-revelar-${width}.png`)).catch(() => null);
            out.afterReveal = { rivalRemaining: v.rivalRemaining, domHints: dom.hints.length, rivalUsed: (v.rivalUsed ?? []).map((x: any) => x.cardId) };
          }
        }
        out.reveal = { status: v?.status, revealed: revealLog };
        const noLogo = revealLog.filter((x) => !x.teamHasLogo);
        const withLogo = revealLog.filter((x) => x.teamHasLogo);
        check("servidor = algoritmo: cada carta revelada tiene la pista que se vio oculta (mismo hash y resolvedor)", revealLog.length > 0 && revealLog.every((x) => x.seenWhileHidden), `${revealLog.length} reveladas`);
        check("D · equipo SIN logo: nunca TEAM, cae a la bandera (siguiente tipo disponible), jamás placeholder", noLogo.length > 0 && noLogo.every((x) => x.recomputed?.type === "COUNTRY" && x.seenWhileHidden), JSON.stringify(noLogo.map((x) => `${x.cardId}(${x.team})→${key(x.recomputed)}`)));
        check("equipo CON logo: su pista TEAM (si la hay) es el logo de su equipo IMPRESO", withLogo.every((x) => x.recomputed?.type !== "TEAM" || x.recomputed.value === x.team), JSON.stringify(withLogo.map((x) => `${x.cardId}(${x.team})→${key(x.recomputed)}`)));
        check("G · al revelarse, la pista de esa carta desaparece (API y DOM cuadran con las que siguen ocultas)", removalOk && domOk, JSON.stringify(out.afterReveal ?? {}));
        if (v?.status === "IN_PROGRESS") await duel({ action: "abandon", matchId: v.matchId });
      } else if (view?.matchId) {
        await duel({ action: "abandon", matchId: view.matchId });
      }
      const res2 = await foreignResources(c);
      foreign.push(...res2.foreign); res2.hintAssets.forEach((u: string) => hintAssets.add(u));
      errors.push(...c.tab.takeErrors());
      const failedFetch = errors.filter((e) => /Failed to fetch/i.test(e));
      // Las pistas: ni un recurso de otro host (y ninguno de los hosts vetados en toda la sesión). Lo demás de otro host
      // (hoy las fuentes de Google que carga el layout de la app, ajeno a las pistas) se registra aparte, sin esconderlo.
      const BANNED = /flagcdn|valorant-api|valorantesports|vlr\.gg|liquipedia|github|jsdelivr|unpkg|cdnjs/i;
      const hintForeign = foreign.filter((u) => /\/(flags|hints)\//.test(u) || BANNED.test(u));
      out.otherForeignHosts = [...new Set(foreign.filter((u) => !hintForeign.includes(u)).map((u) => new URL(u).host))];
      check("J · 0 peticiones de pistas a otro host (ni flagcdn, CDN, GitHub, valorant-api, VLR, Liquipedia): todos sus assets del propio origen", hintForeign.length === 0 && hintAssets.size > 0 && [...hintAssets].every((u) => u.startsWith(ORIGIN)), `hintForeign=${hintForeign.length} · hintAssets=${hintAssets.size} · otros hosts (no pistas)=${out.otherForeignHosts.join(",")}`);
      check("K · 0 errores de consola", errors.length === 0, errors[0] ?? "");
      check("L · 0 «Failed to fetch»", failedFetch.length === 0, failedFetch[0] ?? "");
      out.network = { foreign, hintAssets: [...hintAssets].sort() };
      out.consoleErrors = errors;
    } finally {
      await c.browser.close().catch(() => null);
      const left = (await duel({ action: "active" })).json?.view?.matchId;
      if (left) await duel({ action: "abandon", matchId: left });
    }
    out.pass = results.filter((x) => x.ok).length; out.total = results.length; out.results = results;
    writeFileSync(join(OUT, `browser-${width}.json`), JSON.stringify(out, null, 2) + "\n");
    all[width] = out;
  }
  const net = Object.fromEntries(Object.entries(all).map(([w, o]: any) => [w, o.network]));
  writeFileSync(join(OUT, "external-network.json"), JSON.stringify({ at: new Date().toISOString(), method: "Resource Timing de toda la sesión (login, tablero, recarga, reconexión) + fuentes de las pistas; el asset de la pista es CSS background, así que también cuenta", byWidth: net, foreignTotal: Object.values(net).reduce((s: number, n: any) => s + (n?.foreign?.length ?? 0), 0) }, null, 2) + "\n");
  const pass = Object.values(all).reduce((s: number, o: any) => s + o.pass, 0), total = Object.values(all).reduce((s: number, o: any) => s + o.total, 0);
  console.log(`f72.3 browser: ${pass}/${total}`);
  process.exit(pass === total ? 0 : 1);
})();
