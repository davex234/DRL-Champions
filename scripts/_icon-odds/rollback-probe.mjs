/**
 * ICON · ENSAYO DE ROLLBACK (instrumento; solo stack de QA aislado, cuenta sintética).
 *
 *   node rollback-probe.mjs buy     compra 1 `icon-single` y 2 `icon` (release nueva) y los deja SIN abrir
 *   node rollback-probe.mjs probe   qué ve y qué permite la app que esté sirviendo (estado, páginas, abrir cada sobre)
 *   node rollback-probe.mjs open <packId>   abre una unidad y lista las cartas
 *   node rollback-probe.mjs frozen  con la BARRERA puesta: intenta comprar, abrir y craftear ICON y comprueba que nada se
 *                                   cobra ni se consume (créditos e inventario idénticos antes y después)
 *   node rollback-probe.mjs craft   craftea Champions → ICON Premium (receta de la base) y enseña el inventario
 *
 * Variables: BASE_URL (por defecto http://127.0.0.1:3027), QA_ANON_KEY, QA_PLAYER_EMAIL, QA_PLAYER_PASSWORD.
 */
import { randomUUID } from "node:crypto";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3027";
if (/valorosters\.com|:3005\b/.test(BASE)) throw new Error("solo contra el stack de QA aislado");
if (!/@example\.invalid$/.test(process.env.QA_PLAYER_EMAIL ?? "")) throw new Error("cuenta QA no sintética");

async function login() {
  const r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: process.env.QA_ANON_KEY, "content-type": "application/json" }, body: JSON.stringify({ email: process.env.QA_PLAYER_EMAIL, password: process.env.QA_PLAYER_PASSWORD }) });
  const j = await r.json();
  if (!j.access_token) throw new Error(`login ${r.status}`);
  return j.access_token;
}
async function api(t, path, body) {
  const r = await fetch(`${BASE}${path}`, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${t}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { json = text.slice(0, 200); }
  return { status: r.status, json };
}
const icons = (s) => Object.fromEntries(Object.entries(s.json?.unopenedPacks ?? {}).filter(([k, v]) => (k.startsWith("icon") || k === "champions") && v > 0));
const credits = (s) => s.json?.credits ?? s.json?.profile?.credits ?? s.json?.wallet?.credits ?? null;
const snap = (s) => JSON.stringify({ creditos: credits(s), sobres: icons(s), cartas: s.json?.ownedTotal ?? (s.json?.ownedCards ?? []).length }); // COLECCIONES ILIMITADAS · el total exacto lo da `ownedTotal`; con una build anterior, los ejemplares del estado
/** Cartas entregadas según la RESPUESTA de la apertura (`opened`): no depende de `ownedCards`, que PostgREST corta en 1.000 filas. */
const cardsOf = (res) => (res.json?.opened ?? res.json?.data?.opened ?? res.json?.results ?? res.json?.cards ?? []).map((c) => `${c.card?.id ?? c.cardId ?? c.id}`);

const [mode, arg] = process.argv.slice(2);
const t = await login();
const build = (await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => ({}))).version;
console.log(`app ${BASE} · versión ${build} · modo ${mode}`);

if (mode === "buy") {
  for (const [packId, price] of [["icon-single", 30000], ["icon", 80000], ["icon", 80000], ["champions", 35000], ["champions", 35000], ["champions", 35000]]) {
    const r = await api(t, "/api/game/packs", { action: "buy", packId, ref: `rbprobe-${randomUUID()}`, expectedPrice: price });
    console.log(`compra ${packId} → ${r.status}`);
  }
  console.log("inventario ICON:", JSON.stringify(icons(await api(t, "/api/game/state"))));
} else if (mode === "open") {
  const before = (await api(t, "/api/game/state")).json.ownedCards.map((c) => c.uid);
  const r = await api(t, "/api/game/packs", { action: "open", packId: arg, ref: `rbprobe-${randomUUID()}` });
  const after = (await api(t, "/api/game/state"));
  // con ≥ 1.000 cartas la foto del estado está cortada y la diferencia sale vacía: manda la respuesta de la apertura
  const diff = after.json.ownedCards.filter((c) => !before.includes(c.uid)).map((c) => c.cardId);
  const got = cardsOf(r).length ? cardsOf(r) : diff;
  console.log(`abrir ${arg} → ${r.status} · cartas nuevas: ${JSON.stringify(got)} · ${r.status === 200 ? "" : JSON.stringify(r.json).slice(0, 200)}`);
  console.log("inventario ICON:", JSON.stringify(icons(after)));
} else if (mode === "probe") {
  const s = await api(t, "/api/game/state");
  console.log(`estado → ${s.status} · inventario ICON: ${JSON.stringify(icons(s))}`);
  for (const p of ["/api/game/store", "/api/game/daily-loop", "/api/game/onboarding", "/api/game/season", "/api/game/meta", "/api/game/crafting"]) { const r = await api(t, p); console.log(`${p} → ${r.status}`); }
  for (const p of ["/", "/inventario", "/packs", "/tienda", "/abrir/icon-single", "/abrir/icon", "/packs/icon-single", "/misiones/crafting/sobres"]) { const r = await fetch(`${BASE}${p}`, { headers: { cookie: "" } }); console.log(`página ${p} → ${r.status}`); }
  console.log("estado:", snap(s));
} else if (mode === "frozen") {
  const before = snap(await api(t, "/api/game/state"));
  console.log("antes  :", before);
  const tries = [
    ["comprar icon-single", "/api/game/packs", { action: "buy", packId: "icon-single", ref: `rbprobe-${randomUUID()}`, expectedPrice: 30000 }],
    ["comprar icon", "/api/game/packs", { action: "buy", packId: "icon", ref: `rbprobe-${randomUUID()}`, expectedPrice: 80000 }],
    ["comprar icon (precio antiguo)", "/api/game/packs", { action: "buy", packId: "icon", ref: `rbprobe-${randomUUID()}`, expectedPrice: 60000 }],
    ["abrir icon-single", "/api/game/packs", { action: "open", packId: "icon-single", ref: `rbprobe-${randomUUID()}` }],
    ["abrir icon", "/api/game/packs", { action: "open", packId: "icon", ref: `rbprobe-${randomUUID()}` }],
    ["craftear Champions → ICON", "/api/game/crafting", { action: "craftPack", recipeId: "pack-champions-icon", ref: `rbprobe-${randomUUID()}` }],
  ];
  for (const [name, path, body] of tries) { const r = await api(t, path, body); console.log(`${name} → ${r.status} · ${JSON.stringify(r.json).slice(0, 140)}`); }
  const after = snap(await api(t, "/api/game/state"));
  console.log("después:", after);
  console.log(before === after ? "SIN PÉRDIDAS: créditos, sobres y cartas idénticos" : "¡¡CAMBIO!! revisar");
  if (before !== after) process.exit(1);
} else if (mode === "craft") {
  const r = await api(t, "/api/game/crafting", { action: "craftPack", recipeId: "pack-champions-icon", ref: `rbprobe-${randomUUID()}` });
  console.log(`craftear Champions → ICON → ${r.status} · ${JSON.stringify(r.json).slice(0, 160)}`);
  console.log("estado:", snap(await api(t, "/api/game/state")));
} else throw new Error("modo: buy | probe | open <packId> | frozen | craft");
