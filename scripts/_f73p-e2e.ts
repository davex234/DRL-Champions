/**
 * F73 · PRODUCCIÓN — E2E REAL (fuera de CI). UI real (Chrome) → API real (:3005) → servicio real → Postgres del VPS.
 * SIN intercepción, SIN mocks, SIN MemSupabase: la red solo se OBSERVA (Network.requestWillBeSent) para leer el gesto.
 * Solo cuentas QA (el guardián de `_fase68-lib` aborta con la cuenta del usuario).
 *
 *   npx tsx scripts/_f73p-e2e.ts <packs|exchange|salvage-race|cross|nonadmin|ratios|ui>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { openBrowser, loginUi, logoutUi, goto, sleep, waitFor, token, api, creds, type Client } from "./_fase68-lib";

const OUT = join(process.cwd(), process.env.F73P_OUT ?? "docs/product/qa/fase73-production");
const SHOTS = join(OUT, "shots");
mkdirSync(SHOTS, { recursive: true });
const WHAT = process.argv[2] ?? "";
const results: { id: string; ok: boolean; detail: string }[] = [];
const extra: Record<string, unknown> = {};
const check = (id: string, ok: boolean, detail = "") => { results.push({ id, ok, detail: detail.slice(0, 900) }); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${detail.slice(0, 300)}`); };
const js = <T>(c: Client, e: string) => c.tab.js<T>(e);
const click = (c: Client, sel: string) => js<boolean>(c, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || e.disabled) return false; e.scrollIntoView({block:'center'}); e.click(); return true; })()`);
const shot = (c: Client, name: string) => c.tab.shot(join(SHOTS, `${name}.png`)).catch(() => null);
const crafting = async (t: string) => (await api(t, "/api/game/crafting")).json;
const state = async (t: string) => (await api(t, "/api/game/state")).json;
function watchPosts(c: Client, path: string) {
  const seen: any[] = [];
  c.tab.on("Network.requestWillBeSent", (p: any) => {
    if (p.request?.method === "POST" && String(p.request.url).includes(path)) { try { seen.push(JSON.parse(p.request.postData ?? "{}")); } catch { seen.push({ raw: p.request.postData }); } }
  });
  return seen;
}
function save(name: string) {
  const pass = results.filter((r) => r.ok).length;
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify({ at: new Date().toISOString(), baseUrl: "http://127.0.0.1:3005 (build de producción)", intercepted: false, pass, fail: results.length - pass, results, ...extra }, null, 2));
  console.log(`→ ${name}.json  ${pass}/${results.length}`);
}

/* ─────────── Sobres: I por la UI (doble clic, F5, relogin, reintento ×10 de la misma ref); K 10 simultáneos ─────────── */
async function packs() {
  const tI = await token("I");
  const before = (await crafting(tI)).packs;
  extra.before = { I: before };
  const c = await openBrowser("I", 1440, { label: "f73p" });
  await c.tab.send("Network.enable", {});
  const posts = watchPosts(c, "/api/game/crafting");
  try {
    await loginUi(c, "I");
    await goto(c, "/misiones/crafting/sobres", 2500);
    await waitFor(c.tab, `document.querySelectorAll('[data-testid="pack-recipe"]').length >= 5`, 25000); await sleep(800);
    await shot(c, "sobres-antes-1440");
    await click(c, '[data-recipe="pack-estandar-premium"] [data-testid="pack-recipe-craft"]');
    const dlg = await waitFor(c.tab, `!!document.querySelector('[data-testid="pack-craft-confirm"]')`, 6000);
    check("UI · diálogo de confirmación con 4 × Bronce → 1 × Plata", dlg && await js<boolean>(c, `/4/.test(document.querySelector('[data-testid="pack-craft-dialog"]')?.innerText || '')`));
    await js(c, `(() => { const b = document.querySelector('[data-testid="pack-craft-confirm"]'); b.click(); b.click(); })()`); // doble clic real
    const done = await waitFor(c.tab, `!!document.querySelector('[data-testid="craft-result"]')`, 15000);
    await sleep(600); await shot(c, "sobres-resultado-1440");
    const after = (await crafting(tI)).packs;
    const crafts = posts.filter((p) => p.action === "craftPack");
    const refs = [...new Set(crafts.map((p) => p.ref))];
    extra.uiPosts = crafts; extra.after1 = after;
    check("UI · CRAFT: resultado visible y el SERVIDOR dice Bronce −4, Plata +1", done && after.estandar === before.estandar - 4 && (after.premium ?? 0) === (before.premium ?? 0) + 1, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    check("UI · doble clic = UNA sola ref de gesto (y como mucho una operación)", refs.length === 1, `posts=${crafts.length} refs=${refs.length}`);
    await c.tab.send("Page.reload", {}); await waitFor(c.tab, `document.querySelectorAll('[data-testid="pack-recipe"]').length >= 5`, 25000); await sleep(800);
    const row = await js<string>(c, `document.querySelector('[data-recipe="pack-estandar-premium"]')?.innerText || ''`);
    check("F5 · la UI muestra 4 / 4 y no repite el crafteo", /4\s*\/\s*4/.test(row) && (await crafting(tI)).packs.estandar === after.estandar, row.replace(/\s+/g, " ").slice(0, 100));
    await shot(c, "sobres-f5-1440");
    await logoutUi(c); await loginUi(c, "I");
    await goto(c, "/misiones/crafting/sobres", 2500);
    await waitFor(c.tab, `document.querySelectorAll('[data-testid="pack-recipe"]').length >= 5`, 25000); await sleep(600);
    const row2 = await js<string>(c, `document.querySelector('[data-recipe="pack-estandar-premium"]')?.innerText || ''`);
    check("RELOGIN · el inventario persiste (4 / 4)", /4\s*\/\s*4/.test(row2), row2.replace(/\s+/g, " ").slice(0, 100));
    // Reintento real de la MISMA ref ×10 a la vez (lo que haría un reintento de red o un F5 en pleno POST).
    const ref = refs[0];
    const rs = await Promise.all(Array.from({ length: 10 }, () => api(tI, "/api/game/crafting", { action: "craftPack", recipeId: "pack-estandar-premium", ref })));
    const after2 = (await crafting(tI)).packs;
    check("REINTENTO · misma ref ×10 simultáneos → 10 × repeated, inventario sin cambios", rs.every((r) => r.status === 200 && r.json?.repeated === true) && JSON.stringify(after2) === JSON.stringify(after), `${rs.map((r) => `${r.status}${r.json?.repeated ? "R" : ""}`).join(",")} ${JSON.stringify(after2)}`);
    extra.iRef = ref;
    const errs = c.tab.takeErrors();
    check("UI · sin errores de consola", errs.length === 0, errs.slice(0, 3).join(" | "));
  } finally { await c.browser.close(); }

  // K: 10 crafteos simultáneos con gestos DISTINTOS e inventario para UNO (6 Bronce, receta de 4).
  const tK = await token("K");
  const kb = (await crafting(tK)).packs;
  const refsK = Array.from({ length: 10 }, () => `f73p-k-${randomUUID()}`);
  const rk = await Promise.all(refsK.map((ref) => api(tK, "/api/game/crafting", { action: "craftPack", recipeId: "pack-estandar-premium", ref })));
  const ka = (await crafting(tK)).packs;
  const okK = rk.filter((r) => r.status === 200 && !r.json?.repeated);
  extra.K = { before: kb, after: ka, statuses: rk.map((r) => `${r.status}:${r.json?.code ?? (r.json?.repeated ? "repeated" : "ok")}`), winner: refsK[rk.indexOf(okK[0])] };
  check("CONCURRENCIA · K 10 gestos distintos, inventario para 1 → exactamente 1 crafteo", okK.length === 1 && ka.estandar === kb.estandar - 4 && (ka.premium ?? 0) === (kb.premium ?? 0) + 1, `${JSON.stringify(kb)} → ${JSON.stringify(ka)} · ${(extra.K as any).statuses.join(",")}`);
  check("CONCURRENCIA · los 9 perdedores reciben un error de negocio (409/422), nunca 500", rk.filter((r) => r !== okK[0]).every((r) => r.status >= 400 && r.status < 500), "");
  save("pack-craft");
}

/* ─────────── Intercambio de cartas: C por la UI (Plata → Oro, 3 copias) ─────────── */
async function exchange() {
  const t = await token("C");
  const pre = await crafting(t);
  const rec = pre.cardRecipes.find((r: any) => r.id === "card-plata-oro");
  const ownedBefore = (await state(t)).ownedCards as any[];
  extra.before = { available: rec.available, candidates: rec.candidates, owned: ownedBefore.length };
  const c = await openBrowser("C", 1440, { label: "f73p" });
  await c.tab.send("Network.enable", {});
  const posts = watchPosts(c, "/api/game/crafting");
  try {
    await loginUi(c, "C");
    await goto(c, "/misiones/crafting/cartas", 2500);
    await waitFor(c.tab, `!!document.querySelector('[data-testid="card-recipe"]')`, 25000); await sleep(800);
    // Elegir la receta Plata → Oro (si la UI muestra varias).
    await js(c, `(() => { const r = [...document.querySelectorAll('[data-testid="card-recipe"]')].find(e => /Plata\\s*→\\s*Oro/i.test(e.innerText)); if (r) { (r.querySelector('button') || r).click(); } })()`);
    await sleep(800);
    await waitFor(c.tab, `document.querySelectorAll('[data-testid="exchange-candidate"]').length >= 1`, 15000);
    await shot(c, "intercambio-antes-1440");
    for (let i = 0; i < 12; i++) {
      const n = await js<string>(c, `document.querySelector('[data-testid="exchange-count"]')?.textContent || ''`);
      if (/3 \/ 3/.test(n)) break;
      await js(c, `(() => { const b = document.querySelector('[data-testid="exchange-add"]:not([disabled])'); b && b.click(); })()`);
      await sleep(250);
    }
    const cnt = await js<string>(c, `document.querySelector('[data-testid="exchange-count"]')?.textContent || ''`);
    check("UI · selección de 3 / 3 duplicados Plata", /3 \/ 3/.test(cnt), cnt);
    await click(c, '[data-testid="exchange-craft"]');
    await waitFor(c.tab, `!!document.querySelector('[data-testid="card-craft-confirm"]')`, 6000); await sleep(400);
    await shot(c, "intercambio-confirmar-1440");
    await click(c, '[data-testid="card-craft-confirm"]');
    const out = await waitFor(c.tab, `!!document.querySelector('[data-testid="craft-result"] img[data-card-art]')`, 15000);
    await sleep(800); await shot(c, "intercambio-resultado-1440");
    const craft = posts.filter((p) => p.action === "craftCard");
    extra.uiPosts = craft;
    const ownedAfter = (await state(t)).ownedCards as any[];
    const gone = (craft[0]?.uids ?? []).filter((u: string) => !ownedAfter.some((o) => o.uid === u));
    const newOnes = ownedAfter.filter((o) => !ownedBefore.some((b) => b.uid === o.uid));
    extra.after = { owned: ownedAfter.length, newCards: newOnes, consumed: craft[0]?.uids };
    check("UI · resultado con arte real de la carta", out);
    check("SERVIDOR · las 3 copias entregadas ya no existen y hay exactamente 1 copia nueva", craft.length === 1 && craft[0].uids.length === 3 && gone.length === 3 && newOnes.length === 1 && ownedAfter.length === ownedBefore.length - 2, `posts=${craft.length} gone=${gone.length} new=${newOnes.map((n) => n.cardId).join(",")} ${ownedBefore.length}→${ownedAfter.length}`);
    extra.outputCardId = newOnes[0]?.cardId ?? null;
    // Reintento de la misma ref ×10: devuelve LA MISMA carta y no cambia nada.
    const ref = craft[0]?.ref;
    const rs = await Promise.all(Array.from({ length: 10 }, () => api(t, "/api/game/crafting", { action: "craftCard", recipeId: "card-plata-oro", uids: craft[0].uids, ref })));
    const owned3 = (await state(t)).ownedCards as any[];
    check("REINTENTO · misma ref ×10 → repeated con la MISMA carta de salida, inventario sin cambios", rs.every((r) => r.status === 200 && r.json?.repeated && r.json.outputs?.[0]?.uid === newOnes[0]?.uid) && owned3.length === ownedAfter.length, rs.map((r) => `${r.status}${r.json?.repeated ? "R" : ""}`).join(","));
    // Reutilizar copias YA gastadas con otra ref → rechazo.
    const reuse = await api(t, "/api/game/crafting", { action: "craftCard", recipeId: "card-plata-oro", uids: craft[0].uids, ref: `f73p-c-${randomUUID()}` });
    check("REUSO · las mismas 3 copias con otra ref → rechazo 4xx", reuse.status >= 400 && reuse.status < 500, `${reuse.status} ${reuse.json?.code}`);
    await c.tab.send("Page.reload", {}); await waitFor(c.tab, `!!document.querySelector('[data-testid="card-recipe"]')`, 25000); await sleep(600);
    const post = await crafting(t);
    check("F5 · disponibles Plata = antes − 3", post.cardRecipes.find((r: any) => r.id === "card-plata-oro").available === rec.available - 3, `${rec.available} → ${post.cardRecipes.find((r: any) => r.id === "card-plata-oro").available}`);
    const errs = c.tab.takeErrors();
    check("UI · sin errores de consola", errs.length === 0, errs.slice(0, 3).join(" | "));
  } finally { await c.browser.close(); }
  save("card-craft");
}

/* ─────────── Desguace vs intercambio de la MISMA copia (B, 3 Plata disponibles, receta de 3) ─────────── */
async function salvageRace() {
  const t = await token("B");
  const rec = (await crafting(t)).cardRecipes.find((r: any) => r.id === "card-plata-oro");
  // Tres uids entregables respetando «queda una copia»: por carta, como mucho `available`.
  const pick: string[] = [];
  for (const cnd of rec.candidates) for (const u of cnd.uids.slice(0, cnd.available)) if (pick.length < 3) pick.push(u);
  const X = pick[0];
  const ownedBefore = (await state(t)).ownedCards as any[];
  const credBefore = (await state(t)).credits;
  extra.before = { available: rec.available, pick, X, owned: ownedBefore.length, credits: credBefore };
  const [sv, cr] = await Promise.all([
    api(t, "/api/game/economy", { action: "salvage", uids: [X], ref: `f73p-sv-${randomUUID()}` }),
    api(t, "/api/game/crafting", { action: "craftCard", recipeId: "card-plata-oro", uids: pick, ref: `f73p-cr-${randomUUID()}` }),
  ]);
  const ownedAfter = (await state(t)).ownedCards as any[];
  const credAfter = (await state(t)).credits;
  const salvOk = sv.status === 200 && (sv.json?.salvaged ?? 0) > 0;
  const craftOk = cr.status === 200 && !cr.json?.repeated;
  extra.responses = { salvage: { status: sv.status, body: sv.json }, craft: { status: cr.status, code: cr.json?.code, outputs: cr.json?.outputs } };
  extra.after = { owned: ownedAfter.length, credits: credAfter, xPresent: ownedAfter.some((o) => o.uid === X) };
  check("CARRERA · exactamente UNA de las dos operaciones gasta la copia X", salvOk !== craftOk, `salvage=${sv.status}/${sv.json?.salvaged ?? sv.json?.error} craft=${cr.status}/${cr.json?.code ?? "ok"}`);
  check("CARRERA · X ya no existe y NO se duplicó nada", !ownedAfter.some((o) => o.uid === X), "");
  const expectCount = salvOk ? ownedBefore.length - 1 : ownedBefore.length - 2;
  check("CARRERA · recuento de copias coherente con la ganadora", ownedAfter.length === expectCount, `${ownedBefore.length} → ${ownedAfter.length} (esperado ${expectCount})`);
  check("CARRERA · créditos coherentes (solo cambian si ganó el desguace)", salvOk ? credAfter > credBefore : credAfter === credBefore, `${credBefore} → ${credAfter}`);
  save("salvage-craft-race");
}

/* ─────────── Cruce entre usuarios y superficie directa de PostgREST ─────────── */
async function cross() {
  const tK = await token("K"); const tB = await token("B");
  const bRec = (await crafting(tB)).cardRecipes;
  const bUids: string[] = bRec.flatMap((r: any) => r.candidates.flatMap((c: any) => c.uids)).slice(0, 3);
  const bOwned = ((await state(tB)).ownedCards as any[]).slice(0, 3).map((o) => o.uid);
  const useUids = bUids.length >= 3 ? bUids : bOwned;
  const kOwnedBefore = ((await state(tK)).ownedCards as any[]).length;
  const r1 = await api(tK, "/api/game/crafting", { action: "craftCard", recipeId: "card-plata-oro", uids: useUids, ref: `f73p-x-${randomUUID()}` });
  const bAfter = ((await state(tB)).ownedCards as any[]).map((o) => o.uid);
  check("CRUCE · K no puede intercambiar copias de B (4xx) y las copias de B siguen siendo de B", r1.status >= 400 && r1.status < 500 && useUids.every((u) => bAfter.includes(u)), `${r1.status} ${r1.json?.code}`);
  const r2 = await api(tK, "/api/game/economy", { action: "salvage", uids: useUids.slice(0, 1), ref: `f73p-x-${randomUUID()}` });
  const bAfter2 = ((await state(tB)).ownedCards as any[]).map((o) => o.uid);
  check("CRUCE · K no puede desguazar una copia de B", useUids.slice(0, 1).every((u) => bAfter2.includes(u)) && (r2.status >= 400 || (r2.json?.salvaged ?? 0) === 0), `${r2.status} ${JSON.stringify(r2.json).slice(0, 120)}`);
  check("CRUCE · el inventario de K no cambió", ((await state(tK)).ownedCards as any[]).length === kOwnedBefore);
  const rMiss = await api(tK, "/api/game/missions", { action: "claimProject", projectId: "no-existe-qa" });
  check("CRUCE · reclamar un proyecto inexistente → 404", rMiss.status === 404, `${rMiss.status}`);
  const bad = await api(tK, "/api/game/crafting", { action: "craftPack", recipeId: "pack-estandar-premium", ref: `f73p-x-${randomUUID()}`, qty: 99 } as any);
  check("CUERPO · un campo extra (qty) se rechaza 400", bad.status === 400, `${bad.status}`);
  // PostgREST directo con el JWT del jugador y con anon.
  const env = Object.fromEntries((await import("node:fs")).readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
  const SB = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const rest = async (tok: string | null, path: string, init: RequestInit = {}) => { const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { apikey: ANON, authorization: `Bearer ${tok ?? ANON}`, "content-type": "application/json", ...(init.headers ?? {}) } }); const txt = await r.text(); let j: any = txt; try { j = JSON.parse(txt); } catch { /* texto */ } return { status: r.status, j }; };
  const kId = creds("K").userId, bId = creds("B").userId;
  const own = await rest(tK, `user_mission_progress?select=user_id`);
  check("RLS · K lee user_mission_progress: solo filas suyas", own.status === 200 && Array.isArray(own.j) && own.j.every((r: any) => r.user_id === kId), `${own.status} n=${Array.isArray(own.j) ? own.j.length : "?"}`);
  const other = await rest(tK, `user_project_claims?select=user_id&user_id=eq.${bId}`);
  check("RLS · K no ve los reclamos de B", other.status === 200 && Array.isArray(other.j) && other.j.length === 0, `${other.status}`);
  const ins = await rest(tK, "user_mission_progress", { method: "POST", body: JSON.stringify({ user_id: kId, mission_id: "x", progress: 999 }) });
  check("RLS · K no puede escribir progreso (INSERT denegado)", ins.status === 401 || ins.status === 403 || ins.status === 404 || ins.status === 400, `${ins.status} ${JSON.stringify(ins.j).slice(0, 100)}`);
  const ev = await rest(tK, "mission_events?select=user_id&limit=1");
  check("RLS · mission_events no es legible por un jugador", ev.status >= 400 || (Array.isArray(ev.j) && ev.j.length === 0), `${ev.status}`);
  const anonRec = await rest(null, "craft_recipes?select=id&limit=1");
  check("ANON · craft_recipes no es legible sin sesión", anonRec.status >= 400 || (Array.isArray(anonRec.j) && anonRec.j.length === 0), `${anonRec.status}`);
  for (const [fn, body] of [["app_craft_pack", { p_user: kId, p_recipe: "pack-estandar-premium", p_ref: `f73p-${randomUUID()}` }], ["app_mission_apply", { p_user: kId, p_event_key: "x", p_kind: "MATCH", p_ops: [], p_evidence: {} }]] as const) {
    const r = await rest(tK, `rpc/${fn}`, { method: "POST", body: JSON.stringify(body) });
    check(`RPC · ${fn} no es ejecutable por un jugador (42501, no «no encontrada»)`, (r.status === 401 || r.status === 403) && r.j?.code === "42501", `${r.status} ${JSON.stringify(r.j).slice(0, 100)}`);
  }
  save("cross-user");
}

