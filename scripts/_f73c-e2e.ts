/**
 * F73 · CIERRE — E2E REAL de misiones y proyectos (fuera de CI). Chrome real → :3005 → servicios → Postgres del VPS.
 * SIN intercepción ni mocks. Configuración QA SOLO por /admin/crafting (cuenta QA Q con admin TEMPORAL autorizado).
 * La BD solo se LEE (dbRead) para comprobar lo que ha guardado el producto.
 *
 *   npx tsx scripts/_f73c-e2e.ts <fase>
 *   fases: admin-check · config · reject · player-i · player-k · project-ui · cross · cleanup · post-revoke
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PERSONA_FILES, openBrowser, loginUi, logoutUi, goto, sleep, waitFor, token, api, creds, playOneUi, type Client } from "./_fase68-lib";
import { clearActive, startPve, playMatch, active, matchState, eventsFor, progressFor, dbRead } from "./_f73c-lib";
import { serverCatalogSync } from "../src/server/catalog";
import { packCardClass } from "../src/domain/packs/packClass";

PERSONA_FILES.Q = "C:/Users/david/AppData/Local/Temp/claude/C--NEXUS-CENTRAL-DRLCards/738eeaef-6ef7-4f65-abd1-2ca435caa596/scratchpad/qa352-creds.json";
const OUT = join(process.cwd(), "docs/product/qa/fase73-closure");
const SHOTS = join(OUT, "shots");
mkdirSync(SHOTS, { recursive: true });
const STATE_F = join(OUT, "state.json");
const S: any = existsSync(STATE_F) ? JSON.parse(readFileSync(STATE_F, "utf8")) : {};
const persist = () => writeFileSync(STATE_F, JSON.stringify(S, null, 2));
const PHASE = process.argv[2] ?? "";
const results: { id: string; ok: boolean; detail: string }[] = [];
const extra: Record<string, unknown> = {};
const check = (id: string, ok: boolean, detail = "") => { results.push({ id, ok, detail: String(detail).slice(0, 1200) }); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${String(detail).slice(0, 300)}`); return ok; };
const save = (name: string) => { const pass = results.filter((r) => r.ok).length; writeFileSync(join(OUT, `${name}.json`), JSON.stringify({ at: new Date().toISOString(), intercepted: false, pass, fail: results.length - pass, results, ...extra }, null, 2)); console.log(`→ ${name}.json ${pass}/${results.length}`); };
const js = <T = any>(c: Client, e: string) => c.tab.js<T>(e);
const shot = (c: Client, n: string) => c.tab.shot(join(SHOTS, `${n}.png`)).catch(() => null);
const J = JSON.stringify;

// F73C_TAG: los ids/nombres de una pasada anterior quedan RETIRED (historia auditada) y no se reactivan.
const TAG = process.env.F73C_TAG ?? "";
const N = (s: string) => (TAG ? `${s} ${TAG}` : s);
const P = { partidas: `qa-f73-partidas${TAG ? "-" + TAG : ""}`, abrir: `qa-f73-abrir${TAG ? "-" + TAG : ""}`, tr: `qa-f73-equipo-tr${TAG ? "-" + TAG : ""}`, tras: `qa-f73-tras-equipo${TAG ? "-" + TAG : ""}`, project: `qa-f73-proyecto${TAG ? "-" + TAG : ""}` };
const TARGET_CARD = "darker__base";
const uid = (p: string) => creds(p).userId;
const missions = async (t: string) => (await api(t, "/api/game/missions")).json;
const mState = (snap: any, id: string) => snap?.missions?.find((m: any) => m.id === id);
const pState = (snap: any, id: string) => snap?.projects?.find((p: any) => p.id === id);
const copiesOf = async (t: string, cardId: string) => ((await api(t, "/api/game/state")).json.ownedCards as any[]).filter((o) => o.cardId === cardId).length;

/* ─────────── admin UI ─────────── */
async function setField(c: Client, id: string, value: string) {
  const ok = await js<boolean>(c, `(() => { const el = document.getElementById(${J(id)}); if (!el) return false;
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${J(value)});
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true; })()`);
  await sleep(120);
  if (!ok) throw new Error(`campo ${id} no encontrado`);
}
const btn = (c: Client, re: string) => js<boolean>(c, `(() => { const b = [...document.querySelectorAll('button')].find(x => new RegExp(${J(re)}, 'i').test((x.innerText||'').trim()) && !x.disabled && x.offsetParent !== null); if (!b) return false; b.scrollIntoView({block:'center'}); b.click(); return true; })()`);
async function tab(c: Client, name: "Recetas" | "Misiones" | "Proyectos") {
  await js(c, `[...document.querySelectorAll('[role="tab"]')].find(b => new RegExp('^${name}', 'i').test(b.innerText.trim()))?.click()`);
  if (!(await waitFor(c.tab, `[...document.querySelectorAll('[role="tab"]')].some(b => b.getAttribute('aria-selected') === 'true' && new RegExp('^${name}', 'i').test(b.innerText.trim()))`, 5000))) throw new Error(`pestaña ${name} no seleccionada`);
  await sleep(400);
}
async function adminOpen(c: Client) {
  await goto(c, "/admin/crafting", 3000);
  return waitFor(c.tab, `!!document.querySelector('[role="tablist"]') && /Crafteo y misiones/i.test(document.body.innerText)`, 25000);
}
/** Pulsa Guardar y devuelve { saved, error } según lo que diga el SERVIDOR (el editor se cierra o aparece la alerta). */
async function saveEditor(c: Client): Promise<{ saved: boolean; error: string | null }> {
  await js(c, `(() => { const p = [...document.querySelectorAll('[role="alert"]')]; p.forEach(x => x.setAttribute('data-old', '1')); })()`);
  await btn(c, "^Guardar$");
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    const st = await js<any>(c, `(() => { const a = [...document.querySelectorAll('[role="alert"]')].filter(x => !x.hasAttribute('data-old') && /▲/.test(x.innerText)).pop();
      const open = [...document.querySelectorAll('button')].some(b => /^(Guardar|Guardando…)$/i.test((b.innerText||'').trim()));
      return { alert: a ? a.innerText.trim() : null, open, busy: [...document.querySelectorAll('button')].some(b => /Guardando/.test(b.innerText)) }; })()`);
    if (st.alert) return { saved: false, error: st.alert };
    if (!st.open) return { saved: true, error: null };
  }
  return { saved: false, error: "sin respuesta" };
}
async function editRow(c: Client, text: string) {
  const ok = await js<boolean>(c, `(() => { const t = ${J(text)}.toLowerCase(); const li = [...document.querySelectorAll('li')].find(l => l.innerText.toLowerCase().includes(t) && [...l.querySelectorAll('button')].some(x => /editar/i.test(x.innerText))); const b = li && [...li.querySelectorAll('button')].find(x => /editar/i.test(x.innerText)); if (!b) return false; b.click(); return true; })()`);
  if (!ok) throw new Error(`fila «${text}» no encontrada`);
  await waitFor(c.tab, `!!document.getElementById('f-status')`, 5000);
  return ok;
}
async function newMission(c: Client, f: Record<string, string>) {
  await tab(c, "Misiones");
  if (!(await btn(c, "^Nueva misión$"))) throw new Error("sin botón Nueva misión");
  await sleep(400);
  for (const k of ["f-id", "f-name", "f-desc", "f-status", "f-type", "f-ccard", "f-ccountry", "f-cmin", "f-cmodes", "f-cpack", "f-target", "f-deps", "f-proj", "f-rc", "f-rx", "f-rp", "f-rn"]) if (f[k] !== undefined) await setField(c, k, f[k]);
  return saveEditor(c);
}
const cancel = async (c: Client) => { await btn(c, "^Cancelar$"); await sleep(300); };

