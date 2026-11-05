/**
 * FASE 69 · F68-010/011/012 — juega un partido del Tactical Coach por la INTERFAZ y mide la autoridad del HUD:
 * servidor y HUD ANTES, en la ceremonia (sin recargar), DESPUÉS de sincronizar y tras F5. Además registra, en cada
 * preparación, la recomendación de la IA (ronda pistola) y los botones de la fase de compra. Fuera de CI.
 *   npx tsx scripts/_fase69-coach.ts <persona> <etiqueta> [ancho]
 */
import {
  openBrowser, loginUi, goto, reload, sleep, token, api, net, collectErrors,
  writeRaw69, shot69, serverWallet, hudWallet, type Client,
} from "./_fase69-lib";
import { playCoach as playCoachF68 } from "./_fase68-coach2";

/* eslint-disable @typescript-eslint/no-explicit-any */
async function observeRound(c: Client) {
  return c.tab.js<any>(`(() => {
    const t = (document.querySelector('main') || document.body).innerText.replace(/\\s+/g, ' ');
    const vis = [...document.querySelectorAll('button')].filter(x => x.offsetParent !== null);
    const txt = (x) => (x.innerText || '').trim().replace(/\\s+/g, ' ');
    return {
      round: (t.match(/RONDA\\s*(\\d+)/i) || [])[1] || null,
      pistol: /pistola/i.test(t),
      // Solo el CONCEPTO que recomienda la IA («RECOMENDACIÓN IA · N% confianza · <concepto> ›»), no el tramo de compra.
      recommendsSave: /RECOMENDACI[ÓO]N IA\\s*\\d+%\\s*confianza\\s*[^›]*\\bSAVE\\b[^›]*›/i.test(t),
      recommendation: (t.match(/(RECOMENDACI[ÓO]N IA\\s*\\d+%\\s*confianza\\s*[^›]*›[^.]{0,140})/i) || [])[1] || null,
      economyBroken: /econom[ií]a est[aá] tocada/i.test(t),
      buyButtons: vis.map(txt).filter(s => /^(Comprar y empezar ronda|Jugar la ronda|Empezar ronda|Comprar)/i.test(s)),
      rewardCopy: /\\+\\s?\\d+\\s*(XP|cr[eé]ditos)|Recompensa/i.test(t),
    };
  })()`);
}

/**
 * Juega el partido con el bucle ÚNICO de F68 (`_fase68-coach2.ts`) y observa cada paso con sus ganchos: la
 * recomendación de la preparación (ronda pistola, F68-011) y las órdenes de la compra (F68-012).
 */
export async function playCoach(c: Client, t: string, label: string) {
  const obsOut: any = { observations: [] };
  let shotBuy = false, shotPrep = false;
  const play: any = await playCoachF68(c, t, label, {
    onStep: async (cc) => {
      const obs = await observeRound(cc);
      // F68-012 dejó la orden de la preparación SOLO en el pie anclado («Comenzar fase de compra»).
      const inPrep = await cc.tab.js<boolean>(`[...document.querySelectorAll('button')].some(b => b.offsetParent !== null && /^(Confirmar plan|Comenzar fase de compra)/i.test((b.innerText||'').trim()))`);
      if (inPrep) (obsOut.prepObs ??= []).push(obs);
      if (obs.buyButtons.length) obsOut.observations.push(obs);
      if (!shotPrep && inPrep) { shotPrep = true; await shot69(cc, `${label}-prep-r1`); obsOut.prepR1 = obs; }
      if (!shotBuy && obs.buyButtons.length) { shotBuy = true; await shot69(cc, `${label}-buy`); obsOut.buyR1 = obs; }
    },
    finalShot: (cc) => shot69(cc, `${label}-final`),
  });
  const final = await c.tab.js<string>(`document.body.innerText.replace(/\\s+/g, ' ').slice(0, 600)`);
  const ceremonyRewardCopy = await c.tab.js<boolean>(`/\\+\\s?\\d+\\s*XP|Cr[eé]ditos\\s*\\+\\d|\\+\\d+\\s*cr[eé]ditos/i.test(document.body.innerText)`);
  return { ...play, ...obsOut, final, ceremonyRewardCopy };
}

if (process.argv[1]?.includes("_fase69-coach")) (async () => {
  const p = process.argv[2]; const label = process.argv[3] ?? "run"; const W = Number(process.argv[4] ?? 1440);
  const c = await openBrowser(p, W, { label: `coach-${p}-${label}` });
  const out: any = { persona: p, label, width: W, at: new Date().toISOString() };
  try {
    const t = await token(p);
    out.historyBefore = (await api(t, "/api/game/coach-matches")).json?.total ?? null;
    out.serverBefore = await serverWallet(t);
    await loginUi(c, p);
    await goto(c, "/entrenador", 3000);
    out.hudBefore = await hudWallet(c);
    out.play = await playCoach(c, t, `${p}-${label}`);
    out.hudAtCeremony = await hudWallet(c);           // sin recargar: lo que el jugador ve al terminar
    out.serverAfter = await serverWallet(t);
    await sleep(6000);                                  // freno de CloudSync (5 s) + foco
    out.hudAfterSettle = await hudWallet(c);
    await reload(c, 4000);
    out.hudAfterReload = await hudWallet(c);
    out.serverAfterReload = await serverWallet(t);
    out.historyAfter = (await api(t, "/api/game/coach-matches")).json?.total ?? null;
    await collectErrors(c);
    out.errors = c.errors; out.network = await net(c);
  } finally { await c.browser.close(); }
  // /api/game/state no trae nivel (null): el HUD se compara en créditos con el servidor, y su nivel consigo mismo.
  const same = (a: any, b: any) => a?.credits != null && a?.credits === b?.credits;
  out.verdict = {
    serverUnchanged: out.serverBefore?.credits === out.serverAfter?.credits && out.serverBefore?.xp === out.serverAfter?.xp
      && out.serverAfter?.credits === out.serverAfterReload?.credits && out.serverAfter?.xp === out.serverAfterReload?.xp,
    hudBeforeEqualsServer: same(out.hudBefore, out.serverBefore),
    hudCeremonyEqualsServer: same(out.hudAtCeremony, out.serverAfter),
    hudSettleEqualsServer: same(out.hudAfterSettle, out.serverAfter),
    hudReloadEqualsServer: same(out.hudAfterReload, out.serverAfterReload),
    hudLevelUnchanged: out.hudBefore?.level != null && out.hudBefore?.level === out.hudAtCeremony?.level && out.hudBefore?.level === out.hudAfterReload?.level,
    pistolRecommendsSave: !!out.play?.prepR1?.recommendsSave,
    buyCtas: out.play?.buyR1?.buyButtons ?? null,
    historyGrew: typeof out.historyBefore === "number" && out.historyAfter === out.historyBefore + 1,
    rewardCopyShown: !!out.play?.ceremonyRewardCopy,
  };
  writeRaw69(`coach-${p}-${label}`, out);
  console.log(JSON.stringify({ serverBefore: out.serverBefore, hudBefore: out.hudBefore, hudAtCeremony: out.hudAtCeremony, serverAfter: out.serverAfter, hudAfterReload: out.hudAfterReload, verdict: out.verdict, prepR1: out.play?.prepR1, buyR1: out.play?.buyR1 }, null, 1));
})();
