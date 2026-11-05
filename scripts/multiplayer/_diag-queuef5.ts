/** F66 · diagnóstico: ?buscar → F5 en cola → ¿qué ve la página y qué responde la cola? */
import { launch, sleep } from "../lib/cdp";
import { api, creds, login, mm, pvpGet, validDeck } from "./_qa";
/* eslint-disable @typescript-eslint/no-explicit-any */
(async () => {
  const B = await login("B"); await mm(B, { action: "cancel" });
  const d = await validDeck(B);
  const b = await launch({ args: ["--mute-audio"] }); const tab = b.tab; const c = creds("B"); const esc = JSON.stringify;
  await tab.resize(390, 844, 1);
  await tab.goto(`http://127.0.0.1:3005/cuenta`, 2500);
  await tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set(document.querySelector('input[type="email"]'), ${esc(c.email)}); set(document.querySelector('input[type="password"]'), ${esc(c.password)}); document.querySelector('form button[type="submit"]').click(); })()`);
  await sleep(4000);
  const probe = `(() => { const r = [...document.querySelectorAll('button')].find(x => /Reintentar/.test(x.textContent||'')); const box = r ? r.closest('section,div') : null; return { url: location.pathname + location.search, err: box ? box.innerText.slice(0, 200) : null, mm: performance.getEntriesByType('resource').filter(e => /matchmaking/.test(e.name)).map(e => e.responseStatus) }; })()`;
  await tab.goto(`http://127.0.0.1:3005/duelos/pvp?buscar=${d!.id}`, 2500);
  console.log("antes F5", JSON.stringify(await tab.js(probe)), "servidor", (await mm(B)).json?.entry?.state);
  await tab.send("Page.reload", {}); await sleep(6000);
  console.log("tras F5", JSON.stringify(await tab.js(probe)), "servidor", (await mm(B)).json?.entry?.state);
  const A = await login("A"); await mm(A, { action: "cancel" });
  console.log("A encola", (await mm(A, { action: "enqueue", deckId: (await validDeck(A))!.id })).json?.entry?.state);
  const probe2 = probe.replace("/matchmaking/.test(e.name)).map(e => e.responseStatus)", "/api\//.test(e.name)).map(e => new URL(e.name).pathname.split('/').pop() + ':' + e.responseStatus)");
  for (let i = 0; i < 6; i++) { await sleep(2500); console.log("+", i, JSON.stringify(await tab.js(probe2)), JSON.stringify(await tab.js(`[...document.querySelectorAll('[data-scene]')].map(e => e.getAttribute('data-scene'))`))); }
  const q = (await mm(A)).json?.entry; console.log("A cola", q?.state, q?.matchId?.slice(0, 8));
  if (q?.matchId) { const s = (await pvpGet(A, q.matchId)).json?.snapshot; if (s && s.lifecycle === "IN_TURN") await api(A, "/api/game/duel/pvp", { action: "abandon", matchId: q.matchId }); }
  await mm(B, { action: "cancel" }); await mm(A, { action: "cancel" }); await b.close();
})();