/* ═════════════ FASES ═════════════ */

async function adminCheck() {
  const tQ = await token("Q");
  const g = await api(tQ, "/api/admin/cms/crafting");
  check("ADMIN QA · GET /api/admin/cms/crafting → 200 con la configuración", g.status === 200 && g.json?.available === true && Array.isArray(g.json?.recipes), `${g.status} recetas=${g.json?.recipes?.length}`);
  extra.adminKeys = Object.keys(g.json ?? {});
  check("ADMIN QA · la respuesta es SOLO configuración (sin datos de jugadores)", J(Object.keys(g.json ?? {}).sort()) === J(["available", "conditionTypes", "missions", "projects", "reason", "recipes"]), J(extra.adminKeys));
  const tI = await token("I");
  const n = await api(tI, "/api/admin/cms/crafting");
  check("CUENTA NORMAL (I) · sigue sin acceso (401 sin oráculo)", n.status === 401, `${n.status}`);
  const c = await openBrowser("Q", 1440, { label: "f73c" });
  try {
    await loginUi(c, "Q");
    const ok = await adminOpen(c);
    await sleep(800); await shot(c, "admin-qa-acceso-1440");
    check("ADMIN QA · /admin/crafting abre el panel real (Recetas/Misiones/Proyectos)", ok);
  } finally { await c.browser.close(); }
  save("admin-access");
}

async function config() {
  const reg = serverCatalogSync().registry;
  const card = reg.card(TARGET_CARD);
  check("PROYECTO · la carta objetivo es REAL del catálogo", !!card, `${TARGET_CARD} clase=${card ? packCardClass(card) : "?"} ovr=${card?.ovr}`);
  const c = await openBrowser("Q", 1440, { label: "f73c" });
  try {
    await loginUi(c, "Q");
    check("ADMIN · panel abierto", await adminOpen(c));
    await tab(c, "Proyectos");
    await btn(c, "^Nuevo proyecto$"); await sleep(400);
    for (const [k, v] of [["f-id", P.project], ["f-name", N("QA · F73 Proyecto de carta")], ["f-desc", "Configuración QA de la validación F73 en producción (se retira al terminar)."], ["f-card", TARGET_CARD], ["f-status", "DRAFT"]]) await setField(c, k, v);
    let r = await saveEditor(c);
    check("ADMIN · crear proyecto QA (DRAFT) con carta real", r.saved, r.error ?? "");
    const base = { "f-status": "ACTIVE" };
    r = await newMission(c, { ...base, "f-id": P.partidas, "f-name": N("QA · F73 Juega 5 partidas PvE"), "f-desc": "QA F73 (se retira al terminar).", "f-type": "MATCH_PLAY", "f-cmodes": "PVE", "f-target": "5" });
    check("ADMIN · misión QA MATCH_PLAY ×5 (PvE)", r.saved, r.error ?? "");
    r = await newMission(c, { ...base, "f-id": P.abrir, "f-name": N("QA · F73 Abre un sobre"), "f-desc": "QA F73 (se retira al terminar).", "f-type": "OPEN_PACK", "f-target": "1", "f-rx": "10" });
    check("ADMIN · misión QA OPEN_PACK ×1 con recompensa +10 XP", r.saved, r.error ?? "");
    await sleep(800);
    r = await newMission(c, { ...base, "f-id": P.tr, "f-name": N("QA · F73 Equipo con 3 de Turquía"), "f-desc": "QA F73: juega con al menos 3 jugadores turcos.", "f-type": "DECK_MIN_COUNTRY", "f-ccountry": "TR", "f-cmin": "3", "f-cmodes": "PVE", "f-target": "1", "f-proj": P.project });
    check("ADMIN · misión QA DECK_MIN_COUNTRY TR ≥ 3 en el proyecto", r.saved, r.error ?? "");
    await sleep(800);
    r = await newMission(c, { ...base, "f-id": P.tras, "f-name": N("QA · F73 Juega tras el equipo turco"), "f-desc": "QA F73: depende de la anterior.", "f-type": "MATCH_PLAY", "f-cmodes": "PVE", "f-target": "1", "f-deps": P.tr, "f-proj": P.project });
    check("ADMIN · misión QA dependiente (MATCH_PLAY ×1 tras la de Turquía) en el proyecto", r.saved, r.error ?? "");
    await tab(c, "Proyectos"); await sleep(400);
    await editRow(c, N("QA · F73 Proyecto de carta")); await sleep(400);
    await setField(c, "f-status", "ACTIVE");
    r = await saveEditor(c);
    check("ADMIN · activar el proyecto (tiene misiones activas)", r.saved, r.error ?? "");
    await tab(c, "Misiones"); await sleep(800); await shot(c, "admin-misiones-qa-1440");
    await tab(c, "Proyectos"); await sleep(600); await shot(c, "admin-proyectos-qa-1440");
  } finally { await c.browser.close(); }
  const db = dbRead(`select json_build_object('missions', (select json_agg(json_build_object('id', id, 'status', status, 'condition', condition, 'target', target, 'deps', depends_on, 'project', project_id, 'reward', reward, 'version', version) order by id) from public.content_missions), 'projects', (select json_agg(json_build_object('id', id, 'status', status, 'card', target_card_id, 'version', version)) from public.content_card_projects), 'audit', (select json_agg(action order by at) from public.content_audit_log where action like 'f73_%'))::text`);
  extra.db = db;
  const mine = (db.missions ?? []).filter((m: any) => [P.partidas, P.abrir, P.tr, P.tras].includes(m.id));
  const proj = (db.projects ?? []).filter((p: any) => p.id === P.project);
  check("BD · las 4 misiones QA de esta pasada ACTIVE + su proyecto ACTIVE, auditados", mine.length === 4 && mine.every((m: any) => m.status === "ACTIVE") && proj.length === 1 && proj[0].status === "ACTIVE" && (db.audit ?? []).length >= 6, J({ mine, proj, audit: db.audit }));
  save("admin-config");
}

