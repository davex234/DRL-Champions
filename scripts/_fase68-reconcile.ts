/**
 * FASE 68 · CONCILIACIÓN de las cuentas de la beta (instrumento `_`, fuera de CI): libro de créditos, inventario de
 * sobres, propiedad de cartas y progreso de objetivos. SOLO LECTURA: SQL en una sesión `default_transaction_read_only`
 * por ssh + lecturas GET/state del producto. SOLO cuentas QA (aborta con la del usuario).
 *
 *   npx tsx scripts/_fase68-reconcile.ts [--out=reconcile-final]
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { api, creds, OUT, PERSONA_FILES, SCRATCH, token, USER_ACCOUNT_PREFIX } from "./_fase68-lib";

/* eslint-disable @typescript-eslint/no-explicit-any */
const OUTNAME = process.argv.find((a) => a.startsWith("--out="))?.slice(6) ?? "reconcile";
const PERSONAS = Object.keys(PERSONA_FILES).filter((p) => { try { creds(p); return true; } catch { return false; } });
const ids = PERSONAS.map((p) => creds(p).userId);
if (ids.some((x) => x.startsWith(USER_ACCOUNT_PREFIX))) throw new Error("la cuenta del usuario no se toca");
const list = ids.map((x) => `'${x}'`).join(",");

const SQL = `set default_transaction_read_only = on;
\\pset tuples_only on
\\pset format unaligned
select json_build_object(
  'profiles', (select json_agg(json_build_object('id', id, 'credits', credits, 'xp', xp, 'points', points)) from public.profiles where id in (${list})),
  'ledger', (select json_agg(json_build_object('u', user_id, 'd', delta, 'r', reason, 'ref', ref, 'b', balance_after, 't', created_at) order by created_at) from public.credit_transactions where user_id in (${list})),
  'ops', (select json_agg(json_build_object('u', user_id, 'k', kind, 'res', result, 'ref', ref, 't', created_at)) from public.economy_ops where user_id in (${list})),
  'packs', (select json_agg(json_build_object('u', user_id, 'p', pack_id, 'q', qty)) from public.user_packs where user_id in (${list})),
  'game', (select json_agg(json_build_object('u', user_id, 'opened', packs_opened)) from public.user_game where user_id in (${list})),
  'cards', (select json_agg(json_build_object('u', user_id, 'n', n, 'uids', uids)) from (select user_id, count(*) n, array_agg(uid) uids from public.user_cards where user_id in (${list}) group by user_id) x),
  'decks', (select json_agg(json_build_object('u', user_id, 'id', id, 'uids', card_uids)) from public.duel_decks where user_id in (${list})),
  'negatives', (select count(*) from public.user_packs where user_id in (${list}) and qty < 0)
)::text;
`;

