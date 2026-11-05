/**
 * FASE 56 · verificación REAL del perfil contra la BD del VPS (fuera de CI). No modifica datos: solo lecturas y
 * escrituras que el servidor DEBE rechazar (la única escritura válida posible no se intenta).
 *
 *   npx tsx scripts/_fase56-live.ts --a=<creds A> --b=<creds B>
 *
 * API: perfil ajeno con sesión, sin sesión, id malformado, inexistente, cuerpo con userId ajeno, vitrina con una carta
 * de OTRO jugador, sin sesión al escribir; escaneo de correos/saldo en todas las respuestas. Navegador (Chrome headless,
 * sesión QA A): /competitivo → clic en la fila de B en la clasificación → /jugador/<B> (PUBLIC, sin editar) → volver →
 * /jugador/me (SELF, con editar). Capturas en docs/product/qa/fase56-profile/live/.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase56-profile", "live");
mkdirSync(OUT, { recursive: true });
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PRIVATE_KEYS = /"(email|credits|balance|xpIntoLevel|packsOpened|privateDuels|showcaseUids|version|is_admin)"/;
const leaks: string[] = [];

async function session(file: string) {
  const c = JSON.parse(readFileSync(file, "utf8"));
  const s = await (await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "content-type": "application/json" }, body: JSON.stringify({ email: c.email, password: c.password }) })).json();
  return { userId: c.userId as string, token: s.access_token as string, raw: s };
}
async function api(token: string | null, path: string, body?: unknown, scanPrivate = false) {
  const r = await fetch(`${BASE}${path}`, { method: body === undefined ? "GET" : "POST", headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  if (EMAIL.test(t)) leaks.push(`${path}: correo`);
  if (scanPrivate && PRIVATE_KEYS.test(t)) leaks.push(`${path}: ${t.match(PRIVATE_KEYS)![0]}`);
  let json: any = null; try { json = JSON.parse(t); } catch { json = t; }
  return { status: r.status, json };
}

(async () => {
  const A = await session(arg("a")!), B = await session(arg("b")!);
  const ev: Record<string, unknown> = {};
  // ── API ──
  const bByA = await api(A.token, `/api/game/player?id=${B.userId}`, undefined, true);
  const bAnon = await api(null, `/api/game/player?id=${B.userId}`, undefined, true);
  const aByB = await api(B.token, `/api/game/player?id=${A.userId}`, undefined, true);
  const me = await api(A.token, "/api/game/player?me=1");
  ev.publicB = { status: bByA.status, view: bByA.json?.view, self: bByA.json?.self, name: bByA.json?.player?.username, rating: bByA.json?.ranked?.rating, position: bByA.json?.ranked?.position, standing: bByA.json?.standing, season: bByA.json?.season?.ranked, cardsSummary: bByA.json?.collection?.instances, showcase: bByA.json?.showcase?.length };
  ev.anonB = { status: bAnon.status, view: bAnon.json?.view, h2h: bAnon.json?.h2h };
  ev.publicAbyB = { status: aByB.status, view: aByB.json?.view };
  ev.meA = { status: me.status, view: me.json?.view, hasSelf: !!me.json?.self };
  ev.malformed = (await api(A.token, "/api/game/player?id=not-a-uuid")).status;
  ev.nonexistent = (await api(A.token, "/api/game/player?id=00000000-0000-4000-8000-00000000dead")).status;
  // Escrituras que DEBEN fallar (ninguna modifica nada).
  const bCard = ((await api(B.token, "/api/game/duels")).json?.collection ?? [])[0]?.uid as string | undefined;
  ev.writeUnauth = (await api(null, "/api/game/player", { action: "set_avatar", avatar: "🐉" })).status;
  ev.writeOtherUserField = await api(A.token, "/api/game/player", { action: "set_showcase", cardUids: [], expectedVersion: null, userId: B.userId }).then((r) => ({ status: r.status, code: r.json?.code }));
  ev.showcaseOthersCard = bCard ? await api(A.token, "/api/game/player", { action: "set_showcase", cardUids: [bCard], expectedVersion: null }).then((r) => ({ status: r.status, code: r.json?.code })) : "sin carta de B";
  ev.showcaseDuplicate = bCard ? await api(A.token, "/api/game/player", { action: "set_showcase", cardUids: [bCard, bCard], expectedVersion: null }).then((r) => ({ status: r.status, code: r.json?.code })) : null;
  ev.showcaseBadUid = await api(A.token, "/api/game/player", { action: "set_showcase", cardUids: ["<script>"], expectedVersion: null }).then((r) => ({ status: r.status, code: r.json?.code }));
  ev.badAvatar = await api(A.token, "/api/game/player", { action: "set_avatar", avatar: "<img src=x onerror=alert(1)>" }).then((r) => ({ status: r.status, code: r.json?.code }));

  // ── Navegador ──
  const browser = await launch({ args: ["--in-process-gpu", "--mute-audio", "--hide-scrollbars"] });
  const t = browser.tab;
  const full = async (name: string, w: number) => {
    const h = await t.js<number>("Math.ceil(document.documentElement.scrollHeight)");
    const r = await t.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: Math.min(h, 7000), scale: 1 } });
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.data, "base64"));
  };
  try {
    await t.resize(1440, 900, 1);
    await t.setMedia([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await t.goto(`${BASE}/design-system`, 800);
    await t.setStorage("sb-127-auth-token", JSON.stringify({ ...A.raw, expires_at: Math.floor(Date.now() / 1000) + 3500 }));
    await t.goto(`${BASE}/competitivo`, 7000);
    const clicked = await t.js<string | null>(`(() => { const a = [...document.querySelectorAll('[data-testid="ranked-ladder"] a')].find((x) => x.getAttribute('href') === '/jugador/${B.userId}' && x.offsetParent); if (!a) return null; a.click(); return a.getAttribute('href'); })()`);
    await sleep(6000);
    ev.browserOther = await t.js(`({ clicked: ${JSON.stringify(clicked)}, path: location.pathname, view: document.querySelector('[data-scene="player-identity"]')?.getAttribute('data-view'), edit: !!document.querySelector('[data-action="edit"]'), share: !!document.querySelector('[data-action="share"]'), standing: document.querySelector('[data-testid="profile-standing"]')?.getAttribute('data-state'), season: !!document.querySelector('[data-testid="profile-season"]'), email: /@example\\.invalid/.test(document.body.innerText) })`);
    await full("L1-other-profile-real", 1440);
    await t.goto(`${BASE}/competitivo`, 6000);
    ev.browserBack = await t.js("location.pathname");
    await t.goto(`${BASE}/jugador/me`, 8000);
    ev.browserOwn = await t.js(`({ path: location.pathname, view: document.querySelector('[data-scene="player-identity"]')?.getAttribute('data-view'), edit: !!document.querySelector('[data-action="edit"]'), seasonCta: !!document.querySelector('[data-action="season"]') })`);
    await full("L2-own-profile-real", 1440);
    await t.resize(390, 844, 1); await sleep(900); await full("L3-own-profile-real-390", 390);
    ev.consoleErrors = t.takeErrors().slice(0, 6);
  } finally { await browser.close(); }
  ev.leaks = leaks;
  writeFileSync(join(OUT, "live.json"), JSON.stringify({ generated: new Date().toISOString(), accounts: "QA A 8c326e52 · QA B 1ff2c0ef", ...ev }, null, 2));
  console.log(JSON.stringify(ev, null, 2));
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
