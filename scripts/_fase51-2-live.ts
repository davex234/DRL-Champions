/**
 * FASE 51.2 · instrumento: RONDA REAL en vivo, muestreada (fuera de CI). Deriva de `_fase51-2-shots.ts`.
 *
 *   npx tsx scripts/_fase51-2-shots.ts [--scenes=01,14] [--sizes=1440x900,...]
 *
 * Escenas 01–13 y 18: arnés `/design-system/fase51-2` (ruta del grafo sobre el asset real).
 * Escenas 14–17: partido en vivo con la sesión simulada; el gesto mide si el aviso de momento
 * solapa el marcador del broadcast y lo devuelve junto a la captura.
 *
 * Mismo método que `_fase51-shots.ts` (sesión simulada + `/api/game/*` con respuestas reales) y,
 * por escena, una SEMILLA local: la colección del demo (las 331 cartas, `_fase51-1-seed.json`) y
 * sus equipos (ninguno, uno listo, o uno listo + uno incompleto). La composición de Ascent es la
 * que se creó por la UI real en el QA (`__QA_TRAINER511__ Ascent`).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg("base") ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase51-2-navigation");
mkdirSync(OUT, { recursive: true });
const SEED = JSON.parse(readFileSync(join(process.cwd(), "scripts", "_fase51-1-seed.json"), "utf8"));
const USER = "2f86cbe8-f663-40fb-a87c-4896b9a45b62";
const COMP = {
  id: "310ecd94-af68-477d-b285-ff7022724f50", mapId: "ascent", name: "__QA_TRAINER511__ Ascent",
  agentIds: ["jett", "omen", "sova", "killjoy", "kayo"], notes: "", primary: false, updatedAt: "2026-09-22T12:00:00.000Z",
};
const RESP = {
  "GET /api/game/compositions": { status: 200, body: { compositions: [COMP] } },
  "GET /api/game/strats": { status: 200, body: { strats: [] } },
  "GET /api/game/coach-matches": { status: 200, body: { matches: [], record: { jugados: 0, ganados: 0, perdidos: 0, diferencialRondas: 0, racha: 0 }, total: 0 } },
  "POST /api/telemetry": { status: 200, body: { ok: true } },
  "POST /api/game/coach-matches": { status: 200, body: { ok: true } },
};

const boot = `(() => {
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\\+/g, "-").replace(/\\//g, "_");
  const exp = 4102444800;
  const user = { id: ${JSON.stringify(USER)}, aud: "authenticated", role: "authenticated", email: "demo@nexus.local", app_metadata: {}, user_metadata: {} };
  const jwt = b64({ alg: "none", typ: "JWT" }) + "." + b64({ sub: user.id, exp, role: "authenticated" }) + ".qa";
  try { localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "qa-f511", user })); } catch {}
  const F = ${JSON.stringify(RESP)};
  const orig = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(url, location.href);
    if (u.origin === location.origin && u.pathname.startsWith("/api/")) {
      const m = (init && init.method) || "GET";
      const hit = F[m + " " + u.pathname + u.search] || F[m + " " + u.pathname];
      if (hit) return new Response(JSON.stringify(hit.body), { status: hit.status, headers: { "content-type": "application/json" } });
    }
    return orig(input, init);
  };
})();`;

type Equipos = "ninguno" | "uno" | "dos";
const seed = (e: Equipos) => {
  const teams = e === "ninguno" ? [] : e === "uno" ? [SEED.team] : [SEED.team, SEED.incompleto];
  return `(() => { try {
    if (sessionStorage.getItem("qa511")) return; sessionStorage.setItem("qa511", "1");
    localStorage.setItem("drl-champions", ${JSON.stringify(JSON.stringify({ state: { ownedCards: SEED.owned, credits: 984585 }, version: 1 }))});
    localStorage.setItem("drl-champions-teams", ${JSON.stringify(JSON.stringify({ state: { teams, activeTeamId: teams[0]?.id ?? null, lastSetup: null }, version: 1 }))});
  } catch {} })();`;
};

const js = (f: string) => f;
const click = (sel: string) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e?.click(); return !!e; })()`);
const scroll = (sel: string, block = "start") => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e?.scrollIntoView({ block: "${block}" }); return !!e; })()`);

/**
 * Lanza una partida en `map`, juega UNA ronda a 1× respondiendo los avisos con la opción neutra y
 * muestrea cada 100 ms la posición de cada ficha (coordenadas del asset). Al acabar la ronda
 * comprueba en Node, sobre el PNG real, que todas las posiciones son suelo y que no hay saltos.
 */
