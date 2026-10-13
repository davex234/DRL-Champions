/**
 * F60 · INSTANTÁNEA DEL ROSTER DESDE LA BD — regenera `src/domain/tactics/valorantRoster.ts` a partir de
 * `public.agents` (PUBLICADOS). La fuente es la BD (se gestiona en /admin/agents); este fichero es un DERIVADO para el
 * primer pintado, las pruebas y los scripts sin red (el importador VLR y el espejo esports lo leen).
 *
 *   npm run agents:snapshot            reescribe el fichero si la BD cambió
 *   npm run agents:snapshot -- --check  no escribe; sale con 1 si la instantánea no coincide con la BD
 *
 * Sólo LEE la BD (service role de .env.local). Conserva la cabecera de procedencia y el `uuid` de la fuente de cada
 * agente ya conocido (los nuevos del panel no tienen uuid de valorant-api: se deja vacío).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { VALORANT_ROSTER } from "@/domain/tactics/valorantRoster";

for (const l of readFileSync(join(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(l);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const CHECK = process.argv.includes("--check");
const FILE = join(process.cwd(), "src", "domain", "tactics", "valorantRoster.ts");

(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("[agents:snapshot] falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY"); process.exit(2); }
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await sb.from("agents").select("id, name, role, code, abilities, lifecycle").eq("lifecycle", "PUBLISHED").order("id");
  if (error || !data) { console.error("[agents:snapshot] no se pudo leer public.agents"); process.exit(2); }
  const rows = data as { id: string; name: string; role: string; code: string | null; abilities: { slot: string; name: string }[] }[];
  const incomplete = rows.filter((r) => !r.code || (r.abilities ?? []).length !== 4);
  if (incomplete.length) { console.error(`[agents:snapshot] publicados incompletos: ${incomplete.map((r) => r.id).join(", ")}`); process.exit(1); }
  const uuid = new Map(VALORANT_ROSTER.map((r) => [r.id, r.uuid]));
  const q = (s: string) => JSON.stringify(s);
  const body = rows.map((r) => `  { id: ${q(r.id)}, name: ${q(r.name)}, code: ${q(r.code!)}, role: ${q(r.role)}, uuid: ${q(uuid.get(r.id) ?? "")}, abilities: [${r.abilities.map((a) => `{ slot: ${q(a.slot)}, name: ${q(a.name)} }`).join(", ")}] },`).join("\n");
  const cur = readFileSync(FILE, "utf8");
  const head = cur.slice(0, cur.indexOf("export const VALORANT_ROSTER"));
  const next = `${head}export const VALORANT_ROSTER: ValorantRosterRow[] = [\n${body}\n];\n`;
  const same = next.replace(/\r\n/g, "\n") === cur.replace(/\r\n/g, "\n");
  console.log(JSON.stringify({ published: rows.length, snapshot: VALORANT_ROSTER.length, identical: same }));
  if (CHECK) { process.exitCode = same ? 0 : 1; return; }
  if (!same) writeFileSync(FILE, cur.includes("\r\n") ? next.replace(/\n/g, "\r\n") : next);
})();
