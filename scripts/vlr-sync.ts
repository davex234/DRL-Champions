/**
 * PUENTE VLR → SUPABASE (Fase 17C) — `npm run vlr:sync`
 *
 *   npm run vlr:sync -- <url>                    → DRY RUN (no escribe nada)
 *   npm run vlr:sync -- <url> --event <id>       → dry run con el id de evento aislado
 *   npm run vlr:sync -- <url> --event <id> --write            → escribe, SIN Pick'ems
 *   npm run vlr:sync -- <url> --event <id> --write --pickems  → escribe y abre Pick'ems
 *
 * ────────────────────────── QUÉ HACE ──────────────────────────
 *
 * Une dos sistemas que ya existían y nunca se habían tocado entre sí:
 *
 *   importer-vlr (validado en F16)  →  adaptador  →  syncTournament (escrito, nunca ejecutado)
 *
 * No descarga de otra manera, no calcula estadísticas y no genera cartas. Traduce y persiste.
 *
 * ────────────────────────── POR QUÉ EL DRY RUN ES EL MODO POR DEFECTO ──────────────────────────
 *
 * Escribir en Supabase es irreversible y la base sostiene la demo. Sin `--write` esto no abre
 * una sola transacción: descarga, traduce, comprueba identidades y enseña el resumen. Escribir
 * exige además `--event`, para que nunca se pueda tocar un evento existente por descuido.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { importVlrTournament } from "@/importer-vlr";
import { snapshotToSource, type AdapterResult } from "@/lib/esports/sync/vlrSnapshotSource";
import { syncTournament } from "@/lib/esports/sync/orchestrator";
import { playerRow } from "@/lib/esports/sync/mappers";

const ROOT = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const args = process.argv.slice(2);
const argOf = (n: string): string | undefined => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const url = args.find((a) => a.startsWith("http"));
const write = args.includes("--write");
const withPickems = args.includes("--pickems");
const eventId = argOf("--event");

/** Eventos que esta herramienta no puede tocar NUNCA, ni por error de tecleo. */
const PROTECTED_EVENTS = new Set(["demo-masters-madrid-2026"]);

const norm = (s: string): string =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

async function catalogs(db: SupabaseClient) {
  const { data: ag, error: e1 } = await db.from("agents").select("id,name");
  if (e1) throw new Error(`agents: ${e1.message}`);
  const { data: mp, error: e2 } = await db.from("maps").select("id,name");
  if (e2) throw new Error(`maps: ${e2.message}`);
  const agents = new Map<string, string>();
  for (const a of (ag ?? []) as { id: string; name: string }[]) {
    agents.set(norm(a.name), a.id);
    agents.set(norm(a.id), a.id);
  }
  const maps = new Map<string, string>();
  for (const m of (mp ?? []) as { id: string; name: string }[]) {
    maps.set(norm(m.name), m.id);
    maps.set(norm(m.id), m.id);
  }
  return { agents, maps };
}

function reportDryRun(res: AdapterResult, snapshotCounts: Record<string, number>): boolean {
  const s = res.summary;
  console.log("\n" + "═".repeat(74));
  console.log(`  DRY RUN · ${s.eventName}`);
  console.log(`  evento destino: ${s.eventId}`);
  console.log("═".repeat(74));
  const line = (label: string, got: number, expected: number) => {
    const ok = got === expected;
    console.log(`  ${ok ? "✓" : "✗"} ${label.padEnd(28)} ${String(got).padStart(6)}${ok ? "" : `   (fuente: ${expected})`}`);
    return ok;
  };
  let ok = true;
  ok = line("equipos", s.teams, snapshotCounts.teams) && ok;
  ok = line("jugadores", s.players, snapshotCounts.players) && ok;
  ok = line("partidos", s.matches, snapshotCounts.matches) && ok;
  ok = line("mapas", s.maps, snapshotCounts.maps) && ok;
  ok = line("filas de scoreboard", s.mapStats, snapshotCounts.mapStats) && ok;
  console.log(`  · clasificación               ${String(s.standings).padStart(6)}`);
  console.log("");
  const okOrphan = s.orphanStats === 0;
  console.log(`  ${okOrphan ? "✓" : "✗"} filas de scoreboard sin identidad: ${s.orphanStats}`);
  ok = okOrphan && ok;

  const byKind = new Map<string, string[]>();
  for (const i of res.issues) byKind.set(i.kind, [...(byKind.get(i.kind) ?? []), i.detail]);
  if (byKind.size === 0) {
    console.log("  ✓ ninguna identidad sin resolver (equipos · jugadores · agentes · mapas)");
  } else {
    ok = false;
    console.log("\n  INCIDENCIAS DE IDENTIDAD:");
    for (const [kind, list] of byKind) {
      console.log(`    ✗ ${kind} (${list.length})`);
      for (const d of [...new Set(list)].slice(0, 5)) console.log(`        · ${d}`);
      if (new Set(list).size > 5) console.log(`        … y ${new Set(list).size - 5} más`);
    }
  }
  console.log("\n" + "═".repeat(74));
  console.log(ok ? "  ✅ DRY RUN VERDE — se puede sincronizar" : "  ❌ DRY RUN EN ROJO — NO se sincroniza");
  console.log("═".repeat(74) + "\n");
  return ok;
}

async function main(): Promise<void> {
  if (!url) {
    console.error("Uso: npm run vlr:sync -- <url de vlr.gg> [--event <id>] [--write] [--pickems]");
    process.exit(1);
  }
  const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL_ || !SERVICE) {
    console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }
  const db = createClient(URL_, SERVICE, { auth: { persistSession: false } });

  console.log(`Descargando ${url} …`);
  const out = await importVlrTournament(url, {});
  const snap = out.snapshot;
  for (const w of out.warnings) console.log(`  ⚠ ${w}`);
  const snapshotCounts = {
    teams: snap.teams.length, players: snap.players.length, matches: snap.matches.length,
    maps: snap.maps?.length ?? 0, mapStats: snap.mapStats?.length ?? 0,
  };
  console.log(`Fuente: ${snap.tournament.name} · estado ${snap.tournament.status}`);
  console.log(`  ${snapshotCounts.teams} equipos · ${snapshotCounts.players} jugadores · `
    + `${snapshotCounts.matches} partidos · ${snapshotCounts.maps} mapas · ${snapshotCounts.mapStats} filas`);

  const target = eventId ?? `${snap.tournament.id}`;
  if (PROTECTED_EVENTS.has(target)) {
    console.error(`\n❌ «${target}» está protegido. Elige otro --event.`);
    process.exit(1);
  }

  const { agents, maps } = await catalogs(db);
  const res = snapshotToSource(snap, { eventId: target, agents, maps });
  const green = reportDryRun(res, snapshotCounts);

  if (!write) {
    console.log("Modo DRY RUN: no se ha escrito nada. Añade --write --event <id> para sincronizar.\n");
    process.exitCode = green ? 0 : 1;
    return;
  }
  if (!green) {
    console.error("❌ El dry run no está verde: no se sincroniza.");
    process.exit(1);
  }
  if (!eventId) {
    console.error("❌ Escribir exige --event <id> explícito (evento aislado).");
    process.exit(1);
  }

  console.log(`Sincronizando en «${target}» · Pick'ems ${withPickems ? "ACTIVADOS" : "desactivados"} …`);
  const r = await syncTournament(res.source, target, db, {
    players: res.players.map(playerRow),
    pickems: withPickems,
  });
  console.log("\n── RESULTADO DEL SYNC ──");
  console.log(JSON.stringify(r, null, 2));
  process.exitCode = r.ok ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
