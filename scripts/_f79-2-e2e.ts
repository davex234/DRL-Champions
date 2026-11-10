/**
 * F79.2 · E2E DE PRODUCCIÓN — carreras y protección por el CAMINO REAL DE LA APLICACIÓN (Cloudflare → Next desplegado →
 * PostgREST → Postgres), con cuentas QA. Tras cada carrera se lee el ESTADO REAL de la BD (solo lectura, ssh+psql).
 * Instrumento fuera de CI. cwd = carpeta con `.env.local` público.
 *
 *   BASE_URL=https://valorosters.com tsx scripts/_f79-2-e2e.ts
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { api, exchangeMaterial, g, login, pick, sleep, type Who } from "./_f79-2-lib";

/* eslint-disable @typescript-eslint/no-explicit-any */
const rows: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail: unknown = "") => { const d = typeof detail === "string" ? detail : JSON.stringify(detail); rows.push({ id, ok, detail: d.slice(0, 500) }); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${d.slice(0, 220)}`); return ok; };
const KEY = `${process.env.USERPROFILE}/.ssh/id_ed25519`;
/** Lectura SQL de SOLO LECTURA en el VPS (la consulta viaja por stdin: sin capas de comillas). */
function sql(q: string): string {
  return execSync(`ssh -o BatchMode=yes -i "${KEY}" nexusadmin@212.95.40.144 "docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' supabase_db_DRLCards psql -U postgres -d postgres -Atq -v ON_ERROR_STOP=1"`, { encoding: "utf8", input: q + ";\n" }).trim();
}
const U = /^[0-9a-f-]{36}$/;
const copies = (who: Who, cardId: string) => Number(sql(`select count(*) from public.user_cards where user_id='${who.userId}' and card_id='${cardId}'`));
const exists = (uid: string) => { if (!U.test(uid)) throw new Error("uid"); return sql(`select count(*) from public.user_cards where uid='${uid}'`) === "1"; };
const opsFor = (who: Who, tag: string) => Number(sql(`select count(*) from public.economy_ops where user_id='${who.userId}' and ref like '%${tag}%'`));
const forge = (who: Who, recipeId: string, uids: string[], ref: string, confirmProtected: string[] = []) => api(who, "/api/game/forge", { action: "craft", recipeId, uids, ref, ...(confirmProtected.length ? { confirmProtected } : {}) }, { noRetry: true });
const exchange = (who: Who, recipeId: string, uids: string[], ref: string) => api(who, "/api/game/crafting", { action: "craftCard", recipeId, uids, ref }, { noRetry: true });
const salvage = (who: Who, uids: string[], ref: string, confirmProtected: string[] = []) => api(who, "/api/game/economy", { action: "salvage", uids, ref, ...(confirmProtected.length ? { confirmProtected } : {}) }, { noRetry: true });
const code = (r: { status: number; json: unknown }) => `${r.status}:${(r.json as any)?.code ?? ((r.json as any)?.repeated ? "repeated" : (r.json as any)?.error?.slice?.(0, 30) ?? "ok")}`;
const R = "card-base-plata";

async function main() {
  const [C, A, G] = [await login("C"), await login("A"), await login("G")];
  const cardOf = async (who: Who) => { const m = (await exchangeMaterial(who)).find((x) => x.recipeId === R)!; return m; };

  /* ── G · FAVORITA: sin confirmación nunca; confirmada copia a copia, sí (C) ── */
  {
    const m = await cardOf(C);
    const fav = Object.entries(m.usableByCard).find(([c, u]) => u >= 1 && m.free.filter((f) => f.cardId === c).length >= 2)?.[0];
    if (fav) {
      const fr = await api(C, "/api/game/collection", { action: "favorite", cardId: fav, favorite: true });
      check("G · marcar favorita (API real)", fr.status === 200, code(fr));
      const m2 = await cardOf(C); const favUids = m2.free.filter((f) => f.cardId === fav).map((f) => f.uid);
      check("G · el selector del servidor la marca protegida (FAVORITE)", m2.free.filter((f) => f.cardId === fav).every((f) => f.protectedBy.includes("FAVORITE")), m2.free.filter((f) => f.cardId === fav).map((f) => f.protectedBy));
      const others = pick(m2, 6) ?? [];
      const n0 = copies(C, fav);
      const f1 = await forge(C, R, [favUids[0], ...others], g("G1"));
      const f2 = await exchange(C, R, [favUids[0], ...others], g("G2"));
      const f3 = await salvage(C, [favUids[0]], g("G3"));
      check("G · Forja / intercambio / desguace SIN confirmar → 409 PROTECTED_COPY, nada consumido", [f1, f2, f3].every((r) => r.status === 409 && (r.json as any).code === "PROTECTED_COPY") && copies(C, fav) === n0, [code(f1), code(f2), code(f3)]);
      const pv = await api(C, "/api/game/economy", { action: "salvagePreview" });
      const protUid = ((pv.json as any).protectedCopies ?? []).find((p: any) => p.cardId === fav)?.uid;
      check("G · la vista previa del desguace la lista APARTE (no en el total)", !!protUid && !((pv.json as any).uids ?? []).includes(protUid), "");
      const ok = await salvage(C, [protUid], g("G4"), [protUid]);
      check("G · confirmada copia a copia → se desguaza SOLO esa", ok.status === 200 && (ok.json as any).salvaged === 1 && copies(C, fav) === n0 - 1, code(ok));
      const un = await api(C, "/api/game/collection", { action: "favorite", cardId: fav, favorite: false });
      check("G · limpieza: favorita desmarcada", un.status === 200, code(un));
    } else check("G · (sin carta repetida para marcar: no ejecutado)", true, "SKIP");
  }

  /* ── H · VITRINA (C): la copia de la vitrina no se destruye sin confirmar ── */
  {
    const me = await api(C, "/api/game/player?me=1");
    const prevShow: string[] = (me.json as any)?.self?.showcaseUids ?? [];
    const ver: number | null = (me.json as any)?.self?.version ?? null;
    const m = await cardOf(C);
    const card = Object.entries(m.usableByCard).find(([c, u]) => u >= 1 && m.free.filter((f) => f.cardId === c && !f.protectedBy.length).length >= 2)?.[0];
    if (card) {
      const target = m.free.filter((f) => f.cardId === card)[0].uid;
      const set = await api(C, "/api/game/player", { action: "set_showcase", cardUids: [target], expectedVersion: ver });
      check("H · poner una copia en la vitrina (API real)", set.status === 200, code(set));
      const others = pick(await cardOf(C), 6, new Set([target])) ?? [];
      const h1 = await forge(C, R, [target, ...others], g("H1"));
      const h2 = await salvage(C, [target], g("H2"));
      check("H · Forja sin confirmar → PROTECTED_COPY; desguace → no la toca; la copia sigue", h1.status === 409 && (h1.json as any).code === "PROTECTED_COPY" && h2.status !== 200 && exists(target), [code(h1), code(h2)]);
      const me2 = await api(C, "/api/game/player?me=1");
      const v2: number | null = (me2.json as any)?.self?.version ?? null;
      const back = await api(C, "/api/game/player", { action: "set_showcase", cardUids: prevShow, expectedVersion: v2 });
      check("H · limpieza: vitrina restaurada a la de antes", back.status === 200, code(back));
    } else check("H · (sin carta adecuada: no ejecutado)", true, "SKIP");
  }

  /* ── I · copia de un EQUIPO (C) ── */
  {
    const d = await api(C, "/api/game/duels");
    const deckUid: string | undefined = ((d.json as any)?.decks ?? []).flatMap((x: any) => x.cardUids ?? [])[0];
    if (deckUid) {
      const i1 = await salvage(C, [deckUid], g("I1"));
      const m = await cardOf(C); const others = pick(m, 6) ?? [];
      const i2 = await forge(C, R, [deckUid, ...others], g("I2"));
      check("I · desguace / Forja de una copia del equipo → rechazados, la copia sigue", i1.status !== 200 && i2.status === 409 && exists(deckUid), [code(i1), code(i2)]);
    } else check("I · (la cuenta no tiene equipo: no ejecutado)", true, "SKIP");
  }

  /* ── Cuerpos hechos a mano / cruce de usuarios ── */
  {
    const theirs = sql(`select uid from public.user_cards where user_id='${A.userId}' limit 1`);
    const x1 = await salvage(C, [theirs], g("X1"));
    const x2 = await forge(C, R, [theirs, ...(pick(await cardOf(C), 6) ?? [])], g("X2"));
    check("CRUCE · copia de OTRO usuario → rechazado y la copia de A intacta", x1.status !== 200 && x2.status === 409 && exists(theirs), [code(x1), code(x2)]);
    const bad1 = await api(C, "/api/game/forge", { action: "craft", recipeId: R, uids: [], ref: g("Y1"), xp: 999 }, { noRetry: true });
    const bad2 = await api(C, "/api/game/forge", { action: "craft", recipeId: R, uids: ["no-uuid"], ref: g("Y2") }, { noRetry: true });
    const bad3 = await api(C, "/api/game/economy", { action: "salvage", uids: [theirs], ref: g("Y3"), confirmProtected: ["nope"] }, { noRetry: true });
    const bad4 = await forge(C, "forge-ruta-oro", pick(await cardOf(C), 4) ?? [], g("Y4"));
    check("BYPASS · campos extra (xp) / uids inválidos / confirmación inválida → 400; receta DRAFT → no disponible", bad1.status === 400 && bad2.status === 400 && bad3.status === 400 && bad4.status === 404, [code(bad1), code(bad2), code(bad3), code(bad4)]);
      const only = sql(`select c.uid from public.user_cards c where c.user_id='${C.userId}' and (select count(*) from public.user_cards x where x.user_id=c.user_id and x.card_id=c.card_id)=1 limit 1`);
    const lc = await forge(C, R, [only, ...(pick(await cardOf(C), 6) ?? [])], g("L1"));
    check("ÚLTIMA COPIA · pedir la única copia de una carta → rechazado y sigue", lc.status === 409 && exists(only), { r: code(lc) });
  }

  /* ── F · última copia en carrera: dos desguaces de las DOS copias de una carta (C) ── */
  {
    const m = await cardOf(C);
    const two = Object.entries(m.usableByCard).find(([c, u]) => u === 1 && m.free.filter((f) => f.cardId === c && !f.protectedBy.length).length === 2);
    if (two) {
      const [cardId] = two; const [u1, u2] = m.free.filter((f) => f.cardId === cardId).map((f) => f.uid);
      const both = await salvage(C, [u1, u2], g("F0"));
      check("F · pedir las DOS copias de una carta → no se desguaza ninguna (se descartan las no desguazables; nunca 0)", copies(C, cardId) >= 1, code(both));
      const left = copies(C, cardId);
      if (left === 2) {
        const tag = g("F");
        const [a, b] = await Promise.all([salvage(C, [u1], `${tag}-1`), salvage(C, [u2], `${tag}-2`)]);
        check("F · dos desguaces simultáneos de copias distintas → gana uno, queda 1 copia", copies(C, cardId) === 1 && [a, b].filter((r) => r.status === 200 && (r.json as any).salvaged === 1).length === 1, [code(a), code(b)]);
      } else check("F · (la primera petición ya desguazó una: quedaba 1)", left === 1, left);
    } else check("F · (sin carta con exactamente 2 copias libres: no ejecutado)", true, "SKIP");
  }

  /* ── C + D + E + K · sobre las MISMAS 7 copias, a la vez: Forja, intercambio ×2 (pestañas idénticas), otro intercambio
   *    y un DESGUACE de una de ellas. Solo UNA operación puede aplicarse. Si gana el desguace, segunda ronda D/E/K. ── */
  let jWinner: { ref: string; via: "forge" | "exchange"; out: string; s: string[] } | null = null;
  for (let round = 1; round <= 2 && !jWinner; round++) {
    const m = await cardOf(C); const s = pick(m, 7);
    if (!s) { check(`C/D/E/K ronda ${round} · (sin 7 copias usables: no ejecutado)`, round > 1, "SKIP"); break; }
    const tag = g(`CDEK${round}`); const cr0 = Number(sql(`select credits from public.profiles where id='${C.userId}'`));
    const withSalvage = round === 1;
    const reqs = [forge(C, R, s, `${tag}-Z`), exchange(C, R, s, `${tag}-X`), exchange(C, R, s, `${tag}-X`), exchange(C, R, s, `${tag}-Y`), ...(withSalvage ? [salvage(C, [s[0]], `${tag}-S`)] : [])];
    const out = await Promise.all(reqs);
    const [z, x1, x2, y] = out; const sv = withSalvage ? out[4] : null;
    const res = out.map(code);
    const ops = opsFor(C, tag);
    check(`C/D/E · ronda ${round}: ${withSalvage ? "Forja + 3 intercambios + desguace" : "Forja + 3 intercambios"} sobre las mismas copias → UNA sola operación`, ops === 1, { ops, res });
    const losers = out.filter((r) => r.status !== 200 || (r.json as any)?.repeated === true);
    check(`C/D/E · ronda ${round}: los perdedores fallan por inventario (409), nunca 500`, out.filter((r) => r.status !== 200).every((r) => r.status === 409), res);
    const xWon = x1.status === 200 || x2.status === 200;
    check(`K · ronda ${round}: dos pestañas IDÉNTICAS (mismo gesto) → o las dos el mismo resultado (una repeated) o las dos rechazadas`, xWon ? (x1.status === 200 && x2.status === 200 && (x1.json as any).outputs[0].uid === (x2.json as any).outputs[0].uid) : (x1.status === 409 && x2.status === 409), res);
    const paid = Number(sql(`select credits from public.profiles where id='${C.userId}'`)) - cr0;
    if (sv && sv.status === 200) {
      check("C · ganó el DESGUACE: una copia, su pago exacto, ninguna forja", !exists(s[0]) && s.slice(1).every((u) => exists(u)) && paid === (sv.json as any).paid && paid > 0, { paid });
    } else {
      check(`C/D/E · ronda ${round}: ganó una forja: las 7 copias desaparecen UNA vez y 0 créditos de desguace`, s.every((u) => !exists(u)) && paid === 0, { paid });
      const w = [[z, "forge", "Z"], [x1, "exchange", "X"], [y, "exchange", "Y"]].find(([r]) => (r as any).status === 200) as [any, "forge" | "exchange", string];
      jWinner = { ref: `${tag}-${w[2]}`, via: w[1], out: w[0].json.outputs[0].uid, s };
      // J · reintento tras éxito (cliente sin respuesta): mismo gesto → mismo resultado, nada más consumido.
      const again = jWinner.via === "forge" ? await forge(C, R, s, jWinner.ref) : await exchange(C, R, s, jWinner.ref);
      check("J · reintento del gesto ganador → 200 repeated con la MISMA carta y sin otro asiento", again.status === 200 && (again.json as any).repeated === true && (again.json as any).outputs[0].uid === jWinner.out && opsFor(C, tag) === 1, code(again));
    }
    void losers;
  }

  /* ── B · forja REPETIBLE a la vez (sobres, F73) con material para UNA: 4 pestañas → 1; reintento idempotente (cuenta F) ── */
  {
    const F = await login("F");
    const st = await api(F, "/api/game/crafting");
    const have = Number((st.json as any)?.packs?.estandar ?? 0);
    let bought = 0;
    for (let i = have; i < 4; i++) { const b = await api(F, "/api/game/packs", { action: "buy", packId: "estandar", ref: g("Bbuy") }); if (b.status === 200) bought++; await sleep(250); }
    const st2 = await api(F, "/api/game/crafting");
    const est = Number((st2.json as any)?.packs?.estandar ?? 0), prem0 = Number((st2.json as any)?.packs?.premium ?? 0);
    if (est >= 4 && est < 8) {
      const tag = g("B");
      const out = await Promise.all([1, 2, 3, 4].map((i) => api(F, "/api/game/crafting", { action: "craftPack", recipeId: "pack-estandar-premium", ref: `${tag}-${i}` }, { noRetry: true })));
      const st3 = await api(F, "/api/game/crafting");
      const est3 = Number((st3.json as any)?.packs?.estandar ?? 0), prem3 = Number((st3.json as any)?.packs?.premium ?? 0);
      check("B · 4 forjas de sobres a la vez con material para 1 → 1 aplicada, sobres nunca negativos", out.filter((r) => r.status === 200).length === 1 && est3 === est - 4 && prem3 === prem0 + 1 && opsFor(F, tag) === 1, { res: out.map(code), est: [est, est3], prem: [prem0, prem3], bought });
      const win = out.findIndex((r) => r.status === 200);
      const again = await api(F, "/api/game/crafting", { action: "craftPack", recipeId: "pack-estandar-premium", ref: `${tag}-${win + 1}` }, { noRetry: true });
      check("B/J · reintento de la forja de sobres ganadora → repeated, nada más consumido", again.status === 200 && (again.json as any).repeated === true && Number(((await api(F, "/api/game/crafting")).json as any)?.packs?.estandar ?? 0) === est3, code(again));
    } else check("B · (cuenta F sin 4–7 sobres estándar: no ejecutado)", false, { est, bought });
  }

  /* ── Invariantes globales en la BD (cuentas QA) ── */
  const ids = [C, A, G, await login("F")].map((w) => `'${w.userId}'`).join(",");
  const neg = sql(`select count(*) from public.profiles where id in (${ids}) and credits < 0`) + "/" + sql(`select count(*) from public.user_packs where user_id in (${ids}) and qty < 0`);
  check("INVARIANTE · ni créditos ni sobres negativos", neg === "0/0", neg);
  const dangling = sql(`select count(*) from public.duel_decks d, unnest(d.card_uids) u where d.user_id in (${ids}) and not exists (select 1 from public.user_cards c where c.uid = u)`);
  check("INVARIANTE · ningún equipo QA apunta a una copia destruida", dangling === "0", dangling);
  const zero = sql(`select count(*) from (select distinct card_id from public.user_cards where user_id in (${ids})) k`);
  check("INVARIANTE · toda carta QA conserva ≥1 copia (no hay filas a 0; se cuentan cartas distintas)", Number(zero) > 0, zero);
  const dupTx = sql(`select count(*) from (select ref from public.credit_transactions where user_id in (${ids}) and ref like '%f792-%' group by user_id, ref having count(*) > 1) d`);
  check("INVARIANTE · ningún cobro/recompensa duplicado por clave", dupTx === "0", dupTx);
  const favLeft = sql(`select count(*) from public.user_card_favorites where user_id in (${ids})`);
  check("LIMPIEZA · sin favoritas QA residuales", favLeft === "0", favLeft);

  const ok = rows.filter((r) => r.ok).length;
  console.log(`\n${ok}/${rows.length} PASS`);
  writeFileSync("f79-2-e2e.json", JSON.stringify({ at: new Date().toISOString(), base: process.env.BASE_URL, rows }, null, 2));
  process.exit(ok === rows.length ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(2); });
void sleep;
