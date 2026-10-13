/**
 * F59 · QA visual del sistema de arte de agentes (instrumento `_`, fuera de CI, SOLO LECTURA).
 *
 *   npx tsx scripts/_fase59-agent-qa.ts --label=before|after [--base=http://127.0.0.1:3005] [--scenes=a,b] [--sizes=1440x900,...]
 *
 * Reutiliza el patrón de `_fase51-shots.ts`: sesión Supabase simulada + `fetch` que sirve `/api/game/*`
 * con los fixtures REALES de `_fase51-fixtures.json` (composición jett/omen/sova/killjoy/kayo y la
 * jugada «Ejecución A»). No escribe en ninguna cuenta. `?qa=empty-comps` fuerza «sin composiciones»
 * para ver el quick play. Las estadísticas salen del arnés `/design-system/fase30?scene=match`.
 *
 * En `after` mide además, por escena: imágenes de agente pintadas, rotas (naturalWidth 0), qué
 * piezas se pidieron (face/full) y cuántos bytes de `/agents/` se descargaron.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const LABEL = arg("label") ?? "after";
const BASE = arg("base") ?? "http://127.0.0.1:3005";
const ROOT = join(process.cwd(), "docs", "product", "qa", "fase59-agent-visual-system");
const OUT = join(ROOT, "screenshots", LABEL);
const SIZES = (arg("sizes") ?? "1440x900,1024x768,390x844").split(",").map((s) => s.split("x").map(Number) as [number, number]);
const FIX = JSON.parse(readFileSync(join(process.cwd(), "scripts", "_fase51-fixtures.json"), "utf8"));
mkdirSync(OUT, { recursive: true });
const RICH = FIX.richStratId as string;
const COMP = FIX.responses["GET /api/game/compositions"].body.compositions[0].id as string;

const boot = `(() => {
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\\+/g, "-").replace(/\\//g, "_");
  const exp = 4102444800;
  const user = { id: ${JSON.stringify(FIX.userId)}, aud: "authenticated", role: "authenticated", email: "demo@nexus.local", app_metadata: {}, user_metadata: {} };
  const jwt = b64({ alg: "none", typ: "JWT" }) + "." + b64({ sub: user.id, exp, role: "authenticated", email: user.email }) + ".qa";
  try { localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "qa-f59", user })); } catch {}
  const F = ${JSON.stringify(FIX.responses)};
  const empty = location.search.includes("qa=empty-comps");
  const orig = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(url, location.href);
    if (u.origin === location.origin && u.pathname.startsWith("/api/")) {
      const m = (init && init.method) || (typeof input === "object" && input.method) || "GET";
      if (m === "GET" && u.pathname === "/api/game/compositions" && empty) return new Response(JSON.stringify({ compositions: [] }), { status: 200, headers: { "content-type": "application/json" } });
      if (m !== "GET" && u.pathname !== "/api/telemetry") return new Response(JSON.stringify({ error: "QA: sin escrituras" }), { status: 409, headers: { "content-type": "application/json" } });
      const hit = F[m + " " + u.pathname + u.search] || F[m + " " + u.pathname];
      if (hit) return new Response(JSON.stringify(hit.body), { status: hit.status, headers: { "content-type": "application/json" } });
    }
    return orig(input, init);
  };
})();`;

const click = (sel: string) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); e?.click(); return !!e; })()`;
const clickText = (t: string) => `(() => { const e = [...document.querySelectorAll("button,a")].find((b) => b.textContent.trim() === ${JSON.stringify(t)}); e?.click(); return !!e; })()`;
const scroll = (sel: string) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); e?.scrollIntoView({ block: "start" }); window.scrollBy(0, -12); return !!e; })()`;
const pick5 = (roster: string) => `(() => { const want = ["jett","omen","sova","killjoy","kayo"]; let n = 0; for (const id of want) { const b = document.querySelector('[data-testid="${roster}-' + id + '"]'); if (b) { b.click(); n++; } } return n; })()`;

interface Scene { id: string; path: string; gestos?: string[]; wait?: number }
const SCENES: Scene[] = [
  { id: "01-hub", path: "/entrenador" },
  { id: "02-composiciones-lista", path: "/entrenador/composiciones" },
  { id: "03-selector-composicion", path: "/entrenador/composiciones", gestos: [click('[data-testid="new-composition"]'), `(() => { const b = [...document.querySelectorAll('[data-testid="agent-roster"] button')]; [0, 9].forEach((i) => b[i]?.click()); return b.length; })()`, scroll('[data-testid="agent-roster"]')] },
  { id: "04-composicion-final", path: "/entrenador/composiciones", gestos: [click('[data-testid="new-composition"]'), pick5("roster"), scroll('[data-testid="composition-slots"]')] },
  { id: "05-jugar-elegir", path: "/entrenador/jugar" },
  { id: "06-quickplay", path: "/entrenador/jugar?qa=empty-comps", gestos: [pick5("quick-agent")] },
  { id: "07-mapa-pizarra", path: `/entrenador/strats?abrir=${RICH}`, gestos: [clickText("02.Utilidad")] },
  { id: "08-teatro", path: `/entrenador/strats?abrir=${RICH}`, gestos: [click('[data-testid="open-theater"]'), click('[data-testid="theater-next"]')], wait: 1400 },
  { id: "09-preparacion-partido", path: `/entrenador/partido?map=ascent&comp=${COMP}`, gestos: [scroll('[data-testid="prematch-comp"]')], wait: 1200 },
  { id: "10-estadisticas-match-center", path: "/design-system/fase30?scene=match", gestos: [scroll('[data-testid="match-stats"]')], wait: 900 },
];

const METRICS = `(() => {
  const imgs = [...document.querySelectorAll('img[src*="/agents/"], image')].map((e) => {
    const src = e.getAttribute("src") || e.getAttribute("href") || "";
    return { src, tag: e.tagName.toLowerCase(), broken: e.tagName === "IMG" ? (e.complete && e.naturalWidth === 0) : false };
  }).filter((x) => x.src.includes("/agents/"));
  const res = performance.getEntriesByType("resource").filter((r) => r.name.includes("/agents/"));
  return {
    agentImages: imgs.length,
    broken: imgs.filter((i) => i.broken).map((i) => i.src),
    faceNodes: document.querySelectorAll('[data-testid="agent-face"][data-art="image"]').length,
    fullNodes: document.querySelectorAll('[data-testid="agent-full"][data-art="image"]').length,
    emblemFallbacks: document.querySelectorAll('[data-art="emblem"]').length,
    mapFaces: document.querySelectorAll('[data-agent-face]').length,
    requested: { face96: res.filter((r) => r.name.includes("/face-96.webp")).length, face: res.filter((r) => r.name.includes("/face.webp")).length, full: res.filter((r) => r.name.includes("/full.webp")).length },
    bytes: res.reduce((n, r) => n + (r.encodedBodySize || r.decodedBodySize || r.transferSize || 0), 0),
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
})()`;

async function main() {
  const pick = (arg("scenes") ?? "").split(",").filter(Boolean);
  const escenas = pick.length ? SCENES.filter((s) => pick.some((p) => s.id.startsWith(p))) : SCENES;
  const rows: Record<string, unknown>[] = [];
  const browser = await launch({ args: ["--in-process-gpu", "--mute-audio", "--hide-scrollbars"] });
  try {
    await browser.tab.send("Page.addScriptToEvaluateOnNewDocument", { source: boot });
    await browser.tab.setMedia([{ name: "prefers-reduced-motion", value: "reduce" }]);
    for (const s of escenas) {
      for (const [w, h] of SIZES) {
        const file = `${s.id}-${w}.png`;
        try {
          await browser.tab.resize(w, h, 1);
          await browser.tab.goto(`${BASE}${s.path}`, 2800);
          const gestos: unknown[] = [];
          for (const g of s.gestos ?? []) { gestos.push(await browser.tab.js(g)); await sleep(400); }
          await sleep(s.wait ?? 900);
          await browser.tab.shot(join(OUT, file));
          const m = await browser.tab.js<Record<string, unknown>>(METRICS);
          rows.push({ scene: s.id, width: w, file: `screenshots/${LABEL}/${file}`, gestos, ...m });
          console.log(`  ✓ ${LABEL}/${file} ${JSON.stringify(gestos)} ${JSON.stringify(m)}`);
        } catch (e) {
          console.log(`  ✗ ${file}: ${e instanceof Error ? e.message : String(e)}`);
          rows.push({ scene: s.id, width: w, error: e instanceof Error ? e.message : String(e) });
        }
      }
    }
  } finally {
    await browser.close();
  }
  // Se FUSIONA con lo anterior por escena+ancho: repetir una escena no borra las demás.
  const path = join(ROOT, `shots-${LABEL}.json`);
  let prev: Record<string, unknown>[] = [];
  try { prev = JSON.parse(readFileSync(path, "utf8")).rows ?? []; } catch { /* primera vez */ }
  const key = (r: Record<string, unknown>) => `${r.scene}@${r.width}`;
  const merged = new Map(prev.map((r) => [key(r), r]));
  for (const r of rows) merged.set(key(r), r);
  const all = [...merged.values()].sort((a, b) => key(a).localeCompare(key(b), undefined, { numeric: true }));
  writeFileSync(path, JSON.stringify({ label: LABEL, base: BASE, note: "sesión simulada + fixtures reales de _fase51-fixtures.json; sin escrituras", rows: all }, null, 1) + "\n");
  console.log(`FIN · ${rows.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
