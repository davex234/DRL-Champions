/**
 * F72.8 · QA REAL DEL RELOJ DE LAS DECISIONES (fuera de CI) — Chrome real contra :3005 (build de producción).
 *
 * Nada de relojes falsos: se ESPERA el plazo real de 30 s.
 *
 *   PvE (persona A) por anchura 1440 / 1024 / 390:
 *     · el contador del HUD, muestreado cada 150 ms: 00:30 … 00:10 … 00:05 00:04 00:03 00:02 00:01 00:00 (capturas);
 *     · no se toca nada: al llegar a 0 la partida avanza SOLA (versión +1, turno resuelto, jugada automática
 *       registrada, aviso «Tiempo agotado», plazo nuevo); se mide el retraso respecto al plazo del servidor;
 *     · se sigue hasta ver al menos un vencimiento ATACANDO y uno DEFENDIENDO.
 *   1440, además:
 *     · F5 con ~5 s: tras recargar el contador NO vuelve a 30 y vence en el plazo ORIGINAL;
 *     · dos clientes de la misma cuenta (dos navegadores, dos sesiones = dos pestañas para el servidor): UNA
 *       resolución y los dos ven lo mismo.
 *   PvP (personas F y G, ranked real): nadie juega; al vencer, el servidor juega por quien debía, los dos reciben el
 *     mismo estado y la partida sigue (antes: se cerraba EXPIRED). Se abandona al final.
 *
 *   npx tsx scripts/_f728-timer-qa.ts [pve|pvp|all] [anchuras=1440,1024,390]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, loginUi, goto, sleep, waitFor, token, api, type Client } from "./_fase68-lib";

const WHAT = process.argv[2] ?? "all";
const WIDTHS = (process.argv[3] ?? "1440,1024,390").split(",").map(Number);
const OUT = join(process.cwd(), process.env.F728_OUT ?? "docs/product/qa/fase72-8/timer");
mkdirSync(OUT, { recursive: true });
const results: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail = "") => { results.push({ id, ok, detail: detail.slice(0, 700) }); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${detail.slice(0, 260)}`); };
const WANT = ["00:10", "00:05", "00:04", "00:03", "00:02", "00:01", "00:00"];

async function reachBoard(c: Client): Promise<boolean> {
  await goto(c, "/jugar", 2500);
  await c.tab.js(`document.querySelector('[data-testid="play-area-cta-DUELS"]')?.click()`);
  await waitFor(c.tab, `location.pathname === '/duelos' && !!document.querySelector('[data-testid="duel-mode-cta-QUICK"]')`, 15000);
  await c.tab.js(`document.querySelector('[data-testid="duel-mode-cta-QUICK"]')?.click()`);
  await sleep(3500);
  if (await c.tab.js<boolean>(`/Comenzar duelo/i.test(document.body.innerText)`)) {
    await c.tab.js(`[...document.querySelectorAll('button')].find(b => /^Comenzar duelo$/i.test((b.innerText||'').trim()))?.click()`);
    await sleep(2500);
  }
  return boardVisible(c);
}
const boardVisible = (c: Client, ms = 30000) => waitFor(c.tab, `(() => { document.querySelector('[data-f61="moment"]')?.click(); return !!document.querySelector('[data-testid="turn-timer"]') && !document.querySelector('[data-scene="intro"]'); })()`, ms);
const timerText = (c: Client) => c.tab.js<string | null>(`document.querySelector('[data-testid="turn-timer-value"]')?.textContent ?? null`);
const hud = async (c: Client, file: string) => {
  const box = await c.tab.js<any>(`(() => { const e = document.querySelector('[data-hud="partida"]') || document.querySelector('[data-testid="turn-timer"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top), width: innerWidth, height: Math.min(r.height + 4, 120) }; })()`);
  if (!box) return;
  const s = await c.tab.send("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 2 } }).catch(() => null);
  if (s?.data) writeFileSync(join(OUT, file), Buffer.from(s.data, "base64"));
};

/**
 * Espera a que la decisión en curso venza SOLA. Muestrea el contador y captura los valores pedidos. Devuelve lo visto,
 * la vista antes y después (API), el retraso respecto al plazo y si apareció el aviso.
 */
