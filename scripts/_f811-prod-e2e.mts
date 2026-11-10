/**
 * F81.1 · E2E EN PRODUCCIÓN (instrumento, fuera de CI) con QA G (`f63-n1b`, la MISMA cuenta en navegador y API):
 *   1 · propiedad: la UI reconoce el Sobre Inicial que tiene el servidor;
 *   2 · fallos INTERCEPTADOS en el navegador (CDP Fetch; nunca llegan al servidor): 500, no-poseído, inválido, vacío,
 *       red caída, timeout → error/reintento y CERO cartas;
 *   3 · UNA apertura real (triple clic) comparando lo mostrado con la respuesta autoritativa;
 *   4 · F5 con el resultado persistido; 5 · salir y volver.
 * Uso (cwd temporal con .env.local público + tsconfig con paths):  BASE_URL=https://valorosters.com npx tsx scripts/_f811-prod-e2e.mts
 */
const lib = await import("file:///C:/NEXUS-CENTRAL/DRLCards/scripts/_fase68-lib.ts");
const { login, QA_FILES } = await import("file:///C:/NEXUS-CENTRAL/DRLCards/scripts/multiplayer/_qa.ts");
const { getCard } = await import("file:///C:/NEXUS-CENTRAL/DRLCards/src/data/catalog.ts");
const { openBrowser, loginUi, goto, sleep, PERSONA_FILES } = lib;
PERSONA_FILES.QG = QA_FILES.G; // F81: el «G» del navegador (f68-G) NO era el «G» de la API (f63-n1b)
const OUT = "C:/NEXUS-CENTRAL/DRLCards/docs/product/qa/f811-integrity";
const log = (k: string, v: unknown) => console.log(`${k} ${JSON.stringify(v)}`);
const api = async () => {
  const u = await login("G");
  const s = await (await fetch("https://valorosters.com/api/game/state", { headers: { authorization: `Bearer ${u.token}` } })).json();
  return { userId: u.userId as string, credits: s.credits, unopened: s.unopenedPacks, packsOpened: s.packsOpened, uids: s.ownedCards.map((o: any) => o.uid) as string[], cards: s.ownedCards as any[] };
};
const json = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
const H = [{ name: "content-type", value: "application/json" }];

const s0 = await api();
log("PRE", { user: s0.userId.slice(0, 8), credits: s0.credits, unopened: s0.unopened, packsOpened: s0.packsOpened, cards: s0.uids.length });
if ((s0.unopened?.inicial ?? 0) !== 1) { log("ABORT", "QA G no tiene exactamente 1 Sobre Inicial"); process.exit(1); }

