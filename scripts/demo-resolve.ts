/**
 * AVANZAR EL TORNEO DE DEMOSTRACIÓN — resuelve partidos y corrige los Pick'ems.
 *
 *   npm run demo:resolve                 → resuelve el siguiente partido pendiente
 *   npm run demo:resolve -- --all        → resuelve todos los partidos restantes
 *   npm run demo:resolve -- --match demo-m4 --winner demo-drx
 *
 * QUÉ HACE DE VERDAD
 *   Escribe el resultado en `matches`, fija la opción correcta de la pregunta de
 *   ese partido y ejecuta el CORRECTOR real (`app_score_pickem_event`), que
 *   reparte puntos y recompensas a los usuarios que hayan predicho.
 *
 * QUÉ NO HACE
 *   No inventa predicciones ni usuarios. Solo mueve el estado del torneo, que es
 *   lo que en producción hará el sincronizador cuando llegue el resultado real.
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
  console.error("❌ Faltan credenciales. Ejecuta: npx supabase start");
  process.exit(1);
}
const sb = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface MatchRow {
  id: string; team_a: string | null; team_b: string | null;
  team_a_id: string | null; team_b_id: string | null;
  status: string; round: string | null; match_order: number | null;
}

async function resolveMatch(m: MatchRow, winnerId: string): Promise<void> {
  const winnerName = winnerId === m.team_a_id ? m.team_a : m.team_b;
  const isA = winnerId === m.team_a_id;

  const { error } = await sb.from("matches").update({
    status: "finished",
    score_a: isA ? 2 : 0,
    score_b: isA ? 0 : 2,
    winner_team_id: winnerId,
    winner_team: winnerName,
    updated_at: new Date().toISOString(),
  }).eq("id", m.id);
  if (error) throw new Error(`matches: ${error.message}`);

  // La pregunta de ese partido pasa a tener respuesta correcta.
  const { data: q } = await sb.from("pickem_questions")
    .select("id, prompt, locks_at").eq("match_id", m.id).maybeSingle();
  if (q) {
    /*
     * CIERRE ANTES DE REVELAR. En producción no hace falta: `locks_at` es la hora de
     * inicio del partido, así que cuando llega el resultado la pregunta ya cerró sola.
     * En la demo se adelanta el final de un partido futuro, y sin esto quedaba una
     * pregunta con el resultado ya fijado pero todavía ABIERTA. Dos consecuencias, las
     * dos malas:
     *   · integridad — `app_submit_pick` solo mira el reloj, así que aceptaría una
     *     predicción sobre un resultado que ya se conoce;
     *   · UX — la vista pública oculta `correct_option` hasta el cierre, así que el
     *     usuario veía los puntos sumados sin poder ver de qué pregunta salían.
     * Se cierra por el mismo mecanismo de siempre (mover `locks_at`), no relajando la
     * comprobación: el servidor sigue decidiendo el cierre con su propio reloj.
     */
    const closedAt = new Date().toISOString();
    if (new Date(q.locks_at).getTime() > Date.now()) {
      const { error: lockErr } = await sb.from("pickem_questions")
        .update({ locks_at: closedAt }).eq("id", q.id);
      if (lockErr) throw new Error(`cerrar pregunta: ${lockErr.message}`);
    }

    const { error: qErr } = await sb.rpc("app_set_correct_option", {
      p_question_id: q.id, p_correct: winnerId,
    });
    if (qErr) throw new Error(`app_set_correct_option: ${qErr.message}`);
    console.log(`  ✓ ${m.round} · ${m.team_a} vs ${m.team_b} → gana ${winnerName} (pregunta cerrada)`);
  } else {
    console.log(`  ✓ ${m.round} · ${m.team_a} vs ${m.team_b} → gana ${winnerName} (sin pregunta asociada)`);
  }
}

