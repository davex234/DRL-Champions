/**
 * COLECCIONES ILIMITADAS · SONDA DE CARGA (instrumento; SOLO stack de QA aislado, cuentas sintéticas).
 *
 * Se ejecuta DENTRO del contenedor de la app de QA (`collection-scale.sh` lo lanza). Solo habla HTTP con la app y con
 * el Auth del stack de QA; la base se siembra y se mide desde el guion (psql), no desde aquí.
 *
 *   node - setup <tamaños,…>      crea (o reutiliza) una cuenta sintética por tamaño → { tamaño: userId }
 *   node - run <tamaño> <esperadas>   todas las medidas de esa cuenta → un JSON por línea
 *   node - security <tamañoA> <tamañoB>   aislamiento entre cuentas, cursores y parámetros
 *   node - concurrency <tamaño>   dos sesiones a la vez: paginar mientras se abre un sobre y desguaces simultáneos
 *
 * Variables: QA_ANON_KEY, QA_SERVICE_KEY, COLL_PW (contraseña de las cuentas sintéticas, la genera el guion).
 */
import { randomUUID } from "node:crypto";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3027";
if (/valorosters\.com|:3005\b/.test(BASE)) throw new Error("solo contra el stack de QA aislado");
const ANON = process.env.QA_ANON_KEY, SERVICE = process.env.QA_SERVICE_KEY, PW = process.env.COLL_PW;
if (!ANON || !PW) throw new Error("faltan QA_ANON_KEY / COLL_PW");
const emailOf = (size) => `coll-${size}@example.invalid`;
const out = (o) => console.log(JSON.stringify(o));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(size) {
  const r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify({ email: emailOf(size), password: PW }) });
  const j = await r.json();
  if (!j.access_token) throw new Error(`login ${size} → ${r.status}`);
  return j.access_token;
}

