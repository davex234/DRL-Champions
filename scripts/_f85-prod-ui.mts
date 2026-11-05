/**
 * F85 · E2E DE NAVEGADOR EN PRODUCCIÓN (instrumento, fuera de CI). Dos Chrome reales, SOLO cuentas QA:
 *   X = C (f64, retador, 1440)   ·   Y = A (f45, retado, 390 y movimiento REDUCIDO)   ·   K (f69) para el cambio de cuenta.
 *
 *   BASE_URL=https://valorosters.com npx tsx C:/NEXUS-CENTRAL/DRLCards/scripts/_f85-prod-ui.mts   (cwd = prodqa)
 *
 * Presencia real entre navegadores, RETAR desde la lista, «esperando respuesta», aviso global del reto en 390 (tiempo de
 * entrega medido), ACEPTAR → los DOS entran en la partida sin navegar a mano, F5 en la partida, resultado con REVANCHA,
 * revancha recibida y ACEPTADA desde el resultado (misma partida nueva para los dos), perfil F89 con acciones sociales por estado, comparar, y cambio de cuenta sin fuga.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const qa = await import("file:///C:/NEXUS-CENTRAL/DRLCards/scripts/multiplayer/_qa.ts");
const lib = await import("file:///C:/NEXUS-CENTRAL/DRLCards/scripts/_fase68-lib.ts");
const { mkdirSync, writeFileSync } = await import("node:fs");
const { openBrowser, loginUi, logoutUi, goto, waitFor, PERSONA_FILES } = lib;
const { login, api, pvpGet, legalMove, uuid, sleep, QA_FILES } = qa;
if ((process.env.BASE_URL ?? "") !== "https://valorosters.com") throw new Error("BASE_URL=https://valorosters.com");
const OUT = "C:/NEXUS-CENTRAL/DRLCards/docs/product/qa/f85-social/prod";
mkdirSync(`${OUT}/shots`, { recursive: true });
PERSONA_FILES.QA_A = QA_FILES.A; PERSONA_FILES.QA_C = QA_FILES.C;
const rows: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail: unknown = "") => { const d = typeof detail === "string" ? detail : JSON.stringify(detail); rows.push({ id, ok, detail: (d ?? "").slice(0, 500) }); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${(d ?? "").slice(0, 200)}`); };
const S = "/api/game/social";
const shot = (c: any, n: string) => c.tab.shot(`${OUT}/shots/${n}.png`).catch(() => null);
const url = (c: any) => c.tab.js<string>("location.pathname + location.search");

const A = await login("A"), C = await login("C");
const K = lib.creds("K");
const nameA = (await api(C, `${S}?player=${A.userId}`)).json?.player?.username as string;
const nameC = (await api(A, `${S}?player=${C.userId}`)).json?.player?.username as string;
await api(C, S, { action: "friend_request", targetUserId: A.userId });
check("prep: C y A amigos (API)", (await api(A, S, { action: "friend_accept", targetUserId: C.userId })).json?.relation === "FRIENDS");

const X = await openBrowser("QA_C", 1440, { label: "f85-X" });
const Y = await openBrowser("QA_A", 390, { reduced: true, label: "f85-Y" });
try {
  check("login UI de C (1440) y A (390, reducido)", (await loginUi(X, "QA_C")) && (await loginUi(Y, "QA_A")));
  await Promise.all([goto(X, "/social", 2500), goto(Y, "/social", 2500)]);
  // Presencia real: X ve a A «En línea» porque la pestaña de Y late.
  const t0 = Date.now();
  const online = await waitFor(X.tab, `(() => { const r = document.querySelector('[data-friend="${A.userId}"]'); return !!r && r.dataset.presence === 'ONLINE'; })()`, 60000);
  check("presencia entre navegadores: C ve a A «En línea»", online, { ms: Date.now() - t0 });
  await shot(X, "social-hub-1440"); await shot(Y, "social-hub-390-reduced");
  check("390: hub sin desbordamiento horizontal", (await Y.tab.js<number>("document.documentElement.scrollWidth - window.innerWidth")) <= 0);

  // RETAR desde la lista de amigos
  await X.tab.js(`document.querySelector('[data-friend="${A.userId}"] [data-testid="friend-challenge"]').click()`);
  const sheet = await waitFor(X.tab, `!!document.querySelector('[role="dialog"] [data-testid="challenge-confirm"]') && !document.querySelector('[data-testid="challenge-confirm"]').disabled`, 15000);
  check("RETAR abre la hoja con un equipo legal preseleccionado", sheet);
  await shot(X, "challenge-sheet-1440");
  await X.tab.js(`document.querySelector('[data-testid="challenge-confirm"]').click()`);
  const tSent = Date.now();
  const waiting = await waitFor(X.tab, `/esperando/i.test(document.body.textContent)`, 15000);
  check("emisor: «Esperando respuesta…» visible", waiting);
  await shot(X, "challenge-waiting-1440");

  // Aviso global en el retado (sin F5): tiempo de entrega real
  const got = await waitFor(Y.tab, `!!document.querySelector('[data-testid="incoming-challenge"]')`, 70000);
  const deliveryMs = Date.now() - tSent;
  check("retado: aviso «te reta a un duelo amistoso» sin recargar", got, { deliveryMs });
  const box = await Y.tab.js<any>(`(() => { const s = document.querySelector('[data-testid="incoming-challenge"]'); const b = s.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, vh: innerHeight, text: s.textContent }; })()`);
  check("390: aviso dentro de la pantalla, con nombre y «sin rating»", box.top >= 0 && box.bottom <= box.vh && box.text.includes(nameC) && /Sin rating/.test(box.text), { top: box.top, bottom: box.bottom, vh: box.vh });
  await shot(Y, "incoming-challenge-390-reduced");
  await Y.tab.js(`document.querySelector('[data-testid="incoming-challenge"] [data-action="accept"]').click()`);
  const tAcc = Date.now();
  // Con varios equipos y ninguno activo, el aviso abre la hoja de aceptar en Social (se confirma ahí).
  await waitFor(Y.tab, `location.search.includes('match=') || location.search.includes('aceptar=')`, 15000);
  if ((await url(Y)).includes("aceptar=")) { await waitFor(Y.tab, `!!document.querySelector('[data-testid="challenge-confirm"]') && !document.querySelector('[data-testid="challenge-confirm"]').disabled`, 15000); await Y.tab.js(`document.querySelector('[data-testid="challenge-confirm"]').click()`); }
  const yIn = await waitFor(Y.tab, `location.pathname.startsWith('/duelos/pvp') && location.search.includes('match=')`, 20000);
  check("ACEPTAR → el retado entra en la partida sin navegar a mano", yIn, await url(Y));
  const xIn = await waitFor(X.tab, `location.pathname.startsWith('/duelos/pvp') && location.search.includes('match=')`, 30000);
  check("el retador entra solo («¡ha aceptado! Entrando…»)", xIn, { ms: Date.now() - tAcc, url: await url(X) });
  const mid = new URLSearchParams((await url(Y)).split("?")[1] ?? "").get("match") ?? "";
  check("los dos en la MISMA partida", mid.length > 0 && (await url(X)).includes(mid), mid);
  await sleep(2500);
  await shot(X, "private-duel-1440"); await shot(Y, "private-duel-390-reduced");
  const xText = await X.tab.js<string>("document.body.textContent");
  check("la arena rotula el duelo como AMISTOSO / privado (no Ranked)", /amistos|privad/i.test(xText) && !/Ranked · rating en juego/i.test(xText));
  // F5 / reconexión
  await Y.tab.goto(`${process.env.BASE_URL}/duelos/pvp?match=${mid}`, 3000);
  const back = await waitFor(Y.tab, `location.search.includes(${JSON.stringify(mid)}) && !/no encontrada/i.test(document.body.textContent)`, 20000);
  check("F5 en la partida: vuelve a la MISMA partida (sin crear otra)", back && (await api(A, S, { action: "pulse" })).json?.activeMatchId === mid);
  // jugar la partida hasta el final (API, vistas redactadas propias)
  for (let i = 0; i < 80; i++) {
    const [a, c] = await Promise.all([pvpGet(A, mid), pvpGet(C, mid)]).then((r) => r.map((z) => z.json?.snapshot));
    if (["FINISHED", "ABANDONED", "EXPIRED"].includes(a?.lifecycle)) break;
    const w = a?.isYourTurn ? A : c?.isYourTurn ? C : null;
    if (!w) { await sleep(400); continue; }
    const s = w === A ? a : c;
    await api(w, "/api/game/duel/pvp", { action: "play", matchId: mid, actionId: uuid(), expectedVersion: s.stateVersion, ...legalMove(s)! });
  }
  const rem = await waitFor(X.tab, `!!document.querySelector('[data-testid="private-duel-panel"] [data-action="rematch"]')`, 40000);
  check("resultado del duelo amistoso con REVANCHA", rem);
  await sleep(1200);
  await shot(X, "result-rematch-1440"); await shot(Y, "result-390-reduced");
  await X.tab.js(`document.querySelector('[data-action="rematch"]').click()`);
  const rs = await waitFor(X.tab, `!!document.querySelector('[data-testid="challenge-confirm"]') && !document.querySelector('[data-testid="challenge-confirm"]').disabled`, 15000);
  if (rs) await X.tab.js(`document.querySelector('[data-testid="challenge-confirm"]').click()`);
  const yr = await waitFor(Y.tab, `!!document.querySelector('[data-testid="incoming-challenge"]') && /revancha/i.test(document.querySelector('[data-testid="incoming-challenge"]').textContent)`, 70000);
  check("REVANCHA = nuevo reto que el rival debe aceptar («te pide la revancha»)", rs && yr);
  await shot(Y, "incoming-rematch-390-reduced");
  // F85.1 · ACEPTAR la revancha DESDE la pantalla de resultado: los dos entran en la MISMA partida NUEVA sin navegar a mano.
  if (yr) await Y.tab.js(`document.querySelector('[data-testid="incoming-challenge"] [data-action="accept"]').click()`);
  const isNew = `location.pathname.startsWith('/duelos/pvp') && new URLSearchParams(location.search).get('match') && new URLSearchParams(location.search).get('match') !== ${JSON.stringify(mid)}`;
  if (yr) { await waitFor(Y.tab, `${isNew} || location.search.includes('aceptar=')`, 15000); if ((await url(Y)).includes("aceptar=")) { await waitFor(Y.tab, `!!document.querySelector('[data-testid="challenge-confirm"]') && !document.querySelector('[data-testid="challenge-confirm"]').disabled`, 15000); await Y.tab.js(`document.querySelector('[data-testid="challenge-confirm"]').click()`); } }
  const yNew = yr && await waitFor(Y.tab, isNew, 20000);
  const xNew = yr && await waitFor(X.tab, isNew, 30000);
  const mid2 = new URLSearchParams((await url(Y)).split("?")[1] ?? "").get("match") ?? "";
  check("REVANCHA aceptada desde el resultado → los DOS entran en la MISMA partida NUEVA", !!yNew && !!xNew && mid2 !== mid && (await url(X)).includes(mid2), { y: await url(Y), x: await url(X) });
  await sleep(2500);
  const fresh = await Y.tab.js<boolean>(`!document.querySelector('[data-testid="private-duel-panel"]')`);
  check("la arena se remonta: no queda el resultado de la partida anterior en pantalla", fresh);
  await shot(X, "rematch-match-1440"); await shot(Y, "rematch-match-390-reduced");
  if (mid2 && mid2 !== mid) await api(A, "/api/game/duel/pvp", { action: "abandon", matchId: mid2 });
  await sleep(1500);
  check("revancha cerrada (abandono de QA): ninguna partida viva", (await api(A, S, { action: "pulse" })).json?.activeMatchId === null);

  // Perfil F89 con acciones sociales por estado
  await goto(X, `/jugador/${A.userId}`, 3500);
  await waitFor(X.tab, `!!document.querySelector('[data-testid="social-actions"]')`, 20000);
  check("perfil de un AMIGO: estado «Amigos», COMPARAR, menú (sin AÑADIR)", await X.tab.js<boolean>(`!!document.querySelector('[data-testid="relation-badge"]') && /Amigos/i.test(document.querySelector('[data-testid="social-actions"]').textContent) && !document.querySelector('[data-action="add"]') && !!document.querySelector('[data-action="more"]')`));
  await shot(X, "profile-friend-1440");
  await goto(X, `/jugador/${K.userId}`, 3500);
  await waitFor(X.tab, `!!document.querySelector('[data-testid="social-actions"]')`, 20000);
  check("perfil de un DESCONOCIDO: AÑADIR AMIGO, sin RETAR", await X.tab.js<boolean>(`!!document.querySelector('[data-action="add"]') && !document.querySelector('[data-action="challenge"]')`));
  await shot(X, "profile-stranger-1440");
  await goto(X, `/jugador/${C.userId}`, 3500);
  await sleep(2500);
  check("perfil PROPIO: nunca «añadirme» ni «retarme»", await X.tab.js<boolean>(`!document.querySelector('[data-action="add"]') && !document.querySelector('[data-action="challenge"]')`));
  await goto(X, `/social/comparar?id=${A.userId}`, 3500);
  await waitFor(X.tab, `!!document.querySelector('[data-testid="compare-table"]')`, 20000);
  check("COMPARAR con datos públicos reales", await X.tab.js<boolean>(`document.querySelectorAll('[data-testid="compare-table"] tr, [data-testid="compare-table"] [role="row"], [data-testid="compare-table"] > *').length > 3`));
  await shot(X, "compare-1440");

  // Cambio de cuenta en Y: A → K, sin fuga de lo social de A
  await logoutUi(Y);
  await loginUi(Y, "K");
  await goto(Y, "/social", 600);
  let leak = false;
  for (let i = 0; i < 16; i++) { if (await Y.tab.js<boolean>(`document.body.textContent.includes(${JSON.stringify(nameC)})`)) { leak = true; break; } await sleep(250); }
  check("cambio de cuenta A → K: ni amigos ni retos de A en ningún momento", !leak);
  await shot(Y, "account-switch-K-390");
} finally {
  await X.browser.close().catch(() => null); await Y.browser.close().catch(() => null);
}
// limpieza (el logout revocó los tokens de A: sesión nueva)
const A2 = await login("A");
await api(A2, S, { action: "unfriend", targetUserId: C.userId });
check("limpieza: C y A ya no son amigos", (await api(A2, `${S}?player=${C.userId}`)).json?.relation === "NONE");
const failed = rows.filter((r) => !r.ok);
writeFileSync(`${OUT}/prod-ui.json`, JSON.stringify({ at: new Date().toISOString(), total: rows.length, passed: rows.length - failed.length, failed: failed.length, rows }, null, 1));
console.log(`\nF85 PROD UI: ${rows.length - failed.length}/${rows.length}`);
process.exitCode = failed.length ? 1 : 0;
