/**
 * FASE 69 · DRY-RUN AISLADO de 0058 v3 en PGlite (Postgres 17 en WASM, en memoria). NO toca el VPS ni ninguna BD real.
 * Réplica sintética con los privilegios medidos (scripts/_fase69-0058-fixture.sql) →
 *   preflight → pruebas RLS (ANTES) → exploit H5/H4 demostrado → 0058 → postflight → pruebas RLS (DESPUÉS)
 *   → exploit bloqueado → llamador SECURITY DEFINER sigue funcionando → ROLLBACK → postflight → pruebas RLS.
 * Uso: PGLITE_DIR=<carpeta con node_modules/@electric-sql/pglite> node scripts/_fase69-0058-dryrun.mjs [salida.json]
 * Fuera de CI; PGlite NO es dependencia del proyecto (se instala en el scratchpad).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = process.env.PGLITE_DIR;
if (!dir) { console.error("PGLITE_DIR no definido"); process.exit(2); }
const req = createRequire(join(dir, "package.json"));
const { PGlite } = await import(pathToFileURL(req.resolve("@electric-sql/pglite")).href);

const P = "docs/operations/proposals/";
const sql = (f) => readFileSync(f, "utf8");
const db = new PGlite();
const out = { at: new Date().toISOString(), engine: null, steps: [] };
const rowsOf = (res) => res.flatMap((r) => r.rows ?? []).map((r) => (Array.isArray(r) ? r : Object.values(r)).join(" | "));
async function step(name, text) {
  try { const res = await db.exec(text, { rowMode: "array" }); const rows = rowsOf(res); out.steps.push({ name, ok: true, rows }); console.log(`\n## ${name}\n${rows.join("\n")}`); return rows; }
  catch (e) { out.steps.push({ name, ok: false, error: String(e.message ?? e) }); console.log(`\n## ${name}\nERROR ${e.message ?? e}`); return null; }
}

out.engine = (await db.query("select version() v")).rows[0].v;
await step("fixture (privilegios medidos en 0057)", sql("scripts/_fase69-0058-fixture.sql"));
await step("preflight", sql(P + "0058_preflight.sql"));
const before = await step("pruebas RLS · ANTES de 0058", sql(P + "0058_rls_tests.sql"));

// Exploit H5 en la réplica: anon cambia los puntos de una pregunta de Pick'ems A TRAVÉS de la vista.
await step("exploit H5 · ANTES (anon PATCH vía vista)", `
  begin; set local role anon;
  update public.pickem_questions_public set points = 999 where id = '33333333-3333-3333-3333-333333333333';
  reset role; select 'puntos en la tabla base tras el PATCH de anon: ' || points from public.pickem_questions where id = '33333333-3333-3333-3333-333333333333';
  rollback;`);
await step("exploit H4 · ANTES (anon libera ofertas y mueve créditos)", `
  begin; set local role anon;
  select public._release_listing_offers('55555555-5555-5555-5555-555555555555'::uuid, null);
  reset role; select 'créditos del comprador tras la llamada de anon: ' || credits from public.profiles where id = '11111111-1111-1111-1111-111111111111';
  rollback;`);

await step("APLICAR 0058 v3", sql(P + "0058_hardening_grants.PROPOSAL.sql"));
await step("postflight · DESPUÉS", sql(P + "0058_postflight.sql"));
const after = await step("pruebas RLS · DESPUÉS de 0058", sql(P + "0058_rls_tests.sql"));
await step("exploit H5 · DESPUÉS", `
  begin; set local role anon;
  do $$ begin update public.pickem_questions_public set points = 999 where id = '33333333-3333-3333-3333-333333333333'; raise notice 'permitido';
  exception when insufficient_privilege then raise notice 'denegado'; end $$;
  reset role; select 'puntos en la tabla base: ' || points from public.pickem_questions where id = '33333333-3333-3333-3333-333333333333';
  rollback;`);
await step("llamador SECURITY DEFINER sigue funcionando (buy_listing → _release_listing_offers)", `
  begin; select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  set local role authenticated; select public.buy_listing_stub('55555555-5555-5555-5555-555555555555'::uuid);
  reset role; select 'créditos del comprador tras la compra legítima: ' || credits from public.profiles where id = '11111111-1111-1111-1111-111111111111';
  rollback;`);
// v3 · ORDEN build→migración: el cliente F68 leía su perfil con select("*") por REST (se rompe con 0058); el F69 lo lee por
// /api/game/me (service_role) y por REST solo cuenta posiciones y edita avatar/región (siguen funcionando).
await step("cliente F68 · select(\"*\") del perfil propio DESPUÉS (esperado: denegado)", `
  begin; select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  set local role authenticated;
  do $$ begin perform * from public.profiles where id = '11111111-1111-1111-1111-111111111111'; raise notice 'x';
    create temp table if not exists _o (r text) on commit drop; insert into _o values ('select * propio: PERMITIDO');
  exception when insufficient_privilege then create temp table if not exists _o (r text) on commit drop; insert into _o values ('select * propio: denegado (la build F68 no es compatible con 0058)'); end $$;
  select r from _o; rollback;`);
await step("cliente F69 · lecturas/escrituras REST DESPUÉS (esperado: todas ok)", `
  begin; select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  set local role authenticated;
  select 'posición global (count points>40): ' || count(*) from public.profiles where points > 40;
  select 'posición regional (count EMEA points>40): ' || count(*) from public.profiles where region = 'EMEA' and points > 40;
  update public.profiles set avatar = '🐺' where id = '11111111-1111-1111-1111-111111111111';
  update public.profiles set region = 'Pacific' where id = '11111111-1111-1111-1111-111111111111';
  reset role; select 'avatar/región propios tras editar: ' || avatar || ' / ' || region from public.profiles where id = '11111111-1111-1111-1111-111111111111';
  rollback;`);
await step("clasificación pública (anon) sigue viva", `begin; set local role anon; select 'filas ranking_points visibles para anon: ' || count(*) from public.ranking_points; rollback;`);

await step("ROLLBACK de 0058", sql(P + "0058_hardening_grants.ROLLBACK.sql"));
await step("postflight · tras ROLLBACK (esperado «pendiente»)", sql(P + "0058_postflight.sql"));
const back = await step("pruebas RLS · tras ROLLBACK (= ANTES)", sql(P + "0058_rls_tests.sql"));

const fails = (rows) => (rows ?? ["sin datos"]).filter((r) => /FALLA|ERROR/.test(r));
out.summary = {
  beforeFailures: fails(before).length, afterFailures: fails(after).length, rollbackFailures: fails(back).length,
  rollbackRestoresExactly: JSON.stringify(before) === JSON.stringify(back),
  stepErrors: out.steps.filter((s) => !s.ok).map((s) => s.name),
};
console.log("\n## RESUMEN\n" + JSON.stringify(out.summary, null, 2));
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(out, null, 2));
