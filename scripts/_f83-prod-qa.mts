/**
 * F83 · QA EN PRODUCCIÓN DE LA RUTA DE TEMPORADA (instrumento, fuera de CI). SOLO cuentas QA. Nada se concede.
 *
 * Con la Temporada 2 en BORRADOR (no activada a propósito), lo verificable en producción es: 0064 aplicada, la ruta
 * responde «sin temporada» con el pase heredado en curso, el borrador es invisible, no hay forma de mandar XP, el
 * reclamo se rechaza sin temporada, el panel exige admin, la UI de /temporada sigue siendo la del pase heredado,
 * la portada y el perfil no inventan nivel, los ganchos no rompen nada y la BD no registra XP.
 *   BASE_URL=https://valorosters.com npx tsx C:/NEXUS-CENTRAL/DRLCards/scripts/_f83-prod-qa.mts   (cwd = prodqa)
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const lib = await import("file:///C:/NEXUS-CENTRAL/DRLCards/scripts/_fase68-lib.ts");
const { mkdirSync, writeFileSync } = await import("node:fs");
const { join } = await import("node:path");
const { execFileSync } = await import("node:child_process");
const { openBrowser, loginUi, sleep, token, api, waitFor, PERSONA_FILES, creds } = lib;
const TMP = process.env.TEMP ?? "C:/Users/david/AppData/Local/Temp";
PERSONA_FILES.QA = join(TMP, "claude/C--NEXUS-CENTRAL-DRLCards/287155d6-0740-47dd-baa7-edb43491b4e3/scratchpad/f45-qa-creds.json");
const BASE = process.env.BASE_URL ?? "";
if (BASE !== "https://valorosters.com") throw new Error("BASE_URL=https://valorosters.com");
const OUT = "C:/NEXUS-CENTRAL/DRLCards/docs/product/qa/f83-season-track/prod";
mkdirSync(`${OUT}/shots`, { recursive: true });
const rows: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail: unknown = "") => { const d = typeof detail === "string" ? detail : JSON.stringify(detail); rows.push({ id, ok, detail: d.slice(0, 700) }); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${d.slice(0, 200)}`); };
const sql = (q: string): string => execFileSync("ssh", ["-i", `${process.env.USERPROFILE}/.ssh/id_ed25519`, "nexusadmin@212.95.40.144", "docker exec -i supabase_db_DRLCards psql -U postgres -d postgres -At -v ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();
const R = "/api/game/season-track";

const ready = await api(null, "/api/ready");
// F86 · se exige que 0064 esté APLICADA (cabeza ≥ 0064 por estado real y su capacidad «seasons» en verde), no que sea la
// última: cada migración posterior compatible (0065…) rompía aquí sin que F83 hubiera cambiado.
const headN = Number(String(ready.json?.migrationHead ?? "").slice(0, 4));
check("ready + 0064 aplicada (cabeza ≥ 0064) + check «seasons»", ready.status === 200 && headN >= 64 && (ready.json?.checks ?? []).some((c: any) => c.id === "seasons" && c.ok), { head: ready.json?.migrationHead });
check("anónimo → 401", (await api(null, R)).status === 401);
const tQA = await token("QA"), tK = await token("K");
const ov = await api(tQA, R);
check("QA · vista 200", ov.status === 200, ov.status);
check("QA · sin temporada de la ruta activa: phase NONE (la T2 es borrador e invisible)", ov.json?.phase === "NONE" && ov.json?.season === null, { phase: ov.json?.phase });
check("QA · explica el pase heredado en curso", ov.json?.legacy?.name === "Temporada 1 · Ascenso", ov.json?.legacy);
check("QA · nada de XP, ni retos, ni reclamables inventados", (ov.json?.track ?? []).length === 0 && ov.json?.daily === null && (ov.json?.claimable ?? []).length === 0 && (ov.json?.recent ?? []).length === 0);
check("parámetro en la URL → 400", (await api(tQA, `${R}?user=${creds("K").userId}`)).status === 400);
const claimDraft = await api(tQA, R, { action: "claim", seasonId: "temporada-2", level: 10 }, true);
check("reclamar en la T2 (borrador/no empezada) → 404", claimDraft.status === 404 && claimDraft.json?.code === "NOT_FOUND", claimDraft.json);
check("reclamar nivel inválido → 400", (await api(tQA, R, { action: "claim", seasonId: "temporada-2", level: 999 }, true)).status === 400);
check("reclamar temporada mal formada → 400", (await api(tQA, R, { action: "claim", seasonId: "../x", level: 1 }, true)).status === 400);
check("«dame XP» (acción inexistente) → 400", (await api(tQA, R, { action: "xp", amount: 999999 }, true)).status === 400);
check("campo extra (userId/amount) → 400", (await api(tQA, R, { action: "claim", seasonId: "temporada-2", level: 10, userId: creds("K").userId }, true)).status === 400);
check("panel de temporadas como usuario normal → 401", [401, 403].includes((await api(tQA, "/api/admin/cms/seasons", undefined, true)).status));
check("publicar como usuario normal → 401", [401, 403].includes((await api(tQA, "/api/admin/cms/seasons", { action: "publish", id: "temporada-2", expectedVersion: 1, confirm: "PUBLICAR" }, true)).status));
const pub = await api(tQA, `/api/game/player?id=${creds("K").userId}`);
check("perfil de K: sin nivel de temporada (no hay temporada activa)", pub.status === 200 && pub.json?.seasonTrack === null);

// BD: borrador intacto, nada registrado.
const db = sql("select (select string_agg(id||':'||status, ',') from public.game_seasons)||'|'||(select count(*) from public.season_events)||'|'||(select count(*) from public.season_xp_ledger)||'|'||(select count(*) from public.season_reward_claims);");
check("BD: temporada-2 DRAFT; 0 eventos, 0 XP, 0 reclamos", db === "temporada-2:DRAFT|0|0|0", db);

// UI
for (const w of [1440, 390]) {
  const c = await openBrowser("QA", w, { label: `f83-prod-${w}` });
  try {
    await loginUi(c, "QA");
    await c.tab.goto(`${BASE}/temporada`, 3500);
    await waitFor(c.tab, `!document.body.textContent.includes('Leyendo la temporada')`, 25000); await sleep(1200);
    const legacyHub = await c.tab.js<boolean>(`!document.querySelector('[data-scene="season-track"]')`);
    check(`/temporada ${w}: sigue el hub del pase heredado (sin ruta F83 activa)`, legacyHub);
    check(`/temporada ${w}: sin desbordamiento`, (await c.tab.js<number>("document.documentElement.scrollWidth - window.innerWidth")) <= 0);
    await c.tab.shot(`${OUT}/shots/temporada-${w}.png`).catch(() => null);
    await c.tab.goto(`${BASE}/`, 3500); await sleep(1500);
    check(`portada ${w}: sin acceso de temporada inventado`, !(await c.tab.js<boolean>(`!!document.querySelector('[data-testid="season-dock"]')`)));
  } finally { await c.browser.close().catch(() => null); }
}

for (const p of ["/", "/temporada", "/coleccion", "/coleccion/trofeos", "/tienda", "/misiones/crafting", "/competitivo", "/progresion", "/admin/seasons", `/jugador/${creds("K").userId}`]) {
  const r = await fetch(`${BASE}${p}`, { redirect: "manual" });
  check(`página ${p} → 200`, r.status === 200, r.status);
}
for (const p of ["/api/game/state", "/api/game/me", "/api/game/competitive", "/api/game/forge", "/api/game/missions", "/api/game/crafting", "/api/game/collection-sets", "/api/game/daily-loop"]) {
  const r = await api(tK, p);
  check(`API ${p} (K) → 2xx`, r.status >= 200 && r.status < 300, r.status);
}
writeFileSync(`${OUT}/prod-qa.json`, JSON.stringify({ at: new Date().toISOString(), base: BASE, pass: rows.filter((r) => r.ok).length, fail: rows.filter((r) => !r.ok).length, rows }, null, 1));
console.log(`\nTOTAL ${rows.filter((r) => r.ok).length}/${rows.length}`);
process.exitCode = rows.every((r) => r.ok) ? 0 : 1;
