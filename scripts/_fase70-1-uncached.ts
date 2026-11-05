import { launch } from "./lib/cdp";
(async () => {
  const b = await launch({ userDataDir: process.argv[2] });
  for (const r of ["/logros", "/social", "/temporada"]) {
    await b.tab.goto("http://127.0.0.1:3005" + r, 3000).catch(() => null);
    console.log(r, JSON.stringify(await b.tab.js(`({ url: location.pathname, h: [...document.querySelectorAll('h1,h2')].map(e=>e.innerText.trim()).filter(Boolean).slice(0,3), text: document.body.innerText.replace(/\s+/g,' ').slice(0,140) })`)));
  }
  await b.close(); process.exit(0);
})();