async function reject() {
  const before = dbRead(`select json_build_object('recipes', (select json_object_agg(id, input_qty::text || ':' || status || ':v' || version) from public.craft_recipes), 'missions', (select count(*) from public.content_missions), 'projects', (select count(*) from public.content_card_projects))::text`);
  const c = await openBrowser("Q", 1440, { label: "f73c" });
  const rej = async (id: string, expect: RegExp, fn: () => Promise<{ saved: boolean; error: string | null }>) => {
    const r = await fn();
    check(`RECHAZO · ${id}`, !r.saved && !!r.error && expect.test(r.error), r.error ?? "¡SE GUARDÓ!");
    if (r.error) await shot(c, `rechazo-${id.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`);
    await cancel(c);
  };
  try {
    await loginUi(c, "Q"); await adminOpen(c);
    const newPack = async (vals: Record<string, string>) => { await tab(c, "Recetas"); await btn(c, "^Nueva de sobres$"); await sleep(400); for (const [k, v] of Object.entries(vals)) await setField(c, k, v); return saveEditor(c); };
    const newCard = async (vals: Record<string, string>) => { await tab(c, "Recetas"); await btn(c, "^Nueva de cartas$"); await sleep(400); for (const [k, v] of Object.entries(vals)) await setField(c, k, v); return saveEditor(c); };
    await rej("receta inválida (Plata → Plata, no sube de clase)", /sube|categor|inferior|clase/i, () => newCard({ "f-id": "qa-f73-rej-clase", "f-name": "QA rechazo clase", "f-cin": "plata", "f-cout": "plata", "f-qty": "3" }));
    await rej("cantidad 0", /2.?100|cantidad|entradas/i, () => newPack({ "f-id": "qa-f73-rej-cero", "f-name": "QA rechazo cero", "f-in": "estandar", "f-out": "premium", "f-qty": "0" }));
    await rej("sobre inexistente", /sobre|existe/i, () => newPack({ "f-id": "qa-f73-rej-pack", "f-name": "QA rechazo sobre", "f-in": "no-existe", "f-out": "premium", "f-qty": "4" }));
    await rej("receta circular (Bronce → Bronce)", /circular|mismo/i, () => newPack({ "f-id": "qa-f73-rej-circ", "f-name": "QA rechazo circular", "f-in": "estandar", "f-out": "estandar", "f-qty": "4" }));
    await rej("receta que baja de categoría (Plata → Bronce)", /baja|categor|sube|inferior/i, () => newPack({ "f-id": "qa-f73-rej-baja", "f-name": "QA rechazo baja", "f-in": "premium", "f-out": "estandar", "f-qty": "4" }));
    await tab(c, "Recetas"); await editRow(c, "Bronce → Plata"); await sleep(400); await setField(c, "f-qty", "3");
    await rej("económica: Bronce → Plata a 3 (suelo 4) ACTIVA", /suelo/i, () => saveEditor(c));
    await tab(c, "Recetas"); await editRow(c, "Prime → Icon"); await sleep(400); await setField(c, "f-status", "ACTIVE");
    await rej("económica: activar Prime → Icon (salida escasa)", /escas|Icon|garant/i, () => saveEditor(c));
    await tab(c, "Proyectos"); await btn(c, "^Nuevo proyecto$"); await sleep(400);
    for (const [k, v] of [["f-id", "qa-f73-rej-carta"], ["f-name", "QA rechazo carta"], ["f-card", "no-existe__base"], ["f-status", "DRAFT"]]) await setField(c, k, v);
    await rej("carta inexistente (proyecto)", /carta/i, () => saveEditor(c));
    await rej("carta inexistente (condición USE_CARD)", /carta/i, () => newMission(c, { "f-id": "qa-f73-rej-mcarta", "f-name": "QA rechazo carta misión", "f-status": "DRAFT", "f-type": "USE_CARD", "f-ccard": "no-existe__base", "f-target": "1" }));
    await rej("recompensa inexistente (sobre no-existe)", /recompensa|sobre/i, () => newMission(c, { "f-id": "qa-f73-rej-premio", "f-name": "QA rechazo premio", "f-status": "DRAFT", "f-type": "MATCH_PLAY", "f-target": "1", "f-rp": "no-existe", "f-rn": "1" }));
    await rej("recompensa fuera de tope (999.999 créditos)", /recompensa|tope|máximo|cr[eé]dit|0 a 5000/i, () => newMission(c, { "f-id": "qa-f73-rej-tope", "f-name": "QA rechazo tope", "f-status": "DRAFT", "f-type": "MATCH_PLAY", "f-target": "1", "f-rc": "999999" }));
    await rej("objetivo 0", /objetivo/i, () => newMission(c, { "f-id": "qa-f73-rej-obj", "f-name": "QA rechazo objetivo", "f-status": "DRAFT", "f-type": "MATCH_PLAY", "f-target": "0" }));
    await tab(c, "Misiones"); await editRow(c, N("QA · F73 Equipo con 3 de Turquía")); await sleep(400); await setField(c, "f-deps", P.tras);
    await rej("dependencia circular (Turquía ↔ tras Turquía)", /circular|ciclo/i, () => saveEditor(c));
  } finally { await c.browser.close(); }
  // Versión obsoleta: el mismo endpoint que usa el panel, con la versión anterior.
  const tQ = await token("Q");
  const cur = (await api(tQ, "/api/admin/cms/crafting")).json.missions.find((m: any) => m.id === P.partidas);
  const stale = await api(tQ, "/api/admin/cms/crafting", { action: "saveMission", id: P.partidas, patch: { name: "QA · F73 obsoleta" }, expectedVersion: cur.version - 1 < 1 ? cur.version + 5 : cur.version - 1 });
  check("RECHAZO · versión obsoleta (STALE_CONTENT) → 409", stale.status === 409, `${stale.status} ${stale.json?.error}`);
  const after = dbRead(`select json_build_object('recipes', (select json_object_agg(id, input_qty::text || ':' || status || ':v' || version) from public.craft_recipes), 'missions', (select count(*) from public.content_missions), 'projects', (select count(*) from public.content_card_projects), 'rej', (select count(*) from (select id from public.craft_recipes where id like 'qa-f73-rej%' union all select id from public.content_missions where id like 'qa-f73-rej%' union all select id from public.content_card_projects where id like 'qa-f73-rej%') x))::text`);
  extra.before = before; extra.after = after;
  check("BD · ningún rechazo escribió nada: recetas (cantidad, estado y versión) idénticas, 0 filas qa-f73-rej", J(before.recipes) === J(after.recipes) && before.missions === after.missions && before.projects === after.projects && after.rej === 0, J(after));
  save("admin-rejections");
}

async function uiMissions(c: Client) {
  await goto(c, "/misiones", 2500);
  await waitFor(c.tab, `document.querySelectorAll('[data-testid="mission-card"]').length >= 1`, 25000); await sleep(700);
  return js<Record<string, { state: string; text: string }>>(c, `Object.fromEntries([...document.querySelectorAll('[data-testid="mission-card"]')].map(e => [e.dataset.mission, { state: e.dataset.state, text: e.innerText.replace(/\\s+/g, ' ').slice(0, 160) }]))`);
}
const prog = (m: any) => (m ? `${m.progress}/${m.target} ${m.state}` : "—");

