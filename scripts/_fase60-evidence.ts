/**
 * F60 · EVIDENCIAS (instrumento `_`, fuera de CI, SOLO LECTURA de la BD). Escribe los JSON de
 * docs/product/qa/fase60-admin-cms/: matriz de fuentes, salud de contenido real, cambios de esquema y los catálogos de
 * pruebas (qué prueba cubre qué). Los recuentos de la línea base vienen del precheck de producción (pre-0057).
 *
 *   npx tsx scripts/_fase60-evidence.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

const OUT = join(process.cwd(), "docs/product/qa/fase60-admin-cms");
const w = (name: string, data: unknown) => writeFileSync(join(OUT, name), JSON.stringify(data, null, 1) + "\n");
const testsOf = (file: string) => [...readFileSync(join(process.cwd(), file), "utf8").matchAll(/^test\("([^"]+)"/gm)].map((m) => m[1]);

(async () => {
  const { SOURCE_MATRIX } = await import("@/domain/cms/sourceMatrix");
  const { getSupabaseAdmin } = await import("@/lib/supabase/admin");
  const { contentHealth } = await import("@/server/cms/health");
  const { TEAM_IDENTITIES } = await import("@/data/teamIdentities");
  const sb = getSupabaseAdmin()!;
  const at = new Date().toISOString();

  const count = async (t: string, f?: (q: any) => any) => { let q: any = sb.from(t).select("*", { count: "exact", head: true }); if (f) q = f(q); const r = await q; return r.error ? `error: ${r.error.code}` : r.count; };
  const probe = await sb.rpc("app_admin_schema_probe");
  const now = {
    publishedCards: await count("content_cards", (q) => q.eq("lifecycle", "PUBLISHED")),
    adminCards: await count("content_cards", (q) => q.eq("origin", "admin")),
    agents: await count("agents"), agentsPublished: await count("agents", (q) => q.eq("lifecycle", "PUBLISHED")),
    cmsPacks: await count("content_packs"), cmsAssets: await count("assets"),
    players: await count("content_players"), admins: await count("profiles", (q) => q.eq("is_admin", true)),
  };
  w("baseline.json", {
    at, note: "Antes = precheck de producción previo a 0057 (production-migration-evidence/precheck-before.txt) + gates locales antes de F60. Después = lectura de producción ahora.",
    before: { migrationHead: "0056_agents_catalog_miks_veto", tests: 5113, publishedCards: 331, agents: 29, cmsPacks: "tabla inexistente", admins: 1, marketplace: "OFF (GLOBAL_MARKET_ENABLED=false)", payments: "OFF" },
    after: { migrationHead: "0057_admin_cms", schemaProbe: probe.error ? `error: ${probe.error.code}` : probe.data, ...now, marketplace: "OFF (sin tocar)", payments: "OFF (sin tocar)" },
  });

  w("content-source-matrix.json", { at, classes: ["CONTENT", "CONFIGURATION", "GAME_RULE", "SECURITY_RULE"], rows: SOURCE_MATRIX });

  const health = await contentHealth(sb, TEAM_IDENTITIES.length);
  w("content-health.json", { at, source: "producción (lectura, service role)", ...health });

  w("schema-changes.json", {
    migration: "supabase/migrations/0057_admin_cms.sql", appliedAt: "2026-09-24T19:13:56Z", registeredInSchemaMigrations: false,
    backup: "/opt/nexus/backups/supabase-drlcards/pre-0057/20260924T191344Z (1902 entradas, 10 tablas tocadas, CSV de agents, SHA256SUMS)",
    tablesAdded: ["content_entity_version", "content_packs"],
    columnsAdded: {
      agents: ["code", "abilities", "lifecycle", "face_asset_id (FK restrict)", "full_asset_id (FK restrict)", "origin", "version", "created_at", "updated_at", "published_at", "retired_at"],
      content_cards: ["presentation", "presentation_rev"], content_players: ["version", "photo_asset_id"],
      events: ["description"], admin_event_drafts: ["image_asset_id"],
    },
    checksExtended: ["content_assets.kind += agent_face, agent_full, pack_art, event_art, map_art", "content_assets.subject_type += agent, pack, event, map"],
    policies: ["agents: lectura pública sólo lifecycle <> 'DRAFT'"],
    triggers: ["content_card_publish_guard (carta del panel sin presentación completa no se publica)"],
    functions: ["_bump_entity", "_require_admin", "app_admin_agent_save", "app_admin_agent_lifecycle", "app_admin_agent_references", "app_admin_agent_delete_draft",
      "app_admin_pack_save", "app_admin_pack_lifecycle", "app_admin_pack_references", "app_admin_pack_delete_draft",
      "app_admin_card_set_presentation", "app_admin_card_create_draft", "app_admin_card_delete_draft", "app_admin_card_references",
      "app_admin_player_save", "app_admin_publish_event_v2", "app_admin_schema_probe (v2)"],
    grants: "todas las RPC nuevas: sólo service_role (security definer + _require_admin(actor))",
    auditLog: "content_audit_log sin cambios de esquema; el trigger inmutable de F58 intacto",
    rollback: "probado en seco (BEGIN … ROLLBACK): 25 valores idénticos antes/después; plan de marcha atrás en docs/product/fase-60-admin-cms.md §Rollback",
    postCheck: "production-migration-evidence/before-vs-after.diff: sólo sondas 0057, +2 tablas (122), +22 funciones (149) y la política de agents",
  });

  const server = testsOf("src/server/cms/cms.test.ts"), domain = testsOf("src/domain/cms/cms.domain.test.ts");
  const all = [...server.map((t) => ({ file: "src/server/cms/cms.test.ts", test: t })), ...domain.map((t) => ({ file: "src/domain/cms/cms.domain.test.ts", test: t }))];
  const pick = (re: RegExp) => all.filter((x) => re.test(x.test));
  const prodQa = JSON.parse(readFileSync(join(OUT, "prod-qa-lifecycles.json"), "utf8")) as { steps: { flow: string; step: string; ok: boolean }[] };
  const prod = (re: RegExp) => prodQa.steps.filter((s) => re.test(s.flow + " " + s.step)).map((s) => ({ step: `${s.flow} · ${s.step}`, ok: s.ok }));
  const suite = "npm test (node:test) — ver fase-60-admin-cms.md §Gates";
  w("security-tests.json", { at, suite, tests: pick(/^(AUTH|MASS|IDOR|SUBIDAS|FIRMAS|REGLAS DE SUBIDA|AGENTE · XSS|MATRIZ)/),
    extra: ["tests/admin: adminControlCenter.test.ts recorre TODAS las rutas /api/admin/** (recursivo) y exige verifyAdmin", "ruta legada /api/admin/assets endurecida: firma por bytes, 20 MB, upsert:false, errores genéricos"],
    production: prod(/401|403|auth|admin|rechaz|Storage/i) });
  w("crud-tests.json", { at, suite, tests: pick(/^(AGENTE ·|SOBRE ·|CARTA ·|JUGADOR ·|SUBIDAS · reemplazo)/), production: prod(/crear|editar|publicar|borrar|retir|subir|asignar|reemplaz/i) });
  w("dependency-tests.json", { at, suite, tests: pick(/dependencias|referencias|histórico|SALUD|en uso|huérfano/i), production: prod(/referencia|depend|huérfano|borrar/i) });
  w("runtime-tests.json", { at, suite, tests: pick(/runtime|CACHÉ|ROSTER VIVO|CLIENTE|REGISTRO DE SOBRES|UNA SOLA FUENTE|331/i), production: prod(/runtime|invisible|juego|recuentos/i) });
  console.log(JSON.stringify({ now, health: health.summary, tests: all.length }, null, 1));
})();