/** Sentencias SQL sobre la colección ejecutadas hasta ahora (ayudante `_qa_stmt_calls`, solo en la base de QA). */
async function stmts() {
  if (!SERVICE) return null;
  const r = await fetch(`${BASE}/rest/v1/rpc/_qa_stmt_calls`, { method: "POST", headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json" }, body: "{}" });
  return r.ok ? Number(await r.text()) : null;
}

/** Una petición medida: latencia, bytes y (si se pide) sentencias SQL que provocó. Reintenta sola un 429. */
async function call(token, path, { body, count = false, raw = false } = {}) {
  for (let attempt = 0; ; attempt++) {
    const before = count ? await stmts() : null;
    const t0 = performance.now();
    const r = await fetch(`${BASE}${path}`, { method: body ? "POST" : "GET", headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    const ms = performance.now() - t0;
    if (r.status === 429 && !raw && attempt < 40) { await sleep((Number(r.headers.get("retry-after")) || 2) * 1000 + 200); continue; }
    const after = count ? await stmts() : null;
    let json = null; try { json = JSON.parse(text); } catch { /* no es JSON */ }
    return { status: r.status, ms: Math.round(ms * 10) / 10, bytes: Buffer.byteLength(text), json, sql: before !== null && after !== null ? after - before : null, waited: attempt };
  }
}
const stat = (list) => { const s = [...list].sort((a, b) => a - b); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]; return { n: s.length, min: s[0], p50: q(0.5), p95: q(0.95), max: s[s.length - 1] }; };
/** Repite una lectura y resume su latencia. La primera va con recuento de SQL. */
async function measure(name, token, path, opts = {}, times = 7) {
  const first = await call(token, path, { ...opts, count: true });
  const ms = [first.ms];
  for (let i = 1; i < times; i++) ms.push((await call(token, path, opts)).ms);
  return { name, status: first.status, bytes: first.bytes, sql: first.sql, ms: stat(ms), json: first.json };
}

const [mode, a, b] = process.argv.slice(2);

if (mode === "setup") {
  if (!SERVICE) throw new Error("falta QA_SERVICE_KEY");
  const ids = {};
  for (const size of a.split(",")) {
    const email = emailOf(size);
    const admin = { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json" };
    let r = await fetch(`${BASE}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email, password: PW, email_confirm: true, user_metadata: { username: `coll${size}` } }) });
    let j = await r.json();
    if (!j.id) {
      // Ya existía de una pasada anterior: se le pone la contraseña de ESTA pasada.
      const list = await (await fetch(`${BASE}/auth/v1/admin/users?per_page=200`, { headers: admin })).json();
      const u = (list.users ?? []).find((x) => x.email === email);
      if (!u) throw new Error(`no se pudo crear ${email}: ${r.status} ${JSON.stringify(j).slice(0, 120)}`);
      r = await fetch(`${BASE}/auth/v1/admin/users/${u.id}`, { method: "PUT", headers: admin, body: JSON.stringify({ password: PW }) });
      j = await r.json();
    }
    ids[size] = j.id;
  }
  out(ids);
} else if (mode === "run") {
  const size = a, expected = Number(b);
  const t = await login(size);
  const rows = [];
  const push = (r, extra = {}) => { const { json, ...rest } = r; void json; rows.push({ size: expected, ...rest, ...extra }); };

  // Estado de juego: total exacto, un ejemplar por carta, tamaño acotado.
  const state = await measure("GET /api/game/state", t, "/api/game/state");
  push(state, { ok: state.status === 200 && state.json.ownedTotal === expected && Object.values(state.json.ownedCounts).reduce((n, c) => n + c, 0) === expected, total: state.json?.ownedTotal, ejemplaresEnRespuesta: state.json?.ownedCards?.length });

  // Foto personal del álbum.
  const col = await measure("GET /api/game/collection", t, "/api/game/collection", {}, 5);
  push(col, { ok: col.status === 200 && col.json.total === expected, total: col.json?.total, ejemplaresEnRespuesta: col.json?.instances?.length });

  // Primera página de ejemplares.
  const first = await measure("GET /api/game/cards (1.ª página, 100)", t, "/api/game/cards?limit=100&sort=uid");
  push(first, { ok: first.status === 200 && first.json.total === expected && first.json.items.length === Math.min(100, expected) && first.json.hasMore === (expected > 100), total: first.json?.total });

  // Recorrido COMPLETO por cursor: todas, sin repetir; la última página no tiene siguiente.
  {
    const seen = new Set(); let cursor = null, pages = 0, waited = 0, dup = 0; const ms = [];
    const t0 = performance.now();
    for (;;) {
      const r = await call(t, `/api/game/cards?limit=100&sort=uid${cursor ? `&cursor=${cursor}` : ""}`);
      if (r.status !== 200) { rows.push({ size: expected, name: "recorrido completo por cursor", ok: false, status: r.status }); break; }
      pages++; waited += r.waited; ms.push(r.ms);
      for (const i of r.json.items) { if (seen.has(i.uid)) dup++; seen.add(i.uid); }
      if (!r.json.nextCursor) {
        rows.push({ size: expected, name: "recorrido completo por cursor (páginas de 100)", ok: seen.size === expected && dup === 0 && r.json.hasMore === false, leidas: seen.size, duplicadas: dup, paginas: pages, ms: stat(ms), totalS: Math.round((performance.now() - t0) / 100) / 10, esperasPorLimite: waited });
        break;
      }
      cursor = r.json.nextCursor;
    }
  }

  // Copias de UNA carta (la más repetida), por serie; y filtros combinados en servidor.
  if (expected > 0) {
    const top = Object.entries(state.json.ownedCounts).sort((x, y) => y[1] - x[1])[0];
    const one = await measure("GET /api/game/cards?card= (copias de una carta, por serie)", t, `/api/game/cards?card=${encodeURIComponent(top[0])}&limit=48`);
    push(one, { ok: one.status === 200 && one.json.total === top[1], copiasDeEsaCarta: top[1] });
    const filt = await measure("GET /api/game/cards (carta + libres + numeradas)", t, `/api/game/cards?card=${encodeURIComponent(top[0])}&locked=0&numbered=1&limit=48`, {}, 5);
    push(filt, { ok: filt.status === 200 && filt.json.items.every((i) => i.cardId === top[0] && i.serial !== null && !i.locked), total: filt.json?.total });
    const serials = (one.json.items ?? []).map((i) => i.serial);
    const nn = serials.filter((s) => s !== null);
    rows.push({ size: expected, name: "orden por serie (numeradas primero, ascendente)", ok: JSON.stringify(nn) === JSON.stringify([...nn].sort((x, y) => x - y)) && serials.slice(nn.length).every((s) => s === null) });
  }

  // Lo que decide o enseña con la colección COMPLETA en servidor.
  const salv = await measure("POST economy salvagePreview", t, "/api/game/economy", { body: { action: "salvagePreview" } }, 3);
  const distinct = Object.keys(state.json.ownedCounts).length;
  push(salv, { ok: salv.status === 200 && salv.json.salvageable === Math.max(0, expected - distinct) && salv.json.uids.length <= 500, desguazables: salv.json?.salvageable, enLaTanda: salv.json?.uids?.length });
  const duels = await measure("GET /api/game/duels (equipos y constructor)", t, "/api/game/duels", {}, 5);
  push(duels, { ok: duels.status === 200, cartasEnElConstructor: duels.json?.collection?.length });
  const meta = await measure("GET /api/game/meta (misiones y logros)", t, "/api/game/meta", {}, 5);
  push(meta, { ok: meta.status === 200 });
  const craft = await measure("GET /api/game/crafting", t, "/api/game/crafting", {}, 3);
  push(craft, { ok: craft.status === 200 });
  const forge = await measure("GET /api/game/forge", t, "/api/game/forge", {}, 3);
  push(forge, { ok: forge.status === 200 });
  const sets = await measure("GET /api/game/collection-sets", t, "/api/game/collection-sets", {}, 3);
  push(sets, { ok: sets.status === 200 });

  // Abrir un sobre con esta colección: las cartas nuevas se suman y el total sube exactamente lo que entrega.
  {
    const before = (await call(t, "/api/game/state")).json;
    const r = await call(t, "/api/game/packs", { body: { action: "buy_and_open", packId: "estandar", ref: randomUUID() }, count: true });
    const after = (await call(t, "/api/game/state")).json;
    const got = r.json?.opened?.length ?? 0;
    const page = got ? await call(t, `/api/game/cards?uids=${r.json.opened.map((o) => o.uid).join(",")}`) : null;
    rows.push({ size: expected, name: "POST packs buy_and_open (sobre Estándar)", status: r.status, ms: r.ms, sql: r.sql, bytes: r.bytes, ok: r.status === 200 && got > 0 && after.ownedTotal === before.ownedTotal + got && page?.json?.items?.length === got, cartasEntregadas: got, totalAntes: before.ownedTotal, totalDespues: after.ownedTotal, nuevasMarcadas: (r.json?.opened ?? []).filter((o) => o.isNew).length });
  }
  for (const r of rows) out(r);
} else if (mode === "security") {
  const ta = await login(a), tb = await login(b);
  const rows = [];
  const check = (name, ok, detail = "") => rows.push({ name, ok, detail: String(detail).slice(0, 160) });
  const pa = await call(ta, "/api/game/cards?limit=5&sort=uid"), pb = await call(tb, "/api/game/cards?limit=5&sort=uid");
  const uidsA = new Set(), uidsB = pb.json.items.map((i) => i.uid);
  for (const i of pa.json.items) uidsA.add(i.uid);
  check("sin token → 401 (estado, colección, cartas, desguace)", (await Promise.all([call(null, "/api/game/state", { raw: true }), call(null, "/api/game/collection", { raw: true }), call(null, "/api/game/cards", { raw: true }), call(null, "/api/game/economy", { body: { action: "salvagePreview" }, raw: true })])).every((r) => r.status === 401));
  const dead = await call("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIwIiwiZXhwIjoxfQ.firma-invalida", "/api/game/cards", { raw: true });
  check("sesión caducada o token falso → 401", dead.status === 401, dead.status);
  const cross = await call(ta, `/api/game/cards?limit=100&sort=uid&cursor=${pb.json.nextCursor}`);
  check("cursor emitido para OTRA cuenta: solo devuelve cartas propias", cross.status === 200 && cross.json.items.every((i) => !uidsB.includes(i.uid)), `${cross.status} · ${cross.json?.items?.length} cartas`);
  const look = await call(ta, `/api/game/cards?uids=${uidsB.join(",")}`);
  check("pedir por uid cartas de OTRA cuenta: no vuelve ninguna", look.status === 200 && look.json.items.length === 0, look.json?.items?.length);
  const mine = await call(ta, `/api/game/cards?uids=${[...uidsA].join(",")}`);
  check("pedir por uid cartas propias: vuelven todas", mine.status === 200 && mine.json.items.length === uidsA.size);
  for (const [name, path] of [
    ["parámetro de usuario", `/api/game/cards?userId=00000000-0000-4000-8000-000000000000`], ["clave desconocida", "/api/game/cards?offset=50"], ["límite 0", "/api/game/cards?limit=0"], ["límite 101", "/api/game/cards?limit=101"], ["límite enorme", "/api/game/cards?limit=999999"],
    ["orden desconocido", "/api/game/cards?sort=price"], ["serie sin carta", "/api/game/cards?sort=serial"], ["carta con ruta", "/api/game/cards?card=..%2F..%2Fetc"], ["cursor basura", "/api/game/cards?cursor=%25%25%25"], ["cursor inyección", `/api/game/cards?cursor=${Buffer.from(JSON.stringify({ v: 1, f: "x", at: { p: "u", u: "' or 1=1 --" } })).toString("base64url")}`],
    ["cursor de otros filtros", `/api/game/cards?limit=5&sort=uid&locked=1&cursor=${pa.json.nextCursor}`], ["uids mal formados", "/api/game/cards?uids=1,2,3"], ["61 uids", `/api/game/cards?uids=${Array.from({ length: 61 }, () => randomUUID()).join(",")}`],
    ["colección con parámetro", "/api/game/collection?userId=x"],
  ]) { const r = await call(ta, path, { raw: true }); check(`${name} → 400`, r.status === 400, `${r.status} ${JSON.stringify(r.json).slice(0, 80)}`); }
  const leak = JSON.stringify(pa.json);
  check("la respuesta no lleva dueño, correo ni datos ajenos al ejemplar", !/user_id|email|example\.invalid/.test(leak));
  const alienSalvage = await call(ta, "/api/game/economy", { body: { action: "salvage", uids: uidsB, ref: randomUUID() } });
  const stillB = await call(tb, `/api/game/cards?uids=${uidsB.join(",")}`);
  check("desguazar cartas de OTRA cuenta: se rechaza y siguen ahí", alienSalvage.status === 409 && stillB.json.items.length === uidsB.length, alienSalvage.status);
  // Límite de frecuencia: una ráfaga acaba en 429 con Retry-After, sin tumbar el servicio.
  let limited = null;
  for (let i = 0; i < 200 && !limited; i++) { const r = await call(ta, "/api/game/cards?limit=1", { raw: true }); if (r.status === 429) limited = r; else if (r.status !== 200) break; }
  check("ráfaga de lecturas: 429 con límite por cuenta", !!limited && limited.json?.code === "RATE_LIMITED");
  check("y la OTRA cuenta no queda afectada", (await call(tb, "/api/game/cards?limit=1", { raw: true })).status === 200);
  for (const r of rows) out(r);
} else if (mode === "concurrency") {
  const size = a;
  const t1 = await login(size), t2 = await login(size);
  const rows = [];
  // 1 · Dos dispositivos: uno recorre la colección mientras el otro abre sobres. Ninguna carta se repite ni se pierde.
  {
    const before = (await call(t1, "/api/game/state")).json.ownedTotal;
    const seen = new Set(); let dup = 0, pages = 0, cursor = null; const opened = [];
    const opener = (async () => { for (let i = 0; i < 3; i++) { const r = await call(t2, "/api/game/packs", { body: { action: "buy_and_open", packId: "estandar", ref: randomUUID() } }); for (const o of r.json?.opened ?? []) opened.push(o.uid); await sleep(150); } })();
    for (;;) {
      const r = await call(t1, `/api/game/cards?limit=100&sort=uid${cursor ? `&cursor=${cursor}` : ""}`);
      pages++; for (const i of r.json.items) { if (seen.has(i.uid)) dup++; seen.add(i.uid); }
      if (!r.json.nextCursor) break; cursor = r.json.nextCursor;
    }
    await opener;
    const after = (await call(t1, "/api/game/state")).json.ownedTotal;
    rows.push({ name: "paginar mientras otro dispositivo abre 3 sobres", ok: dup === 0 && seen.size >= before && seen.size <= after && after === before + opened.length, antes: before, despues: after, leidas: seen.size, duplicadas: dup, abiertas: opened.length, paginas: pages });
  }
  // 2 · Dos desguaces simultáneos de la MISMA tanda (claves distintas): se paga una sola vez cada carta.
  {
    const s0 = (await call(t1, "/api/game/state")).json;
    const p = (await call(t1, "/api/game/economy", { body: { action: "salvagePreview" } })).json;
    const batch = p.uids.slice(0, 200);
    const each = p.batchTotal / p.uids.length;
    const [r1, r2] = await Promise.all([call(t1, "/api/game/economy", { body: { action: "salvage", uids: batch, ref: randomUUID() } }), call(t2, "/api/game/economy", { body: { action: "salvage", uids: batch, ref: randomUUID() } })]);
    const s1 = (await call(t1, "/api/game/state")).json;
    const paid = (r1.json?.paid ?? 0) + (r2.json?.paid ?? 0), gone = (r1.json?.salvaged ?? 0) + (r2.json?.salvaged ?? 0);
    rows.push({ name: "dos desguaces simultáneos de las mismas 200 cartas", ok: s0.ownedTotal - s1.ownedTotal === gone && s1.credits - s0.credits === paid && gone === 200, respuestas: [r1.status, r2.status], borradas: s0.ownedTotal - s1.ownedTotal, contadas: gone, pagado: s1.credits - s0.credits, sumaDeRespuestas: paid, valorMedio: Math.round(each) });
  }
  // 3 · La misma operación repetida (misma clave): idempotente.
  {
    const p = (await call(t1, "/api/game/economy", { body: { action: "salvagePreview" } })).json;
    const ref = randomUUID(), batch = p.uids.slice(0, 50);
    const s0 = (await call(t1, "/api/game/state")).json;
    const [r1, r2, r3] = await Promise.all([1, 2, 3].map(() => call(t1, "/api/game/economy", { body: { action: "salvage", uids: batch, ref } })));
    const s1 = (await call(t1, "/api/game/state")).json;
    rows.push({ name: "misma clave enviada 3 veces a la vez: una sola operación", ok: s0.ownedTotal - s1.ownedTotal === 50 && [r1, r2, r3].every((r) => r.status === 200 || r.status === 409) && s1.credits - s0.credits === Math.max(r1.json?.paid ?? 0, r2.json?.paid ?? 0, r3.json?.paid ?? 0), borradas: s0.ownedTotal - s1.ownedTotal, pagado: s1.credits - s0.credits, respuestas: [r1.status, r2.status, r3.status] });
  }
  // 4 · Desguace completo por tandas, como hace la pantalla: al terminar queda UNA copia de cada carta.
  {
    let rounds = 0, gone = 0, paid = 0; const t0 = performance.now();
    const s0 = (await call(t1, "/api/game/state")).json;
    let p = (await call(t1, "/api/game/economy", { body: { action: "salvagePreview" } })).json;
    const expectedPay = p.total, expectedGone = p.salvageable;
    while (p.uids.length > 0 && rounds < 400) {
      const r = await call(t1, "/api/game/economy", { body: { action: "salvage", uids: p.uids, ref: randomUUID() } });
      if (r.status !== 200) { rows.push({ name: "desguace completo por tandas", ok: false, status: r.status, detalle: JSON.stringify(r.json).slice(0, 120) }); break; }
      rounds++; gone += r.json.salvaged; paid += r.json.paid;
      p = (await call(t1, "/api/game/economy", { body: { action: "salvagePreview" } })).json;
    }
    const s1 = (await call(t1, "/api/game/state")).json;
    rows.push({ name: "desguace completo por tandas de 500", ok: gone === expectedGone && paid === expectedPay && s1.ownedTotal === Object.keys(s1.ownedCounts).length && s1.credits - s0.credits === paid, tandas: rounds, desguazadas: gone, previstas: expectedGone, pagado: paid, previsto: expectedPay, quedan: s1.ownedTotal, cartasDistintas: Object.keys(s1.ownedCounts).length, totalS: Math.round((performance.now() - t0) / 100) / 10 });
  }
  for (const r of rows) out(r);
} else {
  throw new Error("modo: setup | run | security | concurrency");
}