const c = await openBrowser("QG", 390, { label: "f811-e2e" });
const packsReq: { status?: number; body?: string; rid: string }[] = [];
const respBodies = new Map<string, any>();
try {
  await c.tab.send("Network.enable");
  c.tab.on("Network.requestWillBeSent", (p: any) => { if (/\/api\/game\/packs$/.test(p.request.url) && p.request.method === "POST") packsReq.push({ body: p.request.postData, rid: p.requestId }); });
  c.tab.on("Network.responseReceived", (p: any) => { const r = packsReq.find((x) => x.rid === p.requestId); if (r) r.status = p.response.status; });
  c.tab.on("Network.loadingFinished", async (p: any) => { if (packsReq.some((x) => x.rid === p.requestId)) { try { const b = await c.tab.send("Network.getResponseBody", { requestId: p.requestId }); respBodies.set(p.requestId, JSON.parse(b.body)); } catch { /* sin cuerpo */ } } });
  log("LOGIN_UI", await loginUi(c, "QG"));
  const phase = () => c.tab.js<string>(`document.querySelector('[data-testid="pack-opening"]')?.dataset.phase ?? (/No tienes este sobre/.test(document.body.innerText) ? 'MISSING' : '')`);
  const shown = () => c.tab.js<any>(`({ hero: [...document.querySelectorAll('[data-testid="hero-reveal"]')].map(e => e.dataset.uid + ':' + e.dataset.cardId), rest: [...document.querySelectorAll('[data-testid="rest-card"]')].map(e => e.dataset.uid), summary: [...document.querySelectorAll('[data-testid="summary-card"]')].map(e => e.dataset.uid + ':' + e.dataset.cardId), art: [...document.querySelectorAll('[data-testid="pack-opening"] [data-card-image]')].map(e => e.getAttribute('data-card-image')) })`);
  const ready = async () => { for (let i = 0; i < 60; i++) { const p = await phase(); if (p === "ready" || p === "MISSING") return p; await sleep(250); } return phase(); };

  // 1 · PROPIEDAD
  await goto(c, "/abrir/inicial", 2500);
  const uiStore = await c.tab.js(`JSON.parse(localStorage.getItem('drl-champions')).state.unopenedPacks`);
  log("OWNERSHIP", { server: s0.unopened, uiStore, screen: await ready(), openButton: await c.tab.js(`!!document.querySelector('[data-testid="pack-open"]')`) });
  await c.tab.shot(`${OUT}/1-owned-ready-390.png`);

  // 2 · FALLOS INTERCEPTADOS
  const fulfil = (rid: string, code: number, body: unknown) => c.tab.send("Fetch.fulfillRequest", { requestId: rid, responseCode: code, responseHeaders: H, body: json(body) });
  const cases: Record<string, (rid: string) => Promise<unknown>> = {
    "500": (rid) => fulfil(rid, 500, { error: "No se pudo completar la operación" }),
    "not-owned": (rid) => fulfil(rid, 409, { error: "No tienes ese sobre" }),
    invalid: (rid) => fulfil(rid, 200, { opened: [{ uid: "fake-1", cardId: "no-existe__inventada" }], credits: 1, xpGained: 0 }),
    empty: (rid) => fulfil(rid, 200, { opened: [], credits: 1, xpGained: 0 }),
    network: (rid) => c.tab.send("Fetch.failRequest", { requestId: rid, errorReason: "ConnectionFailed" }),
    timeout: async () => undefined, // nunca responde: el cliente aborta a los 25 s
  };
  let mode = "";
  const held: string[] = [];
  let intercepted = 0;
  c.tab.on("Fetch.requestPaused", async (p: any) => {
    if (!/\/api\/game\/packs$/.test(p.request.url) || p.request.method !== "POST") { await c.tab.send("Fetch.continueRequest", { requestId: p.requestId }); return; }
    intercepted++;
    const act = cases[mode];
    if (!act) { await c.tab.send("Fetch.failRequest", { requestId: p.requestId, errorReason: "BlockedByClient" }); return; } // red de seguridad: nunca al servidor
    if (mode === "timeout") held.push(p.requestId); else await act(p.requestId);
  });
  await c.tab.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/game/packs", requestStage: "Request" }] });
  for (const id of Object.keys(cases)) {
    mode = id;
    await c.tab.js(`sessionStorage.clear()`);
    await goto(c, "/abrir/inicial", 1500);
    const r = await ready();
    if (r !== "ready") { log(`CASE_${id}`, { skipped: r }); continue; }
    await c.tab.js(`document.querySelector('[data-testid="pack-open"]').click()`);
    let p = "";
    const until = Date.now() + (id === "timeout" ? 32000 : 8000);
    while (Date.now() < until) { p = await phase(); if (["error", "no_pack", "summary", "opening", "buildup", "hero"].includes(p)) break; await sleep(150); }
    const sh = await shown();
    const text = await c.tab.js<string>(`document.body.innerText.replace(/\\s+/g, ' ').slice(0, 170)`);
    await c.tab.shot(`${OUT}/2-case-${id}-390.png`);
    log(`CASE_${id}`, { phase: p, cardsShown: sh.hero.length + sh.rest.length + sh.summary.length + sh.art.length, text });
  }
  mode = "";
  for (const rid of held) { try { await c.tab.send("Fetch.failRequest", { requestId: rid, errorReason: "Aborted" }); } catch { /* ya abortada */ } }
  await c.tab.send("Fetch.disable");
  const sMid = await api();
  log("AFTER_FAILURES_SERVER", { unopened: sMid.unopened, packsOpened: sMid.packsOpened, cards: sMid.uids.length, credits: sMid.credits, interceptedRequests: intercepted });

  // 3 · APERTURA REAL
  await c.tab.js(`sessionStorage.clear()`);
  await goto(c, "/abrir/inicial", 1500);
  log("REAL_READY", await ready());
  const before = packsReq.length;
  await c.tab.js(`(() => { const b = document.querySelector('[data-testid="pack-open"]'); b.click(); b.click(); b.click(); })()`);
  let p = "";
  for (let i = 0; i < 200 && p !== "hero_hold"; i++) { p = await phase(); await sleep(100); }
  await sleep(500);
  const heroShown = (await shown()).hero;
  await c.tab.shot(`${OUT}/3-real-hero-390.png`);
  await c.tab.js(`(() => { const b = document.querySelector('[data-testid="hero-continue"]'); b?.click(); b?.click(); })()`);
  for (let i = 0; i < 60; i++) { const q = await phase(); if (q === "rest" || q === "summary") break; await sleep(100); }
  await sleep(600);
  const restShown = (await shown()).rest;
  await c.tab.shot(`${OUT}/4-real-rest-390.png`);
  for (let i = 0; i < 80 && (await phase()) !== "summary"; i++) await sleep(150);
  await sleep(800);
  const sum = await shown();
  await c.tab.shot(`${OUT}/5-real-summary-390.png`);
  const calls = packsReq.slice(before);
  const auth = calls.map((x) => respBodies.get(x.rid)).filter((b) => Array.isArray(b?.opened) && b.opened.length).pop();
  log("REAL_REQUESTS", calls.map((x) => ({ status: x.status, body: x.body })));
  log("REAL_AUTHORITATIVE", auth ? { opened: auth.opened.map((o: any) => ({ uid: o.uid, cardId: o.cardId, ovr: getCard(o.cardId)?.ovr })), credits: auth.credits, repeated: auth.repeated ?? false } : null);
  log("REAL_SHOWN", { hero: heroShown, rest: restShown, summary: sum.summary, artIds: sum.art });

  // 4 · F5 con el resultado persistido
  const nBefore = packsReq.length;
  await c.tab.send("Page.reload", {});
  await sleep(6000);
  log("RELOAD", { phase: await phase(), summary: (await shown()).summary, heroAfter: await c.tab.js(`document.querySelector('[data-testid="summary-card"][data-hero="true"]')?.dataset.uid ?? ''`), newPackRequests: packsReq.slice(nBefore).map((x) => ({ status: x.status, body: x.body })) });
  // 5 · salir y volver
  await goto(c, "/coleccion", 2500);
  await goto(c, "/abrir/inicial", 3000);
  log("AWAY_BACK", { screen: await ready(), packRequestsSinceF5: packsReq.length - nBefore });
  log("CONSOLE", c.tab.takeErrors());
} finally { await c.browser.close(); }
await sleep(1500);
const s1 = await api();
const newCards = s1.cards.filter((o: any) => !s0.uids.includes(o.uid));
log("POST", { credits: s1.credits, unopened: s1.unopened, packsOpened: s1.packsOpened, cards: s1.uids.length, newCards: newCards.map((o: any) => ({ uid: o.uid, cardId: o.cardId, ovr: getCard(o.cardId)?.ovr })) });