async function waitTimeout(c: Client, t: string, tag: string, extra?: Client) {
  const active = async () => (await api(t, "/api/game/duel", { action: "active" })).json?.view;
  const before = await active();
  const deadline = before?.turnDeadlineAt as number;
  const seen: string[] = []; const shots = new Set<string>(); let notice = false; let advancedAt: number | null = null; let after: any = null;
  const t0 = Date.now();
  // Registro DENTRO de la página, cada 50 ms: el muestreo desde aquí compite con las llamadas a la API y puede saltarse
  // un 00:00 que dura menos de un segundo.
  await c.tab.js(`(() => { window.__f728 = []; clearInterval(window.__f728t); window.__f728t = setInterval(() => { const v = document.querySelector('[data-testid="turn-timer-value"]')?.textContent; if (v && window.__f728[window.__f728.length - 1] !== v) window.__f728.push(v); }, 50); })()`).catch(() => null);
  while (Date.now() - t0 < 50_000) {
    const v = await timerText(c).catch(() => null);
    if (v && seen[seen.length - 1] !== v) {
      seen.push(v);
      if ((WANT.includes(v) || seen.length === 1) && !shots.has(v)) { shots.add(v); await hud(c, `${tag}-${v.replace(":", "")}.png`); }
    }
    if (!notice) notice = await c.tab.js<boolean>(`!!document.querySelector('[data-testid="timeout-notice"]')`).catch(() => false);
    if (Date.now() > deadline && (Date.now() - t0) % 600 < 160) {
      const now = await active();
      if (now && now.stateVersion !== before.stateVersion) { after = now; advancedAt = advancedAt ?? Date.now(); }
    }
    if (after && notice) break;
    if (after && Date.now() - (advancedAt ?? 0) > 4000) break;
    await sleep(150);
  }
  if (after) { await sleep(400); await c.tab.shot(join(OUT, `${tag}-avanzado.png`)).catch(() => null); if (!notice) notice = await c.tab.js<boolean>(`!!document.querySelector('[data-testid="timeout-notice"]')`).catch(() => false); }
  const pageSeen = await c.tab.js<string[]>(`window.__f728 || []`).catch(() => [] as string[]);
  for (const v of pageSeen) if (!seen.includes(v)) seen.push(v);
  let extraView: any = null;
  if (extra) extraView = { timer: await timerText(extra).catch(() => null), turn: await extra.tab.js<string>(`document.querySelector('[data-testid="topbar-turn"]')?.innerText || ''`).catch(() => "") };
  return { before, after, deadline, seen, notice, lagMs: advancedAt ? advancedAt - deadline : null, extraView };
}

