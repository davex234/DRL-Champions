/**
 * FASE 51 · instrumento de capturas del Tactical Coach (fuera de CI).
 *
 *   npx tsx scripts/_fase51-shots.ts [--sizes=1920x1080,...] [--scenes=a,b] [--probe]
 *
 * Chrome headless no puede iniciar sesión (no hay credenciales en el repo, y no debe haberlas). Para
 * fotografiar las pantallas CON SESIÓN se inyecta, antes de que arranque la app, una sesión local
 * simulada (solo la lee `getSession`, que no valida contra la red) y un `fetch` que sirve
 * `/api/game/*` con las respuestas REALES capturadas del servidor para la cuenta demo el
 * 2026-09-22 (datos `__QA_TRAINER51__`). La UI es la de la build; los datos, los del servidor.
 * Lo que no está en los fixtures sigue a la red (y con la sesión simulada recibe 401).
 *
 * `--probe` lista las peticiones a `/api` que no tenían fixture.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg("base") ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase51-tactical-coach");
const SIZES = (arg("sizes") ?? "1920x1080,1440x900,1024x768,768x1024,390x844")
  .split(",").map((s) => s.split("x").map(Number) as [number, number]);
const FIX = JSON.parse(readFileSync(arg("fixtures") ?? join(process.cwd(), "scripts", "_fase51-fixtures.json"), "utf8"));
mkdirSync(OUT, { recursive: true });

const RICH = FIX.richStratId as string;

/** Lo que se ejecuta en la página ANTES que la app: sesión simulada + fixtures. */
const boot = `(() => {
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\\+/g, "-").replace(/\\//g, "_");
  const exp = 4102444800;
  const user = { id: ${JSON.stringify(FIX.userId)}, aud: "authenticated", role: "authenticated", email: "demo@nexus.local", app_metadata: {}, user_metadata: {} };
  const jwt = b64({ alg: "none", typ: "JWT" }) + "." + b64({ sub: user.id, exp, role: "authenticated", email: user.email }) + ".qa";
  try { localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "qa-f51", user })); } catch {}
  const F = ${JSON.stringify(FIX.responses)};
  const orig = window.fetch.bind(window);
  window.__miss = [];
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(url, location.href);
    if (u.origin === location.origin && u.pathname.startsWith("/api/")) {
      const m = (init && init.method) || (typeof input === "object" && input.method) || "GET";
      const hit = F[m + " " + u.pathname + u.search] || F[m + " " + u.pathname];
      if (hit) return new Response(JSON.stringify(hit.body), { status: hit.status, headers: { "content-type": "application/json" } });
      window.__miss.push(m + " " + u.pathname + u.search);
    }
    return orig(input, init);
  };
})();`;

const click = (sel: string) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); e?.click(); return !!e; })()`;
const clickText = (t: string) => `(() => { const e = [...document.querySelectorAll("button,a")].find((b) => b.textContent.trim() === ${JSON.stringify(t)}); e?.click(); return !!e; })()`;
const scroll = (sel: string) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); e?.scrollIntoView({ block: "start" }); window.scrollBy(0, -12); return !!e; })()`;