async function main() {
  console.log("# Avanzar el torneo de demostración\n");

  const { data: rows, error } = await sb.from("matches")
    .select("id, team_a, team_b, team_a_id, team_b_id, status, round, match_order")
    .eq("event_id", DEMO_EVENT_ID)
    .order("match_order");
  if (error) throw new Error(error.message);

  const matches = (rows as MatchRow[]) ?? [];
  const pending = matches.filter((m) => m.status !== "finished");

  const explicitMatch = arg("match");
  const explicitWinner = arg("winner");
  const all = process.argv.includes("--all");

  if (pending.length === 0) {
    console.log("  Todos los partidos están ya finalizados.");
  } else if (explicitMatch) {
    const m = matches.find((x) => x.id === explicitMatch);
    if (!m) throw new Error(`Partido no encontrado: ${explicitMatch}`);
    const winner = explicitWinner ?? m.team_a_id!;
    if (winner !== m.team_a_id && winner !== m.team_b_id) {
      throw new Error(`El ganador debe ser ${m.team_a_id} o ${m.team_b_id}`);
    }
    await resolveMatch(m, winner);
  } else {
    // Sin ganador explícito gana el equipo local: es una demo, no una simulación,
    // y así el resultado es predecible para quien la enseña.
    const target = all ? pending : pending.slice(0, 1);
    for (const m of target) await resolveMatch(m, m.team_a_id!);
  }

  // ── Corregir: puntos y recompensas reales ──
  const { data: pe } = await sb.from("pickem_events")
    .select("id, title").eq("event_id", DEMO_EVENT_ID).maybeSingle();
  if (!pe) { console.log("\n  (sin Pick'em asociado)"); return; }

  /*
   * PREGUNTA DE CAMPEÓN. No cuelga de ningún partido (`match_id` nulo), así que el
   * bucle de arriba nunca la tocaba: se quedaba abierta para siempre y sus 50 puntos
   * —los que hacen falta para los escalones que reparten sobre— eran inalcanzables.
   * En cuanto la Final tiene ganador, el campeón ES ese ganador: se cierra y se fija
   * con el mismo mecanismo que las demás.
   */
  const finalMatch = matches.find((m) => (m.round ?? "").toLowerCase() === "final");
  if (finalMatch) {
    const { data: fin } = await sb.from("matches")
      .select("winner_team_id, winner_team").eq("id", finalMatch.id).maybeSingle();
    const champion = fin as { winner_team_id: string | null; winner_team: string | null } | null;

    if (champion?.winner_team_id) {
      const { data: champQ } = await sb.from("pickem_questions")
        .select("id, locks_at, correct_option")
        .eq("pickem_event_id", pe.id).eq("kind", "champion").maybeSingle();
      const q = champQ as { id: string; locks_at: string; correct_option: string | null } | null;

      if (q && !q.correct_option) {
        if (new Date(q.locks_at).getTime() > Date.now()) {
          await sb.from("pickem_questions")
            .update({ locks_at: new Date().toISOString() }).eq("id", q.id);
        }
        const { error: cErr } = await sb.rpc("app_set_correct_option", {
          p_question_id: q.id, p_correct: champion.winner_team_id,
        });
        if (cErr) throw new Error(`campeón: ${cErr.message}`);
        console.log(`  ✓ Campeón del torneo → ${champion.winner_team ?? champion.winner_team_id} (pregunta cerrada)`);
      }
    }
  }

  const { scorePickemEvent } = await import("../src/server/services/pickems");
  const res = await scorePickemEvent(sb, pe.id);
  if (!res.ok) throw new Error(res.error);

  console.log(`\n  Corrección ejecutada sobre "${pe.title}"`);
  console.log(`  · usuarios corregidos: ${res.data.users}`);
  console.log(`  · puntos repartidos:   ${res.data.pointsAwarded}`);
  for (const r of res.data.rewarded) {
    console.log(`    - ${r.userId.slice(0, 8)}… → ${r.points} pts · escalón: ${r.tier ?? "ninguno"}`);
  }

  // El Pick'em vuelve a 'open' si aún quedan preguntas por cerrar: corregir un
  // partido no cierra el torneo entero.
  const { data: openQ } = await sb.from("pickem_questions")
    .select("id").eq("pickem_event_id", pe.id).is("correct_option", null).limit(1);
  if ((openQ ?? []).length > 0) {
    await sb.from("pickem_events").update({ status: "open" }).eq("id", pe.id);
    console.log("\n  Quedan preguntas pendientes: el Pick'em sigue abierto.");
  } else {
    console.log("\n  Todas las preguntas resueltas: Pick'em cerrado y puntuado.");
  }

  console.log("\n✅ Listo.");
}

main().catch((e) => { console.error("\n💥", e instanceof Error ? e.message : e); process.exit(1); });
