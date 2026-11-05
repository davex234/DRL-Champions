/**
 * COLECCIONES ILIMITADAS · SONDA DE COMPATIBILIDAD (instrumento; SOLO stack de QA aislado, cuentas sintéticas).
 *
 * Funciona igual contra la release publicada (b48d76af) y contra la candidata: comprueba que cada versión sirve sus
 * pantallas de datos con la migración puesta o quitada, y saca lo que debe ser IDÉNTICO entre versiones (equipos y su
 * validez, ejemplares numerados).
 *
 *   node - read  <correo>            lecturas: estado, colección, equipos, crafteo, forja, misiones, vista de desguace
 *   node - open  <correo>            compra y abre un sobre Estándar (operación económica real EN QA)
 *   node - walk  <correo> <páginas>  recorre /api/game/cards y consulta por uid (solo candidata): debe ser solo lectura
 *   node - serials <correo> <carta>  ejemplares numerados de una carta según la API (solo candidata)
 *
 * Variables: QA_ANON_KEY, PROBE_PW (contraseña de la cuenta).
 */
import { randomUUID } from "node:crypto";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3027";
if (/valorosters\.com|:3005\b/.test(BASE)) throw new Error("solo contra el stack de QA aislado");
const [mode, email, arg] = process.argv.slice(2);
if (!/@example\.invalid$/.test(email ?? "")) throw new Error("cuenta no sintética");
const out = (o) => console.log(JSON.stringify(o));