async function pve(width: number) {
  const P = "A";
  const t = await token(P);
  const duel = (body: any) => api(t, "/api/game/duel", body);
  const stale = (await duel({ action: "active" })).json?.view?.matchId;
  if (stale) await duel({ action: "abandon", matchId: stale });
  const c = await openBrowser(P, width, { label: "f728-timer", reduced: width === 390 });
  let c2: Client | null = null;
  try {
    await loginUi(c, P);
    check(`[${width}] tablero con contador en el HUD`, await reachBoard(c));
    const first = await timerText(c);
    check(`[${width}] el contador arranca en ~00:30 (servidor)`, !!first && /^00:(30|29|28|27|26|25)$/.test(first), `primero=${first}`);
    const kinds = new Set<string>();
    for (let k = 0; k < 4; k++) {
      const r = await waitTimeout(c, t, `pve-${width}-${k}`);
      const kind = r.before?.youAreAttacker ? "ATAQUE" : "DEFENSA";
      kinds.add(kind);
      const youT = (v: any) => (v?.timeouts ?? []).filter((x: any) => x.you).length;
      const played = r.after?.history?.[r.after.history.length - 1];
      check(`[${width}] ${kind} · el contador se vio bajar 10…5 4 3 2 1 0`, WANT.every((w) => r.seen.includes(w)), r.seen.join(" "));
      check(`[${width}] ${kind} · a 0 la partida avanza SOLA (versión +1, un turno más, jugada automática registrada)`,
        !!r.after && r.after.stateVersion === r.before.stateVersion + 1 && r.after.history.length === r.before.history.length + 1 && youT(r.after) === youT(r.before) + 1,
        JSON.stringify({ v: [r.before?.stateVersion, r.after?.stateVersion], h: [r.before?.history?.length, r.after?.history?.length], lagMs: r.lagMs }));
      check(`[${width}] ${kind} · carta de TU mano${kind === "DEFENSA" ? " y la estadística obligada" : " y estadística válida"}`,
        !!played && r.before.yourHand.some((x: any) => x.uid === played.you.uid) && ["stronghold", "gamesense", "entryfrag"].includes(played.you.stat) && (kind === "ATAQUE" || played.you.stat === r.before.requiredStat),
        JSON.stringify(played?.you ?? null));
      check(`[${width}] ${kind} · resuelto cerca del plazo del servidor (≤ 4 s) y aviso «Tiempo agotado» sin modal`, r.lagMs !== null && r.lagMs >= -300 && r.lagMs <= 4000 && r.notice, `retraso=${r.lagMs} ms aviso=${r.notice}`);
      check(`[${width}] ${kind} · la decisión siguiente nace con plazo nuevo`, !r.after || r.after.status !== "IN_PROGRESS" || r.after.turnDeadlineAt > r.deadline, `${r.deadline} → ${r.after?.turnDeadlineAt}`);
      if (kinds.has("ATAQUE") && kinds.has("DEFENSA") && (width !== 1440 || k >= 1)) break;
      await boardVisible(c, 12000);
    }
    check(`[${width}] vistos vencimientos atacando Y defendiendo`, kinds.has("ATAQUE") && kinds.has("DEFENSA"), [...kinds].join(","));

    if (width === 1440) {
      // ── F5 con ~5 s ──
      await boardVisible(c, 12000);
      const v0 = (await duel({ action: "active" })).json?.view;
      const deadline = v0.turnDeadlineAt as number;
      await waitFor(c.tab, `(document.querySelector('[data-testid="turn-timer-value"]')?.textContent || '') <= '00:05'`, 40000);
      const beforeF5 = await timerText(c);
      await hud(c, "f5-antes.png");
      await c.tab.send("Page.reload", {});
      await boardVisible(c, 20000);
      const afterF5 = await timerText(c);
      await hud(c, "f5-despues.png");
      const s = afterF5 ? Number(afterF5.slice(3)) : 99;
      check("[1440] F5 con ~5 s: el contador NO vuelve a 30 (sigue desde ~5)", s <= 6, `antes=${beforeF5} después=${afterF5}`);
      const vAfter = (await duel({ action: "active" })).json?.view;
      check("[1440] F5: el plazo del servidor es el MISMO", vAfter.turnDeadlineAt === deadline && vAfter.stateVersion === v0.stateVersion, `${deadline} vs ${vAfter.turnDeadlineAt}`);
      const r = await waitTimeout(c, t, "f5");
      check("[1440] F5: vence en el plazo ORIGINAL (±4 s)", r.lagMs !== null && Math.abs((r.lagMs ?? 99_999)) <= 4000 && r.deadline === deadline, `retraso=${r.lagMs} ms`);

      // ── Dos clientes de la misma cuenta ──
      await boardVisible(c, 12000);
      c2 = await openBrowser(P, 1440, { label: "f728-tab2" });
      await loginUi(c2, P);
      await goto(c2, "/duelos/jugar", 3000);
      const both = await boardVisible(c2, 20000);
      const [a1, b1] = [await timerText(c), await timerText(c2)];
      check("[1440] dos clientes: los dos ven el mismo contador (±1 s)", both && !!a1 && !!b1 && Math.abs(Number(a1.slice(3)) - Number(b1.slice(3))) <= 1, `${a1} / ${b1}`);
      const vBefore = (await duel({ action: "active" })).json?.view;
      const r2 = await waitTimeout(c, t, "multitab", c2);
      await sleep(2500);
      const vEnd = (await duel({ action: "active" })).json?.view;
      const t2 = await c2.tab.js<string>(`document.querySelector('[data-testid="topbar-turn"]')?.innerText || ''`);
      const t1 = await c.tab.js<string>(`document.querySelector('[data-testid="topbar-turn"]')?.innerText || ''`);
      check("[1440] dos clientes al vencer: UNA resolución (versión +1, una jugada automática)", !!r2.after && vEnd.stateVersion === vBefore.stateVersion + 1 && (vEnd.timeouts ?? []).length === (vBefore.timeouts ?? []).length + 1, JSON.stringify({ v: [vBefore.stateVersion, vEnd.stateVersion], to: [(vBefore.timeouts ?? []).length, (vEnd.timeouts ?? []).length] }));
      check("[1440] dos clientes: los dos muestran el mismo resultado", t1.replace(/\s+/g, " ") === t2.replace(/\s+/g, " "), `${t1.replace(/\s+/g, " ")} | ${t2.replace(/\s+/g, " ")}`);
      await c2.tab.shot(join(OUT, "multitab-cliente2.png")).catch(() => null);
    }
    const errs = [...c.tab.takeErrors(), ...(c2 ? c2.tab.takeErrors() : [])];
    check(`[${width}] 0 errores de consola / 0 Failed to fetch`, errs.length === 0, errs[0] ?? "");
  } finally {
    await c.browser.close().catch(() => null);
    if (c2) await c2.browser.close().catch(() => null);
    const left = (await duel({ action: "active" })).json?.view?.matchId;
    if (left) await duel({ action: "abandon", matchId: left });
  }
}