async function reachBoard(c: Client): Promise<boolean> {
  await goto(c, "/jugar", 2500);
  await js(c, `document.querySelector('[data-testid="play-area-cta-DUELS"]')?.click()`);
  await waitFor(c.tab, `location.pathname === '/duelos' && !!document.querySelector('[data-testid="duel-mode-cta-QUICK"]')`, 15000);
  await js(c, `document.querySelector('[data-testid="duel-mode-cta-QUICK"]')?.click()`);
  await sleep(3500);
  if (await js<boolean>(c, `/Comenzar duelo/i.test(document.body.innerText)`)) { await js(c, `[...document.querySelectorAll('button')].find(b => /^Comenzar duelo$/i.test((b.innerText||'').trim()))?.click()`); await sleep(2500); }
  return waitFor(c.tab, `(() => { document.querySelector('[data-f61="moment"]')?.click(); return !!document.querySelector('[data-testid="turn-timer"]') && !document.querySelector('[data-scene="intro"]'); })()`, 30000);
}

/** Cambia UNA carta turca del equipo por una libre no turca del mismo rol (camino real: save_composition). */
async function swapOutTurk(t: string) {
  const reg = serverCatalogSync().registry;
  const dk = (await api(t, "/api/game/duels")).json; const st = (await api(t, "/api/game/state")).json;
  const deck = dk.decks.find((d: any) => d.id === dk.activeDeckId);
  const owned = st.ownedCards as any[];
  const info = (u: string) => { const o = owned.find((x) => x.uid === u); const d = o && reg.card(o.cardId); const pl = d && reg.player(d.playerId); return { uid: u, cardId: o?.cardId, role: d?.role, country: pl?.country }; };
  const inDeck = deck.cardUids.map(info);
  const free = owned.filter((o) => !dk.decks.some((d: any) => d.cardUids.includes(o.uid))).map((o) => info(o.uid));
  for (const tr of inDeck.filter((x: any) => x.country === "TR")) {
    const rep = free.find((f) => f.role === tr.role && f.country !== "TR" && !inDeck.some((x: any) => x.cardId === f.cardId));
    if (!rep) continue;
    const uids = deck.cardUids.map((u: string) => (u === tr.uid ? rep.uid : u));
    const r = await api(t, "/api/game/duels", { action: "save_composition", id: deck.id, name: deck.name, cardUids: uids, baseVersion: deck.version });
    return { status: r.status, error: r.json?.error, out: tr, in: rep, original: deck.cardUids, deckId: deck.id, name: deck.name, trAfter: uids.map(info).filter((x: any) => x.country === "TR").length };
  }
  return { status: 0, error: "sin sustituto del mismo rol", original: deck.cardUids, deckId: deck.id, name: deck.name };
}
async function restoreDeck(t: string, deckId: string, name: string, uids: string[]) {
  const dk = (await api(t, "/api/game/duels")).json; const deck = dk.decks.find((d: any) => d.id === deckId);
  if (J(deck.cardUids) === J(uids)) return { status: 200, same: true };
  const r = await api(t, "/api/game/duels", { action: "save_composition", id: deckId, name, cardUids: uids, baseVersion: deck.version });
  return { status: r.status, error: r.json?.error };
}

