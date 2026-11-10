/**
 * FASE 69 · ¿qué desplaza /cuenta? Registra cada layout-shift con sus nodos de origen (fuera de CI, solo lectura).
 *   npx tsx scripts/_fase69-cls.ts <persona> [ruta=/cuenta] [ancho=1440]
 */
import { openBrowser, loginUi, goto, sleep } from "./_fase68-lib";
import { writeRaw69 } from "./_fase69-lib";

/* eslint-disable @typescript-eslint/no-explicit-any */
const [P = "J", ROUTE = "/cuenta", W = "1440"] = process.argv.slice(2);
const OBS = `window.__shifts=[];try{new PerformanceObserver(l=>{for(const e of l.getEntries()){if(e.hadRecentInput)continue;window.__shifts.push({t:Math.round(e.startTime),v:Math.round(e.value*1000)/1000,src:(e.sources||[]).map(s=>{const n=s.node;const d=n&&n.nodeType===1?n:n&&n.parentElement;return{el:d?(d.tagName+(d.id?'#'+d.id:'')+(d.getAttribute('data-testid')?'[tid='+d.getAttribute('data-testid')+']':'')+'.'+String(d.className||'').split(' ').slice(0,3).join('.')).slice(0,120):null,text:d?(d.innerText||'').trim().slice(0,50):null,prev:[Math.round(s.previousRect.y),Math.round(s.previousRect.height)],cur:[Math.round(s.currentRect.y),Math.round(s.currentRect.height)]}})})}}).observe({type:'layout-shift',buffered:true})}catch{}`;

(async () => {
  const c = await openBrowser(P, Number(W), { label: `cls-${P}` });
  const runs: any[] = [];
  try {
    await loginUi(c, P);
    await c.tab.send("Page.addScriptToEvaluateOnNewDocument", { source: OBS });
    for (let i = 0; i < 3; i++) {
      await goto(c, ROUTE, 7000);
      await sleep(500);
      const shifts = await c.tab.js<any[]>(`window.__shifts || []`);
      runs.push({ total: Math.round(shifts.reduce((a, s) => a + s.v, 0) * 1000) / 1000, shifts });
    }
  } finally { await c.browser.close(); }
  writeRaw69(`cls-${P}-${ROUTE.replace(/\//g, "_")}-${W}`, { persona: P, route: ROUTE, width: W, runs });
  for (const r of runs) { console.log("TOTAL", r.total); for (const s of r.shifts) console.log(" ", s.t, s.v, JSON.stringify(s.src).slice(0, 400)); }
})().catch((e) => { console.error(e); process.exit(1); });
