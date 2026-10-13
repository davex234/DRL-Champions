/**
 * F87 · QA EN PRODUCCIÓN DEL PANEL /admin/pickems sobre el BORRADOR REAL (instrumento, fuera de CI). SIN escrituras de
 * contenido: solo lectura del panel, un intento de PUBLICAR que el validador debe rechazar (409) y una VISTA PREVIA (no
 * guarda). La cuenta QA recibe admin TEMPORAL por operador (0067: bandera `drl.admin_writer` + auditoría GRANT_ADMIN,
 * actor nulo) y se le retira al terminar (REVOKE_ADMIN), pase lo que pase. Admins finales: davex y ValoRosters.
 *
 *   QA_CREDS_DIR=… QA_SB=… QA_ANON=… BASE_URL=https://valorosters.com npx tsx scripts/_f87-admin-prod.mts
 */
const lib = await import("file:///C:/NEXUS-CENTRAL/DRLCards/scripts/_fase68-lib.ts");
const { openBrowser, loginUi, sleep, creds, waitFor } = lib;
const { execFileSync } = await import("node:child_process");
const { mkdirSync, writeFileSync } = await import("node:fs");
const BASE = process.env.BASE_URL!;
const OUT = process.env.F87_ADMIN_OUT ?? "C:/NEXUS-CENTRAL/DRLCards/docs/product/qa/pickems-2/admin"; // F87.1: F87_ADMIN_OUT para no pisar la evidencia de F87
mkdirSync(`${OUT}/shots`, { recursive: true });
const rows: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail: unknown = "") => { const d = typeof detail === "string" ? detail : JSON.stringify(detail); rows.push({ id, ok, detail: d.slice(0, 500) }); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${d.slice(0, 200)}`); };
const sql = (q: string): string => execFileSync("ssh", ["-i", `${process.env.USERPROFILE}/.ssh/id_ed25519`, "nexusadmin@212.95.40.144", "docker exec -i supabase_db_DRLCards psql -U postgres -d postgres -At -v ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();
const qa = creds("QA");
if (["2f86cbe8", "3befce61", "b7ccff02"].some((p) => qa.userId.startsWith(p))) throw new Error("CUENTA REAL");
const ADMINS = "3befce61#NB2Z9BM,b7ccff02#H5ND8K7";
const admins = () => sql("select string_agg(left(id::text,8)||'#'||public_tag, ',' order by id) from profiles where is_admin;");
check("antes: admins = davex y ValoRosters", admins() === ADMINS, admins());

const TEST_EDGES = [
  { from: "754732", to: "754738", source: "LOSER", slot: 1 }, { from: "754733", to: "754738", source: "LOSER", slot: 2 },
  { from: "754730", to: "754739", source: "LOSER", slot: 1 }, { from: "754731", to: "754739", source: "LOSER", slot: 2 },
  { from: "754734", to: "754741", source: "LOSER", slot: null }, { from: "754735", to: "754740", source: "LOSER", slot: null },
];

sql(`begin; select set_config('drl.admin_writer','on',true); update public.profiles set is_admin = true where id = '${qa.userId}';
insert into public.content_audit_log (actor, action, entity_type, entity_id, detail) values (null, 'GRANT_ADMIN', 'user', '${qa.userId}', '{"via":"operator","why":"F87 QA del panel de Pick''ems (temporal)"}'); commit;`);
const c = await openBrowser("QA", 1440, { label: "f87-admin" });
try {
  check("login QA (admin temporal)", await loginUi(c, "QA"));
  const tok = await c.tab.js<string>(`(() => { const k = Object.keys(localStorage).find(k => /^sb-.+-auth-token/.test(k)); return k ? JSON.parse(localStorage.getItem(k)).access_token : ''; })()`);
  const api = async (path: string, body?: unknown) => {
    const r = await fetch(`${BASE}${path}`, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => null) as any };
  };
  const list = await api("/api/admin/pickems");
  const draft = (list.json?.brackets ?? []).find((b: any) => b.slug === "champions-2026-playoffs");
  check("admin · lista con el borrador real", list.status === 200 && draft?.status === "DRAFT" && draft?.rewardsStatus === "DRAFT", { status: list.status, draft });
  check("admin · estado del worker visible (último éxito reciente)", !!list.json?.sync?.lastSuccessAt, list.json?.sync?.lastSuccessAt);
  const det = await api(`/api/admin/pickems?id=${draft.id}`);
  const codes = (det.json?.issues ?? []).filter((i: any) => i.severity === "ERROR").map((i: any) => i.code);
  check("admin · validador: 6 perdedores sin destino + 4 huecos del cuadro bajo", codes.filter((x: string) => x === "LOSER_MISSING").length === 6 && codes.filter((x: string) => x === "SLOT_UNKNOWN").length === 4, codes);
  check("admin · no publicable", det.json?.canPublish === false);
  check("admin · deriva: lo guardado = lo que hoy dice la fuente", det.json?.drift?.changed === false, det.json?.drift);
  check("admin · economía: escalones y pasivo (1.000 jugadores = 20.000.000)", det.json?.economy?.maxTierValue === 20000 && det.json?.economy?.worstCase1000 === 20000000, det.json?.economy?.perTier);
  check("admin · cuadro incompleto: SIN simulación engañosa y con aviso explícito", (det.json?.economy?.simulation ?? []).length === 0 && (det.json?.economy?.warnings ?? []).some((w: string) => /cuadro completo/.test(w)), det.json?.economy?.warnings);
  const pub = await api("/api/admin/pickems", { action: "publish", id: draft.id, version: det.json?.bracket?.version });
  check("PUERTA · publicar con el validador en rojo → 409 (sin publicar)", pub.status === 409, pub.json);
  check("PUERTA · sigue en BORRADOR", sql("select status from pickem_brackets where slug='champions-2026-playoffs';") === "DRAFT");
  const prev = await api("/api/admin/pickems", { action: "preview", fields: { eventId: "vlr-2766", stageIds: det.json?.bracket?.stage_ids, adminEdges: TEST_EDGES } });
  check("vista previa (NO guarda) con 6 aristas de prueba: el validador queda limpio", prev.status === 200 && prev.json?.canPublish === true, (prev.json?.issues ?? []).filter((i: any) => i.severity === "ERROR"));
  check("vista previa no guardó nada (checksum intacto)", sql("select descriptor_checksum from pickem_brackets where slug='champions-2026-playoffs';") === det.json?.bracket?.descriptor_checksum);
  const bad = await api("/api/admin/pickems", { action: "preview", fields: { eventId: "vlr-2766", stageIds: det.json?.bracket?.stage_ids, adminEdges: [{ from: "754732", to: "754734", source: "WINNER", slot: 1 }] } });
  check("admin no puede contradecir a la fuente (ADMIN_CONTRADICTS_SOURCE)", (bad.json?.issues ?? []).some((i: any) => i.code === "ADMIN_CONTRADICTS_SOURCE"), bad.status);

  // ── F87.1 · corte de autoridad: LEGACY visible, autoridad por evento y activación imposible aquí ───────────────────
  const legacy = list.json?.legacy ?? [];
  check("F87.1 · lista: Pick'ems clásicos (LEGACY) aparte, los 3 LEGACY_V1", legacy.length === 3 && legacy.every((l: any) => l.legacyMode === "LEGACY_V1"), legacy.map((l: any) => `${l.eventId}:${l.legacyMode}:${l.status}:pagos=${l.rewardsPaid}`));
  check("F87.1 · detalle: autoridad legacy en vlr-2766 y bloqueo de activación que lo dice", det.json?.legacyAuthority === true && (det.json?.activationBlockers ?? []).some((b: string) => /legacy/.test(b)), det.json?.activationBlockers);
  const { rewardRulesV1 } = await import("file:///C:/NEXUS-CENTRAL/DRLCards/src/domain/pickems/bracketRewards.ts");
  const fp = () => sql("select rewards_status||'|'||rewards_version||'|'||coalesce(rewards_checksum,'-')||'|'||version from pickem_brackets where slug='champions-2026-playoffs';");
  const before = fp();
  const noAck = await api("/api/admin/pickems", { action: "rewards", id: draft.id, rewardsVersion: det.json?.bracket?.rewards_version, rewards: rewardRulesV1("champions-2026-playoffs", "ACTIVE"), rewardsStatus: "ACTIVE", ack: false });
  check("F87.1 · PUERTA · activar sin confirmación → 400", noAck.status === 400, noAck.json);
  const withAck = await api("/api/admin/pickems", { action: "rewards", id: draft.id, rewardsVersion: det.json?.bracket?.rewards_version, rewards: rewardRulesV1("champions-2026-playoffs", "ACTIVE"), rewardsStatus: "ACTIVE", ack: true });
  check("F87.1 · PUERTA · activar reglas v1 CON confirmación en un evento legacy → 409 (autoridad legacy)", withAck.status === 409 && /legacy/i.test(String(withAck.json?.error)), withAck.json);
  check("F87.1 · nada cambió: recompensas siguen en BORRADOR, misma versión y checksum", fp() === before && before.startsWith("DRAFT|"), { before, after: fp() });
  check("F87.1 · BD: 0 Pick'ems 2.0 con recompensas ACTIVAS y 0 publicados", sql("select count(*) filter (where rewards_status='ACTIVE')||'|'||count(*) filter (where status='PUBLISHED') from pickem_brackets;") === "0|0");

  // ── F87.2 · preparación de lanzamiento canónica + elegibilidad para cobrar (lectura) ─────────────────────────
  const L = det.json?.launch;
  const gate = (id: string) => (L?.gates ?? []).find((g: any) => g.id === id);
  check("F87.2 · detalle: preparación con 8 puertas y tres estados", (L?.gates ?? []).length === 8 && ["READY", "NOT_READY"].includes(L?.structure) && !!L?.launch, { structure: L?.structure, rewards: L?.rewards, launch: L?.launch });
  check("F87.2 · Champions: NO LISTO; estructura en rojo por los cruces de perdedor", L?.structure === "NOT_READY" && L?.launch === "NOT_READY" && gate("STRUCTURE")?.state === "FAIL" && /LOSER_MISSING/.test((gate("STRUCTURE")?.blockers ?? []).join(" ")), gate("STRUCTURE")?.blockers?.slice(0, 2));
  check("F87.2 · Champions: colisión legacy en rojo con su motivo", gate("LEGACY")?.state === "FAIL" && /autoridad legacy/.test((gate("LEGACY")?.blockers ?? []).join(" ")));
  check("F87.2 · bloqueos concretos (nada de «inválido» genérico)", (L?.rewardedBlockers ?? []).length > 0 && (L?.rewardedBlockers ?? []).every((b: string) => /^(Estructura|Fuente|Cierres|Puntuación|Recompensas|Economía|Colisión legacy|Tiempo): .{12,}/.test(b)), (L?.rewardedBlockers ?? []).slice(0, 3));
  check("F87.2 · elegibilidad visible para el admin (política + recuento, sin datos personales)", det.json?.eligibility && "policy" in det.json.eligibility && !JSON.stringify(det.json.eligibility).match(/[0-9a-f]{8}-[0-9a-f]{4}-/), det.json?.eligibility);
  check("F87.2 · BD: política v1 registrada (7 días / 3 partidas) y Champions sigue BORRADOR", sql("select (public._pickem_eligibility_policy('reward-eligibility-v1')->>'minAccountAgeDays')||'/'||(public._pickem_eligibility_policy('reward-eligibility-v1')->>'minCompletedMatches')||'|'||(select status||'/'||rewards_status from pickem_brackets where slug='champions-2026-playoffs');") === "7/3|DRAFT/DRAFT");
  for (const w of [1440, 1024, 390]) {
    await c.tab.resize(w, w < 600 ? 844 : w <= 1024 ? 768 : 900, 1);
    await c.tab.goto(`${BASE}/admin/pickems`, 3000);
    await waitFor(c.tab, `!!document.querySelector('[data-slug="champions-2026-playoffs"]')`, 30000);
    await c.tab.js(`document.querySelector('[data-slug="champions-2026-playoffs"]').click()`);
    await waitFor(c.tab, `!!document.querySelector('[data-testid="pickem-detail"]')`, 30000); await sleep(1200);
    const ox = await c.tab.js<number>("document.documentElement.scrollWidth - window.innerWidth");
    check(`panel ${w}: sin desbordamiento de página`, ox <= 0, ox);
    const lp = await c.tab.js<{ structure: string | null; launch: string | null; gates: number; failText: string; elig: string }>(`(() => { const p = document.querySelector('[data-testid="pickem-launch"]'); return { structure: p?.getAttribute('data-structure') ?? null, launch: p?.getAttribute('data-launch') ?? null, gates: document.querySelectorAll('[data-testid="pickem-launch-gates"] > li').length, failText: [...document.querySelectorAll('[data-testid="pickem-launch-gates"] > li[data-state="FAIL"]')].map(l => l.innerText.split('\\n')[0]).join(' | '), elig: document.querySelector('[data-testid="pickem-eligibility-admin"]')?.innerText ?? '' }; })()`);
    check(`F87.2 · panel ${w}: «Preparación de lanzamiento» NO LISTO con puertas ✓/✕ legibles y elegibilidad`, lp.structure === "NOT_READY" && lp.launch === "NOT_READY" && lp.gates === 8 && /✕/.test(lp.failText) && /Elegibilidad para cobrar/.test(lp.elig), lp);
    await c.tab.js(`document.querySelector('[data-testid="pickem-launch"]')?.scrollIntoView({ block: 'start' })`); await sleep(400);
    await c.tab.shot(`${OUT}/shots/admin-launch-${w}.png`).catch(() => null);
    check(`F87.1 · panel ${w}: Pick'ems clásicos (LEGACY) aparte y aviso de autoridad legacy en el detalle`, await c.tab.js<boolean>(`!!document.querySelector('[data-testid="admin-legacy-pickems"]') && !!document.querySelector('[data-testid="pickem-legacy-authority"]') && /Pick'ems 2\\.0/.test(document.querySelector('[data-testid="pickem-detail"]').innerText)`));
    check(`panel ${w}: errores del validador visibles y «Publicar» deshabilitado`, await c.tab.js<boolean>(`(() => { const b = document.querySelector('[data-testid="pickem-publish"]'); return !!document.querySelector('[data-testid="pickem-issues"]') && !!b && b.disabled; })()`));
    await c.tab.shot(`${OUT}/shots/admin-draft-${w}.png`).catch(() => null);
    await c.tab.js(`document.querySelector('[data-testid="pickem-economy"]')?.scrollIntoView({ block: 'center' })`); await sleep(400);
    await c.tab.shot(`${OUT}/shots/admin-economy-${w}.png`).catch(() => null);
  }
} finally {
  await c.browser.close();
  sql(`begin; select set_config('drl.admin_writer','on',true); update public.profiles set is_admin = false where id = '${qa.userId}';
insert into public.content_audit_log (actor, action, entity_type, entity_id, detail) values (null, 'REVOKE_ADMIN', 'user', '${qa.userId}', '{"via":"operator","why":"fin de la QA F87 del panel"}'); commit;`);
  check("después: admin QA revocado; admins = davex y ValoRosters", admins() === ADMINS, admins());
  const failed = rows.filter((r) => !r.ok);
  writeFileSync(`${OUT}/admin-prod.json`, JSON.stringify({ at: new Date().toISOString(), total: rows.length, passed: rows.length - failed.length, rows }, null, 1));
  console.log(`\nF87 ADMIN PROD: ${rows.length - failed.length}/${rows.length}`);
}