async function playerI() {
  const I = uid("I");
  const t0 = await token("I");
  await clearActive(t0);
  const snap0 = await missions(t0);
  extra.start = Object.fromEntries(snap0.missions.map((m: any) => [m.id, prog(m)]));
  check("ESTADO INICIAL · partidas 0/5 ACTIVE, Turquía 0/1 ACTIVE, dependiente LOCKED, abrir 0/1 ACTIVE", mState(snap0, P.partidas)?.state === "ACTIVE" && mState(snap0, P.partidas)?.progress === 0 && mState(snap0, P.tr)?.state === "ACTIVE" && mState(snap0, P.tras)?.state === "LOCKED" && mState(snap0, P.abrir)?.state === "ACTIVE", J(extra.start));
  const c = await openBrowser("I", 1440, { label: "f73c" });
  try {
    await loginUi(c, "I");
    const ui0 = await uiMissions(c); await shot(c, "misiones-inicial-1440");
    await goto(c, `/misiones/crafting/cartas/${P.project}`, 2500);
    await waitFor(c.tab, `document.querySelectorAll('[data-testid="project-mission"]').length >= 2`, 20000); await sleep(700);
    const pm0 = await js<string[]>(c, `[...document.querySelectorAll('[data-testid="project-mission"]')].map(e => e.dataset.state)`);
    await shot(c, "proyecto-inicial-locked-1440");
    check("UI · estados reales iniciales: /misiones ACTIVE y en el proyecto una misión LOCKED (dependencia)", ui0[P.partidas]?.state === "ACTIVE" && pm0.includes("LOCKED") && pm0.includes("ACTIVE"), J({ misiones: ui0, proyecto: pm0 }));
    // ── Apertura REAL de un sobre (la ruta que usa la UI, con su ref de gesto) → misión OPEN_PACK → reclamo por la UI.
    const op = await api(t0, "/api/game/packs", { action: "open", packId: process.env.F73C_I_PACK ?? "inicial", ref: `f73c-open-${Date.now()}` });
    const snapO = await missions(t0);
    const xp0 = (await api(t0, "/api/game/state")).json.xp; // tras abrir: abrir un sobre da su propia XP
    check("APERTURA real (Sobre Inicial) → misión OPEN_PACK 0/1 → 1/1 COMPLETED", op.status === 200 && mState(snapO, P.abrir)?.state === "COMPLETED", `${op.status} ${prog(mState(snapO, P.abrir))}`);
    await goto(c, "/misiones", 2500);
    await waitFor(c.tab, `!!document.querySelector('[data-mission="${P.abrir}"] [data-testid="mission-claim"]')`, 20000); await sleep(600);
    await shot(c, "mision-completada-1440");
    await js(c, `(() => { const b = document.querySelector('[data-mission="${P.abrir}"] [data-testid="mission-claim"]'); b.click(); b.click(); })()`); // doble clic
    const claimedUi = await waitFor(c.tab, `document.querySelector('[data-mission="${P.abrir}"]')?.dataset.state === 'CLAIMED'`, 15000);
    await sleep(800); await shot(c, "mision-reclamada-1440");
    const xp1 = (await api(t0, "/api/game/state")).json.xp;
    check("RECLAMO de misión por la UI (doble clic) → CLAIMED y +10 XP exactos", claimedUi && xp1 - xp0 === 10, `xp ${xp0} → ${xp1}`);
    await c.tab.send("Page.reload", {}); await sleep(2500);
    const uiR = await uiMissions(c);
    const again = await api(t0, "/api/game/missions", { action: "claimMission", missionId: P.abrir });
    const xp2 = (await api(t0, "/api/game/state")).json.xp;
    check("F5 conserva CLAIMED y un segundo reclamo no paga nada", uiR[P.abrir]?.state === "CLAIMED" && again.json?.repeated === true && xp2 === xp1, `${uiR[P.abrir]?.state} repeated=${again.json?.repeated} xp=${xp2}`);
    // ── PARTIDA REAL por la UI (caso A: todas las decisiones humanas) con cambio del equipo guardado a mitad.
    const board = await reachBoard(c);
    const v0 = await active(t0);
    S.matchA = v0?.matchId; persist();
    check("PARTIDA A · tablero real por la UI", board && !!v0?.matchId, `${v0?.matchId}`);
    const sw = await swapOutTurk(t0);
    S.deckI = { deckId: sw.deckId, name: sw.name, original: sw.original }; persist();
    extra.swap = sw;
    check("SNAPSHOT · el equipo GUARDADO se cambia tras empezar (TR 3 → 2) por el camino real", sw.status === 200 && sw.trAfter === 2, J({ status: sw.status, error: sw.error, out: sw.out, in: sw.in, trAfter: sw.trAfter }));
    let turns = 0;
    for (let i = 0; i < 30; i++) {
      const v = await matchState(t0, v0.matchId);
      if (!v || v.status !== "IN_PROGRESS") break;
      const r = await playOneUi(c);
      if (r === "played") turns++;
      await sleep(1200);
    }
    await sleep(2500);
    const vA = await matchState(t0, v0.matchId);
    await shot(c, "partida-a-resultado-1440");
    check("PARTIDA A · terminada por reglas desde la UI", vA?.status !== "IN_PROGRESS", `${vA?.status} jugadas UI=${turns} timeouts=${(vA?.timeouts ?? []).length}`);
    const evA = eventsFor(I, `match:${v0.matchId}`);
    extra.eventA = evA;
    check("PARTIDA A · evento persistido una vez, ≥5 decisiones humanas → CUENTA", evA.length === 1 && evA[0].evidence.human >= 5 && evA[0].evidence.counts === true, J(evA[0]?.evidence));
    const snapA = await missions(t0);
    check("MISIÓN · partidas 0/5 → 1/5 (partida → evento → app_mission_apply → Postgres → API)", mState(snapA, P.partidas)?.progress === 1, prog(mState(snapA, P.partidas)));
    check("CONDICIÓN TR ≥ 3 · completada con el equipo CONGELADO al empezar (el guardado ya tiene 2)", ["COMPLETED", "CLAIMED"].includes(mState(snapA, P.tr)?.state) && mState(snapA, P.tr)?.progress === 1, prog(mState(snapA, P.tr)));
    check("DEPENDENCIA · la misión dependiente pasa de LOCKED a ACTIVE 0/1", mState(snapA, P.tras)?.state === "ACTIVE" && mState(snapA, P.tras)?.progress === 0, prog(mState(snapA, P.tras)));
    const rest = await restoreDeck(t0, sw.deckId, sw.name, sw.original);
    check("EQUIPO · restaurado a su composición original", rest.status === 200, J(rest));
    const ui1 = await uiMissions(c); await shot(c, "misiones-tras-partida-1440");
    check("UI /misiones · 1/5 visible", /1\s*\/\s*5/.test(ui1[P.partidas]?.text ?? ""), ui1[P.partidas]?.text);
    await c.tab.send("Page.reload", {}); await sleep(2500);
    const ui2 = await uiMissions(c);
    check("F5 · sigue 1/5", /1\s*\/\s*5/.test(ui2[P.partidas]?.text ?? ""), ui2[P.partidas]?.text);
    await logoutUi(c); await loginUi(c, "I");
    const ui3 = await uiMissions(c);
    check("RELOGIN · sigue 1/5", /1\s*\/\s*5/.test(ui3[P.partidas]?.text ?? ""), ui3[P.partidas]?.text);
  } finally { await c.browser.close(); }

  // ── REPROCESO de la MISMA partida: reenviar la última jugada, releer el estado ×10, pedir la repetición.
  const t = await token("I");
  const vA = await matchState(t, S.matchA);
  const last = vA?.history?.[vA.history.length - 1];
  const replays = await Promise.all([
    ...Array.from({ length: 5 }, () => api(t, "/api/game/duel", { action: "play", matchId: S.matchA, cardUid: last?.you?.uid ?? randomUUID(), stat: last?.you?.stat, expectedVersion: (vA?.stateVersion ?? 1) - 1 })),
    ...Array.from({ length: 5 }, () => api(t, "/api/game/duel", { action: "state", matchId: S.matchA })),
  ]);
  const evA2 = eventsFor(I, `match:${S.matchA}`);
  const snapR = await missions(t);
  extra.reprocess = replays.map((r) => r.status);
  check("REPROCESO · reenviar la última jugada ×5 no es aceptado (partida terminada)", replays.slice(0, 5).every((r) => r.status >= 400 && r.status < 500), replays.slice(0, 5).map((r) => `${r.status}`).join(","));
  check("REPROCESO · mission_events tiene EXACTAMENTE una fila para la partida y el progreso sigue en 1/5", evA2.length === 1 && mState(snapR, P.partidas)?.progress === 1, `${evA2.length} ${prog(mState(snapR, P.partidas))}`);
  save("mission-real-match");

  const deckId = (await api(t, "/api/game/duels")).json.activeDeckId;
  if (process.env.F73C_SKIP_AFK === "1") { results.length = 0; for (const k of Object.keys(extra)) delete extra[k]; }
  else {
  // ── CASO B: autoplay completo (nadie juega; el reloj F72.8 decide las 10).
  results.length = 0; for (const k of Object.keys(extra)) delete extra[k];
  const before = progressFor(I);
  const vB = await startPve(t, deckId); S.matchB = vB.matchId; persist();
  const rB = await playMatch(t, vB, 0);
  const evB = eventsFor(I, `match:${vB.matchId}`);
  const afterB = progressFor(I);
  extra.caseB = { played: rB.played, status: rB.final?.status, ms: rB.ms, evidence: evB[0]?.evidence };
  check("CASO B · partida terminada SOLO por el reloj (0 humanas, todas automáticas)", rB.final?.status !== "IN_PROGRESS" && evB[0]?.evidence?.human === 0 && evB[0]?.evidence?.auto >= 5, J(evB[0]?.evidence));
  check("CASO B · NO CUENTA: counts=false, sin misiones y progreso idéntico", evB[0]?.evidence?.counts === false && (evB[0]?.evidence?.missions ?? []).length === 0 && J(before) === J(afterB), `${J(before[P.partidas])} → ${J(afterB[P.partidas])}`);
  // ── CASO B2: 4 humanas + el resto el reloj (por debajo del umbral de 5).
  const vB2 = await startPve(t, deckId); S.matchB2 = vB2.matchId; persist();
  const rB2 = await playMatch(t, vB2, 4);
  const evB2 = eventsFor(I, `match:${vB2.matchId}`);
  const afterB2 = progressFor(I);
  extra.caseB2 = { played: rB2.played, status: rB2.final?.status, evidence: evB2[0]?.evidence };
  check("CASO B2 · 4 humanas + automáticas → NO CUENTA (el reloj no se hace pasar por humano)", evB2[0]?.evidence?.human === 4 && evB2[0]?.evidence?.counts === false && J(afterB2) === J(afterB), J(evB2[0]?.evidence));
  // ── CASO C: abandono tras 3 decisiones.
  const vC = await startPve(t, deckId); S.matchC = vC.matchId; persist();
  let v: any = vC; for (let i = 0; i < 3; i++) { const r = await (await import("./_f73c-lib")).playOne(t, v); v = r.json?.view ?? v; }
  const ab = await api(t, "/api/game/duel", { action: "abandon", matchId: vC.matchId });
  await sleep(1500);
  const evC = eventsFor(I, `match:${vC.matchId}`);
  const afterC = progressFor(I);
  check("CASO C · abandono aceptado", ab.status === 200, `${ab.status}`);
  check("CASO C · NO CUENTA: sin evento de misión y progreso idéntico", evC.length === 0 && J(afterC) === J(afterB2), `eventos=${evC.length}`);
  save("anti-afk");
  }

  // ── Partida 2 (humana) → misión dependiente → proyecto COMPLETED.
  results.length = 0; for (const k of Object.keys(extra)) delete extra[k];
  const v2 = await startPve(t, deckId); S.matchI2 = v2.matchId; persist();
  const r2 = await playMatch(t, v2);
  const snap2 = await missions(t);
  extra.i2 = { played: r2.played, status: r2.final?.status, evidence: eventsFor(I, `match:${v2.matchId}`)[0]?.evidence };
  check("PARTIDA 2 (humana) → dependiente 1/1 completada y partidas 2/5", ["COMPLETED", "CLAIMED"].includes(mState(snap2, P.tras)?.state) && mState(snap2, P.tras)?.progress === 1 && mState(snap2, P.partidas)?.progress === 2, `${prog(mState(snap2, P.tras))} · ${prog(mState(snap2, P.partidas))}`);
  check("PROYECTO · COMPLETED (2/2 misiones)", pState(snap2, P.project)?.state === "COMPLETED", J(pState(snap2, P.project)));
  save("project-completion-i");
}

