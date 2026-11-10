/**
 * QA EN PRODUCCIÓN · RESULTADO DE PARTIDA RÁPIDA (instrumento, fuera de CI). SOLO la cuenta QA A (f45); nunca la personal.
 *
 *   BASE_URL=https://valorosters.com npx tsx C:/NEXUS-CENTRAL/DRLCards/scripts/_quick-result-prod.mts   (cwd = prodqa)
 *
 * 1 · juega una PARTIDA RÁPIDA real por la API (mismo flujo que el cliente) → la jugada final trae `context: "QUICK"`;
 * 2 · el servidor la PAGÓ según sus reglas (créditos/XP de la BD antes/después = `result.award`, libro con la partida);
 * 3 · Chrome real logueado: `/duelos/jugar?resultado=<id>` (recarga sobre el resultado) a 1440/1024/390 (+390 reducido):
 *     resultado mínimo, dos botones, nada de recompensas/progreso, sin desbordamiento;
 * 4 · SEGUIR JUGANDO con DOBLE clic → UNA partida rápida nueva (BD), que se abandona después (limpieza, no paga);
 * 5 · VOLVER AL MENÚ PRINCIPAL → `/`.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const qa = await import("file:///C:/NEXUS-CENTRAL/DRLCards/scripts/multiplayer/_qa.ts");
const lib = await import("file:///C:/NEXUS-CENTRAL/DRLCards/scripts/_fase68-lib.ts");
const { mkdirSync, writeFileSync } = await import("node:fs");
const { execFileSync } = await import("node:child_process");
const { login, api, sleep, QA_FILES } = qa;
const { openBrowser, loginUi, waitFor, PERSONA_FILES } = lib;
if ((process.env.BASE_URL ?? "") !== "https://valorosters.com") throw new Error("BASE_URL=https://valorosters.com");
const BASE = process.env.BASE_URL!;
const OUT = "C:/NEXUS-CENTRAL/DRLCards/docs/product/qa/quick-result/prod";
mkdirSync(`${OUT}/shots`, { recursive: true });
PERSONA_FILES.QA_A = QA_FILES.A;
const rows: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail: unknown = "") => { const d = typeof detail === "string" ? detail : JSON.stringify(detail); rows.push({ id, ok, detail: (d ?? "").slice(0, 600) }); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${(d ?? "").slice(0, 220)}`); };
const sql = (q: string): string => execFileSync("ssh", ["-i", `${process.env.USERPROFILE}/.ssh/id_ed25519`, "nexusadmin@212.95.40.144", "docker exec -i supabase_db_DRLCards psql -U postgres -d postgres -At -v ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();
const D = "/api/game/duel";
const FORBIDDEN = /Puntos de rango|Créditos|XP de cuenta|Ver progreso|Objetivo|Logro|Reclamar|Temporada|Misi[oó]n|Recompensa/i;

const A = await login("A");
const wallet = () => sql(`select credits||'|'||xp from profiles where id='${A.userId}';`);

// 0 · sin partida PvE colgando de antes
const act = await api(A, D, { action: "active" });
if (act.json?.view?.matchId) await api(A, D, { action: "abandon", matchId: act.json.view.matchId });

// 1 · partida rápida real
const decks = (await api(A, "/api/game/duels")).json;
const deck = (decks?.decks ?? []).find((d: any) => d.valid && d.id === decks.activeDeckId) ?? (decks?.decks ?? []).find((d: any) => d.valid);
check("QA A tiene un equipo legal", !!deck, deck?.id ?? null);
const before = wallet();
const s = await api(A, D, { action: "start", deckId: deck.id, difficulty: "NORMAL" });
let v = s.json?.view;
check("partida rápida creada (PVE)", s.status === 200 && !!v?.matchId, s.status);
const contexts: (string | undefined)[] = [];
for (let k = 0; k < 24 && v?.status === "IN_PROGRESS"; k++) {
  const r = await api(A, D, { action: "play", matchId: v.matchId, cardUid: v.yourHand[0].uid, stat: v.youAreAttacker ? "stronghold" : undefined, expectedVersion: v.stateVersion });
  if (r.status !== 200) { await sleep(400); const st = await api(A, D, { action: "state", matchId: v.matchId }); v = st.json?.view; continue; }
  v = r.json.view;
  contexts.push(v.context);
}
const mid = v.matchId as string;
check("la partida terminó", v.status !== "IN_PROGRESS", v.status);
check("SERVIDOR · la jugada final trae context QUICK; en curso, sin contexto", v.context === "QUICK" && contexts.slice(0, -1).every((c) => c === undefined), contexts);
const kind = v.result?.isDraw ? "draw" : v.result?.winner === "YOU" ? "win" : "loss";
const reread = await api(A, D, { action: "state", matchId: mid });
check("SERVIDOR · releer el resultado (F5) conserva QUICK", reread.json?.view?.context === "QUICK");

// 2 · el pago sigue igual (el cambio es solo de pantalla)
await sleep(800);
const after = wallet();
const [c0, x0] = before.split("|").map(Number), [c1, x1] = after.split("|").map(Number);
const award = v.result?.award ?? { credits: 0, xp: 0, points: 0 };
check("BACKEND · créditos y XP de cuenta cambiaron EXACTAMENTE lo que dice result.award (reglas actuales)", c1 - c0 === award.credits && x1 - x0 === award.xp, { before, after, award });
const ledger = sql(`select count(*) from credit_transactions where user_id='${A.userId}' and ref like '%${mid}%';`);
check("BACKEND · asiento del libro para la partida (si hubo créditos)", award.credits > 0 ? Number(ledger) >= 1 : true, { ledger, credits: award.credits });
// Misiones: el motor registra la partida por `event_key` = match:<id> (solo si hay misiones publicadas que la evalúen).
const missions = sql(`select count(*) from mission_events where event_key like '%${mid}%';`).trim();
check("BACKEND · motor de misiones: consulta del rastro de la partida (informativo: depende de misiones publicadas)", /^\d+$/.test(missions), missions);

// 3 · pantalla REAL en Chrome
for (const [w, reduced] of [[1440, false], [1024, false], [390, false], [390, true]] as const) {
  const c = await openBrowser("QA_A", w, { reduced, label: `qr-${w}${reduced ? "-r" : ""}` });
  try {
    const okLogin = await loginUi(c, "QA_A");
    await c.tab.goto(`${BASE}/duelos/jugar?resultado=${mid}`, 3000);
    const shown = await waitFor(c.tab, `!!document.querySelector('[data-result="quick"]')`, 30000);
    await sleep(reduced ? 500 : 1600);
    const f = await c.tab.js<any>(`(() => { const box = document.querySelector('[data-scene="result"]'); const acts = [...document.querySelectorAll('[data-testid="result-actions"] a, [data-testid="result-actions"] button')]; const a = document.querySelector('[data-testid="result-actions"]'); let after = 0; for (let e = a && a.nextElementSibling; e; e = e.nextElementSibling) after++;
      return { kind: box && box.dataset.kind, text: box ? box.textContent : '', acts: acts.map((x) => { const b = x.getBoundingClientRect(); return { t: x.textContent.trim(), top: b.top, bottom: b.bottom }; }), vh: innerHeight, overflow: document.documentElement.scrollWidth - innerWidth, after, url: location.pathname + location.search, sweep: !!document.querySelector('.nx-result-sweep'), fullResult: !!document.querySelector('[aria-label="Recompensa del duelo"]') }; })()`);
    const tag = `${w}${reduced ? " reducido" : ""}`;
    check(`${tag} · login + resultado REAL de partida rápida tras recargar`, okLogin && shown && f.kind === kind, { kind: f.kind, expected: kind, url: f.url });
    check(`${tag} · veredicto + marcador + motivo + DOS botones; nada de recompensas/progreso`, f.acts.length === 2 && /Seguir jugando/i.test(f.acts[0].t) && /Volver al menú principal/i.test(f.acts[1].t) && !FORBIDDEN.test(f.text) && !f.fullResult && f.after === 0, { acts: f.acts.map((a: any) => a.t), forbidden: f.text.match(FORBIDDEN) });
    check(`${tag} · botones en la primera pantalla y sin desbordamiento`, f.acts.every((a: any) => a.bottom <= f.vh) && f.overflow <= 0, { acts: f.acts, vh: f.vh, overflow: f.overflow });
    if (w === 390) check(`${tag} · botones apilados`, f.acts[1].top >= f.acts[0].bottom - 1, f.acts);
    if (reduced) check(`${tag} · movimiento reducido: sin barrido`, !f.sweep);
    await c.tab.shot(`${OUT}/shots/result-${kind}-${w}${reduced ? "-reduced" : ""}.png`).catch(() => null);

    if (w === 1440) {
      // 4 · SEGUIR JUGANDO con doble clic → UNA partida nueva
      const t0 = sql("select to_char(now() at time zone 'utc','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"');");
      await c.tab.js(`(() => { const b = document.querySelector('[data-action="continue"]'); b.click(); b.click(); })()`);
      const left = await waitFor(c.tab, `!document.querySelector('[data-result="quick"]')`, 20000);
      await sleep(2500);
      const fresh = sql(`select string_agg(id::text||':'||mode||':'||status, ',') from duel_matches where user_id='${A.userId}' and created_at > '${t0}';`);
      const list = fresh ? fresh.split(",") : [];
      check("SEGUIR JUGANDO (doble clic) → UNA partida rápida nueva (PVE, en curso), sin ranked/amistoso/torneo", left && list.length === 1 && /:PVE:IN_PROGRESS$/.test(list[0]), list);
      await c.tab.shot(`${OUT}/shots/continue-1440.png`).catch(() => null);
      const fid = list[0]?.split(":")[0];
      check("la nueva partida no es la anterior", !!fid && fid !== mid, { fid, mid });
      if (fid) { await api(A, D, { action: "abandon", matchId: fid }); }
      // Solo PvE sin cerrar (la cuenta QA A arrastra una fila PvP de F66 de 2026-09-26 cerrada como EXPIRED: no es de esta QA).
      const live = sql(`select count(*) from duel_matches where user_id='${A.userId}' and mode='PVE' and status='IN_PROGRESS';`);
      check("limpieza: la partida nueva se abandonó (no paga, sin partidas vivas)", live === "0", live);
    }
    if (w === 390 && !reduced) {
      // 5 · VOLVER AL MENÚ PRINCIPAL
      await c.tab.js(`document.querySelector('[data-action="menu"]').click()`);
      const home = await waitFor(c.tab, `location.pathname === '/'`, 15000);
      check("VOLVER AL MENÚ PRINCIPAL → /", home, await c.tab.js<string>("location.pathname"));
    }
  } finally { await c.browser.close().catch(() => null); }
}

const failed = rows.filter((r) => !r.ok);
writeFileSync(`${OUT}/prod-qa.json`, JSON.stringify({ base: BASE, at: new Date().toISOString(), release: "drl-0.1.1-1-1a261ed8", match: mid, kind, total: rows.length, passed: rows.length - failed.length, failed: failed.length, rows }, null, 1));
console.log(`\nQUICK RESULT PROD: ${rows.length - failed.length}/${rows.length}`);
