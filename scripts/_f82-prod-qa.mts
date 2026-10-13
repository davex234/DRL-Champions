/**
 * F82 · QA EN PRODUCCIÓN (instrumento, fuera de CI). SOLO cuentas QA; nunca la del usuario (la librería aborta).
 *
 *   · QA «QA» (1ff2c0ef, f45): sets EN PROGRESO → lectura, reclamo incompleto, borrador, cuerpo cerrado, insignia ajena.
 *   · F86.2 · REPETIBLE: el reclamo de un solo uso ya NO depende de QA «K» (91cb8a2c), que reclamó Eternal Fire el
 *     2026-10-03 (ese reclamo histórico y su insignia NO se tocan). En cada ejecución se registra una cuenta QA NUEVA por
 *     el formulario real (@example.invalid), una QA con admin TEMPORAL le concede por el camino canónico y auditado
 *     (`/api/admin/users` → grant → `award`) las cartas que pide el set, y se revoca el admin. Esa cuenta nueva hace el
 *     reclamo real por la UI con doble clic MIENTRAS otras dos sesiones disparan 6 reclamos por la API → exactamente uno.
 *     Después: momento de colección completada, destacar en el perfil, perfil público visto por otra cuenta.
 *   · Regresión de lectura: health/ready, tienda, colección, forja/crafteo, misiones, competitivo.
 * La BD se comprueba aparte por SSH (compleciones e insignias exactas).
 *
 * Uso (cwd temporal con .env.local PÚBLICO + tsconfig con paths):
 *   BASE_URL=https://valorosters.com npx tsx C:/NEXUS-CENTRAL/DRLCards/scripts/_f82-prod-qa.mts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const lib = await import("file:///C:/NEXUS-CENTRAL/DRLCards/scripts/_fase68-lib.ts");
const { mkdirSync, writeFileSync } = await import("node:fs");
const { join } = await import("node:path");
const { openBrowser, loginUi, registerUi, sleep, token, api, waitFor, PERSONA_FILES, creds } = lib;
const { execFileSync } = await import("node:child_process");
const TMP = process.env.TEMP ?? "C:/Users/david/AppData/Local/Temp";
PERSONA_FILES.QA = join(TMP, "claude/C--NEXUS-CENTRAL-DRLCards/287155d6-0740-47dd-baa7-edb43491b4e3/scratchpad/f45-qa-creds.json");
// F86.2 · la cuenta del reclamo es NUEVA en cada ejecución (credenciales en el scratchpad, nunca en el repo).
const RUN = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const FX = "F82X";
PERSONA_FILES[FX] = join(TMP, `claude/C--NEXUS-CENTRAL-DRLCards/fcf17e93-8a34-40b9-8c19-cd7a585fa60c/scratchpad/f82x-${RUN}.json`);
const sql = (q: string): string => execFileSync("ssh", ["-i", `${process.env.USERPROFILE}/.ssh/id_ed25519`, "nexusadmin@212.95.40.144", "docker exec -i supabase_db_DRLCards psql -U postgres -d postgres -At -v ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();
const PERSONAL = "2f86cbe8"; // F87.1 · cuenta personal BORRADA el 2026-10-05: solo guardia histórica
// F87.1 · admins reales = davex (#NB2Z9BM) y ValoRosters (#H5ND8K7); se leen, nunca se usan.
const REAL_PREFIXES = ["3befce61", "b7ccff02"];
const REAL_ADMINS = REAL_PREFIXES.join(",");
const BASE = process.env.BASE_URL ?? "";
if (!/^https:\/\/valorosters\.com$/.test(BASE)) throw new Error("BASE_URL=https://valorosters.com");
const OUT = "C:/NEXUS-CENTRAL/DRLCards/docs/product/qa/f82-collection-sets/prod";
mkdirSync(`${OUT}/shots`, { recursive: true });

const EF = "team-eternal-fire-v1";
const EF_BADGE = "insignia:coleccion:team-eternal-fire";
const PUBLISHED = ["team-eternal-fire-v1", "team-fnatic-v1", "team-g2-v1", "team-leviatan-v1", "team-team-heretics-v1", "team-team-liquid-v1"];
const rows: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail: unknown = "") => {
  const d = typeof detail === "string" ? detail : JSON.stringify(detail);
  rows.push({ id, ok, detail: d.slice(0, 900) });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${d.slice(0, 240)}`);
};
const claim = (t: string | null, body: unknown) => api(t, "/api/game/collection-sets", body, true);
const ids = (room: any) => (room?.sets ?? []).map((s: any) => s.id).sort();

// ── 0 · salud y anónimo ─────────────────────────────────────────────────────────────────────────────────────
const health = await api(null, "/api/health");
const ready = await api(null, "/api/ready");
check("health", health.status === 200 && health.json?.status === "ok", health.json);
// F86.2 · la cabeza ya no se FIJA en 0062 (igual que F83/F84): 0062 aplicada = cabeza ≥ 0062 y la sonda «collections» en verde.
const headNum = Number(String(ready.json?.migrationHead ?? "").slice(0, 4));
const collectionsCheck = (ready.json?.checks ?? []).find((c: any) => c.id === "collections");
check("ready + 0062 aplicada (cabeza ≥ 0062 y sonda «collections» en verde)", ready.status === 200 && headNum >= 62 && collectionsCheck?.ok === true, { status: ready.status, head: ready.json?.migrationHead, collections: collectionsCheck });
check("anónimo GET sala → 401", (await api(null, "/api/game/collection-sets")).status === 401);
check("anónimo reclamo → 401", (await claim(null, { action: "claim", setId: EF })).status === 401);
check("anónimo panel → 401", [401, 403].includes((await api(null, "/api/admin/cms/collection-sets")).status));

// ── 1 · QA en progreso (1ff2c0ef) ────────────────────────────────────────────────────────────────────────────
const tQA = await token("QA");
const qaId = creds("QA").userId as string;
const roomQA = await api(tQA, "/api/game/collection-sets");
check("QA · sala 200", roomQA.status === 200, roomQA.status);
check("QA · solo los 6 publicados (ningún borrador)", JSON.stringify(ids(roomQA.json)) === JSON.stringify(PUBLISHED), ids(roomQA.json));
const qaSets = Object.fromEntries((roomQA.json?.sets ?? []).map((s: any) => [s.id, `${s.owned}/${s.required}:${s.state}`]));
check("QA · progreso por set", true, qaSets);
const g2 = roomQA.json?.sets?.find((s: any) => s.id === "team-g2-v1");
// F87.1 · repetible: la QA es NUEVA en cada ejecución (la antigua tenía cartas de G2). Contrato de `setState`: con alguna
// carta → IN_PROGRESS, sin ninguna → LOCKED; en ambos casos «qué falta» = requisitos sin satisfacer = `missing` > 0.
check(`QA · G2 ${(g2?.owned ?? 0) > 0 ? "en progreso" : "bloqueado (QA sin cartas de G2)"} con «qué falta»`, g2?.state === ((g2?.owned ?? 0) > 0 ? "IN_PROGRESS" : "LOCKED") && g2.requirements.filter((r: any) => !r.satisfied).length === g2.missing && g2.missing > 0, { owned: g2?.owned, missing: g2?.missing, faltan: g2?.requirements?.filter((r: any) => !r.satisfied).map((r: any) => r.label) });
check("QA · requisitos sin satisfacer listan cartas elegibles", (g2?.requirements ?? []).every((r: any) => r.eligibleCardIds.length > 0));
const inc = await claim(tQA, { action: "claim", setId: "team-g2-v1" });
check("QA · reclamar incompleto → 409 INCOMPLETE", inc.status === 409 && inc.json?.code === "INCOMPLETE", inc.json);
const draft = await claim(tQA, { action: "claim", setId: "team-100t-v1" });
check("QA · reclamar BORRADOR → 404 (invisible)", draft.status === 404 && draft.json?.code === "NOT_FOUND", draft.json);
check("QA · id mal formado → 400", (await claim(tQA, { action: "claim", setId: "../G2 !" })).status === 400);
const forged = await claim(tQA, { action: "claim", setId: "team-g2-v1", complete: true });
check("QA · «tengo todas» (campo extra) → 400 FIELD_NOT_ALLOWED", forged.status === 400 && forged.json?.code === "FIELD_NOT_ALLOWED", forged.json);
const other = await claim(tQA, { action: "claim", setId: EF, userId: creds("K").userId });
check("QA · reclamar en nombre de otro (userId) → 400", other.status === 400 && other.json?.code === "FIELD_NOT_ALLOWED", other.json);
check("QA · parámetro en la URL → 400", (await api(tQA, "/api/game/collection-sets?user=" + creds("K").userId)).status === 400);
const lockedQA = await api(tQA, "/api/game/player", { action: "set_featured_badges", badgeIds: [EF_BADGE], expectedVersion: null }, true);
check("QA · destacar insignia NO poseída → 403 LOCKED", lockedQA.status === 403 && lockedQA.json?.code === "LOCKED", lockedQA.json);
const fakeQA = await api(tQA, "/api/game/player", { action: "set_featured_badges", badgeIds: ["insignia:coleccion:inventada"], expectedVersion: null }, true);
check("QA · destacar id inventado → 403 LOCKED", fakeQA.status === 403 && fakeQA.json?.code === "LOCKED", fakeQA.json);
const tooMany = await api(tQA, "/api/game/player", { action: "set_featured_badges", badgeIds: ["insignia:a", "insignia:b", "insignia:c", "insignia:d"], expectedVersion: null }, true);
check("QA · 4 insignias → 400", tooMany.status === 400, tooMany.json);
const notBadge = await api(tQA, "/api/game/player", { action: "set_featured_badges", badgeIds: ["titulo:leyenda"], expectedVersion: null }, true);
check("QA · un cosmético que no es insignia → 400", notBadge.status === 400, notBadge.json);
const adminQA = await api(tQA, "/api/admin/cms/collection-sets", undefined, true);
check("QA · panel de sets como usuario normal → 401/403", [401, 403].includes(adminQA.status), adminQA.status);
const adminGen = await api(tQA, "/api/admin/cms/collection-sets", { action: "generate", kind: "TEAM" }, true);
check("QA · generar borradores como usuario normal → 401/403", [401, 403].includes(adminGen.status), adminGen.status);

// ── 2 · K antes del reclamo ──────────────────────────────────────────────────────────────────────────────────
// F86.2 · 2a · cuenta NUEVA por el registro real + cartas concedidas por el camino canónico auditado (admin QA temporal).
{
  const reg = await openBrowser(FX, 1440, { label: "f82-prod-register" });
  try { await registerUi(reg, FX); } finally { await reg.browser.close().catch(() => null); }
}
const fxId = creds(FX).userId as string;
if ([PERSONAL, ...REAL_PREFIXES].some((p) => fxId.startsWith(p) || qaId.startsWith(p))) throw new Error("cuenta real: prohibido");
check("FX · cuenta nueva registrada por el formulario real", !!fxId && sql(`select count(*) from auth.users where id='${fxId}' and email ilike '%@example.invalid';`) === "1", fxId.slice(0, 8));
const tFx0 = await token(FX);
const room0 = await api(tFx0, "/api/game/collection-sets");
const ef0 = room0.json?.sets?.find((s: any) => s.id === EF);
const needed: string[] = (ef0?.requirements ?? []).filter((r: any) => !r.satisfied).map((r: any) => r.eligibleCardIds[0]).filter(Boolean);
// Al nacer no tiene NINGUNA carta del set: LOCKED (0 de N) o IN_PROGRESS si el sobre de bienvenida trajo alguna.
check("FX · Eternal Fire sin completar al nacer (le faltan cartas; ni reclamable ni completado)", (ef0?.state === "LOCKED" || ef0?.state === "IN_PROGRESS") && ef0.missing > 0 && needed.length === ef0.missing, { state: ef0?.state, missing: ef0?.missing, needed });
sql(`begin; select set_config('drl.admin_writer','on',true); update public.profiles set is_admin = true where id = '${qaId}';
insert into public.content_audit_log (actor, action, entity_type, entity_id, detail) values (null, 'GRANT_ADMIN', 'user', '${qaId}', '{"via":"operator","purpose":"QA F82 repetible: conceder cartas a la cuenta QA nueva (temporal)"}'); commit;`);
const grants: number[] = [];
try {
  for (const cardId of needed) {
    const g = await api(tQA, "/api/admin/users", { action: "grant", userId: fxId, kind: "card", cardId, reason: "QA F82 repetible: cartas del set para probar el reclamo", ref: `f82x-${RUN}-${cardId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40)}` }, true);
    grants.push(g.status);
  }
} finally {
  sql(`begin; select set_config('drl.admin_writer','on',true); update public.profiles set is_admin = false where id = '${qaId}';
insert into public.content_audit_log (actor, action, entity_type, entity_id, detail) values (null, 'REVOKE_ADMIN', 'user', '${qaId}', '{"via":"operator","purpose":"fin QA F82 repetible"}'); commit;`);
}
check("FX · cartas concedidas por /api/admin/users (auditado) y admin QA revocado al momento", grants.length === needed.length && grants.every((x) => x === 200) && sql(`select string_agg(left(id::text,8), ',' order by id) from profiles where is_admin;`) === REAL_ADMINS, grants);
const tK1 = await token(FX), tK2 = await token(FX), tK3 = await token(FX);
const kId = fxId;
const pre = await api(tK1, "/api/game/collection-sets");
const efPre = pre.json?.sets?.find((s: any) => s.id === EF);
check("K · Eternal Fire CLAIMABLE con sus cartas reales", efPre?.state === "CLAIMABLE" && efPre.owned === efPre.required, { owned: efPre?.owned, required: efPre?.required, state: efPre?.state });
check("K · insignia de EF todavía bloqueada (en «locked», no en «unlocked»)", (pre.json?.badges?.locked ?? []).some((b: any) => b.id === EF_BADGE) && !(pre.json?.badges?.unlocked ?? []).some((b: any) => b.id === EF_BADGE));
check("K · insignia de EF con el logo REAL del equipo", efPre?.badge?.logo === "/hints/teams/eternal-fire.png", efPre?.badge);

// ── 3 · reclamo real por la UI (doble clic) + 6 reclamos API de otras dos sesiones a la vez ─────────────────
const c = await openBrowser(FX, 1440, { label: "f82-prod-FX" });
const raceApi: any[] = [];
let uiOutcome: unknown = null;
try {
  check("K · login UI", await loginUi(c, FX));
  await c.tab.goto(`${BASE}/coleccion/trofeos`, 2500);
  await waitFor(c.tab, `!!document.querySelector('[data-testid="trophy-room"]')`, 25000);
  await sleep(800);
  check("K · UI sala: banner «lista para reclamar»", await c.tab.js<boolean>(`!!document.querySelector('[data-testid="claimable-banner"]')`));
  check("K · UI sala: 6 colecciones", (await c.tab.js<number>(`document.querySelectorAll('[data-testid="set-tile"]').length`)) === 6);
  await c.tab.shot(`${OUT}/shots/K-room-claimable-1440.png`);
  await c.tab.goto(`${BASE}/coleccion/trofeos/${EF}`, 2500);
  await waitFor(c.tab, `!!document.querySelector('[data-testid="claim-badge"]')`, 25000);
  await sleep(600);
  await c.tab.shot(`${OUT}/shots/K-detail-claimable-1440.png`);
  // Doble clic real en el botón y, a la vez, 6 reclamos desde otras dos sesiones de la misma cuenta.
  await Promise.all([
    c.tab.js(`(() => { const b = document.querySelector('[data-testid="claim-badge"]'); b.click(); b.click(); return true; })()`),
    ...[tK2, tK3, tK2, tK3, tK2, tK3].map((t) => claim(t, { action: "claim", setId: EF }).then((r) => raceApi.push({ status: r.status, outcome: r.json?.outcome ?? r.json?.code }))),
  ]);
  const momentShown = await waitFor(c.tab, `!!document.querySelector('[data-testid="completion-moment"]')`, 20000);
  await sleep(1800);
  uiOutcome = await c.tab.js(`(() => { const m = document.querySelector('[data-testid="completion-moment"]'); return m ? { text: m.innerText.slice(0, 200), reduced: m.dataset.reduced, logo: !!m.querySelector('img[alt]') } : null; })()`);
  check("K · UI: momento de colección completada", momentShown, uiOutcome);
  await c.tab.shot(`${OUT}/shots/K-moment-1440.png`);
  const completedCount = raceApi.filter((r) => r.outcome === "COMPLETED").length + (/ya la tenías|ya era tuya|ya reclamada/i.test(String((uiOutcome as any)?.text ?? "")) ? 0 : 1);
  check("K · carrera: 6 API + doble clic UI → exactamente 1 COMPLETED", completedCount === 1 && raceApi.every((r) => r.status === 200 && ["COMPLETED", "ALREADY"].includes(r.outcome)), { api: raceApi, ui: uiOutcome });
  // Destacar desde el momento (EQUIP).
  const equipBtn = await c.tab.js<boolean>(`!!document.querySelector('[data-testid="moment-equip"]')`);
  if (equipBtn) {
    await c.tab.js(`document.querySelector('[data-testid="moment-equip"]').click()`);
    await waitFor(c.tab, `!document.querySelector('[data-testid="completion-moment"]')`, 15000);
    await sleep(1200);
  }
  check("K · UI: botón DESTACAR EN MI PERFIL presente", equipBtn);
  await c.tab.shot(`${OUT}/shots/K-detail-completed-1440.png`);
  check("K · UI detalle: ya no hay botón de reclamar", !(await c.tab.js<boolean>(`!!document.querySelector('[data-testid="claim-badge"]')`)));
  await c.tab.send("Page.reload", {}); await sleep(3500);
  check("K · F5: sigue COMPLETADO, sin reclamar otra vez", !(await c.tab.js<boolean>(`!!document.querySelector('[data-testid="claim-badge"]')`)) && !(await c.tab.js<boolean>(`!!document.querySelector('[data-testid="completion-moment"]')`)));
  // F86.2 · OBSOLETA desde Profile 2.0 (2026-10-05, decisión de producto): el perfil es UNA tarjeta de identidad y
  // NO enseña vitrina de insignias (el brief prohíbe volver a añadirla). Antes: «insignia destacada visible en el
  // perfil». Ahora: la tarjeta simple se pinta y la insignia destacada vive en el perfil por API (comprobado abajo).
  await c.tab.goto(`${BASE}/jugador/me`, 3500);
  await waitFor(c.tab, `!!document.querySelector('[data-testid="profile-card"]')`, 20000);
  await sleep(800);
  check("K · perfil propio: tarjeta de identidad simple (sin vitrina de insignias, Profile 2.0)", (await c.tab.js<boolean>(`!!document.querySelector('[data-testid="profile-card"]') && !document.querySelector('[data-testid="profile-badges"]')`)));
  await c.tab.shot(`${OUT}/shots/K-profile-own-1440.png`);
  for (const w of [1024, 390]) {
    await c.tab.resize(w, w < 600 ? 844 : 768, 1);
    for (const [path, name, sel] of [["/coleccion/trofeos", "room", "trophy-room"], [`/coleccion/trofeos/${EF}`, "detail-completed", "set-detail"], ["/jugador/me", "profile-own", "profile-card"]] as const) {
      await c.tab.goto(`${BASE}${path}`, 2500);
      await waitFor(c.tab, `!!document.querySelector('[data-testid="${sel}"]')`, 20000);
      await sleep(700);
      const ox = await c.tab.js<number>("document.documentElement.scrollWidth - window.innerWidth");
      check(`K · ${name} ${w}: sin desbordamiento horizontal`, ox <= 0, ox);
      await c.tab.shot(`${OUT}/shots/K-${name}-${w}.png`);
    }
  }
} finally { await c.browser.close().catch(() => null); }

// ── 4 · después: API, insignias, perfil ─────────────────────────────────────────────────────────────────────
const post = await api(tK1, "/api/game/collection-sets");
const efPost = post.json?.sets?.find((s: any) => s.id === EF);
check("K · EF COMPLETED con fecha", efPost?.state === "COMPLETED" && !!efPost.completedAt, { state: efPost?.state, at: efPost?.completedAt });
check("K · insignia en «unlocked», fuera de «locked»", (post.json?.badges?.unlocked ?? []).some((b: any) => b.id === EF_BADGE) && !(post.json?.badges?.locked ?? []).some((b: any) => b.id === EF_BADGE));
check("K · compleciones recientes incluye EF", (post.json?.recent ?? []).some((r: any) => r.setId === EF));
const retry = await claim(tK1, { action: "claim", setId: EF });
check("K · reintento → 200 ALREADY", retry.status === 200 && retry.json?.outcome === "ALREADY", retry.json?.outcome);
const lockedK = await api(tK1, "/api/game/player", { action: "set_featured_badges", badgeIds: [EF_BADGE, "insignia:coleccion:team-g2"], expectedVersion: post.json?.profileVersion }, true);
check("K · destacar EF + una bloqueada (G2) → 403 LOCKED", lockedK.status === 403 && lockedK.json?.code === "LOCKED", lockedK.json);
const me1 = await api(tK1, "/api/game/player?me=1");
const v1 = me1.json?.version ?? me1.json?.self?.version ?? post.json?.profileVersion;
const meRoom = await api(tK1, "/api/game/collection-sets");
const pv = meRoom.json?.profileVersion;
check("K · featuredBadgeIds tras EQUIP = [EF]", JSON.stringify(meRoom.json?.featuredBadgeIds) === JSON.stringify([EF_BADGE]), meRoom.json?.featuredBadgeIds);
const same = await api(tK1, "/api/game/player", { action: "set_featured_badges", badgeIds: [EF_BADGE], expectedVersion: pv }, true);
check("K · mismo contenido → UNCHANGED", same.status === 200 && same.json?.code === "UNCHANGED", same.json);
const unequip = await api(tK1, "/api/game/player", { action: "set_featured_badges", badgeIds: [], expectedVersion: pv }, true);
check("K · quitar → SAVED", unequip.status === 200 && unequip.json?.code === "SAVED", unequip.json);
const stale = await api(tK1, "/api/game/player", { action: "set_featured_badges", badgeIds: [EF_BADGE], expectedVersion: pv }, true);
check("K · versión vieja (otra pestaña) → 409 CONFLICT", stale.status === 409 && stale.json?.code === "CONFLICT", stale.json);
const reequip = await api(tK1, "/api/game/player", { action: "set_featured_badges", badgeIds: [EF_BADGE], expectedVersion: unequip.json?.version }, true);
check("K · volver a destacar → SAVED", reequip.status === 200 && reequip.json?.code === "SAVED", reequip.json);
const meSelf = await api(tK1, "/api/game/player?me=1");
check("K · perfil SELF: destacadas [EF] + lista propia para el editor", JSON.stringify((meSelf.json?.badges ?? []).map((b: any) => b.id)) === JSON.stringify([EF_BADGE]) && (meSelf.json?.self?.ownedBadges ?? []).some((b: any) => b.id === EF_BADGE), { badges: meSelf.json?.badges?.map((b: any) => b.id), owned: meSelf.json?.self?.ownedBadges?.length });
const pub = await api(tQA, `/api/game/player?id=${kId}`);
const pubText = JSON.stringify(pub.json ?? {});
check("perfil PÚBLICO de K visto por QA: insignia con logo real", pub.status === 200 && (pub.json?.badges ?? []).some((b: any) => b.id === EF_BADGE && b.logo === "/hints/teams/eternal-fire.png"), pub.json?.badges);
check("perfil PÚBLICO: sin lista de insignias propias ni bloqueadas", !pub.json?.self && !/ownedBadges|featuredBadgeIds|"locked"/.test(pubText));
void v1; void me1;

// ── 5 · QA en progreso por la UI a 390 (qué me falta) ───────────────────────────────────────────────────────
const q = await openBrowser("QA", 390, { label: "f82-prod-QA" });
try {
  check("QA · login UI", await loginUi(q, "QA"));
  await q.tab.goto(`${BASE}/coleccion/trofeos/team-g2-v1`, 2500);
  await waitFor(q.tab, `!!document.querySelector('[data-testid="missing-list"]')`, 25000);
  await sleep(700);
  check("QA · UI 390: lista «te falta» + sin botón de reclamar", (await q.tab.js<number>(`document.querySelectorAll('[data-testid="missing-list"] [data-testid="requirement"]').length`)) > 0 && !(await q.tab.js<boolean>(`!!document.querySelector('[data-testid="claim-badge"]')`)));
  check("QA · UI 390 sin desbordamiento", (await q.tab.js<number>("document.documentElement.scrollWidth - window.innerWidth")) <= 0);
  await q.tab.shot(`${OUT}/shots/QA-detail-progress-390.png`);
  await q.tab.goto(`${BASE}/coleccion/trofeos`, 2500);
  await waitFor(q.tab, `!!document.querySelector('[data-testid="trophy-room"]')`, 25000);
  await sleep(700);
  await q.tab.shot(`${OUT}/shots/QA-room-390.png`);
  const hidden = await q.tab.js<number>(`document.querySelectorAll('[data-set="team-100t-v1"]').length`);
  check("QA · UI: un borrador no aparece en la sala", hidden === 0);
} finally { await q.browser.close().catch(() => null); }

// ── 6 · regresión de lectura (otras áreas) ──────────────────────────────────────────────────────────────────
for (const p of ["/", "/coleccion", "/coleccion/trofeos", "/tienda", "/misiones/crafting", "/competitivo", "/progresion", "/admin/collection-sets"]) {
  const r = await fetch(`${BASE}${p}`, { redirect: "manual" });
  check(`página ${p} → 200`, r.status === 200, r.status);
}
for (const p of ["/api/game/state", "/api/game/me", "/api/game/competitive", "/api/game/forge", "/api/game/missions", "/api/game/crafting"]) {
  const r = await api(tQA, p);
  check(`API ${p} (QA) → 2xx`, r.status >= 200 && r.status < 300, r.status);
}

writeFileSync(`${OUT}/prod-qa.json`, JSON.stringify({ at: new Date().toISOString(), base: BASE, qa: qaId.slice(0, 8), k: kId.slice(0, 8), pass: rows.filter((r) => r.ok).length, fail: rows.filter((r) => !r.ok).length, rows }, null, 1));
console.log(`\nTOTAL ${rows.filter((r) => r.ok).length}/${rows.length}`);
process.exitCode = rows.every((r) => r.ok) ? 0 : 1;
