import { launch, sleep } from "../lib/cdp";
import { creds, login, mm, validDeck } from "./_qa";
(async () => {
  const B = await login("B"); const d = await validDeck(B);
  const b = await launch({ args: ["--mute-audio"] }); const tab = b.tab; const c = creds("B"); const esc = JSON.stringify;
  await tab.goto(`http://127.0.0.1:3005/cuenta`, 2500);
  await tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set(document.querySelector('input[type="email"]'), ${esc(c.email)}); set(document.querySelector('input[type="password"]'), ${esc(c.password)}); document.querySelector('form button[type="submit"]').click(); })()`);
  await sleep(4000);
  await tab.goto(`http://127.0.0.1:3005/duelos/pvp?buscar=${d!.id}`, 1000);
  for (let i = 0; i < 8; i++) { await sleep(1000); console.log(i, await tab.js(`location.pathname + location.search`), (await mm(B)).json?.entry?.state, (await tab.js<string[]>(`window.__f66log || []`))); }
  await tab.js(`history.replaceState(history.state, "", "/duelos/pvp")`);
  for (let i = 0; i < 3; i++) { await sleep(1000); console.log("manual", i, await tab.js(`location.pathname + location.search`)); }
  console.log("errores", tab.takeErrors().slice(0, 5));
  await mm(B, { action: "cancel" }); await b.close();
})();
