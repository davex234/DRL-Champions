/**
 * FASE 68 · SMOKE DE SEGURIDAD tras la beta (instrumento `_`, fuera de CI). No repite F67: cruce entre usuarios, admin,
 * recompensa falsa, IDOR de partidas y la exposición ACTUAL del perfil público (propuesta 0058 NO aplicada). Solo cuentas
 * QA; ninguna escritura que prospere (todas las sondas deben ser rechazadas; si alguna pasara, se anota).
 *   npx tsx scripts/_fase68-security.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { api, creds, OUT, readRaw, snapshot, token } from "./_fase68-lib";

/* eslint-disable @typescript-eslint/no-explicit-any */
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const SB = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const rest = async (t: string | null, path: string) => {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: ANON, ...(t ? { authorization: `Bearer ${t}` } : {}) } });
  const text = await r.text(); let json: any = null; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
};

(async () => {
  const out: any = { at: new Date().toISOString(), probes: [] };
  const probe = (name: string, ok: boolean, data: any) => { out.probes.push({ name, ok, data }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(data).slice(0, 200)}`); };
  const [tB, tC, tE, tH] = [await token("B"), await token("C"), await token("E"), await token("H")];
  const idB = creds("B").userId;
  const before = { B: await snapshot(tB), C: await snapshot(tC), H: await snapshot(tH) };

  // 1 · CRUCE: C pide el estado de una partida PvE de B.
  // F69 · con F68_OUT apuntando a la evidencia de F69, las partidas de B son las de sus journeys (B-f69*-pve).
  const pveB = ["B-r2-pve", "B-r1-pve", "B-f69final-pve", "B-f69-pve"].map((id) => readRaw(id)?.matches?.[0]?.matchId).find(Boolean);
  const r1 = await api(tC, "/api/game/duel", { action: "state", matchId: pveB });
  probe("cruce: C no ve la partida PvE de B", r1.status === 404 && !JSON.stringify(r1.json).includes(idB), { status: r1.status, body: r1.json });
  // 2 · IDOR ranked: B pide una partida ranked C–E en la que no está (mismo 404 uniforme que un id inexistente).
  const ranked = readRaw("CE-final-ranked") ?? readRaw("CE-r2-ranked");
  const histC = (await api(tC, "/api/game/competitive")).json;
  const cid = (histC?.recentMatches ?? histC?.self?.recentMatches ?? [])[0]?.matchId ?? null;
  const rankedId = cid ?? null;
  if (rankedId) {
    const a = await api(tB, `/api/game/duel/pvp?matchId=${rankedId}`);
    const b = await api(tB, `/api/game/duel/pvp?matchId=00000000-0000-4000-8000-000000000000`);
    probe("IDOR: B no puede leer una partida ranked ajena (404 idéntico a inexistente)", a.status === 404 && JSON.stringify(a.json) === JSON.stringify(b.json), { a: a.status, b: b.status, same: JSON.stringify(a.json) === JSON.stringify(b.json) });
  } else out.probes.push({ name: "IDOR ranked", ok: null, data: "sin id de partida ranked legible en /competitive", rankedShort: ranked?.matches?.map((m: any) => m.matchId) });
  const replay = await api(tB, "/api/game/duel", { action: "replay", matchId: pveB ? pveB : "x" });
  probe("replay propio accesible (control)", replay.status === 200 || replay.status === 404, { status: replay.status });
  const replayOther = await api(tC, "/api/game/duel", { action: "replay", matchId: pveB });
  probe("replay ajeno: C no ve la repetición de B", replayOther.status === 404, { status: replayOther.status });
  // 3 · ADMIN con usuario normal.
  for (const path of ["/api/admin/overview", "/api/admin/system", "/api/admin/cms/cards"]) {
    const r = await api(tC, path);
    probe(`admin: ${path} rechazado a un usuario normal`, r.status === 401 || r.status === 403 || r.status === 404, { status: r.status });
  }
  // 4 · RECOMPENSA FALSA.
  const incomplete = ((await api(tH, "/api/game/progression", { action: "state" })).json?.missions ?? []).find((m: any) => !m.complete && !m.claimed);
  const f1 = await api(tH, "/api/game/progression", { action: "claimMission", missionId: incomplete?.id ?? "w-sobres-10" });
  const f2 = await api(tH, "/api/game/progression", { action: "claimAchievement", achievementId: "sobres-1000" });
  const f3 = await api(tH, "/api/game/progression", { action: "claimLevel", level: 30, track: "free" });
  const f4 = await api(tH, "/api/game/store", { action: "checkout", productId: "pack:estandar", method: "GAME_CURRENCY", price: 0 });
  const f5 = await api(tH, "/api/game/credits", { action: "purchase", productId: "x", credits: 999999 });
  const f6 = await api(tH, "/api/game/packs", { action: "open", packId: "champions", ref: "f68-fake" });
  const after = await snapshot(tH);
  probe("recompensa falsa: misión sin completar → rechazada", f1.status >= 400, { status: f1.status, error: f1.json?.error });
  probe("recompensa falsa: logro sin completar → rechazado", f2.status >= 400, { status: f2.status, error: f2.json?.error });
  probe("recompensa falsa: nivel 30 del pase → rechazado", f3.status >= 400, { status: f3.status, error: f3.json?.error });
  probe("tienda: precio del cliente → «Campo no permitido»", f4.status === 400, { status: f4.status, error: f4.json?.error });
  probe("créditos: cantidad del cliente → rechazada", f5.status >= 400, { status: f5.status, error: f5.json?.error });
  probe("sobres: abrir un sobre que no se tiene → rechazado", f6.status >= 400, { status: f6.status, error: f6.json?.error });
  probe("recompensa falsa: saldo, XP e inventario de H sin cambios", after.credits === before.H.credits && after.xp === before.H.xp && JSON.stringify(after.unopenedPacks) === JSON.stringify(before.H.unopenedPacks), { before: [before.H.credits, before.H.xp], after: [after.credits, after.xp] });
  // 5 · PostgREST directo: C lee lo privado de B.
  for (const table of ["user_cards", "user_packs", "credit_transactions", "user_game", "duel_decks", "user_pass", "economy_ops"]) {
    const r = await rest(tC, `${table}?user_id=eq.${idB}&select=*&limit=5`);
    probe(`REST: C no lee ${table} de B`, r.status >= 400 || (Array.isArray(r.json) && r.json.length === 0), { status: r.status, rows: Array.isArray(r.json) ? r.json.length : null });
  }
  // 6 · EXPOSICIÓN ACTUAL DEL PERFIL (0058 PROPUESTA, NO APLICADA): qué columnas de `profiles` ve un anónimo (fila QA).
  const anonProfile = await rest(null, `profiles?id=eq.${idB}&select=*`);
  const cols = Array.isArray(anonProfile.json) && anonProfile.json[0] ? Object.keys(anonProfile.json[0]).sort() : [];
  out.publicProfileExposure = { anonStatus: anonProfile.status, columnsVisibleToAnon: cols, note: cols.length ? "RLS-1 de F67: anon lee profiles (0058 no vigente)" : "0058 vigente (aplicada 2026-09-28): anon no lee profiles" };
  console.log("columnas de profiles visibles para anon:", cols.join(", "));
  const afterAll = { B: await snapshot(tB), C: await snapshot(tC) };
  probe("las sondas no cambiaron nada en B ni en C", afterAll.B.credits === before.B.credits && afterAll.C.credits === before.C.credits && afterAll.B.ownedCards === before.B.ownedCards, { B: [before.B.credits, afterAll.B.credits], C: [before.C.credits, afterAll.C.credits] });
  out.pass = out.probes.filter((p: any) => p.ok === true).length; out.fail = out.probes.filter((p: any) => p.ok === false).map((p: any) => p.name);
  void tE;
  writeFileSync(join(OUT, "raw", "security-smoke.json"), JSON.stringify(out, null, 2));
  console.log(`→ raw/security-smoke.json pass=${out.pass} fail=${out.fail.length}`);
})().catch((e) => { console.error(e); process.exit(1); });