/* ─────────── Panel admin con una cuenta NO admin ─────────── */
async function nonadmin() {
  const t = await token("I");
  const g = await api(t, "/api/admin/cms/crafting");
  check("ADMIN · GET con cuenta no admin → 401 idéntico al anónimo (sin oráculo, contrato de server/admin/http.ts)", g.status === 401 && g.json?.error === "No autorizado", `${g.status}`);
  const p = await api(t, "/api/admin/cms/crafting", { action: "saveRecipe", id: "pack-estandar-premium", patch: { inputQty: 2 }, expectedVersion: 1 });
  check("ADMIN · POST saveRecipe con cuenta no admin → 401 (sin oráculo)", p.status === 401, `${p.status}`);
  const m = await api(t, "/api/admin/cms/crafting", { action: "saveMission", id: "qa-hack", patch: { name: "x", condition: { type: "MATCH_PLAY" }, target: 1, reward: { credits: 5000 }, status: "ACTIVE" }, expectedVersion: 0 });
  check("ADMIN · POST saveMission con cuenta no admin → 401 (sin oráculo)", m.status === 401, `${m.status}`);
  const anon = await api(null, "/api/admin/cms/crafting");
  check("ADMIN · anónimo → 401/403", anon.status === 401 || anon.status === 403, `${anon.status}`);
  const r = (await crafting(t)).packRecipes.find((x: any) => x.id === "pack-estandar-premium");
  check("ADMIN · la receta sigue en 4 tras los intentos", r.inputQty === 4, `${r.inputQty}`);
  const c = await openBrowser("I", 1440, { label: "f73p" });
  try {
    await loginUi(c, "I");
    await goto(c, "/admin/crafting", 3500);
    await sleep(1500);
    const txt = await js<string>(c, `document.body.innerText.slice(0, 400)`);
    const noPanel = await js<boolean>(c, `!/Crafteo y misiones/.test(document.body.innerText) || !document.querySelector('[role="tablist"]')`);
    await shot(c, "admin-no-admin-1440");
    check("ADMIN · /admin/crafting en el navegador de un no admin no enseña el panel", noPanel, txt.replace(/\s+/g, " ").slice(0, 160));
  } finally { await c.browser.close(); }
  save("admin-nonadmin");
}