interface Scene { id: string; path: string; gestos?: string[]; wait?: number }
const SCENES: Scene[] = [
  { id: "01-jugar-centro-tactico", path: "/jugar", gestos: [scroll('[data-testid="play-hub-coach"]')] },
  { id: "02-hub", path: "/entrenador" },
  { id: "03-composiciones", path: "/entrenador/composiciones" },
  { id: "04-composicion-constructor", path: "/entrenador/composiciones", gestos: [click('[data-testid="new-composition"]'),
    `(() => { const b = [...document.querySelectorAll('[data-testid="agent-roster"] button')]; [0, 9, 17].forEach((i) => b[i]?.click()); return b.length; })()`] },
  { id: "05-composicion-filtro-rol", path: "/entrenador/composiciones", gestos: [click('[data-testid="new-composition"]'),
    `(() => { const g = document.querySelector('[aria-label="Filtrar por rol"]'); const b = g?.querySelectorAll("button")[3]; b?.click(); return !!b; })()`,
    scroll('[data-testid="agent-roster"]')] },
  { id: "06-mapas", path: "/entrenador/mapas" },
  { id: "07-pizarra", path: `/entrenador/strats?abrir=${RICH}`, gestos: [clickText("02.Utilidad")] },
  { id: "08-pizarra-agente-habilidad", path: `/entrenador/strats?abrir=${RICH}`, gestos: [clickText("02.Utilidad"),
    `(() => { const b = [...document.querySelectorAll('button[title^="Seleccionar "]')][1]; b?.click(); return !!b; })()`] },
  { id: "09-pizarra-herramienta-armada", path: `/entrenador/strats?abrir=${RICH}`, gestos: [clickText("03.Entrada A"), click('button[aria-label="Humo"], nav[aria-label="Herramientas"] button[aria-label]:nth-of-type(1)')] },
  { id: "10-pizarra-deshacer", path: `/entrenador/strats?abrir=${RICH}`, gestos: [clickText("04.Post-plant"), clickText("+ Paso"), clickText("+ Paso"), click('[data-testid="undo"]')] },
  { id: "11-pizarra-conflicto", path: `/entrenador/strats?abrir=${RICH}`, gestos: [clickText("+ Paso"), click('[data-testid="save-strat"]')], wait: 900 },
  { id: "12-teatro", path: `/entrenador/strats?abrir=${RICH}`, gestos: [click('[data-testid="open-theater"]'), click('[data-testid="theater-next"]'), click('[data-testid="theater-next"]')], wait: 1400 },
  { id: "13-plan-seleccionar", path: "/entrenador/plan" },
  { id: "14-plan-no-encontrada", path: "/entrenador/plan?match=00000000-0000-4000-8000-000000000000" },
  { id: "15-dirigir-partido", path: "/entrenador/partido" },
  { id: "16-partidos-vacio", path: "/entrenador/partidos" },
  { id: "17-plantilla", path: "/entrenador/equipos" },
  { id: "18-menu-entrenador", path: "/entrenador", gestos: [`(() => { const m = document.querySelector('[aria-label="Abrir menú"]'); if (m && m.offsetParent) { m.click(); return "movil"; } const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim().startsWith("Más")); b?.click(); return b ? "mas" : "nada"; })()`] },
];

async function main() {
  const pick = (arg("scenes") ?? "").split(",").filter(Boolean);
  const escenas = pick.length ? SCENES.filter((s) => pick.some((p) => s.id.startsWith(p))) : SCENES;
  const filas: { file: string; errors: string[]; miss: string[]; gestos: unknown[] }[] = [];
  const browser = await launch({ args: ["--in-process-gpu", "--mute-audio", "--hide-scrollbars"] });
  try {
    await browser.tab.send("Page.addScriptToEvaluateOnNewDocument", { source: boot });
    await browser.tab.setMedia([{ name: "prefers-reduced-motion", value: "reduce" }]);
    for (const s of escenas) {
      for (const [w, h] of SIZES) {
        const file = `${s.id}-${w}.png`;
        try {
          await browser.tab.resize(w, h, 1);
          await browser.tab.goto(`${BASE}${s.path}`, 2600);
          const gestos: unknown[] = [];
          for (const g of s.gestos ?? []) { gestos.push(await browser.tab.js(g)); await sleep(350); }
          await sleep(s.wait ?? 500);
          await browser.tab.shot(join(OUT, file));
          const miss = (await browser.tab.js<string[]>("window.__miss || []")) ?? [];
          const errors = browser.tab.takeErrors().filter((e) => !/401|Failed to load resource/.test(e));
          filas.push({ file, errors, miss, gestos });
          console.log(`  ✓ ${file} ${JSON.stringify(gestos)}${miss.length && process.argv.includes("--probe") ? ` miss=${[...new Set(miss)].join(" ")}` : ""}${errors.length ? ` · ${errors.length} err: ${errors[0].slice(0, 140)}` : ""}`);
        } catch (e) {
          console.log(`  ✗ ${file}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  } finally {
    await browser.close();
  }
  writeFileSync(join(OUT, "shots.json"), JSON.stringify({ base: BASE, generated: new Date().toISOString(), note: "sesión simulada + fixtures reales (ver cabecera de scripts/_fase51-shots.ts)", rows: filas }, null, 2));
  console.log(`FIN · ${filas.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
