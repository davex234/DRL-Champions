/**
 * SIEMBRA DE CARTAS PARA PROBAR DUELOS (herramienta de desarrollo).
 *
 *   npm run seed:duel                    → al primer perfil de la base de datos
 *   npm run seed:duel -- correo@ejemplo  → a un usuario concreto
 *
 * POR QUÉ EXISTE
 *   Para jugar un duelo hacen falta diez cartas con dos de cada rol, y conseguirlas abriendo sobres
 *   es aleatorio y lento. Esto concede un conjunto legal para poder PROBAR el modo.
 *
 * NO ES UN ATAJO INSEGURO: usa `service_role` desde un script de servidor y la MISMA RPC
 * `app_grant_cards` que usa el juego. El cliente no puede hacer nada de esto. Es idempotente:
 * si el usuario ya tiene cartas suficientes de cada rol, no concede nada.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { CardRegistry } from "@/collection/registry";
import { DUEL_ROLES } from "@/domain/cardgame";

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
const registry = new CardRegistry();

/** Cuántas cartas por rol se conceden. Con 4 hay margen para construir dos mazos distintos. */
const PER_ROLE = 4;

async function main() {
  const wanted = process.argv[2];

  let userId: string;
  let label: string;
  if (wanted) {
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const user = data.users.find((u) => u.email === wanted || u.id === wanted);
    if (!user) { console.error(`No existe el usuario ${wanted}`); process.exit(1); }
    userId = user.id;
    label = user.email ?? user.id;
  } else {
    const { data } = await admin.from("profiles").select("id, username").limit(1).maybeSingle();
    if (!data) { console.error("No hay ningún perfil en la base de datos. Regístrate primero."); process.exit(1); }
    userId = (data as { id: string }).id;
    label = (data as { username: string }).username;
  }

  // Qué roles cubre ya el inventario actual: no se duplica lo que sobra.
  const { data: existing } = await admin.from("user_cards").select("card_id").eq("user_id", userId);
  const have = new Map<string, number>();
  for (const r of ((existing as { card_id: string }[]) ?? [])) {
    const def = registry.card(r.card_id);
    const role = def ? registry.player(def.playerId)?.role : undefined;
    if (role) have.set(role, (have.get(role) ?? 0) + 1);
  }

  const instances: { cardId: string; serial: null }[] = [];
  for (const role of DUEL_ROLES) {
    const already = have.get(role) ?? 0;
    if (already >= PER_ROLE) continue;

    // Mejor carta de cada jugador del rol, de mayor a menor: cartas distintas y jugadores distintos.
    const best = new Map<string, { id: string; ovr: number }>();
    for (const c of registry.forRole(role)) {
      if (!c.combat) continue;
      const prev = best.get(c.playerId);
      if (!prev || c.ovr > prev.ovr) best.set(c.playerId, { id: c.id, ovr: c.ovr });
    }
    const pool = [...best.values()].sort((a, b) => b.ovr - a.ovr || a.id.localeCompare(b.id));
    for (const c of pool.slice(0, PER_ROLE - already)) instances.push({ cardId: c.id, serial: null });
  }

  if (instances.length === 0) {
    console.log(`✓ ${label} ya tiene cartas suficientes de los cinco roles. No se concede nada.`);
    return;
  }

  const { error } = await admin.rpc("app_grant_cards", {
    p_user: userId, p_instances: instances, p_mint_delta: {}, p_origin: "admin",
  });
  if (error) { console.error("Error al conceder:", error.message); process.exit(1); }

  console.log(`✓ ${instances.length} cartas concedidas a ${label}:`);
  for (const i of instances) {
    const def = registry.card(i.cardId)!;
    const p = registry.player(def.playerId);
    console.log(`   ${p?.nick ?? def.playerId} · ${p?.role} · OVR ${def.ovr} · ${def.variantId}`);
  }
  console.log("\nYa puedes crear un mazo en /duelos/mazos.");
}

main().catch((e) => { console.error(e); process.exit(1); });