/* ─────────── Configuración activa = ratios aprobados (sin recalcular) ─────────── */
async function ratios() {
  const APPROVED_PACK: Record<string, number> = { "pack-estandar-premium": 4, "pack-premium-oro": 2, "pack-oro-masters": 2, "pack-masters-champions": 3, "pack-champions-icon": 2 };
  const APPROVED_CARD: Record<string, number> = { "card-base-plata": 7, "card-plata-oro": 3, "card-oro-masters": 8, "card-masters-champions": 14, "card-champions-prime": 10 };
  const s = await crafting(await token("L"));
  const pk = Object.fromEntries(s.packRecipes.map((r: any) => [r.id, r.inputQty]));
  const cd = Object.fromEntries(s.cardRecipes.map((r: any) => [r.id, r.inputQty]));
  extra.served = { packs: pk, cards: cd };
  check("RATIOS · sobres servidos = aprobados", JSON.stringify(pk) === JSON.stringify(APPROVED_PACK), JSON.stringify(pk));
  check("RATIOS · cartas servidas = aprobadas", JSON.stringify(cd) === JSON.stringify(APPROVED_CARD), JSON.stringify(cd));
  check("RATIOS · Prime → Icon NO se ofrece (DISABLED)", !("card-prime-icon" in cd), Object.keys(cd).join(","));
  save("ratios-served");
}