async function playerK() {
  const K = uid("K");
  const t = await token("K");
  await clearActive(t);
  const dk = (await api(t, "/api/game/duels")).json;
  const deck = dk.decks.find((d: any) => d.id === dk.activeDeckId);
  S.deckK = { deckId: deck.id, name: deck.name, original: deck.cardUids }; persist();
  // Control negativo: equipo con 1 turco → la condición NO progresa.
  const v1 = await startPve(t, deck.id); const r1 = await playMatch(t, v1);
  const s1 = await missions(t);
  check("CONTROL NEGATIVO · K con TR = 1 juega → Turquía sigue 0/1 (la condición mira el equipo)", r1.final?.status !== "IN_PROGRESS" && mState(s1, P.tr)?.progress === 0 && mState(s1, P.partidas)?.progress === 1, `${prog(mState(s1, P.tr))} · ${prog(mState(s1, P.partidas))}`);
  const cx = await api(t, "/api/game/missions", { action: "claimProject", projectId: P.project });
  check("CRUCE · K no puede reclamar el proyecto que I tiene completado (409 NOT_COMPLETED)", cx.status === 409, `${cx.status} ${cx.json?.code}`);
  // Equipo de K con ≥ 3 turcos (mismo rol) por el camino real.
  const reg = serverCatalogSync().registry; const owned = (await api(t, "/api/game/state")).json.ownedCards as any[];
  const info = (u: string) => { const o = owned.find((x) => x.uid === u); const d = o && reg.card(o.cardId); const pl = d && reg.player(d.playerId); return { uid: u, cardId: o?.cardId, role: d?.role, country: pl?.country }; };
  const cur = deck.cardUids.map(info); const free = owned.filter((o) => !dk.decks.some((d: any) => d.cardUids.includes(o.uid))).map((o) => info(o.uid));
  const uids = [...deck.cardUids]; let tr = cur.filter((x: any) => x.country === "TR").length;
  for (const f of free.filter((x) => x.country === "TR")) {
    if (tr >= 3) break;
    const i = uids.findIndex((u) => { const x = info(u); return x.role === f.role && x.country !== "TR"; });
    if (i < 0 || uids.some((u) => info(u).cardId === f.cardId)) continue;
    uids[i] = f.uid; tr++;
  }
  const sv = await api(t, "/api/game/duels", { action: "save_composition", id: deck.id, name: deck.name, cardUids: uids, baseVersion: deck.version });
  check("K · equipo con ≥ 3 turcos guardado por el camino real", sv.status === 200 && tr >= 3, `${sv.status} ${sv.json?.error ?? ""} TR=${tr}`);
  for (let i = 0; i < 3; i++) {
    const s = await missions(t);
    if (pState(s, P.project)?.state === "COMPLETED") break;
    const v = await startPve(t, deck.id); await playMatch(t, v);
  }
  const s2 = await missions(t);
  check("K · proyecto COMPLETED por partidas reales (Turquía y dependiente)", pState(s2, P.project)?.state === "COMPLETED", `${prog(mState(s2, P.tr))} · ${prog(mState(s2, P.tras))}`);
  const rest = await restoreDeck(t, deck.id, deck.name, deck.cardUids);
  check("K · equipo restaurado", rest.status === 200, J(rest));
  // 10 reclamos simultáneos (los PRIMEROS de K).
  const n0 = await copiesOf(t, TARGET_CARD);
  const rs = await Promise.all(Array.from({ length: 10 }, () => api(t, "/api/game/missions", { action: "claimProject", projectId: P.project })));
  const n1 = await copiesOf(t, TARGET_CARD);
  const claims = dbRead<any>(`select json_build_object('claims', (select count(*) from public.user_project_claims where user_id = '${K}' and project_id = '${P.project}'), 'grants', (select count(*) from public.credit_transactions where user_id = '${K}' and ref = 'm73:project:${P.project}'))::text`);
  extra.concurrent = { statuses: rs.map((r) => `${r.status}:${r.json?.repeated ? "R" : r.json?.code ?? "ok"}`), copies: [n0, n1], claims };
  check("10 RECLAMOS SIMULTÁNEOS · exactamente +1 copia", n1 === n0 + 1, `${n0} → ${n1}`);
  check("10 RECLAMOS · 1 aplicado y 9 repetidos, ningún 500", rs.filter((r) => r.status === 200 && !r.json?.repeated).length === 1 && rs.every((r) => r.status === 200), (extra.concurrent as any).statuses.join(","));
  check("10 RECLAMOS · BD: 1 reclamo y 1 concesión en el libro mayor", claims.claims === 1 && claims.grants === 1, J(claims));
  // Misión con recompensa: apertura real de K y 10 reclamos SIMULTÁNEOS (los primeros de K) → una sola recompensa.
  const opK = await api(t, "/api/game/packs", { action: "open", packId: "estandar", ref: `f73c-openk-${Date.now()}` });
  const sK = await missions(t);
  const xpK0 = (await api(t, "/api/game/state")).json.xp; // tras abrir
  check("K · apertura real → misión OPEN_PACK COMPLETED", opK.status === 200 && mState(sK, P.abrir)?.state === "COMPLETED", `${opK.status} ${prog(mState(sK, P.abrir))}`);
  const mc = await Promise.all(Array.from({ length: 10 }, () => api(t, "/api/game/missions", { action: "claimMission", missionId: P.abrir })));
  const xpK1 = (await api(t, "/api/game/state")).json.xp;
  const mg = dbRead<any>(`select json_build_object('ledger', (select count(*) from public.credit_transactions where user_id = '${K}' and ref = 'm73:mission:${P.abrir}'))::text`);
  extra.missionClaims = { statuses: mc.map((r) => `${r.status}:${r.json?.repeated ? "R" : r.json?.code ?? "ok"}`), xp: [xpK0, xpK1], db: mg };
  check("10 RECLAMOS SIMULTÁNEOS DE MISIÓN · +10 XP exactos una sola vez, ningún 500", xpK1 - xpK0 === 10 && mc.every((r) => r.status === 200) && mc.filter((r) => !r.json?.repeated).length === 1, `${(extra.missionClaims as any).statuses.join(",")} xp ${xpK0}→${xpK1}`);
  check("10 RECLAMOS DE MISIÓN · BD: una sola entrada en el libro mayor (credit_transactions por ref)", mg.ledger === 1, J(mg));
  save("project-race");
}

