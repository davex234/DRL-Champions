/**
 * CICLO DE PICK'EMS — herramienta de operación (NEXUS, Fase 10).
 *
 *   npm run pickems:lifecycle                 # todos los torneos en curso o próximos
 *   npm run pickems:lifecycle -- <eventId>    # uno concreto
 *   npm run pickems:lifecycle -- --all        # todos los torneos, incluidos los cerrados
 *
 * Abre las predicciones de los partidos que aún no han empezado, fija el resultado de los
 * que ya acabaron y reparte puntos y recompensas.
 *
 * En producción esto NO hace falta llamarlo a mano: `runPickemLifecycle` corre dentro de
 * la sincronización competitiva (`/api/esports/sync`), que es la que trae los partidos y
 * los resultados. Esta herramienta existe para dos cosas: operar en local sin montar un
 * cron, y poder forzar una corrección cuando el origen publica un resultado tarde.
 *
 * Es idempotente de arriba abajo: ejecutarlo mil veces da el mismo resultado que una.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { runPickemLifecycle } from "@/server/services/pickemLifecycle";

const ROOT = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!URL_ || !SERVICE) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

async function main() {
  const args = process.argv.slice(2).filter((a) => a.length > 0);
  const all = args.includes("--all");
  const explicit = args.filter((a) => !a.startsWith("--"));

  let ids: string[] = explicit;
  if (ids.length === 0) {
    const q = admin.from("events").select("id, name, status");
    const { data, error } = all
      ? await q.order("start_date", { ascending: false })
      : await q.in("status", ["ongoing", "upcoming"]).order("start_date", { ascending: true });
    if (error) throw new Error(error.message);
    ids = ((data ?? []) as { id: string }[]).map((e) => e.id);
  }

  if (ids.length === 0) {
    console.log("No hay torneos que procesar.");
    return;
  }

  console.log(`# Ciclo de Pick'ems — ${ids.length} torneo(s)\n`);
  let created = 0;
  let resolved = 0;
  let scored = 0;

  for (const id of ids) {
    const r = await runPickemLifecycle(admin, id);
    created += r.created;
    resolved += r.resolved;
    if (r.scored) scored++;
    const bits = [
      `${r.created} pregunta(s) nueva(s)`,
      `${r.resolved} resuelta(s)`,
      r.scored ? `corregido · ${r.usersScored} jugador(es)` : "sin corregir",
    ];
    console.log(`  · ${id}: ${bits.join(" · ")}${r.notes.length ? ` — ${r.notes.join(" · ")}` : ""}`);
  }

  console.log(`\n${created} pregunta(s) creada(s) · ${resolved} resuelta(s) · ${scored} torneo(s) corregido(s)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