/* ─────────── UI 1440 / 1024 / 390 (cuenta L, solo lectura; 390 con movimiento reducido) ─────────── */
async function ui() {
  for (const width of [1440, 1024, 390]) {
    const local: typeof results = [];
    const c = await openBrowser("L", width, { label: "f73p", reduced: width === 390 });
    const ck = (id: string, ok: boolean, d = "") => { local.push({ id, ok, detail: d }); check(`[${width}] ${id}`, ok, d); };
    try {
      await loginUi(c, "L");
      const pages: [string, string, string][] = [
        ["/misiones", `!!document.querySelector('[data-testid="hub-tab-misiones"]') && !document.querySelector('[data-testid="f73-unavailable"]')`, "misiones"],
        ["/misiones/crafting", `!!document.querySelector('[data-testid="crafting-entry-sobres"] img')`, "crafting"],
        ["/misiones/crafting/sobres", `document.querySelectorAll('[data-testid="pack-recipe"]').length >= 5`, "sobres"],
        ["/misiones/crafting/cartas", `!!document.querySelector('[data-testid="card-recipe"]')`, "cartas"],
      ];
      for (const [path, ready, name] of pages) {
        await goto(c, path, 2500);
        const ok = await waitFor(c.tab, ready, 25000);
        await sleep(900);
        const noScroll = await js<boolean>(c, `document.scrollingElement.scrollWidth <= innerWidth + 1`);
        const loading = await js<boolean>(c, `/Cargando/i.test(document.querySelector('main')?.innerText || '') && !(${ready})`);
        await shot(c, `${name}-${width}`);
        ck(`${name}: contenido real cargado (no pantalla de carga), sin scroll horizontal`, ok && noScroll && !loading, `ready=${ok} noScroll=${noScroll}`);
      }
      await js(c, `document.querySelector('[data-testid="cards-tab-proyectos"]')?.click()`);
      await sleep(1500);
      const projReady = await waitFor(c.tab, `!!document.querySelector('[data-testid="project-card"]') || /proyecto/i.test(document.querySelector('main')?.innerText || '')`, 15000);
      await sleep(800);
      await shot(c, `proyectos-${width}`);
      ck("proyectos: pestaña cargada (lista o vacío real, no carga)", projReady && !(await js<boolean>(c, `/Cargando/i.test(document.querySelector('main')?.innerText || '')`)));
      const errs = c.tab.takeErrors();
      ck("sin errores de consola", errs.length === 0, errs.slice(0, 3).join(" | "));
    } finally { await c.browser.close(); }
    const pass = local.filter((r) => r.ok).length;
    writeFileSync(join(OUT, `responsive-${width}.json`), JSON.stringify({ at: new Date().toISOString(), width, reducedMotion: width === 390, intercepted: false, account: "QA L (solo lectura)", pass, fail: local.length - pass, results: local }, null, 2));
  }
}

