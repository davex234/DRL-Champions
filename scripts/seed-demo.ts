/**
 * SEED DE DEMOSTRACIÓN — torneo + partidos + Pick'ems.
 *
 *   npm run seed:demo          (idempotente: se puede reejecutar)
 *   npm run seed:demo -- --reset-picks   (borra además las predicciones y puntos)
 *
 * POR QUÉ EXISTE
 *   La integración con una fuente real (VLR) necesita un proxy que todavía no
 *   existe. Para no bloquear el MVP se siembra un torneo de DEMOSTRACIÓN, pero
 *   marcado como tal de forma inequívoca:
 *
 *     · `events.source = 'demo'` en base de datos.
 *     · La UI muestra un distintivo "DEMO" en todo torneo con ese origen.
 *
 *   Los nombres de equipos son reales (ya estaban en `src/data/teams.ts`), pero
 *   NINGÚN resultado aquí corresponde a un partido real. No se presentan datos
 *   inventados como si fueran reales.
 *
 * QUÉ NO SIMULA
 *   Nada del usuario. Predicciones, puntos, cartas, sobres, recompensas e
 *   inventario se generan de verdad contra el backend cuando el usuario actúa.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { DEMO_EVENT_ID } from "./lib/demo-constants";

const ROOT = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!URL_ || !SERVICE) {
  console.error("❌ Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
  console.error("   Levanta el entorno local:  npx supabase start");
  process.exit(1);
}
const sb = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

export { DEMO_EVENT_ID } from "./lib/demo-constants";
const DEMO_PICKEM_TITLE = "Pick'ems · DRL Masters Madrid 2026";

const day = 24 * 60 * 60 * 1000;
const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

const TEAMS = [
  { id: "demo-th",   name: "Team Heretics",     tag: "TH",   region: "EMEA" },
  { id: "demo-fnc",  name: "Fnatic",            tag: "FNC",  region: "EMEA" },
  { id: "demo-tl",   name: "Team Liquid",       tag: "TL",   region: "EMEA" },
  { id: "demo-kc",   name: "Karmine Corp",      tag: "KC",   region: "EMEA" },
  { id: "demo-nrg",  name: "NRG",               tag: "NRG",  region: "Americas" },
  { id: "demo-sen",  name: "Sentinels",         tag: "SEN",  region: "Americas" },
  { id: "demo-geng", name: "Gen.G",             tag: "GENG", region: "Pacific" },
  { id: "demo-drx",  name: "DRX",               tag: "DRX",  region: "Pacific" },
];

/** Partidos: 2 ya jugados, 1 en curso (bloqueado), 4 por jugar. */
const MATCHES = [
  { id: "demo-m1", a: "demo-th",   b: "demo-kc",   round: "Cuartos",   order: 1, at: now - 3 * day, status: "finished", sa: 2, sb: 0, winner: "demo-th" },
  { id: "demo-m2", a: "demo-fnc",  b: "demo-tl",   round: "Cuartos",   order: 2, at: now - 2 * day, status: "finished", sa: 1, sb: 2, winner: "demo-tl" },
  { id: "demo-m3", a: "demo-nrg",  b: "demo-sen",  round: "Cuartos",   order: 3, at: now - 30 * 60 * 1000, status: "live", sa: 1, sb: 1, winner: null },
  { id: "demo-m4", a: "demo-geng", b: "demo-drx",  round: "Cuartos",   order: 4, at: now + 1 * day, status: "upcoming", sa: null, sb: null, winner: null },
  { id: "demo-m5", a: "demo-th",   b: "demo-tl",   round: "Semifinal", order: 5, at: now + 3 * day, status: "upcoming", sa: null, sb: null, winner: null },
  { id: "demo-m6", a: "demo-nrg",  b: "demo-geng", round: "Semifinal", order: 6, at: now + 4 * day, status: "upcoming", sa: null, sb: null, winner: null },
  { id: "demo-m7", a: "demo-th",   b: "demo-nrg",  round: "Final",     order: 7, at: now + 6 * day, status: "upcoming", sa: null, sb: null, winner: null },
];

const nameOf = (id: string) => TEAMS.find((t) => t.id === id)?.name ?? id;

