import { launch } from "./lib/cdp";
const b = await launch({ args: ["--mute-audio"] });
await b.tab.goto("https://valorosters.com/inventario", 4000);
console.log(await b.tab.js(`JSON.stringify({ ls: Object.keys(localStorage), store: (() => { for (const k of Object.keys(localStorage)) { const v = localStorage.getItem(k); if (/unopenedPacks/.test(v ?? '')) { try { const j = JSON.parse(v); const s = j.state ?? j; return { k, credits: s.credits, packs: s.unopenedPacks }; } catch { return k; } } } return null; })(), text: document.querySelector('main')?.textContent?.replace(/\s+/g,' ').slice(0,300) })`));
await b.close();
