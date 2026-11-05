/** F81.2 · apertura por URL directa en producción con QA G (sin sobres): neutral → «no tienes este sobre» (real), nunca la ceremonia con el sobre de la demo. Solo lectura. */
const lib = await import("file:///C:/NEXUS-CENTRAL/DRLCards/scripts/_fase68-lib.ts");
const { QA_FILES } = await import("file:///C:/NEXUS-CENTRAL/DRLCards/scripts/multiplayer/_qa.ts");
const { openBrowser, loginUi, sleep, PERSONA_FILES } = lib;
PERSONA_FILES.QG = QA_FILES.G;
const OUT = "C:/NEXUS-CENTRAL/DRLCards/docs/product/qa/f812-hydration/prod";
const c = await openBrowser("QG", 390, { label: "f812-abrir" });
try {
  console.log("LOGIN", await loginUi(c, "QG"));
  c.tab.on("Fetch.requestPaused", async (p: any) => { await sleep(3000); try { await c.tab.send("Fetch.continueRequest", { requestId: p.requestId }); } catch {} });
  await c.tab.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/game/state*", requestStage: "Request" }] });
  const probe = `({ loader: !!document.querySelector('[data-testid="game-loader"]'), pack: document.querySelector('[data-testid="pack-opening"]')?.dataset.phase ?? '', open: !!document.querySelector('[data-testid="pack-open"]'), text: (document.querySelector('main') || document.body).innerText.replace(/\s+/g, ' ').slice(0, 160) })`;
  await c.tab.send("Page.navigate", { url: "https://valorosters.com/abrir/estandar" });
  const seen: any[] = [];
  for (let t = 0; t < 7000; t += 250) { const s = await c.tab.js(probe).catch(() => null); if (s && JSON.stringify(s) !== JSON.stringify(seen[seen.length - 1]?.s)) seen.push({ t, s }); if (t === 1000) await c.tab.shot(`${OUT}/shots/390-abrir-estandar-1000ms.png`); await sleep(250); }
  await c.tab.shot(`${OUT}/shots/390-abrir-estandar-resolved.png`);
  console.log("SEQ", JSON.stringify(seen));
  console.log("ERRORS", JSON.stringify(c.tab.takeErrors()));
} finally { await c.browser.close(); }
