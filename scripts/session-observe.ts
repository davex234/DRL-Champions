/**
 * OBSERVADOR DE PRIMERA SESIÓN (Fase 17) — `npm run session:observe`
 *
 *   npm run session:observe                      → todas las cuentas creadas hoy
 *   npm run session:observe -- --since 2026-09-03T09:00:00Z
 *   npm run session:observe -- --user pepe       → por username, email o uuid
 *   npm run session:observe -- --json            → salida JSON para pegar en el informe
 *
 * ────────────────────────── QUÉ ES, Y QUÉ NO ES ──────────────────────────
 *
 * Es una herramienta de LECTURA. No escribe ni una fila, no crea esquema, no añade telemetría
 * y no toca el producto: hace `select` sobre las tablas que YA existen y reconstruye la línea
 * de tiempo de la primera sesión de una persona.
 *
 * Existe porque la Fase 16 midió que NEXUS registra TRANSACCIONES pero no PRESENCIA. De los
 * doce puntos que la Fase 17 quería medir, ocho ya se pueden reconstruir desde el libro mayor
 * y las marcas de tiempo por fila; los otros cuatro son navegación y no dejan rastro. Este
 * script extrae los ocho y DECLARA los cuatro que faltan, para que nadie los dé por medidos.
 *
 * ────────────────────────── POR QUÉ NO LEE `profiles` ──────────────────────────
 *
 * `profiles.packs_opened`, `distinct_cards`, `collection_value` y `rarest_rank` están
 * declarados y protegidos por trigger, pero NO los escribe nadie: valen 0 para siempre. Medir
 * desde ahí daría cero y no se notaría. Aquí se cuenta contra `user_cards`, `economy_ops` y
 * `user_game`, que son las que sí se mueven.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
const argOf = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const asJson = args.includes("--json");

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !SERVICE) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY (.env.local).");
  process.exit(1);
}
const db: SupabaseClient = createClient(URL_, SERVICE, { auth: { persistSession: false } });

/** Marca temporal mínima de una consulta, o `null` si no hay ninguna fila. */
async function firstAt(
  table: string, column: string, filters: (q: any) => any,
): Promise<string | null> {
  const { data } = await filters(db.from(table).select(column)).order(column, { ascending: true }).limit(1);
  const row = (data as Record<string, string>[] | null)?.[0];
  return row ? row[column] : null;
}

