/**
 * F76 · REPRODUCCIÓN (fuera de CI). Contra la app en BASE_URL (por defecto https://valorosters.com).
 *   npx tsx scripts/_f76-repro.ts api      → GET de la cola de cuentas QA con MATCHED → partida terminal (sin escrituras)
 *   npx tsx scripts/_f76-repro.ts ui [P]   → Chrome real: /competitivo → JUGAR ranked; muestrea URL, pantalla y BD 30 s;
 *                                            al final saca a P de la cola con el cancel normal (F68_OUT para capturas)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { BASE, login, mm, pvp, queueFacts, sleep } from "./_f76-lib";
import { clickTid, goto, loginUi, openBrowser, shot } from "./_fase68-lib";

const OUT = "docs/product/qa/f76-ranked";
mkdirSync(OUT, { recursive: true });

async function apiRepro() {
  const rows: any[] = [];
  for (const p of ["C", "G"]) {
    const w = await login(p);
    const before = queueFacts(w.userId);
    const st = await mm(w);
    const matchId = st.json?.entry?.matchId ?? null;
    const match = matchId ? await pvp(w, matchId) : null;
    const after = queueFacts(w.userId);
    const row = {
      persona: p, user: w.userId.slice(0, 8), base: BASE,
      dbBefore: before.entries[0], liveBefore: before.live,
      api: { status: st.status, code: st.json?.code, entryState: st.json?.entry?.state, matchId: matchId?.slice(0, 8) ?? null },
      matchLifecycle: match ? { status: match.status, lifecycle: match.json?.snapshot?.lifecycle ?? null } : null,
      dbAfter: after.entries[0], liveAfter: after.live,
      bug: st.json?.entry?.state === "MATCHED" && !!matchId && ["FINISHED", "ABANDONED", "EXPIRED"].includes(match?.json?.snapshot?.lifecycle),
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  writeFileSync(`${OUT}/repro-api-${BASE.includes("valorosters") ? "prod-before" : "local"}.json`, JSON.stringify({ at: new Date().toISOString(), rows }, null, 2) + "\n");
}

/** Lo que un jugador ve: URL, partida que pinta la pantalla y si hay buscador/resultado. Sin depender de textos frágiles. */
const SCREEN = `(() => { const t = document.body.innerText;
  return { url: location.pathname + location.search,
    searching: /buscando rival|en cola|cancelar búsqueda/i.test(t),
    result: /victoria|derrota|empate|abandon|buscar otro rival/i.test(t),
    // La partida que la PÁGINA está sincronizando: la última consulta a /api/game/duel/pvp?matchId=…
    syncingMatch: (performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes('/api/game/duel/pvp?matchId=')).pop() || '').replace(/.*matchId=([0-9a-f]{8}).*/, '$1') || null,
    head: t.replace(/\s+/g,' ').slice(0, 160) }; })()`;

async function uiRepro(p: string) {
  const w = await login(p);
  const c = await openBrowser(p, 1440, { label: `f76-repro-${p}` });
  const samples: any[] = [];
  try {
    await loginUi(c, p);
    const before = queueFacts(w.userId);
    const apiBefore = (await mm(w)).json;
    // ENTRY=direct → /duelos/pvp sin ?buscar (menú Duelos, F5, volver): la cola sola decide qué se pinta.
    const direct = process.env.ENTRY === "direct";
    if (!direct) { await goto(c, "/competitivo", 3000); await shot(c, `f76-${p}-01-competitivo`); }
    const clicked = direct ? (await goto(c, "/duelos/pvp", 0), true) : await clickTid(c, "ranked-play-cta");
    const t0 = Date.now();
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      const s = await c.tab.js<any>(SCREEN).catch(() => null);
      const db = i % 3 === 0 ? queueFacts(w.userId) : null;
      samples.push({ t: Math.round((Date.now() - t0) / 1000), ...s, db: db ? { latest: db.entries[0], live: db.live } : undefined });
      if (i === 2 || i === 10 || i === 29) await shot(c, `f76-${p}-02-tras-jugar-${i + 1}s`);
    }
    const after = queueFacts(w.userId);
    const apiAfter = (await mm(w)).json;
    const res = { persona: p, user: w.userId.slice(0, 8), base: BASE, clicked,
      dbBefore: before, apiBefore: { code: apiBefore?.code, state: apiBefore?.entry?.state, matchId: apiBefore?.entry?.matchId?.slice(0, 8) },
      samples, dbAfter: after, apiAfter: { code: apiAfter?.code, state: apiAfter?.entry?.state, matchId: apiAfter?.entry?.matchId?.slice(0, 8) } };
    writeFileSync(`${OUT}/repro-ui-${p}-${BASE.includes("valorosters") ? "prod" : "local"}-${process.env.ENTRY ?? "cta"}-${Date.now()}.json`, JSON.stringify(res, null, 2) + "\n");
    for (const s of samples.filter((_, i) => i % 3 === 0)) console.log(JSON.stringify(s).slice(0, 330));
    console.log("AFTER db", JSON.stringify(after), "api", JSON.stringify(res.apiAfter));
  } finally {
    const cancel = await mm(w, { action: "cancel" });
    console.log("cleanup cancel", cancel.status, cancel.json?.code, cancel.json?.entry?.state, "live:", queueFacts(w.userId).live);
    await c.browser.close().catch(() => null);
  }
}

const mode = process.argv[2] ?? "api";
(mode === "api" ? apiRepro() : mode === "ui" ? uiRepro(process.argv[3] ?? "G") : Promise.reject(new Error(`modo ${mode}`))).catch((e) => { console.error(e); process.exit(1); });
