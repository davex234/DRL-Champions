/**
 * FASE 51.2 · instrumento de capturas de la NAVEGACIÓN (fuera de CI). Deriva de `_fase51-1-shots.ts`.
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
/** Lanza la partida y avanza (plan → compra → ronda → intro) hasta ver el tablero en vivo. */
const LIVE = js(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const btn = (re) => [...document.querySelectorAll("button")].find((b) => re.test(b.textContent.trim()));
  btn(/^Sortear lado y jugar/)?.click();
  for (let i = 0; i < 200; i++) {
    await sleep(100);
    const b = btn(/^(Confirmar plan|Jugar la ronda|Empezar (el )?partido|Confirmar compra)/i);
    if (b) { b.click(); continue; }
    if (document.querySelector('[data-testid="match-map"]') && !btn(/^Empezar (el )?partido/i)) break;
  }
  /* Avisos del entrenador: la opción neutra (la última), para que la ronda siga. Luego se pausa. */
  const avisos = () => [...document.querySelectorAll("div")].find((d) => /^Decisión del entrenador/i.test(d.textContent.trim()) && d.querySelectorAll("button").length > 1);
  btn(/^1×$/)?.click();
  for (let t = 0; t < 900; t += 150) {
    await sleep(150);
    const d = avisos();
    if (d) { const bs = d.querySelectorAll("button"); bs[bs.length - 1].click(); }
  }
  btn(/Pausa/)?.click();
  await sleep(300);
  const d2 = avisos();
  if (d2) { const bs = d2.querySelectorAll("button"); bs[bs.length - 1].click(); await sleep(300); btn(/Pausa/)?.click(); }
  await sleep(600);
  const m = document.querySelector('[data-testid="match-map"]');
  const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const k = e.getBoundingClientRect(); return [Math.round(k.top), Math.round(k.bottom), Math.round(k.left), Math.round(k.right)]; };
  const sb = r('[data-broadcast="scoreboard"]'), bn = r('[data-testid="moment-banner"] > div > *');
  const solapa = sb && bn ? !(bn[0] >= sb[1] || bn[1] <= sb[0] || bn[2] >= sb[3] || bn[3] <= sb[2]) : null;
  const rutas = m ? m.querySelectorAll("[data-route]").length : 0;
  return (m ? m.getAttribute("data-map-id") : "sin tablero") + " rutas=" + rutas + " marcador=" + JSON.stringify(sb) + " aviso=" + JSON.stringify(bn) + " solapa=" + solapa;
})()`);

/** Igual que LIVE pero se pausa en cuanto aparece el tablero: el aviso de momento (eco, etc.) sigue visible. */
const LIVE_EARLY = LIVE.replace("for (let t = 0; t < 900; t += 150) {", "for (let t = 0; t < 0; t += 150) {");

interface Scene { id: string; path: string; equipos: Equipos; gestos?: string[]; sizes?: [number, number][]; wait?: number }
const RESP_SIZES: [number, number][] = [[1920, 1080], [1440, 900], [1366, 768], [1024, 768], [768, 1024], [390, 844]];
const D: [number, number][] = [[1440, 900]];
const SCENES: Scene[] = [
  { id: "01-ascent-path", path: "/design-system/fase51-2?map=ascent&scene=path", equipos: "uno", sizes: [[1440, 900]] },
  { id: "02-bind-path", path: "/design-system/fase51-2?map=bind&scene=path", equipos: "uno", sizes: [[1440, 900]] },
  { id: "03-haven-path", path: "/design-system/fase51-2?map=haven&scene=path", equipos: "uno", sizes: [[1440, 900]] },
  { id: "04-lotus-path", path: "/design-system/fase51-2?map=lotus&scene=path", equipos: "uno", sizes: [[1440, 900]] },
  { id: "05-sunset-path", path: "/design-system/fase51-2?map=sunset&scene=path", equipos: "uno", sizes: [[1440, 900]] },
  { id: "06-abyss-path", path: "/design-system/fase51-2?map=abyss&scene=path", equipos: "uno", sizes: [[1440, 900]] },
  { id: "07-breeze-path", path: "/design-system/fase51-2?map=breeze&scene=path", equipos: "uno", sizes: [[1440, 900]] },
  { id: "08-corrode-path", path: "/design-system/fase51-2?map=corrode&scene=path", equipos: "uno", sizes: [[1440, 900]] },
  { id: "09-fracture-path", path: "/design-system/fase51-2?map=fracture&scene=path", equipos: "uno", sizes: [[1440, 900]] },
  { id: "10-icebox-path", path: "/design-system/fase51-2?map=icebox&scene=path", equipos: "uno", sizes: [[1440, 900]] },
  { id: "11-pearl-path", path: "/design-system/fase51-2?map=pearl&scene=path", equipos: "uno", sizes: [[1440, 900]] },
  { id: "12-split-path", path: "/design-system/fase51-2?map=split&scene=path", equipos: "uno", sizes: [[1440, 900]] },
  { id: "13-ascent-wall-avoidance", path: "/design-system/fase51-2?map=ascent&scene=wall", equipos: "uno", sizes: [[1440, 900]] },
  { id: "14-live-round", path: "/entrenador/partido?map=ascent", equipos: "uno", gestos: [LIVE], sizes: [[1920, 1080], [1440, 900]] },
  { id: "15-broadcast", path: "/entrenador/partido?map=haven", equipos: "uno", gestos: [LIVE_EARLY], sizes: [[1920, 1080], [1440, 900], [1366, 768], [1024, 768], [768, 1024], [390, 844]] },
  { id: "17-mobile", path: "/entrenador/partido?map=lotus", equipos: "uno", gestos: [LIVE], sizes: [[390, 844]] },
  { id: "18-navigation-debug", path: "/design-system/fase51-2?map=ascent&scene=debug", equipos: "uno", sizes: [[1440, 900]] },
  { id: "19-debug", path: "/design-system/fase51-2?map=split&scene=debug", equipos: "uno", sizes: [[1440, 900]] },
];

async function main() {
  const pick = (arg("scenes") ?? "").split(",").filter(Boolean);
  const escenas = pick.length ? SCENES.filter((s) => pick.some((p) => s.id.startsWith(p))) : SCENES;
  const forced = arg("sizes")?.split(",").map((s) => s.split("x").map(Number) as [number, number]);
  const filas: { file: string; gestos: unknown[]; errors: string[] }[] = [];
  for (const s of escenas) {
    for (const [w, h] of forced ?? s.sizes ?? D) {
      const file = `${s.id}-${w}.png`;
      const browser = await launch({ args: ["--in-process-gpu", "--mute-audio", "--hide-scrollbars"] });
      try {
        await browser.tab.send("Page.addScriptToEvaluateOnNewDocument", { source: boot });
        await browser.tab.send("Page.addScriptToEvaluateOnNewDocument", { source: seed(s.equipos) });
        await browser.tab.setMedia([{ name: "prefers-reduced-motion", value: "reduce" }]);
        await browser.tab.resize(w, h, 1);
        await browser.tab.goto(`${BASE}${s.path}`, 3000);
        const gestos: unknown[] = [];
        for (const g of s.gestos ?? []) { gestos.push(await browser.tab.js(g)); await sleep(500); }
        await sleep(s.wait ?? 700);
        await browser.tab.shot(join(OUT, file));
        const errors = browser.tab.takeErrors().filter((e) => !/401|Failed to load resource|No autenticado/.test(e));
        filas.push({ file, gestos, errors });
        console.log(`  ✓ ${file} ${JSON.stringify(gestos)}${errors.length ? ` · ${errors.length} err: ${errors[0].slice(0, 160)}` : ""}`);
      } catch (e) {
        console.log(`  ✗ ${file}: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        await browser.close();
      }
    }
  }
  writeFileSync(join(OUT, `shots${pick.length ? "-" + pick.join("_") : ""}.json`), JSON.stringify({ base: BASE, generated: new Date().toISOString(), note: "sesión simulada + fixtures + semilla local (ver cabecera de scripts/_fase51-1-shots.ts)", rows: filas }, null, 2));
  console.log(`FIN · ${filas.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