async function projectUi() {
  const t = await token("I");
  const n0 = await copiesOf(t, TARGET_CARD);
  S.copiesBefore = n0; persist();
  for (const width of [1440, 1024, 390]) {
    const c = await openBrowser("I", width, { label: "f73c", reduced: width === 390 });
    try {
      await loginUi(c, "I");
      await uiMissions(c); await shot(c, `misiones-estados-${width}`);
      await goto(c, "/misiones/crafting/cartas?tab=proyectos", 2500);
      await waitFor(c.tab, `!!document.querySelector('[data-testid="project-card"][data-project="${P.project}"]')`, 25000); await sleep(700);
      await shot(c, `proyectos-lista-${width}`);
      await goto(c, `/misiones/crafting/cartas/${P.project}`, 2500);
      const ready = await waitFor(c.tab, `!!document.querySelector('[data-testid="project-progress"]') && !!document.querySelector('[data-testid="project-claim"]')`, 25000);
      await sleep(1200);
      const info = await js<any>(c, `({ progress: document.querySelector('[data-testid="project-progress"]')?.textContent, states: [...document.querySelectorAll('[data-testid="project-mission"]')].map(e => e.dataset.state), loading: /Cargando/i.test(document.querySelector('main')?.innerText || ''), noScroll: document.scrollingElement.scrollWidth <= innerWidth + 1, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, art: !!document.querySelector('[data-testid="project-page"] img') })`);
      await shot(c, `proyecto-completo-${width}`);
      check(`[${width}] PROYECTO COMPLETO REAL · 2 / 2, botón Reclamar, sin pantalla de carga, sin scroll horizontal${width === 390 ? ", movimiento reducido" : ""}`, ready && /2\s*\/\s*2/.test(info.progress ?? "") && !info.loading && info.noScroll && info.art && (width !== 390 || info.reduced), J(info));
      if (width === 390) {
        await js(c, `(() => { const b = document.querySelector('[data-testid="project-claim"]'); b.click(); b.click(); })()`); // doble clic
        const got = await waitFor(c.tab, `/ya en tu colección/i.test(document.body.innerText)`, 15000);
        await sleep(1200); await shot(c, "proyecto-reclamado-390");
        const n1 = await copiesOf(t, TARGET_CARD);
        check("[390] RECLAMO por la UI (doble clic) · carta real revelada y N → N + 1", got && n1 === n0 + 1, `${n0} → ${n1}`);
        await c.tab.send("Page.reload", {}); await sleep(3000);
        await waitFor(c.tab, `!!document.querySelector('[data-testid="project-progress"]')`, 20000); await sleep(800);
        const f5 = await js<any>(c, `({ claim: !!document.querySelector('[data-testid="project-claim"]'), text: document.querySelector('main')?.innerText.replace(/\\s+/g,' ').slice(0, 300) })`);
        await shot(c, "proyecto-reclamado-f5-390");
        const n2 = await copiesOf(t, TARGET_CARD);
        check("[390] F5 · sin botón de reclamar, sigue N + 1", !f5.claim && n2 === n0 + 1, `${n2} ${f5.text}`);
        const again = await api(t, "/api/game/missions", { action: "claimProject", projectId: P.project });
        const n3 = await copiesOf(t, TARGET_CARD);
        check("SEGUNDO RECLAMO · repeated y sigue N + 1", again.status === 200 && again.json?.repeated === true && n3 === n0 + 1, `${again.status} repeated=${again.json?.repeated} ${n3}`);
        const snap = await missions(t);
        check("ESTADO · proyecto CLAIMED en el servidor", pState(snap, P.project)?.state === "CLAIMED", J(pState(snap, P.project)));
        await uiMissions(c); await shot(c, "misiones-final-390");
      }
      const errs = c.tab.takeErrors();
      check(`[${width}] sin errores de consola`, errs.length === 0, errs.slice(0, 3).join(" | "));
    } finally { await c.browser.close(); }
  }
  const I = uid("I");
  extra.db = dbRead(`select json_build_object('claims', (select count(*) from public.user_project_claims where user_id = '${I}' and project_id = '${P.project}'), 'grants', (select count(*) from public.credit_transactions where user_id = '${I}' and ref = 'm73:project:${P.project}'))::text`);
  check("BD · I: 1 reclamo y 1 concesión", (extra.db as any).claims === 1 && (extra.db as any).grants === 1, J(extra.db));
  save("project-claim-ui");
}