const fmt = (t0: string, at: string | null): string => {
  if (!at) return "—";
  const ms = new Date(at).getTime() - new Date(t0).getTime();
  if (ms < 0) return "(antes del alta)";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

interface Milestones {
  username: string; userId: string; registeredAt: string;
  firstCard: string | null; firstPackOpen: string | null; firstPackBuy: string | null;
  firstDeck: string | null; firstDuelStart: string | null; firstDuelEnd: string | null;
  firstReward: string | null; firstPickem: string | null; firstPrediction: string | null;
  cards: number; packsOpened: number; duels: number; duelsFinished: number;
  pickems: number; predictions: number; achievements: number;
  level: number; xp: number; credits: number; creditsIn: number; creditsOut: number;
}

async function observe(p: { id: string; username: string; created_at: string; level: number; xp: number; credits: number }): Promise<Milestones> {
  const uid = p.id;
  const t0 = p.created_at;

  const [firstCard, firstPackOpen, firstPackBuy, firstDeck, firstDuelStart] = await Promise.all([
    firstAt("user_cards", "obtained_at", (q) => q.eq("user_id", uid)),
    firstAt("economy_ops", "created_at", (q) => q.eq("user_id", uid).eq("kind", "open_pack")),
    firstAt("economy_ops", "created_at", (q) => q.eq("user_id", uid).eq("kind", "buy_pack")),
    firstAt("duel_decks", "created_at", (q) => q.eq("user_id", uid)),
    firstAt("duel_matches", "created_at", (q) => q.eq("user_id", uid)),
  ]);

  // Fin de duelo: `status` terminal + `updated_at` (lo mantiene el trigger touch_updated_at).
  const firstDuelEnd = await firstAt("duel_matches", "updated_at",
    (q) => q.eq("user_id", uid).in("status", ["COMPLETED", "DRAW"]));

  // Primera recompensa = primer ingreso que NO es el alta automática.
  const { data: inflow } = await db.from("credit_transactions")
    .select("created_at, reason, delta").eq("user_id", uid).gt("delta", 0)
    .order("created_at", { ascending: true });
  const firstReward = (inflow ?? []).find((r: any) => r.reason !== "starter_grant")?.created_at ?? null;

  const firstPickem = await firstAt("pickem_submissions", "created_at", (q) => q.eq("user_id", uid));

  // Predicción: una respuesta concreta dentro de una entrega del usuario.
  const { data: subs } = await db.from("pickem_submissions").select("id").eq("user_id", uid);
  const subIds = (subs as { id: string }[] | null)?.map((s) => s.id) ?? [];
  let firstPrediction: string | null = null;
  let predictions = 0;
  if (subIds.length) {
    const { data: ans } = await db.from("pickem_answers")
      .select("created_at").in("submission_id", subIds).order("created_at", { ascending: true });
    predictions = (ans ?? []).length;
    firstPrediction = (ans as { created_at: string }[] | null)?.[0]?.created_at ?? null;
  }

  /** Cuenta filas de la tabla para este usuario, con un filtro extra opcional. */
  const count = async (table: string, extra: (q: any) => any = (q) => q): Promise<number> => {
    const { count: n } = await extra(
      db.from(table).select("*", { count: "exact", head: true }).eq("user_id", uid),
    );
    return n ?? 0;
  };
  const finished = (q: any) => q.in("status", ["COMPLETED", "DRAW"]);
  const [cards, duels, duelsFinished, pickems, achievements] = await Promise.all([
    count("user_cards"),
    count("duel_matches"),
    count("duel_matches", finished),
    count("pickem_submissions"),
    count("user_achievements"),
  ]);

  // Sobres abiertos: `user_game`, NUNCA `profiles.packs_opened` (ver cabecera).
  const { data: ug } = await db.from("user_game").select("packs_opened").eq("user_id", uid).maybeSingle();

  const { data: tx } = await db.from("credit_transactions").select("delta").eq("user_id", uid);
  let creditsIn = 0, creditsOut = 0;
  for (const r of (tx as { delta: number }[] | null) ?? []) {
    if (r.delta > 0) creditsIn += Number(r.delta); else creditsOut += -Number(r.delta);
  }

  return {
    username: p.username, userId: uid, registeredAt: t0,
    firstCard, firstPackOpen, firstPackBuy, firstDeck, firstDuelStart, firstDuelEnd,
    firstReward, firstPickem, firstPrediction,
    cards, packsOpened: (ug as { packs_opened: number } | null)?.packs_opened ?? 0,
    duels, duelsFinished, pickems, predictions, achievements,
    level: p.level, xp: p.xp, credits: Number(p.credits), creditsIn, creditsOut,
  };
}

/** Lo que este script NO puede responder. Se imprime siempre: si falta, se da por medido. */
const NO_MEDIBLE = [
  ["Tiempo total de sesión", "no existe señal de inicio/fin de sesión"],
  ["Entrada en la colección", "es navegación; no deja fila"],
  ["Visita al perfil", "es navegación; no deja fila"],
  ["Descubrimiento de objetivos", "es navegación; no deja fila"],
  ["Punto de abandono", "haría falta saber en qué pantalla estaba"],
  ["Retorno al día siguiente (D1+)", "no hay señal de actividad diaria (deuda 5)"],
  ["Qué pantalla no entiende", "nunca será telemetría: se observa"],
];

async function main(): Promise<void> {
  const who = argOf("--user");
  let q = db.from("profiles").select("id, username, created_at, level, xp, credits");

  if (who) {
    const isUuid = /^[0-9a-f-]{36}$/i.test(who);
    q = isUuid ? q.eq("id", who) : q.ilike("username", `%${who}%`);
  } else {
    const since = argOf("--since") ?? new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
    q = q.gte("created_at", since);
  }

  const { data: profiles, error } = await q.order("created_at", { ascending: true });
  if (error) { console.error("Error leyendo profiles:", error.message); process.exit(1); }

  const rows = (profiles ?? []) as any[];
  if (!rows.length) {
    console.log("No hay cuentas que observar con ese criterio.");
    console.log("Prueba con --since 2026-01-01 o --user <username>.");
    return;
  }

  const out: Milestones[] = [];
  for (const p of rows) out.push(await observe(p));

  if (asJson) { console.log(JSON.stringify(out, null, 2)); return; }

  console.log("# Observación de primera sesión — NEXUS\n");
  console.log(`Cuentas observadas: ${out.length}\n`);

  for (const m of out) {
    console.log("─".repeat(78));
    console.log(`${m.username}   ·   alta ${m.registeredAt.slice(0, 19).replace("T", " ")}`);
    console.log("─".repeat(78));
    const line = (label: string, at: string | null) =>
      console.log(`  ${label.padEnd(34)} ${fmt(m.registeredAt, at).padStart(12)}   ${at ? at.slice(11, 19) : ""}`);
    line("primer sobre COMPRADO", m.firstPackBuy);
    line("primer sobre ABIERTO", m.firstPackOpen);
    line("primera CARTA", m.firstCard);
    line("primer MAZO", m.firstDeck);
    line("primer DUELO iniciado", m.firstDuelStart);
    line("primer DUELO terminado", m.firstDuelEnd);
    line("primera RECOMPENSA", m.firstReward);
    line("primer PICK'EM enviado", m.firstPickem);
    line("primera PREDICCIÓN", m.firstPrediction);
    console.log("");
    console.log(`  cartas ${m.cards} · sobres abiertos ${m.packsOpened} · duelos ${m.duels} (${m.duelsFinished} terminados)`);
    console.log(`  pick'ems ${m.pickems} (${m.predictions} respuestas) · logros ${m.achievements}`);
    console.log(`  nivel ${m.level} · xp ${m.xp} · saldo ${m.credits} · créditos +${m.creditsIn} / −${m.creditsOut}`);
    console.log("");
  }

  // Resumen agregado. Sin inventar: solo cuenta cuántos llegaron a cada hito.
  console.log("═".repeat(78));
  console.log("  EMBUDO (cuántas de las cuentas observadas llegaron a cada hito)");
  console.log("═".repeat(78));
  const funnel: [string, (m: Milestones) => boolean][] = [
    ["abrió un sobre", (m) => !!m.firstPackOpen],
    ["consiguió una carta", (m) => !!m.firstCard],
    ["construyó un mazo", (m) => !!m.firstDeck],
    ["empezó un duelo", (m) => !!m.firstDuelStart],
    ["terminó un duelo", (m) => !!m.firstDuelEnd],
    ["cobró una recompensa", (m) => !!m.firstReward],
    ["envió un Pick'em", (m) => !!m.firstPickem],
  ];
  for (const [label, pred] of funnel) {
    const n = out.filter(pred).length;
    console.log(`  ${label.padEnd(26)} ${String(n).padStart(3)} / ${out.length}`);
  }

  console.log("\n" + "═".repeat(78));
  console.log("  NO MEDIBLE CON ESTE SCRIPT (hay que OBSERVAR a la persona)");
  console.log("═".repeat(78));
  for (const [what, why] of NO_MEDIBLE) console.log(`  · ${what.padEnd(34)} ${why}`);
  console.log("");
}

main().catch((e) => { console.error(e); process.exit(1); });