async function pvp() {
  const [PA, PB] = ["F", "G"];
  const [ta, tb] = [await token(PA), await token(PB)];
  const mm = (t: string, body?: any) => api(t, "/api/game/duel/matchmaking", body);
  const pvpGet = (t: string, id: string) => api(t, `/api/game/duel/pvp?matchId=${id}`);
  for (const t of [ta, tb]) {
    const s = (await mm(t)).json?.entry;
    if (s?.state === "MATCHED" && s.matchId) { const snap = (await pvpGet(t, s.matchId)).json?.snapshot; if (snap && snap.lifecycle === "IN_TURN") await api(t, "/api/game/duel/pvp", { action: "abandon", matchId: s.matchId }); }
    await mm(t, { action: "cancel" });
  }
  const deckOf = async (t: string) => { const d = (await api(t, "/api/game/duels")).json; return d?.activeDeckId ?? (d?.decks ?? []).find((x: any) => x.valid)?.id; };
  await mm(ta, { action: "enqueue", deckId: await deckOf(ta) });
  await mm(tb, { action: "enqueue", deckId: await deckOf(tb) });
  let id: string | null = null;
  for (let i = 0; i < 20 && !id; i++) { const [a, b] = [(await mm(ta)).json?.entry, (await mm(tb)).json?.entry]; if (a?.state === "MATCHED" && b?.state === "MATCHED" && a.matchId === b.matchId) id = a.matchId; else await sleep(1500); }
  check("PvP · emparejamiento ranked real de dos cuentas QA", !!id, String(id));
  if (!id) return;
  const ca = await openBrowser(PA, 1440, { label: "f728-pvpA" }), cb = await openBrowser(PB, 1440, { label: "f728-pvpB" });
  try {
    await Promise.all([loginUi(ca, PA), loginUi(cb, PB)]);
    await Promise.all([goto(ca, "/duelos/pvp", 3000), goto(cb, "/duelos/pvp", 3000)]);
    await Promise.all([waitFor(ca.tab, `!!document.querySelector('[data-testid="turn-timer"]')`, 30000), waitFor(cb.tab, `!!document.querySelector('[data-testid="turn-timer"]')`, 30000)]);
    const s0a = (await pvpGet(ta, id)).json?.snapshot, s0b = (await pvpGet(tb, id)).json?.snapshot;
    check("PvP · los dos ven el MISMO plazo", s0a?.turnDeadlineAt === s0b?.turnDeadlineAt && typeof s0a?.turnDeadlineAt === "number", `${s0a?.turnDeadlineAt} / ${s0b?.turnDeadlineAt}`);
    const sleeperIsA = s0a.isYourTurn;
    const [sleeper, waiter] = sleeperIsA ? [ca, cb] : [cb, ca];
    check("PvP · 30 s por decisión", Math.abs(s0a.turnDeadlineAt - (s0a.turnStartedAt ?? 0) - 30_000) <= 5, `${s0a.turnDeadlineAt - s0a.turnStartedAt} ms`);
    const seen: string[] = []; const seenW: string[] = [];
    let after: any = null; let notice = false; const t0 = Date.now();
    while (Date.now() - t0 < 50_000) {
      const v = await timerText(sleeper), w = await timerText(waiter);
      if (v && seen[seen.length - 1] !== v) { seen.push(v); if (WANT.includes(v)) { await hud(sleeper, `pvp-decide-${v.replace(":", "")}.png`); await hud(waiter, `pvp-espera-${v.replace(":", "")}.png`); } }
      if (w && seenW[seenW.length - 1] !== w) seenW.push(w);
      notice ||= await waiter.tab.js<boolean>(`!!document.querySelector('[data-testid="timeout-notice"]')`);
      if (Date.now() > s0a.turnDeadlineAt + 500) { const s = (await pvpGet(sleeperIsA ? tb : ta, id)).json?.snapshot; if (s && s.stateVersion !== s0a.stateVersion) { after = s; } }
      if (after && notice) break;
      if (after && Date.now() - s0a.turnDeadlineAt > 8000) break;
      await sleep(200);
    }
    await sleep(1500);
    await sleeper.tab.shot(join(OUT, "pvp-decidia-tras.png")).catch(() => null);
    await waiter.tab.shot(join(OUT, "pvp-esperaba-tras.png")).catch(() => null);
    const fa = (await pvpGet(ta, id)).json?.snapshot, fb = (await pvpGet(tb, id)).json?.snapshot;
    const pub = (s: any) => JSON.stringify({ v: s.stateVersion, t: s.match.currentTurn, p: s.match.phase, a: s.match.usedA, b: s.match.usedB, to: s.match.timeouts ?? [] });
    check("PvP · el contador bajó hasta 00:00 en los dos lados", WANT.every((w) => seen.includes(w)) && seenW.includes("00:00"), `decide: ${seen.join(" ")} | espera: ${seenW.slice(-6).join(" ")}`);
    check("PvP · al vencer, el servidor jugó por quien debía; la partida SIGUE", !!after && fa.lifecycle === "IN_TURN" && fa.stateVersion === s0a.stateVersion + 1 && (fa.match.timeouts ?? []).length === 1, JSON.stringify({ life: fa?.lifecycle, v: [s0a.stateVersion, fa?.stateVersion], to: fa?.match?.timeouts }));
    check("PvP · A y B reciben EXACTAMENTE el mismo estado", pub(fa) === pub(fb), `${pub(fa).slice(0, 120)} | ${pub(fb).slice(0, 120)}`);
    check("PvP · aviso «Tiempo agotado» en el que esperaba, sin modal", notice);
    check("PvP · ahora decide el otro, con plazo nuevo", fa.isYourTurn !== s0a.isYourTurn && fa.turnDeadlineAt > s0a.turnDeadlineAt, `${s0a.turnDeadlineAt} → ${fa.turnDeadlineAt}`);
    const errs = [...ca.tab.takeErrors(), ...cb.tab.takeErrors()];
    check("PvP · 0 errores de consola", errs.length === 0, errs[0] ?? "");
  } finally {
    await ca.browser.close().catch(() => null); await cb.browser.close().catch(() => null);
    const s = (await pvpGet(ta, id)).json?.snapshot;
    if (s && s.lifecycle === "IN_TURN") await api(ta, "/api/game/duel/pvp", { action: "abandon", matchId: id });
    await mm(ta, { action: "cancel" }); await mm(tb, { action: "cancel" });
  }
}

(async () => {
  if (WHAT === "pve" || WHAT === "all") for (const w of WIDTHS) await pve(w);
  if (WHAT === "pvp" || WHAT === "all") await pvp();
  writeFileSync(join(OUT, `timer-qa-${WHAT}.json`), JSON.stringify({ at: new Date().toISOString(), results }, null, 2) + "\n");
  const pass = results.filter((r) => r.ok).length;
  console.log(`f72.8 reloj: ${pass}/${results.length}`);
  process.exit(pass === results.length ? 0 : 1);
})();
