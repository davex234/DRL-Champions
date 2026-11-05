/**
 * FASE 51.3 · QA del flujo JUGAR inmediato (fuera de CI).
 *
 *   npx tsx scripts/_fase51-3-qa.ts
 *
 * Recorre el camino real con el ratón —/entrenador → JUGAR → composición → JUGAR → mapa → partido—
 * CONTANDO las acciones del jugador. Casos: con composiciones, plantilla incompleta, plantilla válida,
 * cero composiciones (elegir 5 agentes → «Guardar y jugar») y, desde 51.3.1, la API caída (error +
 * reintento, sin editor debajo). Mismo método que `_fase51-1-shots.ts`: sesión simulada + `/api/game/*`
 * con respuestas fijas. No escribe en la BD. Capturas a `docs/product/qa/fase51-3-quickplay`.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";

const BASE = process.argv.find((a) => a.startsWith("--base="))?.slice(7) ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase51-3-quickplay");
mkdirSync(OUT, { recursive: true });
const SEED = JSON.parse(readFileSync(join(process.cwd(), "scripts", "_fase51-1-seed.json"), "utf8"));
const USER = "2f86cbe8-f663-40fb-a87c-4896b9a45b62";
const ASCENT = {
  id: "310ecd94-af68-477d-b285-ff7022724f50", mapId: "ascent", name: "__QA_TRAINER511__ Ascent",
  agentIds: ["jett", "omen", "sova", "killjoy", "kayo"], notes: "", primary: false, updatedAt: "2026-09-22T12:00:00.000Z",
};
const LOTUS = { ...ASCENT, id: "qa-513-lotus", mapId: "lotus", name: "QA Lotus", agentIds: ["raze", "omen", "fade", "killjoy", "breach"], updatedAt: "2026-09-21T12:00:00.000Z" };

const boot = (comps: unknown[], FAIL = false) => `(() => {
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\\+/g, "-").replace(/\\//g, "_");
  const exp = 4102444800;
  const user = { id: ${JSON.stringify(USER)}, aud: "authenticated", role: "authenticated", email: "demo@nexus.local", app_metadata: {}, user_metadata: {} };
  const jwt = b64({ alg: "none", typ: "JWT" }) + "." + b64({ sub: user.id, exp, role: "authenticated" }) + ".qa";
  try { localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "qa-f513", user })); } catch {}
  const COMPS = ${JSON.stringify(comps)};
  window.__qaSaved = null;
  window.__qaFail = ${FAIL ? 'true' : 'false'};
  const F = {
    "GET /api/game/strats": { strats: [] },
    "GET /api/game/coach-matches": { matches: [], record: { jugados: 0, ganados: 0, perdidos: 0, diferencialRondas: 0, racha: 0 }, total: 0 },
    "POST /api/telemetry": { ok: true },
    "POST /api/game/coach-matches": { ok: true },
  };
  const orig = window.fetch.bind(window);
  const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(url, location.href);
    if (u.origin === location.origin && u.pathname.startsWith("/api/")) {
      const m = (init && init.method) || "GET";
      if (u.pathname === "/api/game/compositions") {
        if (window.__qaFail && m === "GET") return new Response(JSON.stringify({ error: "No autenticado" }), { status: 401, headers: { "content-type": "application/json" } });
        if (m === "GET") return json({ compositions: COMPS });
        const body = JSON.parse(init.body);
        const saved = { ...body.composition, id: "qa-513-nueva", notes: "", primary: false, updatedAt: new Date().toISOString() };
        window.__qaSaved = saved;
        COMPS.push(saved);
        return json({ composition: saved });
      }
      const hit = F[m + " " + u.pathname];
      if (hit) return json(hit);
    }
    return orig(input, init);
  };
})();`;

type Equipos = "ninguno" | "incompleto" | "valido";
const seed = (e: Equipos) => {
  const teams = e === "ninguno" ? [] : e === "valido" ? [SEED.team] : [SEED.incompleto];
  return `(() => { try {
    if (sessionStorage.getItem("qa513")) return; sessionStorage.setItem("qa513", "1");
    localStorage.setItem("drl-champions", ${JSON.stringify(JSON.stringify({ state: { ownedCards: SEED.owned, credits: 984585 }, version: 1 }))});
    localStorage.setItem("drl-champions-teams", ${JSON.stringify(JSON.stringify({ state: { teams, activeTeamId: teams[0]?.id ?? null, lastSetup: null }, version: 1 }))});
  } catch {} })();`;
};

async function waitFor(tab: Tab, expr: string, ms = 15000): Promise<boolean> {
  for (let t = 0; t < ms; t += 100) { if (await tab.js<boolean>(expr)) return true; await sleep(100); }
  return false;
}
const shot = async (tab: Tab, name: string, settle = 500) => {
  await sleep(settle);   /* que termine de pintar: la primera captura salía en blanco */
  const r = await tab.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.data, "base64"));
};
const q = (sel: string) => `!!document.querySelector(${JSON.stringify(sel)})`;