async function main() {
  const reset = process.argv.includes("--reset-picks");
  console.log("# Seed de demostración — DRL Masters Madrid 2026\n");

  // ── Temporada ──
  await sb.from("seasons").upsert({
    id: "s1", name: "Temporada 1", starts_at: iso(now - 30 * day),
    ends_at: iso(now + 60 * day), active: true,
  });
  console.log("  ✓ temporada activa");

  // ── Equipos ──
  await sb.from("teams").upsert(TEAMS.map((t) => ({
    id: t.id, name: t.name, tag: t.tag, region: t.region, active: true,
  })), { onConflict: "id" });
  console.log(`  ✓ ${TEAMS.length} equipos`);

  // ── Torneo (marcado como DEMO en la propia base de datos) ──
  const { error: evErr } = await sb.from("events").upsert({
    id: DEMO_EVENT_ID,
    name: "DRL Masters Madrid 2026",
    type: "international",
    region: "Internacional",
    status: "ongoing",
    start_date: iso(now - 5 * day),
    end_date: iso(now + 7 * day),
    source: "demo",              // ← distintivo de datos de demostración
    tier: "vct-international",
    slug: "demo-masters-madrid-2026",
    prize_pool: 500000,
    location: "Madrid",
    country: "España",
  }, { onConflict: "id" });
  if (evErr) throw new Error(`events: ${evErr.message}`);
  console.log("  ✓ torneo (source='demo')");

  // ── Fase ──
  const { data: stageRows, error: stErr } = await sb.from("stages")
    .upsert({ event_id: DEMO_EVENT_ID, slug: "playoffs", name: "Playoffs", kind: "playoff", order_idx: 0 },
            { onConflict: "event_id,slug" })
    .select("id");
  if (stErr) throw new Error(`stages: ${stErr.message}`);
  const stageId = stageRows?.[0]?.id ?? null;
  console.log("  ✓ fase Playoffs");

  // ── Partidos ──
  const { error: mErr } = await sb.from("matches").upsert(MATCHES.map((m) => ({
    id: m.id, event_id: DEMO_EVENT_ID, stage_id: stageId,
    team_a: nameOf(m.a), team_b: nameOf(m.b),
    team_a_id: m.a, team_b_id: m.b,
    start_time: iso(m.at), status: m.status,
    score_a: m.sa, score_b: m.sb,
    winner_team: m.winner ? nameOf(m.winner) : null,
    winner_team_id: m.winner,
    round: m.round, match_order: m.order, best_of: 3, format: "bo3",
  })), { onConflict: "id" });
  if (mErr) throw new Error(`matches: ${mErr.message}`);
  console.log(`  ✓ ${MATCHES.length} partidos (2 finalizados · 1 en vivo · 4 por jugar)`);

  // ── Pick'em del torneo ──
  const { data: existing } = await sb.from("pickem_events")
    .select("id").eq("event_id", DEMO_EVENT_ID).maybeSingle();

  let pickemId = existing?.id as string | undefined;
  if (!pickemId) {
    const { data, error } = await sb.from("pickem_events").insert({
      event_id: DEMO_EVENT_ID, season_id: "s1",
      title: DEMO_PICKEM_TITLE,
      description: "Predice los ganadores de los playoffs y el campeón del torneo.",
      opens_at: iso(now - 5 * day),
      locks_at: iso(now + 6 * day),
      status: "open",
    }).select("id").single();
    if (error) throw new Error(`pickem_events: ${error.message}`);
    pickemId = data.id as string;
  }
  console.log("  ✓ Pick'em del torneo");

  if (reset) {
    await sb.from("pickem_scores").delete().eq("pickem_event_id", pickemId);
    const { data: subs } = await sb.from("pickem_submissions").select("id").eq("pickem_event_id", pickemId);
    for (const s of subs ?? []) await sb.from("pickem_answers").delete().eq("submission_id", s.id);
    await sb.from("pickem_submissions").delete().eq("pickem_event_id", pickemId);
    console.log("  ✓ predicciones y puntuaciones borradas (--reset-picks)");
  }

  // ── Preguntas ──
  // Una por partido no finalizado + la del campeón. El partido EN VIVO se incluye
  // a propósito con `locks_at` ya pasado: sirve para demostrar el cierre real.
  await sb.from("pickem_questions").delete().eq("pickem_event_id", pickemId);

  const questions = MATCHES
    .filter((m) => m.status !== "finished")
    .map((m, i) => ({
      pickem_event_id: pickemId,
      kind: "match_winner",
      match_id: m.id,
      prompt: `${m.round}: ¿quién gana ${nameOf(m.a)} vs ${nameOf(m.b)}?`,
      options: [
        { key: m.a, label: nameOf(m.a) },
        { key: m.b, label: nameOf(m.b) },
      ],
      points: m.round === "Final" ? 25 : m.round === "Semifinal" ? 15 : 10,
      // El cierre de cada pregunta es el comienzo de SU partido.
      locks_at: iso(m.at),
      order_idx: i,
    }));

  questions.push({
    pickem_event_id: pickemId,
    kind: "champion",
    match_id: null as unknown as string,
    prompt: "¿Qué equipo levantará el trofeo?",
    options: TEAMS.map((t) => ({ key: t.id, label: t.name })),
    points: 50,
    locks_at: iso(now + 1 * day),
    order_idx: questions.length,
  });

  const { error: qErr } = await sb.from("pickem_questions").insert(questions);
  if (qErr) throw new Error(`pickem_questions: ${qErr.message}`);

  const open = questions.filter((q) => new Date(q.locks_at).getTime() > now).length;
  console.log(`  ✓ ${questions.length} preguntas (${open} abiertas · ${questions.length - open} ya cerradas)`);

  console.log("\n✅ Seed de demostración listo.");
  console.log(`   Torneo:  /torneos/${DEMO_EVENT_ID}`);
  console.log(`   Pick'em: ${pickemId}`);
}

main().catch((e) => { console.error("\n💥", e instanceof Error ? e.message : e); process.exit(1); });