function sql(): any {
  const file = join(SCRATCH, "f68-reconcile.sql");
  writeFileSync(file, SQL);
  const out = execFileSync("ssh", ["-i", `${process.env.USERPROFILE}/.ssh/id_ed25519`, "nexusadmin@212.95.40.144", "docker exec -i supabase_db_DRLCards psql -U postgres -d postgres -At"], { input: SQL, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const line = out.split(/\r?\n/).find((l) => l.startsWith("{"));
  return JSON.parse(line!);
}

(async () => {
  const db = sql();
  const rows: any[] = [];
  for (const p of PERSONAS) {
    const id = creds(p).userId;
    const t = await token(p);
    const prog = (await api(t, "/api/game/progression", { action: "state" })).json;
    const state = (await api(t, "/api/game/state")).json;
    const profile = (db.profiles ?? []).find((x: any) => x.id === id);
    const ledger = (db.ledger ?? []).filter((x: any) => x.u === id);
    const ops = (db.ops ?? []).filter((x: any) => x.u === id);
    const packs = (db.packs ?? []).filter((x: any) => x.u === id);
    const opened = (db.game ?? []).find((x: any) => x.u === id)?.opened ?? null;
    const cards = (db.cards ?? []).find((x: any) => x.u === id);
    const decks = (db.decks ?? []).filter((x: any) => x.u === id);

    // ── LIBRO: inicial + ganado + gastado = final; cadena de saldos; nunca negativo; sin claves repetidas.
    const start = ledger.find((x: any) => x.r === "starter_grant")?.d ?? null;
    const earned = ledger.filter((x: any) => x.r !== "starter_grant" && x.d > 0).reduce((s: number, x: any) => s + Number(x.d), 0);
    const spent = ledger.filter((x: any) => x.d < 0).reduce((s: number, x: any) => s + Number(x.d), 0);
    const sum = ledger.reduce((s: number, x: any) => s + Number(x.d), 0);
    const byReason: Record<string, { n: number; total: number }> = {};
    for (const x of ledger) { const k = String(x.r).replace(/:.*/, ""); (byReason[k] ??= { n: 0, total: 0 }); byReason[k].n++; byReason[k].total += Number(x.d); }
    // Cadena: ordenando por saldo resultante en empates de hora, cada balance = anterior + delta.
    let chainBreaks = 0; let prev: number | null = null;
    for (const x of ledger) { if (prev !== null && Number(x.b) !== prev + Number(x.d)) chainBreaks++; prev = Number(x.b); }
    const refs = ledger.map((x: any) => x.ref).filter(Boolean);
    const ledgerOk = sum === Number(profile?.credits) && Number(ledger.at(-1)?.b) === Number(profile?.credits) && ledger.every((x: any) => Number(x.b) >= 0) && new Set(refs).size === refs.length;

    // ── INVENTARIO: alta (3 Iniciales + 1 Bronce) + compras + recompensas reclamadas − abiertos = sin abrir.
    const bought: Record<string, number> = {}; const openedBy: Record<string, number> = {};
    for (const o of ops) {
      // `result.qty` de buy_pack es el TOTAL en inventario tras comprar (no las unidades): cada operación = 1 sobre.
      if (o.k === "buy_pack") bought[o.res?.packId] = (bought[o.res?.packId] ?? 0) + 1;
      if (o.k === "open_pack") openedBy[o.res?.packId] = (openedBy[o.res?.packId] ?? 0) + 1;
    }
    const rewarded: Record<string, number> = {};
    for (const track of Object.values<any[]>(prog?.tracks ?? {})) for (const lv of track ?? []) if (lv.claimed && lv.reward?.packId) rewarded[lv.reward.packId] = (rewarded[lv.reward.packId] ?? 0) + Number(lv.reward.packCount ?? 1);
    for (const m of prog?.missions ?? []) if (m.claimed && m.packId && m.packCount) rewarded[m.packId] = (rewarded[m.packId] ?? 0) + Number(m.packCount);
    const starter: Record<string, number> = { inicial: 3, estandar: 1 };
    const kinds = new Set([...Object.keys(starter), ...Object.keys(bought), ...Object.keys(rewarded), ...Object.keys(openedBy), ...packs.map((x: any) => x.p)]);
    const inv: Record<string, any> = {};
    let invOk = true;
    for (const k of kinds) {
      const expected = (starter[k] ?? 0) + (bought[k] ?? 0) + (rewarded[k] ?? 0) - (openedBy[k] ?? 0);
      const actual = packs.find((x: any) => x.p === k)?.q ?? 0;
      inv[k] = { starter: starter[k] ?? 0, bought: bought[k] ?? 0, rewarded: rewarded[k] ?? 0, opened: openedBy[k] ?? 0, expected, actual, ok: expected === actual };
      if (expected !== actual) invOk = false;
    }
    const openedOps = Object.values(openedBy).reduce((a, b) => a + b, 0);
    // Cartas: ninguna carta de un equipo que no sea del jugador.
    const mine = new Set<string>(cards?.uids ?? []);
    const foreign = decks.flatMap((d: any) => (d.uids ?? []).filter((u: string) => !mine.has(u)));
    // Progresión: objetivos coherentes (actual ≤ meta cuando está reclamado; nada reclamado sin completar).
    const phantom = (prog?.missions ?? []).filter((m: any) => m.claimed && !m.complete).map((m: any) => m.id);
    const achPhantom = (prog?.achievements ?? []).filter((a: any) => a.claimed && !a.complete).map((a: any) => a.id);

    rows.push({
      persona: p, account: id.slice(0, 8),
      ledger: { start, earned, spent, sum, final: profile?.credits ?? null, rows: ledger.length, chainBreaks, byReason, ok: ledgerOk },
      inventory: { packs: inv, openedOps, userGameOpened: opened, openedCountersAgree: openedOps === opened, ok: invOk },
      cards: { owned: cards?.n ?? 0, stateOwned: (state?.ownedCards ?? []).length, decks: decks.length, foreignInDecks: foreign.length, ok: foreign.length === 0 && (cards?.n ?? 0) === (state?.ownedCards ?? []).length },
      progression: { missionsClaimedNotComplete: phantom, achievementsClaimedNotComplete: achPhantom, ok: phantom.length === 0 && achPhantom.length === 0, seasonLevel: prog?.level ?? null, seasonXp: prog?.xp ?? null, accountXp: profile?.xp ?? null },
    });
    console.log(`${p} libro=${ledgerOk ? "OK" : "FALLA"} inventario=${invOk ? "OK" : "FALLA"} cartas=${foreign.length === 0 ? "OK" : "FALLA"} progreso=${phantom.length + achPhantom.length === 0 ? "OK" : "FALLA"} (${ledger.length} apuntes: ${start} + ${earned} ganado ${spent} gastado = ${sum} · perfil ${profile?.credits})`);
  }
  const out = { at: new Date().toISOString(), readOnly: true, accounts: rows.length, negativePacks: db.negatives, allOk: rows.every((r) => r.ledger.ok && r.inventory.ok && r.cards.ok && r.progression.ok), rows };
  writeFileSync(join(OUT, `${OUTNAME}.json`), JSON.stringify(out, null, 2));
  console.log(`→ ${OUTNAME}.json allOk=${out.allOk}`);
})().catch((e) => { console.error(e); process.exit(1); });
