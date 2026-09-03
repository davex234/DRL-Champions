/**
 * VERIFICACIÓN DE EVENTOS EN VIVO — NEXUS (Fase 12).
 *
 *   npm run events:verify
 *
 * ────────────────────────── QUÉ COMPRUEBA ──────────────────────────
 *
 * Que la capa de eventos tiene AUTORIDAD DE SERVIDOR de verdad, contra la base de datos
 * real y con eventos reales creados para la prueba. No comprueba que las cosas funcionen:
 * comprueba que **no se puedan romper**, que es distinto y es lo que importa.
 *
 *   1. El ciclo de vida sale de las FECHAS, no del estado ni del cliente.
 *   2. El progreso lo cuenta el servidor sobre las tablas donde ya está el hecho.
 *   3. Un desafío incompleto NO paga.
 *   4. Un desafío cobrado NO paga dos veces.
 *   5. Un evento ARCHIVADO no paga nada, por completo que esté el desafío.
 *   6. Un desafío de OTRO conjunto no se puede cobrar.
 *   7. Lo cobrado queda registrado y conserva historial.
 *   8. La recompensa pasa por la ruta única y deja asiento en el libro mayor.
 *
 * Se limpia todo lo que crea: usuario, eventos y filas. Un verificador que deja basura
 * acaba haciendo fallar al siguiente.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  getLiveEvent, getEventView, eventMetricsFor, claimEventChallenge,
} from "@/server/services/events";
import { eventPhase, CLAIM_GRACE_DAYS } from "@/domain/events/lifecycle";
import { challengeRef, challengesFor } from "@/domain/events/challenges";

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

let failures = 0;
const check = (l: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✓" : "✕"} ${l}${d ? ` — ${d}` : ""}`);
  if (!c) failures++;
};

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

const profileOf = async (userId: string) => {
  const { data } = await admin.from("profiles").select("credits, xp, tokens").eq("id", userId).maybeSingle();
  return (data ?? { credits: 0, xp: 0, tokens: 0 }) as { credits: number; xp: number; tokens: number };
};

async function main() {
  console.log("# Verificación de EVENTOS EN VIVO — NEXUS (Fase 12)\n");

  const stamp = Date.now();
  const now = Date.now();
  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email: `events-${stamp}@example.invalid`, password: "Test-1234-events",
    email_confirm: true, user_metadata: { username: `evqa${stamp}` },
  });
  if (userErr || !created.user) throw new Error(userErr?.message ?? "no se pudo crear el usuario");
  const userId = created.user.id;

  /*
   * Tres eventos con ventanas distintas. Los ids llevan la marca de tiempo para que dos
   * ejecuciones simultáneas no se pisen.
   */
  const liveId = `ev12-live-${stamp}`;
  const oldId = `ev12-old-${stamp}`;
  const soonId = `ev12-soon-${stamp}`;

  try {
    await admin.from("events").insert([
      {
        id: liveId, name: "Torneo de prueba (en directo)", type: "international",
        status: "ongoing", start_date: iso(now - 3 * DAY), end_date: iso(now + 10 * DAY), source: "test",
      },
      {
        // Terminado hace mucho más que el plazo de gracia: ARCHIVADO.
        id: oldId, name: "Torneo de prueba (archivado)", type: "international",
        status: "ongoing", start_date: iso(now - 90 * DAY),
        end_date: iso(now - (CLAIM_GRACE_DAYS + 5) * DAY), source: "test",
      },
      {
        id: soonId, name: "Torneo de prueba (proximamente)", type: "regional-league",
        status: "upcoming", start_date: iso(now + 20 * DAY), end_date: iso(now + 30 * DAY), source: "test",
      },
    ]);

    // ══════════════════════════════════════════════════════════════════════
    console.log("## 1 · CICLO DE VIDA: LAS FECHAS MANDAN");
    // ══════════════════════════════════════════════════════════════════════
    {
      check("un evento dentro de su ventana esta EN DIRECTO",
        eventPhase({ status: "ongoing", startDate: iso(now - 3 * DAY), endDate: iso(now + 10 * DAY) }, now) === "live");

      /*
       * La invariante que impide que un torneo terminado siga pagando: `status` lo escribe
       * la sincronización y puede ir rezagado, `end_date` es un hecho.
       */
      check("un evento marcado 'ongoing' cuya fecha paso esta ARCHIVADO",
        eventPhase({ status: "ongoing", startDate: iso(now - 90 * DAY), endDate: iso(now - (CLAIM_GRACE_DAYS + 5) * DAY) }, now) === "archived",
        "el estado de la sincronizacion NO manda sobre la fecha");

      const live = await getLiveEvent(admin, now);
      check("el servidor elige un evento vivo, nunca uno archivado",
        live !== null && live.phase !== "archived", live ? `${live.id} (${live.phase})` : "ninguno");
    }

    // ══════════════════════════════════════════════════════════════════════
    console.log("\n## 2 · EL PROGRESO LO CUENTA EL SERVIDOR");
    // ══════════════════════════════════════════════════════════════════════
    {
      const live = { id: liveId, name: "x", type: "international", region: null, isDemo: false,
        phase: "live" as const, startDate: iso(now - 3 * DAY), endDate: iso(now + 10 * DAY) };

      const before = await eventMetricsFor(admin, userId, live, now);
      check("un jugador nuevo empieza a cero en todas las metricas del evento",
        Object.values(before).every((v) => v === 0), JSON.stringify(before));

      /*
       * Dos duelos DENTRO de la ventana y uno FUERA. Solo deben contar los de dentro: un
       * desafío de evento que contara partidas anteriores sería un logro retroactivo.
       */
      const rows = [
        { user_id: userId, difficulty: "NORMAL", status: "COMPLETED", winner: "A",
          state: {}, rng: {}, rules_version: "test", created_at: iso(now - 2 * DAY) },
        { user_id: userId, difficulty: "NORMAL", status: "COMPLETED", winner: "A",
          state: {}, rng: {}, rules_version: "test", created_at: iso(now - 1 * DAY) },
        { user_id: userId, difficulty: "NORMAL", status: "COMPLETED", winner: "A",
          state: {}, rng: {}, rules_version: "test", created_at: iso(now - 30 * DAY) },
      ];
      await admin.from("duel_matches").insert(rows);

      const after = await eventMetricsFor(admin, userId, live, now);
      check("cuenta los duelos jugados DENTRO de la ventana",
        after.event_duels_played === 2, `${after.event_duels_played} (uno anterior queda fuera)`);
      check("cuenta las victorias de la ventana",
        after.event_duels_won === 2, `${after.event_duels_won}`);
    }

    // ══════════════════════════════════════════════════════════════════════
    console.log("\n## 3 · UN DESAFIO INCOMPLETO NO PAGA");
    // ══════════════════════════════════════════════════════════════════════
    {
      const before = await profileOf(userId);
      // «Gana 3 duelos» y solo lleva 2.
      const r = await claimEventChallenge(admin, userId, liveId, "dominar", now);
      check("rechaza cobrar un desafio a medias", !r.ok && r.status === 409, r.error ?? "");
      const after = await profileOf(userId);
      check("y NO ha tocado el saldo", after.credits === before.credits,
        `${before.credits} -> ${after.credits}`);
    }

    // ══════════════════════════════════════════════════════════════════════
    console.log("\n## 4 · UN DESAFIO COMPLETO PAGA UNA VEZ");
    // ══════════════════════════════════════════════════════════════════════
    {
      // La tercera victoria, dentro de la ventana.
      await admin.from("duel_matches").insert({
        user_id: userId, difficulty: "NORMAL", status: "COMPLETED", winner: "A",
        state: {}, rng: {}, rules_version: "test", created_at: iso(now - 12 * 3600_000),
      });

      const before = await profileOf(userId);
      const first = await claimEventChallenge(admin, userId, liveId, "dominar", now);
      check("cobra el desafio completo", first.ok, first.error ?? "");
      const mid = await profileOf(userId);
      check("el saldo sube exactamente lo que dice el desafio",
        mid.credits === before.credits + 1200, `${before.credits} -> ${mid.credits}`);

      /*
       * El segundo intento. Es EL ataque de esta sección: repetir la petición, que es lo
       * que hace un doble clic o un reintento de red.
       */
      const second = await claimEventChallenge(admin, userId, liveId, "dominar", now);
      check("un segundo cobro se RECHAZA", !second.ok && second.status === 409, second.error ?? "");
      const after = await profileOf(userId);
      check("y el saldo no se ha movido", after.credits === mid.credits,
        `${mid.credits} -> ${after.credits}`);

      // El asiento en el libro mayor, con la clave de idempotencia como rastro.
      const { data: tx } = await admin.from("credit_transactions")
        .select("delta, ref").eq("user_id", userId).eq("ref", challengeRef(liveId, "dominar"));
      check("deja UN asiento en el libro mayor con su clave",
        (tx ?? []).length === 1, `${(tx ?? []).length} asientos`);
    }

    // ══════════════════════════════════════════════════════════════════════
    console.log("\n## 5 · UN EVENTO ARCHIVADO NO PAGA NADA");
    // ══════════════════════════════════════════════════════════════════════
    {
      /*
       * Se siembran tres victorias DENTRO de la ventana del evento archivado. Es
       * imprescindible para que la comprobación signifique algo: si el desafío estuviera
       * incompleto, el rechazo podría deberse al progreso y no al plazo, y no habríamos
       * comprobado lo que dice el titular.
       */
      await admin.from("duel_matches").insert(
        [40, 50, 60].map((d) => ({
          user_id: userId, difficulty: "NORMAL", status: "COMPLETED", winner: "A",
          state: {}, rng: {}, rules_version: "test", created_at: iso(now - d * DAY),
        })),
      );

      const old = { id: oldId, name: "x", type: "international", region: null, isDemo: false,
        phase: "archived" as const, startDate: iso(now - 90 * DAY),
        endDate: iso(now - (CLAIM_GRACE_DAYS + 5) * DAY) };
      const m = await eventMetricsFor(admin, userId, old, now);
      check("el desafio ESTA completo tambien en el evento archivado",
        m.event_duels_won >= 3, `${m.event_duels_won} victorias en su ventana`);

      const before = await profileOf(userId);
      const r = await claimEventChallenge(admin, userId, oldId, "dominar", now);
      check("aun asi, RECHAZA el cobro por plazo cerrado", !r.ok && r.status === 409, r.error ?? "");
      const after = await profileOf(userId);
      check("y no ha pagado nada", after.credits === before.credits);
    }

    // ══════════════════════════════════════════════════════════════════════
    console.log("\n## 6 · UN DESAFIO DE OTRO CONJUNTO NO EXISTE");
    // ══════════════════════════════════════════════════════════════════════
    {
      /*
       * `analista` solo existe en el conjunto internacional. Pedirlo sobre un torneo
       * regional es un id inventado, y un id inventado no puede abrir una puerta.
       */
      const regional = challengesFor({ id: soonId, type: "regional-league", region: "EMEA" });
      check("el conjunto regional no incluye el desafio internacional",
        !regional.some((c) => c.id === "analista"));

      const r = await claimEventChallenge(admin, userId, soonId, "analista", now);
      check("rechaza un desafio que no pertenece al evento", !r.ok, r.error ?? "");

      const bogus = await claimEventChallenge(admin, userId, liveId, "no-existe-nada", now);
      check("rechaza un identificador inventado", !bogus.ok && bogus.status === 404, bogus.error ?? "");
    }

    // ══════════════════════════════════════════════════════════════════════
    console.log("\n## 7 · UN EVENTO QUE NO HA EMPEZADO TAMPOCO PAGA");
    // ══════════════════════════════════════════════════════════════════════
    {
      const r = await claimEventChallenge(admin, userId, soonId, "competir", now);
      check("rechaza cobrar en un evento futuro", !r.ok && r.status === 409, r.error ?? "");
      const ghost = await claimEventChallenge(admin, userId, `no-existe-${stamp}`, "competir", now);
      check("rechaza un evento inexistente", !ghost.ok && ghost.status === 404, ghost.error ?? "");
    }

    // ══════════════════════════════════════════════════════════════════════
    console.log("\n## 8 · LA VISTA DICE LA VERDAD");
    // ══════════════════════════════════════════════════════════════════════
    {
      const res = await getEventView(admin, userId, now);
      check("la vista se construye", res.ok && res.data !== null, res.error ?? "");
      const v = res.data!;
      check("señala el evento vivo, no el archivado", v.event.id === liveId, v.event.id);
      check("y su fase", v.event.phase === "live" || v.event.phase === "ending", v.event.phase);

      const dominar = v.challenges.find((c) => c.id === "dominar")!;
      check("marca como COBRADO lo que ya se cobro", dominar.claimed === true);
      check("y ya no lo ofrece", dominar.claimable === false);

      const competir = v.challenges.find((c) => c.id === "competir")!;
      check("un desafio a medias enseña su progreso real",
        competir.progress === 3 && competir.goal === 5, `${competir.progress}/${competir.goal}`);
      check("y no se puede cobrar", competir.claimable === false);

      check("el total que reparte el evento es el de sus desafios",
        (v.totalReward.credits ?? 0) > 0, `${v.totalReward.credits} cr`);
      check("y el plazo de reclamacion esta calculado", v.event.claimClosesAt !== null);
    }

    // ══════════════════════════════════════════════════════════════════════
    console.log("\n## 9 · HISTORIAL");
    // ══════════════════════════════════════════════════════════════════════
    {
      const { data } = await admin.from("user_achievements")
        .select("achievement_id, claimed_at").eq("user_id", userId)
        .like("achievement_id", "event:%");
      const rows = (data ?? []) as { achievement_id: string; claimed_at: string }[];
      check("lo cobrado queda registrado con su evento y su fecha",
        rows.length === 1 && rows[0].achievement_id === challengeRef(liveId, "dominar"),
        rows.map((r) => r.achievement_id).join(", "));
      check("el registro conserva cuando se cobro", !!rows[0]?.claimed_at);
    }
  } finally {
    // Limpieza. Un verificador que deja basura hace fallar al siguiente.
    await admin.from("duel_matches").delete().eq("user_id", userId);
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    await admin.from("events").delete().in("id", [liveId, oldId, soonId]);
  }

  console.log(
    failures === 0
      ? "\n✅ LOS EVENTOS TIENEN AUTORIDAD DE SERVIDOR"
      : `\n❌ ${failures} comprobacion(es) fallida(s)`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