const lg = await fetch(`${BASE}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: process.env.QA_ANON_KEY, "content-type": "application/json" }, body: JSON.stringify({ email, password: process.env.PROBE_PW }) });
const token = (await lg.json()).access_token;
if (!token) throw new Error(`login ${lg.status}`);
const build = (await (await fetch(`${BASE}/api/health`)).json()).build ?? "?";
async function api(path, body) {
  const r = await fetch(`${BASE}${path}`, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* no JSON */ }
  return { status: r.status, json };
}

if (mode === "read") {
  const state = await api("/api/game/state");
  const duels = await api("/api/game/duels");
  const rest = {};
  for (const p of ["/api/game/collection", "/api/game/crafting", "/api/game/forge", "/api/game/meta", "/api/game/collection-sets", "/api/game/loop", "/api/game/season"]) rest[p] = (await api(p)).status;
  const salv = await api("/api/game/economy", { action: "salvagePreview" });
  out({
    build, cuenta: email,
    estado: state.status, creditos: state.json?.credits, ejemplaresEnEstado: state.json?.ownedCards?.length, total: state.json?.ownedTotal ?? null,
    sobres: state.json?.unopenedPacks,
    equipos: duels.status,
    // Lo que debe coincidir entre versiones: cada equipo, sus cartas y si es válido.
    equiposDetalle: (duels.json?.decks ?? []).map((d) => ({ id: d.id, nombre: d.name, cartas: (d.cards ?? d.cardUids ?? []).length, valido: d.valid ?? null, estado: d.status ?? null, activo: d.active ?? null, uids: (d.cards ?? []).map((c) => c.uid).sort().join(",") })).sort((a, b) => (a.id < b.id ? -1 : 1)),
    desguace: salv.status, lecturas: rest,
  });
} else if (mode === "open") {
  const before = (await api("/api/game/state")).json;
  const r = await api("/api/game/packs", { action: "buy_and_open", packId: "estandar", ref: randomUUID() });
  const after = (await api("/api/game/state")).json;
  out({ build, cuenta: email, compraYApertura: r.status, cartas: r.json?.opened?.length ?? 0, cobro: before.credits - after.credits, uids: (r.json?.opened ?? []).map((o) => o.uid) });
} else if (mode === "walk") {
  let cursor = null, pages = 0, seen = 0; const some = [];
  for (; pages < Number(arg ?? 20); pages++) {
    const r = await api(`/api/game/cards?limit=100&sort=uid${cursor ? `&cursor=${cursor}` : ""}`);
    if (r.status !== 200) { out({ build, error: r.status }); break; }
    seen += r.json.items.length; if (some.length < 40) some.push(...r.json.items.slice(0, 5).map((i) => i.uid));
    if (!r.json.nextCursor) break; cursor = r.json.nextCursor;
  }
  const look = await api(`/api/game/cards?uids=${some.slice(0, 40).join(",")}`);
  out({ build, cuenta: email, paginas: pages, leidas: seen, porUid: look.json?.items?.length ?? null });
} else if (mode === "serials") {
  const rows = []; let cursor = null;
  for (;;) {
    const r = await api(`/api/game/cards?card=${encodeURIComponent(arg)}&numbered=1&limit=100${cursor ? `&cursor=${cursor}` : ""}`);
    if (r.status !== 200) { out({ build, error: r.status }); break; }
    for (const i of r.json.items) rows.push(`${i.serial}:${i.uid}`);
    if (!r.json.nextCursor) break; cursor = r.json.nextCursor;
  }
  const state = (await api("/api/game/state")).json;
  const rep = (state.ownedCards ?? []).find((c) => c.cardId === arg);
  out({ build, carta: arg, numeradas: rows.length, lista: rows.join(","), mejorEjemplar: rep ? `${rep.serial}:${rep.uid}` : null });
} else if (mode === "team") {
  // Crea un equipo LEGAL (2 por rol, jugadores distintos, misma versión de datos) eligiendo a propósito, de cada carta,
  // la copia de uid MÁS ALTO: con varias copias, no es el «mejor ejemplar» que la build nueva trae en el estado.
  // Con la build nueva el constructor solo ofrece un ejemplar por carta: el equipo sale con esos.
  const ws = (await api("/api/game/duels")).json;
  const pool = ws.collection ?? [];
  const byVersion = {}; for (const c of pool) byVersion[c.dataVersion] = (byVersion[c.dataVersion] ?? 0) + 1;
  const version = Object.entries(byVersion).sort((x, y) => y[1] - x[1])[0]?.[0];
  const lastOf = new Map(); for (const c of pool) if (c.dataVersion === version) { const cur = lastOf.get(c.cardId); if (!cur || c.uid > cur.uid) lastOf.set(c.cardId, c); }
  const used = new Set(), uids = [];
  for (const role of ["Duelista", "Controlador", "Iniciador", "Centinela", "Flex"]) {
    let n = 0;
    for (const c of [...lastOf.values()].sort((x, y) => (x.cardId < y.cardId ? -1 : 1))) { if (n === 2) break; if (c.role !== role || used.has(c.playerId)) continue; used.add(c.playerId); uids.push(c.uid); n++; }
  }
  const made = await api("/api/game/duels", { action: "create", name: arg ?? "Compat", cardUids: uids });
  const id = made.json?.deck?.id;
  const act = id ? await api("/api/game/duels", { action: "set_active", id }) : { status: 0 };
  out({ build, cuenta: email, cartasEnElPool: pool.length, elegidas: uids.length, crear: made.status, id, valido: made.json?.deck?.valid ?? null, activar: act.status, error: made.json?.error ?? act.json?.error ?? null });
} else if (mode === "activate") {
  // Con la OTRA versión: volver a marcar activo el mismo equipo (el servidor lo revalida entero: completo, legal y tuyo).
  const ws = (await api("/api/game/duels")).json;
  const d = (ws.decks ?? []).find((x) => x.name === (arg ?? "Compat"));
  const act = d ? await api("/api/game/duels", { action: "set_active", id: d.id }) : { status: 0 };
  out({ build, cuenta: email, equipo: d?.id ?? null, valido: d?.valid ?? null, cartas: (d?.cards ?? []).length, activar: act.status, error: act.json?.error ?? null });
} else throw new Error("modo: read | open | walk | serials | team | activate");