async function cross() {
  const tI = await token("I");
  for (const [n, body] of [["crear misión", { action: "saveMission", id: "qa-f73-hack", patch: { name: "hack", condition: { type: "MATCH_PLAY" }, target: 1, reward: { credits: 5000 }, status: "ACTIVE" }, expectedVersion: 0 }], ["crear proyecto", { action: "saveProject", id: "qa-f73-hack", patch: { name: "hack", targetCardId: TARGET_CARD, status: "DRAFT" }, expectedVersion: 0 }], ["modificar receta", { action: "saveRecipe", id: "pack-estandar-premium", patch: { inputQty: 2 }, expectedVersion: 1 }]] as const) {
    const r = await api(tI, "/api/admin/cms/crafting", body);
    check(`CUENTA NORMAL · no puede ${n} (401)`, r.status === 401, `${r.status}`);
  }
  const g = await api(tI, "/api/admin/cms/crafting");
  check("CUENTA NORMAL · no lee el panel (401)", g.status === 401, `${g.status}`);
  const c = await openBrowser("I", 1440, { label: "f73c" });
  try { await loginUi(c, "I"); await goto(c, "/admin/crafting", 3500); await sleep(1500); const denied = await js<boolean>(c, `/Acceso restringido|solo para administradores/i.test(document.body.innerText) && !document.querySelector('[role="tablist"]')`); await shot(c, "admin-cuenta-normal-1440"); check("CUENTA NORMAL · /admin/crafting en el navegador = acceso restringido", denied); } finally { await c.browser.close(); }
  const tB = await token("B");
  const cb = await api(tB, "/api/game/missions", { action: "claimProject", projectId: P.project });
  check("CRUCE · B (sin completar) no reclama el proyecto que I y K completaron (409)", cb.status === 409, `${cb.status} ${cb.json?.code}`);
  // El admin temporal tampoco ve progreso ni reclamos de otros por PostgREST.
  const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
  const tQ = await token("Q");
  const rest = async (path: string) => { const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, authorization: `Bearer ${tQ}` } }); return { status: r.status, j: await r.json().catch(() => null) }; };
  const Q = uid("Q");
  const p1 = await rest("user_mission_progress?select=user_id");
  check("ADMIN TEMPORAL · por PostgREST solo ve SU progreso (no el de I/K)", p1.status === 200 && Array.isArray(p1.j) && p1.j.every((r: any) => r.user_id === Q), `${p1.status} n=${p1.j?.length}`);
  const p2 = await rest("user_project_claims?select=user_id");
  check("ADMIN TEMPORAL · por PostgREST no ve reclamos ajenos", p2.status === 200 && Array.isArray(p2.j) && p2.j.every((r: any) => r.user_id === Q), `${p2.status} n=${p2.j?.length}`);
  const p3 = await rest("mission_events?select=user_id&limit=1");
  check("ADMIN TEMPORAL · mission_events no es legible", p3.status >= 400, `${p3.status}`);
  const gm = await api(tQ, "/api/game/missions");
  check("ADMIN TEMPORAL · /api/game/missions es el SUYO (0/5, sin progreso de I)", mState(gm.json, P.partidas)?.progress === 0, prog(mState(gm.json, P.partidas)));
  save("cross-user");
}

async function cleanup() {
  const tQ = await token("Q");
  const cfg = (await api(tQ, "/api/admin/cms/crafting")).json;
  const out: any[] = [];
  for (const id of [P.tras, P.tr, P.partidas, P.abrir]) {
    const m = cfg.missions.find((x: any) => x.id === id); if (!m || m.status === "RETIRED") { out.push({ id, skip: m?.status }); continue; }
    const r = await api(tQ, "/api/admin/cms/crafting", { action: "saveMission", id, patch: { status: "RETIRED" }, expectedVersion: m.version, reason: "F73 cierre: limpieza de configuración QA" });
    out.push({ id, status: r.status, error: r.json?.error });
  }
  const pr = cfg.projects.find((x: any) => x.id === P.project);
  if (pr && pr.status !== "RETIRED") { const r = await api(tQ, "/api/admin/cms/crafting", { action: "saveProject", id: P.project, patch: { status: "RETIRED" }, expectedVersion: pr.version, reason: "F73 cierre: limpieza de configuración QA" }); out.push({ id: P.project, status: r.status, error: r.json?.error }); }
  extra.ops = out;
  const db = dbRead(`select json_build_object('missions', (select json_agg(json_build_object('id', id, 'status', status)) from public.content_missions), 'projects', (select json_agg(json_build_object('id', id, 'status', status)) from public.content_card_projects), 'recipes', (select json_object_agg(id, input_qty::text || ':' || status) from public.craft_recipes))::text`);
  extra.db = db;
  check("LIMPIEZA · toda la configuración QA en RETIRED por el panel (auditado)", out.every((o) => o.skip === "RETIRED" || o.status === 200) && db.missions.every((m: any) => m.status === "RETIRED") && db.projects.every((p: any) => p.status === "RETIRED"), J(out));
  const tI = await token("I");
  const snap = await missions(tI);
  check("LIMPIEZA · el jugador ya no ve misiones ni proyectos QA", !snap.missions.some((m: any) => m.id.startsWith("qa-f73")) && !snap.projects.some((p: any) => p.id.startsWith("qa-f73")), `${snap.missions.length} misiones · ${snap.projects.length} proyectos`);
  const dI = (await api(tI, "/api/game/duels")).json; const dK = (await api(await token("K"), "/api/game/duels")).json;
  check("LIMPIEZA · equipos de I y K en su composición original", (!S.deckI || J(dI.decks.find((d: any) => d.id === S.deckI.deckId)?.cardUids) === J(S.deckI.original)) && (!S.deckK || J(dK.decks.find((d: any) => d.id === S.deckK.deckId)?.cardUids) === J(S.deckK.original)));
  save("qa-cleanup");
}

async function postRevoke() {
  const tQ = await token("Q");
  const g = await api(tQ, "/api/admin/cms/crafting");
  check("REVOCADO · la cuenta QA ya NO accede al panel (401 sin oráculo)", g.status === 401, `${g.status}`);
  const p = await api(tQ, "/api/admin/cms/crafting", { action: "saveRecipe", id: "pack-estandar-premium", patch: { inputQty: 2 }, expectedVersion: 1 });
  check("REVOCADO · la cuenta QA ya NO escribe (401)", p.status === 401, `${p.status}`);
  const c = await openBrowser("Q", 1440, { label: "f73c" });
  try { await loginUi(c, "Q"); await goto(c, "/admin/crafting", 3500); await sleep(1500); const denied = await js<boolean>(c, `/Acceso restringido|solo para administradores/i.test(document.body.innerText) && !document.querySelector('[role="tablist"]')`); await shot(c, "admin-qa-revocado-1440"); check("REVOCADO · /admin/crafting en el navegador de la cuenta QA = acceso restringido", denied); } finally { await c.browser.close(); }
  save("post-revoke");
}

const RUN: Record<string, () => Promise<void>> = { "admin-check": adminCheck, config, reject, "player-i": playerI, "player-k": playerK, "project-ui": projectUi, cross, cleanup, "post-revoke": postRevoke };
if (!RUN[PHASE]) { console.error(`uso: ${Object.keys(RUN).join("|")}`); process.exit(2); }
RUN[PHASE]().then(() => process.exit(results.some((r) => !r.ok) ? 1 : 0), (e) => { console.error("ERROR", e); try { save(`${PHASE}-error`); } catch { /* */ } process.exit(3); });