/* ─────────── Dos pestañas (dos sesiones) de I con inventario para UN crafteo: las dos confirman a la vez ─────────── */
async function tabs() {
  const t = await token("I");
  const before = (await crafting(t)).packs;
  const a = await openBrowser("I", 1440, { label: "f73p" });
  const b = await openBrowser("I", 1440, { label: "f73p" });
  try {
    for (const c of [a, b]) {
      await loginUi(c, "I");
      await goto(c, "/misiones/crafting/sobres", 2500);
      await waitFor(c.tab, `document.querySelectorAll('[data-testid="pack-recipe"]').length >= 5`, 25000); await sleep(600);
      await click(c, '[data-recipe="pack-estandar-premium"] [data-testid="pack-recipe-craft"]');
      await waitFor(c.tab, `!!document.querySelector('[data-testid="pack-craft-confirm"]')`, 6000);
    }
    const t2 = await token("I");
    await Promise.all([a, b].map((c) => js(c, `document.querySelector('[data-testid="pack-craft-confirm"]')?.click()`)));
    await sleep(5000);
    const seen = await Promise.all([a, b].map((c) => js<string>(c, `(document.querySelector('[data-testid="pack-craft-dialog"]')?.innerText || '').replace(/\\s+/g, ' ').slice(0, 160)`)));
    const ok = await Promise.all([a, b].map((c) => js<boolean>(c, `!!document.querySelector('[data-testid="craft-result"]')`)));
    await shot(a, "dos-pestanas-A-1440"); await shot(b, "dos-pestanas-B-1440");
    const after = (await crafting(t2)).packs;
    extra.before = before; extra.after = after; extra.tabs = seen;
    check("DOS PESTAÑAS · exactamente una muestra el resultado", ok.filter(Boolean).length === 1, JSON.stringify(ok));
    check("DOS PESTAÑAS · el servidor aplicó UN crafteo (Bronce −4, Plata +1)", after.estandar === before.estandar - 4 && (after.premium ?? 0) === (before.premium ?? 0) + 1, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    check("DOS PESTAÑAS · la otra pestaña ve un error de negocio legible (sin crafteo fantasma)", seen.some((s, i) => !ok[i] && s.length > 0), seen.join(" || "));
  } finally { await a.browser.close(); await b.browser.close(); }
  save("pack-idempotency");
}

/* ─────────── Apertura vs crafteo del MISMO sobre (K: 2 Plata; abrir 1 vs craftear 2 → 1 Oro) ─────────── */
async function openRace() {
  const t = await token("K");
  const before = (await crafting(t)).packs;
  const cardsBefore = ((await state(t)).ownedCards as any[]).length;
  const [op, cr] = await Promise.all([
    api(t, "/api/game/packs", { action: "open", packId: "premium", ref: `f73p-op-${randomUUID()}` }),
    api(t, "/api/game/crafting", { action: "craftPack", recipeId: "pack-premium-oro", ref: `f73p-or-${randomUUID()}` }),
  ]);
  const after = (await crafting(t)).packs;
  const cardsAfter = ((await state(t)).ownedCards as any[]).length;
  const opened = op.status === 200; const crafted = cr.status === 200 && !cr.json?.repeated;
  extra.before = before; extra.after = after; extra.responses = { open: { status: op.status, error: op.json?.error }, craft: { status: cr.status, code: cr.json?.code } }; extra.cards = [cardsBefore, cardsAfter];
  check("CARRERA · exactamente UNA gana (abrir o craftear)", opened !== crafted, `open=${op.status} craft=${cr.status}/${cr.json?.code ?? "ok"}`);
  if (opened) check("CARRERA · ganó la apertura: Plata 2→1, sin Oro, cartas nuevas", after.premium === before.premium - 1 && !(after.oro > (before.oro ?? 0)) && cardsAfter > cardsBefore, `${JSON.stringify(before)} → ${JSON.stringify(after)} cartas ${cardsBefore}→${cardsAfter}`);
  else check("CARRERA · ganó el crafteo: Plata 2→0, Oro +1, sin cartas nuevas", after.premium === before.premium - 2 && after.oro === (before.oro ?? 0) + 1 && cardsAfter === cardsBefore, `${JSON.stringify(before)} → ${JSON.stringify(after)} cartas ${cardsBefore}→${cardsAfter}`);
  check("CARRERA · la perdedora responde 4xx, nunca 500", [op, cr].filter((r) => r.status !== 200).every((r) => r.status >= 400 && r.status < 500));
  save("pack-race");
}

const RUN: Record<string, () => Promise<void>> = { tabs, "open-race": openRace, packs, exchange, "salvage-race": salvageRace, cross, nonadmin, ratios, ui };
if (!RUN[WHAT]) { console.error(`uso: ${Object.keys(RUN).join("|")}`); process.exit(2); }
RUN[WHAT]().then(() => process.exit(results.some((r) => !r.ok) ? 1 : 0), (e) => { console.error(e); process.exit(1); });