interface Case { id: string; equipos: Equipos; comps: unknown[]; reduce?: boolean; fail?: boolean; sizes?: [number, number][] }
const RESP: [number, number][] = [[1920, 1080], [1440, 900], [1366, 768], [1024, 768], [768, 1024], [390, 844]];
const CASES: Case[] = [
  { id: "A-dos-comps-sin-plantilla", equipos: "ninguno", comps: [ASCENT, LOTUS], sizes: RESP },
  { id: "B-plantilla-incompleta", equipos: "incompleto", comps: [ASCENT, LOTUS], reduce: true },
  { id: "C-plantilla-valida", equipos: "valido", comps: [ASCENT] },
  { id: "D-cero-comps", equipos: "ninguno", comps: [], sizes: RESP },
  { id: "E-api-caida", equipos: "ninguno", comps: [ASCENT], fail: true },
];

(async () => {
  const rows: Record<string, unknown>[] = [];
  for (const c of CASES) {
    const browser = await launch({ args: ["--in-process-gpu", "--mute-audio", "--hide-scrollbars"] });
    const tab = browser.tab;
    const acciones: string[] = [];
    const click = async (sel: string, label: string) => {
      const ok = await tab.js<boolean>(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || e.disabled) return false; e.scrollIntoView({ block: "center" }); e.click(); return true; })()`);
      if (!ok) throw new Error(`${c.id}: no se pudo pulsar ${label} (${sel})`);
      acciones.push(label);
    };
    try {
      await tab.resize(1440, 900, 1);
      /* headless viene con «reduce» de serie: se fija a propósito para probar los dos caminos. */
      await tab.setMedia([{ name: "prefers-reduced-motion", value: c.reduce ? "reduce" : "no-preference" }]);
      await tab.send("Page.addScriptToEvaluateOnNewDocument", { source: boot(c.comps, c.fail) });
      await tab.send("Page.addScriptToEvaluateOnNewDocument", { source: seed(c.equipos) });
      await tab.goto(`${BASE}/entrenador`, 2500);
      await waitFor(tab, q('[data-testid="hub-play"]'));
      await shot(tab, `${c.id}-0-hub`);
      await click('[data-testid="hub-play"]', "JUGAR (hub)");
      let mapaEsperado: string | null = null;
      if (c.fail) {
        if (!(await waitFor(tab, q('[data-testid="play-error"]'), 25000))) throw new Error("sin estado de error");
        await shot(tab, `${c.id}-1-error`);
        const diag = await tab.js<Record<string, unknown>>(`(() => ({
          pantalla: document.querySelector('[data-testid="play-flow"]').dataset.screen,
          reintentar: !!document.querySelector('[data-testid="play-retry"]'),
          editor: !!document.querySelector('[data-testid="quick-composer"], [data-testid="composition-builder"]'),
          creaTuPrimera: /crea tu primera/i.test(document.body.innerText),
          texto: document.querySelector('[data-testid="play-error"]').innerText.split("\\n").slice(0, 2).join(" · "),
        }))()`);
        rows.push({ caso: c.id, acciones: acciones.length, ...diag, errores: tab.takeErrors().length });
        console.log(JSON.stringify(rows[rows.length - 1]));
        continue;
      }
      if (c.comps.length === 0) {
        if (!(await waitFor(tab, q('[data-testid="quick-composer"]')))) throw new Error("sin creador rápido");
        for (const [w, h] of c.sizes ?? []) { await tab.resize(w, h, 1); await shot(tab, `${c.id}-1-elige-5-agentes-${w}`); }
        await tab.resize(1440, 900, 1);
        await shot(tab, `${c.id}-1-elige-5-agentes`);
        for (const a of ["jett", "omen", "sova", "killjoy", "kayo"]) await click(`[data-testid="quick-agent-${a}"]`, `agente ${a}`);
        await sleep(200);
        await shot(tab, `${c.id}-2-cinco-agentes`);
        await click('[data-testid="quick-save-play"]', "GUARDAR Y JUGAR");
      } else {
        if (!(await waitFor(tab, q('[data-testid="play-comp-list"]')))) throw new Error("sin lista");
        for (const [w, h] of c.sizes ?? []) { await tab.resize(w, h, 1); await shot(tab, `${c.id}-1-elige-composicion-${w}`); }
        await tab.resize(1440, 900, 1);
        await shot(tab, `${c.id}-1-elige-composicion`);
        const target = c.comps.length > 1 ? LOTUS : ASCENT;
        mapaEsperado = target.mapId;
        if (c.comps.length > 1) await click(`[data-testid="play-comp-${target.id}"]`, `composición ${target.name}`);
        await sleep(150);
        await click('[data-testid="play-start"]', "JUGAR");
      }
      const t0 = Date.now();
      const reveal = await waitFor(tab, q('[data-testid="map-reveal"]'), 10000);
      const revealMap = reveal ? await tab.js<string>(`document.querySelector('[data-testid="map-reveal"]').dataset.mapId`) : null;
      const revealImg = reveal ? await tab.js<string | null>(`document.querySelector('[data-testid="map-reveal"] img, [data-testid="map-reveal"] image')?.getAttribute("src") ?? document.querySelector('[data-testid="map-reveal"] image')?.getAttribute("href") ?? null`) : null;
      if (reveal) await shot(tab, `${c.id}-3-partida-encontrada`, 0);
      const started = await waitFor(tab, `!document.querySelector('[data-testid="map-reveal"]') && !document.querySelector('[data-testid="prematch"]') && [...document.querySelectorAll("button")].some((b) => /Confirmar plan|Abandonar/i.test(b.textContent))`, 12000);
      const revealMs = Date.now() - t0;
      await sleep(500);
      await shot(tab, `${c.id}-4-partido`);
      const estado = await tab.js<Record<string, unknown>>(`(() => ({
        url: location.pathname + location.search,
        intro: [...document.querySelectorAll("button")].some((b) => /Empezar (el )?partido/i.test(b.textContent)),
        teamGate: /Necesitas un equipo/.test(document.body.innerText),
        hud: document.body.innerText.match(/Equipo NEXUS|${SEED.team.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/)?.[0] ?? null,
        guardada: window.__qaSaved && window.__qaSaved.name,
        editorVisible: !!document.querySelector('[data-testid="composition-builder"]'),
      }))()`);
      const errors = tab.takeErrors();
      const row = { caso: c.id, acciones: acciones.length, pasos: acciones, revelacion: reveal, mapaRevelado: revealMap, mapaEsperado, mapaOk: revealMap === mapaEsperado, imagenMapa: revealImg, arranco: started, msHastaPartido: revealMs, ...estado, errores: errors.length, muestraErrores: errors.slice(0, 3) };
      rows.push(row);
      console.log(JSON.stringify(row));
    } catch (e) {
      rows.push({ caso: c.id, error: String(e), pasos: acciones });
      console.log(`✗ ${c.id}: ${e}`);
      await shot(tab, `${c.id}-error`).catch(() => {});
    } finally { await browser.close(); }
  }
  writeFileSync(join(OUT, "qa.json"), JSON.stringify({ base: BASE, generated: new Date().toISOString(), note: "sesión simulada + /api/game/* fijo; no escribe en la BD", rows }, null, 2));
})();