import sharp from "sharp";
import { pixelClassAt } from "../src/domain/tactics/navigation/walkability";
import { availableMaps } from "../src/domain/tactics/maps";

const MAPA = arg("map") ?? "ascent";
const RUN = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const btn = (re) => [...document.querySelectorAll("button")].find((b) => re.test(b.textContent.trim()));
  btn(/^Sortear lado y jugar/)?.click();
  for (let i = 0; i < 200; i++) {
    await sleep(100);
    const b = btn(/^(Confirmar plan|Jugar la ronda|Empezar (el )?partido|Confirmar compra)/i);
    if (b) { b.click(); continue; }
    if (document.querySelector('[data-testid="match-map"]') && !btn(/^Empezar (el )?partido/i)) break;
  }
  btn(/^1×$/)?.click();
  const muestras = []; let rutasMax = 0, ptsRuta = 0;
  for (let t = 0; t < 900; t++) {
    await sleep(100);
    const d = [...document.querySelectorAll("div")].find((x) => /^Decisión del entrenador/i.test(x.textContent.trim()) && x.querySelectorAll("button").length > 1);
    if (d) { const bs = d.querySelectorAll("button"); bs[bs.length - 1].click(); }
    const m = document.querySelector('[data-testid="match-map"]');
    if (!m) { if (muestras.length) break; continue; }
    const fichas = [...m.querySelectorAll('[data-entity="player"]')].map((g) => { const c = g.querySelector("circle"); return [g.querySelector("text:last-of-type")?.textContent ?? "?", +c.getAttribute("cx"), +c.getAttribute("cy")]; });
    const rs = [...m.querySelectorAll("[data-route]")];
    rutasMax = Math.max(rutasMax, rs.length); ptsRuta = Math.max(ptsRuta, ...rs.map((p) => p.getAttribute("points").split(" ").length), 0);
    muestras.push(fichas);
  }
  const fin = document.body.innerText.match(/RONDA (GANADA|PERDIDA)/)?.[0] ?? null;
  return JSON.stringify({ muestras, rutasMax, ptsRuta, fin, marcador: document.body.innerText.match(/\d+\s*[–-]\s*\d+/)?.[0] });
})()`;

(async () => {
  const browser = await launch({ args: ["--in-process-gpu", "--mute-audio"] });
  try {
    await browser.tab.send("Page.addScriptToEvaluateOnNewDocument", { source: boot });
    await browser.tab.send("Page.addScriptToEvaluateOnNewDocument", { source: seed("uno") });
    await browser.tab.resize(1440, 900, 1);
    await browser.tab.goto(`${BASE}/entrenador/partido?map=${MAPA}`, 3000);
    const r = JSON.parse(await browser.tab.js<string>(RUN));
    await browser.tab.shot(join(OUT, `14b-live-round-end-${MAPA}.png`));
    const m = availableMaps().find((x) => x.id === MAPA)!;
    const { data, info } = await sharp(join(process.cwd(), "public", "maps", m.asset)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const im = { width: info.width, height: info.height, channels: info.channels, data };
    let fuera = 0, total = 0, salto = 0, mov = 0;
    const prev = new Map<string, [number, number]>();
    for (const fr of r.muestras as [string, number, number][][]) for (const [n, x, y] of fr) {
      total++;
      if (pixelClassAt(im, x, y) !== "floor") fuera++;
      const p = prev.get(n);
      if (p) { const d = Math.hypot(x - p[0], y - p[1]); salto = Math.max(salto, d); if (d > 0.5) mov++; }
      prev.set(n, [x, y]);
    }
    console.log(JSON.stringify({ mapa: MAPA, muestras: r.muestras.length, posiciones: total, fueraDelSuelo: fuera, movimientos: mov, saltoMaxPx: Math.round(salto), rutasMax: r.rutasMax, puntosMaxRuta: r.ptsRuta, fin: r.fin, errores: browser.tab.takeErrors().filter((e: string) => !/401|No autenticado|Failed to load/.test(e)).length }));
  } finally { await browser.close(); }
})();
