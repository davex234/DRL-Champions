/**
 * F89 · QA EN PRODUCCIÓN DEL PERFIL 2.0 (instrumento, fuera de CI). SOLO cuentas QA; nunca la del usuario (la librería
 * aborta). Nada se concede: se usan las cartas, insignias y partidas que las cuentas QA ya tienen.
 *
 *   · K  (91cb8a2c, f69-K): perfil propio — equipo favorito (guardar, UNCHANGED, CONFLICT, dos pestañas), vitrina con
 *        una copia PROPIA, insignia propia; al final se RESTAURA su estado inicial (equipo y vitrina).
 *   · QA (1ff2c0ef, f45): visitante — perfil público de K, ataques directos (ids ajenos, inválidos, campos extra).
 *   · Anónimo: perfil público y 401 en mutaciones.
 *   · Consistencia: carrera y colecciones contra la BD (SSH, solo lectura) con las MISMAS reglas.
 *   · Navegador: perfil propio/público/anónimo a 1440/1024/390 y cambio de cuenta K → logout → QA sin datos de K.
 *
 * Uso (cwd temporal con .env.local PÚBLICO + tsconfig con paths):
 *   BASE_URL=https://valorosters.com npx tsx C:/NEXUS-CENTRAL/DRLCards/scripts/_f89-prod-qa.mts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const lib = await import("file:///C:/NEXUS-CENTRAL/DRLCards/scripts/_fase68-lib.ts");
const { mkdirSync, writeFileSync } = await import("node:fs");
const { join } = await import("node:path");
const { execFileSync } = await import("node:child_process");
const { openBrowser, loginUi, logoutUi, sleep, token, api, waitFor, PERSONA_FILES, creds } = lib;
const TMP = process.env.TEMP ?? "C:/Users/david/AppData/Local/Temp";
PERSONA_FILES.QA = join(TMP, "claude/C--NEXUS-CENTRAL-DRLCards/287155d6-0740-47dd-baa7-edb43491b4e3/scratchpad/f45-qa-creds.json");
const BASE = process.env.BASE_URL ?? "";
if (BASE !== "https://valorosters.com") throw new Error("BASE_URL=https://valorosters.com");
const OUT = "C:/NEXUS-CENTRAL/DRLCards/docs/product/qa/f89-profile/prod";
mkdirSync(`${OUT}/shots`, { recursive: true });

const rows: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail: unknown = "") => {
  const d = typeof detail === "string" ? detail : JSON.stringify(detail);
  rows.push({ id, ok, detail: d.slice(0, 900) });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${d.slice(0, 220)}`);
};
const sql = (q: string): string => execFileSync("ssh", ["-i", `${process.env.USERPROFILE}/.ssh/id_ed25519`, "nexusadmin@212.95.40.144", "docker exec -i supabase_db_DRLCards psql -U postgres -d postgres -At -v ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();
const P = "/api/game/player";
const post = (t: string | null, body: unknown) => api(t, P, body, true);

const K = creds("K").userId as string;
const QA = creds("QA").userId as string;
const tK1 = await token("K"), tK2 = await token("K"), tQA = await token("QA");

// ── 0 · salud ──
const ready = await api(null, "/api/ready");
check("ready + cabeza 0063", ready.status === 200 && ready.json?.migrationHead === "0063_profile_favorite_team", { s: ready.status, head: ready.json?.migrationHead, checks: (ready.json?.checks ?? []).filter((c: any) => !c.ok).map((c: any) => c.id) });
check("check «profile» (0063) en verde", (ready.json?.checks ?? []).some((c: any) => c.id === "profile" && c.ok));

// ── 1 · estado inicial de K (para restaurar) ──
const me0 = await api(tK1, `${P}?me=1`);
check("K · perfil propio 200 SELF", me0.status === 200 && me0.json?.view === "SELF", me0.status);
const initialTeam: string | null = me0.json?.favoriteTeam?.id ?? null;
const initialShowcase: string[] = me0.json?.self?.showcaseUids ?? [];
console.log("estado inicial K", { initialTeam, initialShowcase, version: me0.json?.self?.version });

// ── 2 · anónimo ──
const anon = await api(null, `${P}?id=${K}`);
const anonJ = JSON.stringify(anon.json ?? {});
check("anónimo · perfil público 200 PUBLIC", anon.status === 200 && anon.json?.view === "PUBLIC" && anon.json?.self === null);
for (const k of ["email", "credits", "xpIntoLevel", "packsOpened", "privateDuels", "showcaseUids", "featuredBadgeIds", "ownedBadges", "version", "is_admin", "createdAt", "token"]) {
  check(`anónimo · sin «${k}»`, !new RegExp(`"${k}"`).test(anonJ));
}
check("anónimo · sin duelos privados en carrera ni historial", !(anon.json?.career?.stats?.modes ?? []).includes("PRIVATE") && (anon.json?.career?.history?.items ?? []).every((i: any) => i.mode !== "PRIVATE" && i.href === null));
check("anónimo · miembro desde = primer día del mes", typeof anon.json?.memberSince === "number" && new Date(anon.json.memberSince).getUTCDate() === 1 && new Date(anon.json.memberSince).getUTCHours() === 0);
check("anónimo · mutación → 401", (await post(null, { action: "set_favorite_team", teamId: "g2", expectedVersion: null })).status === 401);
const nf = await api(null, `${P}?id=dddddddd-0000-4000-8000-0000000000d4`);
check("usuario inexistente → 404 sin datos", nf.status === 404 && !/@|uuid|stack|Error:/i.test(JSON.stringify(nf.json)), nf.json);
check("id mal formado → 400", (await api(null, `${P}?id=nope`)).status === 400);

// ── 3 · consistencia con la BD (mismas reglas que el competitivo) ──
const dbStats = (modes: string[]) => sql(`select count(*) filter (where l is not null)||','||count(*) filter (where l='W')||','||count(*) filter (where l='L')||','||count(*) filter (where l='D') from (
  select case
    when closed_reason='ABANDONED' then case when closed_by='${K}' then 'L' else 'W' end
    when closed_reason='EXPIRED' then case when closed_by='${K}' then 'L' else 'W' end
    when status in ('IN_PROGRESS','WAITING') then null
    when status='DRAW' then 'D'
    when status='COMPLETED' and winner is not null then case when winner = (case when user_id='${K}' then 'A' else 'B' end) then 'W' else 'L' end
    else null end as l
  from duel_matches where mode in (${modes.map((m) => `'${m}'`).join(",")}) and (user_id='${K}' or player_b_id='${K}')
    and (status in ('COMPLETED','DRAW','UNRESOLVED') or closed_reason is not null)) x;`);
const pubDb = dbStats(["PVP", "PVE", "DRAFT_GAUNTLET"]).split(",").map(Number);
const t = anon.json?.career?.stats?.total ?? {};
check("carrera PÚBLICA = BD (jugadas, V, D, E)", JSON.stringify([t.played, t.wins, t.losses, t.draws]) === JSON.stringify(pubDb), { api: [t.played, t.wins, t.losses, t.draws], db: pubDb });
check("% de victorias = V / (V+D+E)", t.played === 0 ? t.winrate === null : t.winrate === Math.round((t.wins / t.played) * 100), t);
const selfDb = dbStats(["PVP", "PVE", "DRAFT_GAUNTLET", "PVP_PRIVATE"]).split(",").map(Number);
const st = me0.json?.career?.stats?.total ?? {};
check("carrera PROPIA = BD (incluye privados)", JSON.stringify([st.played, st.wins, st.losses, st.draws]) === JSON.stringify(selfDb), { api: [st.played, st.wins, st.losses, st.draws], db: selfDb });
const dbSets = sql(`select (select count(*) from user_collection_completions where user_id='${K}')||','||(select count(*) from collection_sets where status='PUBLISHED')||','||(select count(*) from user_cosmetics where user_id='${K}' and cosmetic_id like 'insignia:%');`).split(",").map(Number);
const col = anon.json?.collections ?? {};
check("colecciones = F82 en BD (completadas, publicadas, insignias)", JSON.stringify([col.setsCompleted, col.publishedSets, col.badgesUnlocked]) === JSON.stringify(dbSets), { api: [col.setsCompleted, col.publishedSets, col.badgesUnlocked], db: dbSets });
const dbCards = sql(`select count(*)||','||count(distinct card_id) from user_cards where user_id='${K}';`).split(",").map(Number);
check("copias / distintas = inventario en BD", JSON.stringify([anon.json?.collection?.instances, anon.json?.collection?.distinct]) === JSON.stringify(dbCards), { api: [anon.json?.collection?.instances, anon.json?.collection?.distinct], db: dbCards });

// ── 4 · historial paginado ──
const h1 = anon.json?.career?.history;
if (h1?.nextBefore) {
  const h2 = await api(null, `${P}?id=${K}&history=1&before=${h1.nextBefore}`);
  const ids = new Set([...h1.items, ...(h2.json?.items ?? [])].map((i: any) => i.matchId));
  check("historial · página 2 por cursor, sin repetidos", h2.status === 200 && ids.size === h1.items.length + (h2.json?.items?.length ?? 0), { p1: h1.items.length, p2: h2.json?.items?.length });
} else check("historial · una sola página (≤ 10)", (h1?.items?.length ?? 0) <= 10, h1?.items?.length);
check("historial · parámetro ajeno (?userId=) → 400", (await api(tQA, `${P}?id=${K}&history=1&userId=${QA}`)).status === 400);
check("historial · cursor inválido → 400", (await api(tQA, `${P}?id=${K}&history=1&before=abc`)).status === 400);

// ── 5 · equipo favorito (K) ──
let v = me0.json?.self?.version ?? null;
const pick = initialTeam === "team-heretics" ? "fnatic" : "team-heretics";
const save1 = await post(tK1, { action: "set_favorite_team", teamId: pick, expectedVersion: v });
check(`K · guardar equipo «${pick}» → SAVED`, save1.status === 200 && save1.json?.code === "SAVED", save1.json);
v = save1.json?.version ?? v;
check("K · BD: favorite_team_id persistido", sql(`select coalesce(favorite_team_id,'∅') from player_profile_customization where user_id='${K}';`) === pick);
check("K · mismo equipo → UNCHANGED", (await post(tK1, { action: "set_favorite_team", teamId: pick, expectedVersion: 0 })).json?.code === "UNCHANGED");
const stale = await post(tK1, { action: "set_favorite_team", teamId: "g2", expectedVersion: (v ?? 1) - 1 });
check("K · versión vieja → 409 CONFLICT", stale.status === 409 && stale.json?.code === "CONFLICT", stale.json);
const [ra, rb] = await Promise.all([post(tK1, { action: "set_favorite_team", teamId: "leviatan", expectedVersion: v }), post(tK2, { action: "set_favorite_team", teamId: "team-liquid", expectedVersion: v })]);
check("K · dos pestañas, misma versión → 1 SAVED + 1 CONFLICT", [ra.json?.code, rb.json?.code].sort().join(",") === "CONFLICT,SAVED", [ra.json, rb.json]);
const winner = ra.json?.code === "SAVED" ? "leviatan" : "team-liquid";
check("K · BD: queda SOLO el ganador", sql(`select favorite_team_id from player_profile_customization where user_id='${K}';`) === winner);
v = Number(sql(`select version from player_profile_customization where user_id='${K}';`));
for (const [bad, why] of [["equipo-inventado", "inexistente"], ["Team Heretics", "nombre"], ["https://evil.example/x.png", "URL"], ["/hints/teams/g2.png", "logo"], [7, "número"], ["drx", "identidad sin fijar"]] as const) {
  const r = await post(tK1, { action: "set_favorite_team", teamId: bad, expectedVersion: v });
  check(`K · equipo inválido (${why}) → 400`, r.status === 400, r.json);
}
check("K · campo extra (userId) → 400", (await post(tK1, { action: "set_favorite_team", teamId: "g2", expectedVersion: v, userId: QA })).status === 400);
const pubK = await api(tQA, `${P}?id=${K}`);
check("QA ve el equipo de K con logo del SISTEMA", pubK.json?.favoriteTeam?.id === winner && pubK.json?.favoriteTeam?.logo === `/hints/teams/${winner}.png`, pubK.json?.favoriteTeam);
check("QA ve el perfil de K como PUBLIC (sin controles ni datos propios)", pubK.json?.view === "PUBLIC" && pubK.json?.self === null);

// ── 6 · cruce de cuentas: QA no puede tocar a K ──
const qaBefore = sql(`select coalesce(favorite_team_id,'∅')||':'||version from player_profile_customization where user_id='${K}';`);
const qaSave = await post(tQA, { action: "set_favorite_team", teamId: "g2", expectedVersion: null });
check("QA · su mutación solo toca SU fila (K intacto)", qaSave.status === 200 && sql(`select coalesce(favorite_team_id,'∅')||':'||version from player_profile_customization where user_id='${K}';`) === qaBefore);
await post(tQA, { action: "set_favorite_team", teamId: null, expectedVersion: null }); // QA vuelve a «sin equipo»

// ── 7 · cartas destacadas e insignias ──
const stK = await api(tK1, "/api/game/state");
const myUid: string | undefined = (stK.json?.ownedCards ?? [])[0]?.uid;
const stQA = await api(tQA, "/api/game/state");
const foreignUid: string | undefined = (stQA.json?.ownedCards ?? [])[0]?.uid;
if (foreignUid) {
  const r = await post(tK1, { action: "set_showcase", cardUids: [foreignUid], expectedVersion: v });
  check("K · destacar la copia de QA → 403 NOT_OWNED", r.status === 403 && r.json?.code === "NOT_OWNED", r.json);
}
check("K · uid inventado → 403", (await post(tK1, { action: "set_showcase", cardUids: ["99999999-0000-4000-8000-000000000009"], expectedVersion: v })).status === 403);
check("K · uid mal formado → 400", (await post(tK1, { action: "set_showcase", cardUids: ["nope"], expectedVersion: v })).status === 400);
if (myUid) {
  check("K · uid repetido → 400", (await post(tK1, { action: "set_showcase", cardUids: [myUid, myUid], expectedVersion: v })).status === 400);
  const r = await post(tK1, { action: "set_showcase", cardUids: [myUid], expectedVersion: v });
  check("K · destacar SU copia → SAVED", r.status === 200 && ["SAVED", "UNCHANGED"].includes(r.json?.code), r.json);
  v = r.json?.version ?? v;
  const pub2 = await api(null, `${P}?id=${K}`);
  check("anónimo ve la carta destacada de K (instancia real)", (pub2.json?.showcase ?? []).some((s: any) => s.uid === myUid));
}
check("K · insignia bloqueada (G2) → 403 LOCKED", (await post(tK1, { action: "set_featured_badges", badgeIds: ["insignia:coleccion:team-g2"], expectedVersion: v })).status === 403);

// ── 8 · navegador ──
const shot = (c: any, n: string) => c.tab.shot(`${OUT}/shots/${n}.png`).catch(() => null);
const kName = creds("K").username as string;
for (const w of [1440, 1024, 390]) {
  const c = await openBrowser("K", w, { label: `f89-prod-K-${w}` });
  try {
    await loginUi(c, "K");
    await c.tab.goto(`${BASE}/jugador/me`, 3000);
    await waitFor(c.tab, `!!document.querySelector('[data-testid="player-hero"]')`, 25000); await sleep(1200);
    const ox = await c.tab.js<number>("document.documentElement.scrollWidth - window.innerWidth");
    check(`K · perfil propio ${w}: sin desbordamiento`, ox <= 0, ox);
    check(`K · perfil propio ${w}: equipo favorito y controles de propietario`, await c.tab.js<boolean>(`!!document.querySelector('[data-testid="favorite-team"]') && !!document.querySelector('[data-action="edit"]')`));
    await shot(c, `K-own-${w}`);
    const hgt = await c.tab.js<number>("document.documentElement.scrollHeight");
    await c.tab.js(`window.scrollTo(0, ${Math.round(hgt * 0.4)})`); await sleep(400); await shot(c, `K-own-${w}-mid`);
    await c.tab.js(`window.scrollTo(0, ${hgt})`); await sleep(400); await shot(c, `K-own-${w}-end`);
    if (w === 1440) {
      await c.tab.js("window.scrollTo(0,0)");
      await c.tab.js(`document.querySelector('[data-action="history-more"]')?.click()`); await sleep(1500);
      check("K · «Cargar más» añade partidas", (await c.tab.js<number>(`Number(document.querySelector('[data-testid="match-history"]')?.dataset.count ?? 0)`)) >= Math.min(10, st.played));
      await c.tab.js(`document.querySelector('[data-action="edit"]').click()`); await sleep(600);
      await c.tab.js(`document.querySelector('[data-tab="team"]')?.click()`); await sleep(500);
      check("K · editor: pestaña «Equipo favorito» con equipos reales", (await c.tab.js<number>(`document.querySelectorAll('[data-team-option]').length`)) > 20);
      await shot(c, "K-editor-team-1440");
    }
  } finally { await c.browser.close().catch(() => null); }
}
for (const w of [1440, 390]) {
  const c = await openBrowser("QA", w, { label: `f89-prod-QA-${w}` });
  try {
    await loginUi(c, "QA");
    await c.tab.goto(`${BASE}/jugador/${K}`, 3000);
    await waitFor(c.tab, `!!document.querySelector('[data-testid="player-hero"]')`, 25000); await sleep(1200);
    check(`QA → perfil de K ${w}: público, sin controles de edición`, await c.tab.js<boolean>(`document.querySelector('[data-scene="player-identity"]')?.dataset.view === 'PUBLIC' && !document.querySelector('[data-action="edit"]') && !document.querySelector('[data-action="manage-badges"]')`));
    check(`QA → perfil de K ${w}: sin desbordamiento`, (await c.tab.js<number>("document.documentElement.scrollWidth - window.innerWidth")) <= 0);
    await shot(c, `QA-views-K-${w}`);
  } finally { await c.browser.close().catch(() => null); }
}
{
  const c = await openBrowser("QA", 1440, { label: "f89-prod-anon" });
  try {
    await c.tab.goto(`${BASE}/jugador/${K}`, 3500);
    await waitFor(c.tab, `!!document.querySelector('[data-testid="player-hero"]')`, 25000); await sleep(1000);
    check("anónimo → perfil de K: se ve, sin controles", await c.tab.js<boolean>(`!document.querySelector('[data-action="edit"]')`));
    await shot(c, "anon-views-K-1440");
  } finally { await c.browser.close().catch(() => null); }
}
// Cambio de cuenta SIN recargar (SPA): K abre su perfil → logout → login QA → enlace «perfil» del menú. Un observador en el
// MISMO documento anota si el nombre de K aparece en algún momento mientras carga el perfil de QA.
{
  const c = await openBrowser("K", 1440, { label: "f89-prod-switch" });
  try {
    await loginUi(c, "K");
    await c.tab.goto(`${BASE}/jugador/me`, 3000);
    await waitFor(c.tab, `!!document.querySelector('[data-testid="player-hero"]')`, 25000);
    check("cambio de cuenta · K ve su perfil", (await c.tab.js<string>(`document.querySelector('[data-scene="player-identity"]')?.dataset.player ?? ''`)) === K);
    await logoutUi(c);
    await loginUi(c, "QA");
    await c.tab.js(`window.__seenK = false; window.__iv = setInterval(() => { const h = document.querySelector('[data-scene="player-identity"]'); if (h && (h.dataset.player === ${JSON.stringify(K)} || h.innerText.toUpperCase().includes(${JSON.stringify(kName.toUpperCase())}))) window.__seenK = true; }, 20);`);
    const clicked = await c.tab.js<boolean>(`(() => { const a = [...document.querySelectorAll('a[href="/jugador/me"]')].find((x) => x.offsetParent); if (!a) return false; a.click(); return true; })()`);
    if (!clicked) await c.tab.js(`location.assign('/jugador/me')`);
    await waitFor(c.tab, `document.querySelector('[data-scene="player-identity"]')?.dataset.player === ${JSON.stringify(QA)}`, 25000); await sleep(1500);
    const seen = await c.tab.js<boolean>("window.__seenK === true").catch(() => null);
    const who = await c.tab.js<string>(`document.querySelector('[data-scene="player-identity"]')?.dataset.player ?? ''`);
    check("cambio de cuenta K → QA (SPA): el perfil es el de QA y nunca se pinta K", who === QA && seen === false, { who: who.slice(0, 8), seen, spa: clicked });
    await shot(c, "switch-K-to-QA-1440");
  } finally { await c.browser.close().catch(() => null); }
}

// ── 9 · restaurar K ── (sesión NUEVA: el logout de la prueba de cambio de cuenta revoca las sesiones anteriores de K)
v = Number(sql(`select version from player_profile_customization where user_id='${K}';`));
const tR = await token("K");
const rt = await post(tR, { action: "set_favorite_team", teamId: initialTeam, expectedVersion: v });
v = rt.json?.version ?? v;
const rs = await post(tR, { action: "set_showcase", cardUids: initialShowcase, expectedVersion: v });
const after = sql(`select coalesce(favorite_team_id,'∅')||'|'||showcase_card_uids::text from player_profile_customization where user_id='${K}';`);
check("K · restaurado (equipo y vitrina iniciales)", after === `${initialTeam ?? "∅"}|{${initialShowcase.join(",")}}` && [rt.json?.code, rs.json?.code].every((x) => x === "SAVED" || x === "UNCHANGED"), { after, rt: rt.json, rs: rs.json });

// ── 10 · regresión de lectura ──
for (const p of ["/", "/coleccion", "/coleccion/trofeos", "/tienda", "/misiones/crafting", "/competitivo", "/progresion", `/jugador/${K}`]) {
  const r = await fetch(`${BASE}${p}`, { redirect: "manual" });
  check(`página ${p} → 200`, r.status === 200, r.status);
}
for (const p of ["/api/game/state", "/api/game/me", "/api/game/competitive", "/api/game/forge", "/api/game/missions", "/api/game/crafting", "/api/game/collection-sets"]) {
  const r = await api(tQA, p);
  check(`API ${p} (QA) → 2xx`, r.status >= 200 && r.status < 300, r.status);
}

writeFileSync(`${OUT}/prod-qa.json`, JSON.stringify({ at: new Date().toISOString(), base: BASE, k: K.slice(0, 8), qa: QA.slice(0, 8), pass: rows.filter((r) => r.ok).length, fail: rows.filter((r) => !r.ok).length, rows }, null, 1));
console.log(`\nTOTAL ${rows.filter((r) => r.ok).length}/${rows.length}`);
process.exitCode = rows.every((r) => r.ok) ? 0 : 1;
