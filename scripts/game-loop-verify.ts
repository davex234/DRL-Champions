/**
 * VERIFICACIÓN — EL CICLO DE JUEGO (NEXUS, Fase 10).
 *
 *   npx tsx scripts/game-loop-verify.ts
 *
 * Recorre la cadena entera contra la base de datos REAL, sin navegador y sin interfaz:
 *
 *   TORNEO → PREDICCIÓN → RESULTADO → PUNTOS → RECOMPENSA → PROGRESIÓN
 *   DUELO  → PUNTOS + CRÉDITOS + XP → RANGO
 *   ESTADO → «qué hacer ahora»
 *
 * Lo que demuestra, y que antes de la Fase 10 NO era cierto:
 *
 *   · que terminar un duelo mueve el rango, el saldo y la experiencia;
 *   · que ese pago ocurre UNA sola vez por partida aunque se reintente;
 *   · que un torneo con partidos genera predicciones solo;
 *   · que un partido terminado fija su resultado y reparte puntos y recompensa;
 *   · que reejecutar la cadena entera no duplica nada;
 *   · que el ciclo («qué hacer ahora») responde con datos reales del jugador.
 *
 * Limpia todo lo que crea.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { CardRegistry } from "@/collection/registry";
import { DUEL_ROLES } from "@/domain/cardgame";
import { listCollection, saveDeck, startMatch, playTurn } from "@/server/services/duels";
import { runPickemLifecycle, ensurePickemEvent, syncQuestions, resolveFinished } from "@/server/services/pickemLifecycle";
import { submitPick } from "@/server/services/pickems";
import { getLoop } from "@/server/services/loop";
import { duelAward } from "@/domain/progression/duelRewards";
import type { DuelMatchView } from "@/lib/duel/types";
import type { CombatStatKey } from "@/lib/duel/types";

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
const registry = new CardRegistry();

/** Diez cartas legales: dos jugadores DISTINTOS por cada uno de los cinco roles. */
function duelReadyCardIds(): string[] {
  const out: string[] = [];
  for (const role of DUEL_ROLES) {
    const best = new Map<string, { id: string; ovr: number }>();
    for (const c of registry.forRole(role)) {
      if (!c.combat) continue;
      const prev = best.get(c.playerId);
      if (!prev || c.ovr > prev.ovr) best.set(c.playerId, { id: c.id, ovr: c.ovr });
    }
    const arr = [...best.values()].sort((a, b) => b.ovr - a.ovr || a.id.localeCompare(b.id));
    out.push(arr[0].id, arr[1].id);
  }
  return out;
}

const profileOf = async (userId: string) => {
  const { data } = await admin.from("profiles")
    .select("points, credits, xp").eq("id", userId).maybeSingle();
  return (data ?? { points: 0, credits: 0, xp: 0 }) as { points: number; credits: number; xp: number };
};

/**
 * Predicciones pendientes del usuario en UN torneo concreto.
 *
 * Existe porque el ciclo devuelve el torneo destacado del circuito, que no tiene por qué
 * ser el que crea esta prueba. Es la misma cuenta que hace `loadCircuit`, aplicada al
 * evento que aquí interesa.
 */
async function getLoopPendingFor(eventId: string, userId: string): Promise<number> {
  const { data: pe } = await admin.from("pickem_events")
    .select("id").eq("event_id", eventId).order("created_at", { ascending: true })
    .limit(1).maybeSingle();
  const pickemId = (pe as { id: string } | null)?.id;
  if (!pickemId) return 0;

  const { data: qs } = await admin.from("pickem_questions")
    .select("id, locks_at").eq("pickem_event_id", pickemId);
  const open = ((qs ?? []) as { id: string; locks_at: string }[])
    .filter((q) => new Date(q.locks_at).getTime() > Date.now());
  if (open.length === 0) return 0;

  const { data: sub } = await admin.from("pickem_submissions")
    .select("id").eq("user_id", userId).eq("pickem_event_id", pickemId).maybeSingle();
  const submissionId = (sub as { id: string } | null)?.id;
  if (!submissionId) return open.length;

  const { data: answers } = await admin.from("pickem_answers")
    .select("question_id").eq("submission_id", submissionId);
  const answered = new Set(((answers ?? []) as { question_id: string }[]).map((a) => a.question_id));
  return open.filter((q) => !answered.has(q.id)).length;
}

function pickStat(view: DuelMatchView, uid: string): CombatStatKey {
  const c = view.yourHand.find((x) => x.uid === uid)!;
  const keys: CombatStatKey[] = ["stronghold", "gamesense", "entryfrag"];
  return keys.reduce((best, k) => (c.combat[k] > c.combat[best] ? k : best), keys[0]);
}

async function main() {
  console.log("# Verificación del CICLO DE JUEGO — NEXUS (Fase 10)\n");

  const stamp = Date.now();
  const email = `loop-${stamp}@example.invalid`;
  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email, password: "Test-1234-loop", email_confirm: true, user_metadata: { username: `loopqa${stamp}` },
  });
  if (userErr || !created.user) throw new Error(userErr?.message ?? "no se pudo crear el usuario");
  const userId = created.user.id;

  const eventId = `loop-test-${stamp}`;
  const matchOpenId = `${eventId}-m1`;
  const matchDoneId = `${eventId}-m2`;

  try {
    // ══════════════════════════════════════════════════════════════════════
    console.log("## 1 · DUELO → PUNTOS, CRÉDITOS Y XP");
    // ══════════════════════════════════════════════════════════════════════
    {
      const before = await profileOf(userId);
      check("un jugador nuevo empieza SIN CLASIFICAR (0 puntos)", before.points === 0, `${before.points} pts`);

      await admin.rpc("app_grant_cards", {
        p_user: userId,
        p_instances: duelReadyCardIds().map((cardId) => ({ cardId, serial: null })),
        p_mint_delta: {},
        p_origin: "admin",
      });
      const col = await listCollection(admin, userId);
      const saved = await saveDeck(admin, userId, {
        name: "Mazo del ciclo", cardUids: col.data!.cards.map((c) => c.uid),
      });
      check("el mazo de diez cartas es válido", saved.ok && saved.data!.deck.valid === true, saved.error);

      const start = await startMatch(admin, userId, saved.data!.deck.id, "NORMAL");
      check("la partida arranca", start.ok, start.error);
      let view = start.data!.view;
      const matchId = view.matchId;

      const midProfile = await profileOf(userId);
      check("a mitad de partida todavía no se ha pagado nada",
        midProfile.points === before.points && midProfile.credits === before.credits);

      for (let i = 0; i < 40 && view.status === "IN_PROGRESS"; i++) {
        const card = view.yourHand[0];
        if (!card) break;
        const stat = view.youAreAttacker ? pickStat(view, card.uid) : undefined;
        const r = await playTurn(admin, userId, matchId, card.uid, stat);
        if (!r.ok) { check(`turno ${view.turn} jugable`, false, r.error); break; }
        view = r.data!.view;
      }

      check("la partida termina", view.status === "COMPLETED" || view.status === "DRAW", view.status);
      check("el resultado trae lo que la partida ha dado", !!view.result?.award,
        JSON.stringify(view.result?.award));

      const expected = duelAward(
        { winner: view.result!.winner, isDraw: view.result!.isDraw }, "NORMAL",
      );
      check("lo que se enseña coincide con la tabla del dominio",
        view.result!.award.points === expected.points
        && view.result!.award.credits === (expected.reward.credits ?? 0)
        && view.result!.award.xp === (expected.reward.xp ?? 0),
        `mostrado ${JSON.stringify(view.result!.award)} · tabla ${expected.points}/${expected.reward.credits}/${expected.reward.xp}`);

      const after = await profileOf(userId);
      check("el duelo ha pagado CRÉDITOS de verdad",
        after.credits === before.credits + (expected.reward.credits ?? 0),
        `${before.credits} → ${after.credits}`);
      check("el duelo ha pagado XP de verdad",
        after.xp === before.xp + (expected.reward.xp ?? 0), `${before.xp} → ${after.xp}`);
      check("el duelo ha movido los PUNTOS DE RANGO",
        after.points === before.points + expected.points, `${before.points} → ${after.points}`);

      if (expected.outcome === "win") {
        check("ganar mueve el rango (no es cero)", expected.points > 0, `${expected.points} pts`);
      } else if (expected.outcome === "loss") {
        check("perder no resta rango, pero paga por jugar",
          expected.points === 0 && (expected.reward.credits ?? 0) > 0);
      }

      // ── Idempotencia: el asiento del libro mayor es la puerta ──
      const { data: entries } = await admin.from("credit_transactions")
        .select("ref").eq("user_id", userId).eq("ref", `duel:${matchId}`);
      check("la partida deja UN solo asiento en el libro mayor",
        ((entries ?? []) as unknown[]).length === 1, `${((entries ?? []) as unknown[]).length}`);

      // Reintentar el pago no puede cobrar dos veces.
      const { award } = await import("@/server/services/rewards");
      const retry = await award(admin, {
        userId, ref: `duel:${matchId}`, reason: "duel_retry",
        reward: expected.reward, points: expected.points,
      });
      check("reintentar el pago de la partida NO paga dos veces", retry.applied === false);
      const afterRetry = await profileOf(userId);
      check("y el saldo no se ha movido",
        afterRetry.credits === after.credits && afterRetry.points === after.points);
    }

    // ══════════════════════════════════════════════════════════════════════
    console.log("\n## 2 · TORNEO → PREDICCIONES (generadas solas)");
    // ══════════════════════════════════════════════════════════════════════
    const inTwoHours = new Date(Date.now() + 2 * 3600_000).toISOString();
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
    {
      await admin.from("events").insert({
        id: eventId, name: `Torneo del ciclo ${stamp}`, type: "tournament",
        status: "ongoing", source: "demo",
        start_date: twoHoursAgo, end_date: new Date(Date.now() + 48 * 3600_000).toISOString(),
      });
      await admin.from("matches").insert([
        {
          id: matchOpenId, event_id: eventId, team_a: "Team Heretics", team_b: "NRG",
          start_time: inTwoHours, status: "upcoming", round: "Grand Final",
        },
        {
          id: matchDoneId, event_id: eventId, team_a: "Gen.G", team_b: "DRX",
          start_time: twoHoursAgo, status: "upcoming", round: "Group Stage",
        },
      ]);

      const pe = await ensurePickemEvent(admin, eventId);
      check("se crea un Pick'em para el torneo", !!pe?.id);
      check("y crearlo dos veces devuelve el MISMO", (await ensurePickemEvent(admin, eventId))!.id === pe!.id);

      /*
       * DOS preguntas por partido desde la Fase 13: quién gana y con qué resultado. No es
       * un Pick'em nuevo —misma tabla, mismo ciclo, mismo corrector—, así que lo que
       * cambia aquí es la cuenta, no el flujo.
       */
      const q1 = await syncQuestions(admin, pe!.id, eventId);
      check("se generan DOS preguntas por partido predecible (ganador y resultado)",
        q1.created === 2, `${q1.created} creada(s)`);

      const q2 = await syncQuestions(admin, pe!.id, eventId);
      check("volver a generar NO duplica preguntas", q2.created === 0, `${q2.created} creada(s)`);

      const { data: qs } = await admin.from("pickem_questions")
        .select("id, match_id, kind, points, options, locks_at").eq("pickem_event_id", pe!.id);
      const rows = (qs ?? []) as { id: string; match_id: string; kind: string; points: number; options: { key: string }[]; locks_at: string }[];
      check("no se abre predicción sobre un partido ya empezado",
        rows.every((r) => r.match_id !== matchDoneId));

      const winner = rows.find((r) => r.kind === "match_winner")!;
      const score = rows.find((r) => r.kind === "match_score")!;
      check("hay una de cada tipo", !!winner && !!score,
        rows.map((r) => r.kind).join(", "));
      check("una final vale más que un partido de grupos", (winner?.points ?? 0) === 30, `${winner?.points} pts`);
      check("las opciones son el lado del partido, no el nombre del equipo",
        winner?.options.map((o) => o.key).join(",") === "a,b");
      check("la del resultado ofrece los cuatro marcadores y paga el doble",
        score?.options.length === 4 && score?.points === (winner?.points ?? 0) * 2,
        `${score?.options.length} opciones · ${score?.points} pts`);
      check("las dos cierran cuando empieza SU partido",
        new Date(winner.locks_at).getTime() === new Date(inTwoHours).getTime()
        && new Date(score.locks_at).getTime() === new Date(inTwoHours).getTime());
    }

    // ══════════════════════════════════════════════════════════════════════
    console.log("\n## 3 · PREDICCIÓN → RESULTADO → PUNTOS → RECOMPENSA");
    // ══════════════════════════════════════════════════════════════════════
    {
      const { data: pe } = await admin.from("pickem_events")
        .select("id").eq("event_id", eventId).maybeSingle();
      const pickemEventId = (pe as { id: string }).id;

      /*
       * Se predice la de GANADOR. Desde la Fase 13 hay dos preguntas por partido, así que
       * pedirla sin filtrar por tipo devolvería dos filas y `maybeSingle` daría `null`.
       */
      const { data: q } = await admin.from("pickem_questions")
        .select("id").eq("pickem_event_id", pickemEventId)
        .eq("match_id", matchOpenId).eq("kind", "match_winner").maybeSingle();
      const questionId = (q as { id: string }).id;

      const pick = await submitPick(admin, userId, questionId, "a");
      check("la predicción se guarda", pick.ok, pick.ok ? "" : pick.error);

      /*
       * Y la del RESULTADO EXACTO (Fase 13), que es el segundo tipo de pregunta. Se predice
       * un 2-1 y el partido va a terminar 2-1, así que se comprueba la cadena entera del
       * tipo nuevo: se genera, se responde, se corrige y se paga.
       */
      const { data: qScore } = await admin.from("pickem_questions")
        .select("id").eq("pickem_event_id", pickemEventId)
        .eq("match_id", matchOpenId).eq("kind", "match_score").maybeSingle();
      const scoreQuestionId = (qScore as { id: string }).id;
      const pickScore = await submitPick(admin, userId, scoreQuestionId, "2-1");
      check("la predicción de resultado exacto se guarda", pickScore.ok, pickScore.ok ? "" : pickScore.error);

      const beforeScore = await profileOf(userId);

      // Todavía sin resultado: no se puede corregir NINGUNA de las dos.
      const early = await resolveFinished(admin, pickemEventId, eventId);
      check("sin resultado publicado, nada se corrige", early.resolved === 0 && early.pending === 2,
        `resueltas ${early.resolved} · pendientes ${early.pending}`);

      // El partido termina y gana el equipo A: es lo que traería la sincronización.
      await admin.from("matches").update({
        status: "finished", winner_team: "Team Heretics", score_a: 2, score_b: 1,
      }).eq("id", matchOpenId);

      const cycle = await runPickemLifecycle(admin, eventId);
      check("el ciclo fija el resultado de las DOS preguntas", cycle.resolved === 2, `${cycle.resolved}`);
      check("y corrige el Pick'em", cycle.scored === true, cycle.notes.join(" · "));

      const { data: scoreRow } = await admin.from("pickem_scores")
        .select("points, correct, total").eq("user_id", userId)
        .eq("pickem_event_id", pickemEventId).maybeSingle();
      const sc = scoreRow as { points: number; correct: number; total: number } | null;
      /*
       * 30 por el ganador de una final + 60 por el resultado exacto (que paga el doble).
       * Si el multiplicador de la Fase 13 cambiara, esta cuenta lo dice.
       */
      check("acertar ganador y resultado da 30 + 60 puntos", sc?.points === 90, `${sc?.points}`);
      check("y cuenta como dos aciertos de dos", sc?.correct === 2 && sc?.total === 2,
        `${sc?.correct} de ${sc?.total}`);

      const afterScore = await profileOf(userId);
      check("los puntos del Pick'em SE SUMAN a los del duelo, no lo sustituyen",
        afterScore.points === beforeScore.points + 90,
        `${beforeScore.points} → ${afterScore.points}`);

      const { data: rewardRow } = await admin.from("credit_transactions")
        .select("ref, delta, reason").eq("user_id", userId)
        .like("ref", `pickem:${pickemEventId}:%`);
      const rewards = (rewardRow ?? []) as { ref: string; delta: number; reason: string }[];
      check("se ha pagado la recompensa del escalón alcanzado", rewards.length === 1,
        rewards.map((r) => r.reason).join(", "));
      check("la recompensa lleva créditos", (rewards[0]?.delta ?? 0) > 0, `${rewards[0]?.delta}`);

      // ── Reejecutar la cadena entera no puede duplicar nada ──
      const again = await runPickemLifecycle(admin, eventId);
      check("reejecutar el ciclo no corrige dos veces la misma pregunta", again.resolved === 0);
      const afterAgain = await profileOf(userId);
      check("y los puntos NO se duplican", afterAgain.points === afterScore.points,
        `${afterScore.points} → ${afterAgain.points}`);
      const { data: rewardRow2 } = await admin.from("credit_transactions")
        .select("ref").eq("user_id", userId).like("ref", `pickem:${pickemEventId}:%`);
      check("ni la recompensa se paga dos veces", ((rewardRow2 ?? []) as unknown[]).length === 1);
    }

    // ══════════════════════════════════════════════════════════════════════
    console.log("\n## 4 · «QUÉ HACER AHORA»");
    // ══════════════════════════════════════════════════════════════════════
    {
      const loop = await getLoop(admin, userId);
      check("el ciclo devuelve pasos", loop.steps.length > 0, `${loop.steps.length} pasos`);
      check("los pasos vienen ordenados por prioridad",
        loop.steps.every((s, i) => i === 0 || loop.steps[i - 1].priority <= s.priority));

      const kinds = loop.steps.map((s) => s.kind);
      check("con mazo válido y sin partida en curso, se ofrece jugar", kinds.includes("play"),
        kinds.join(", "));
      check("el circuito activo aparece como paso", kinds.includes("explore"), kinds.join(", "));
      check("no se ofrece construir mazo teniendo uno válido", !kinds.includes("build"));

      check("el rango que devuelve el ciclo ya NO es «sin clasificar»",
        loop.rank.unranked === false, loop.rank.label);
      check("el ciclo cuenta los duelos jugados", loop.duels.played >= 1, `${loop.duels.played}`);

      /*
       * El circuito que devuelve el ciclo es el torneo EN CURSO más antiguo, no el que
       * crea esta prueba: si la base ya tiene torneos sembrados (`npm run seed:demo`),
       * el destacado será otro. Comprobar la identidad del torneo sería comprobar el
       * orden de la semilla, no el ciclo.
       */
      check("el ciclo trae un torneo del circuito", loop.circuit !== null, loop.circuit?.name);
      check("y es uno en curso o próximo",
        ["ongoing", "upcoming"].includes(loop.circuit?.status ?? ""), loop.circuit?.status);

      /*
       * Las predicciones ya respondidas no vuelven a pedirse. Solo se puede afirmar sobre
       * NUESTRO torneo: si el destacado es otro, el paso «predict» que aparezca será suyo
       * y estará bien puesto. Se comprueba lo que de verdad se quiere garantizar —que
       * responder una pregunta la saca de los pendientes— sobre el evento de la prueba.
       */
      if (loop.circuit?.eventId === eventId) {
        check("una predicción ya respondida no se pide otra vez",
          !loop.steps.some((s) => s.kind === "predict"), kinds.join(", "));
      } else {
        const mine = await getLoopPendingFor(eventId, userId);
        check("una predicción ya respondida no se pide otra vez (en el torneo de la prueba)",
          mine === 0, `${mine} pendientes`);
      }
    }

    // ══════════════════════════════════════════════════════════════════════
    console.log("\n## 4 bis · EL PRIMER DÍA (Fase 15)");
    // ══════════════════════════════════════════════════════════════════════
    {
      /*
       * La auditoría de primera experiencia encontró que a un jugador recién registrado
       * —cero cartas y cuatro sobres de bienvenida— lo PRIMERO que se le proponía era hacer
       * predicciones sobre un torneo, y que el paso «Construye tu mazo» le mandaba a la
       * TIENDA a comprar sobres teniendo cuatro sin abrir.
       *
       * Se comprueba con una cuenta nueva de verdad, porque con la cuenta sembrada de esta
       * prueba —que ya tiene cartas— ninguna de las dos reglas se activa.
       */
      const nuevo = await admin.auth.admin.createUser({
        email: `loop-nuevo-${stamp}@example.invalid`, password: "Test-1234-loop",
        email_confirm: true, user_metadata: { username: `loopnuevo${stamp}` },
      });
      const nuevoId = nuevo.data.user!.id;
      try {
        const { count: cartas } = await admin.from("user_cards")
          .select("uid", { count: "exact", head: true }).eq("user_id", nuevoId);
        const { data: sobres } = await admin.from("user_packs")
          .select("qty").eq("user_id", nuevoId);
        const totalSobres = ((sobres ?? []) as { qty: number }[]).reduce((n, r) => n + r.qty, 0);
        check("un jugador recién registrado tiene cero cartas y sobres de bienvenida",
          (cartas ?? 0) === 0 && totalSobres > 0, `${cartas} cartas · ${totalSobres} sobres`);

        const nuevoLoop = await getLoop(admin, nuevoId);
        const primero = nuevoLoop.steps[0];
        check("lo PRIMERO que se le propone es abrir sus sobres",
          primero?.kind === "open", primero ? `${primero.kind} → ${primero.href}` : "ningún paso");
        check("y le lleva al inventario, que es donde se abren",
          primero?.href === "/inventario", primero?.href ?? "—");

        const construir = nuevoLoop.steps.find((x) => x.kind === "build");
        check("«construye tu mazo» NO le manda a comprar teniendo sobres sin abrir",
          construir?.href === "/inventario", construir?.href ?? "sin paso de mazo");

        /*
         * Y la regla deja de aplicarse en cuanto tiene cartas: no es un caso especial para
         * un usuario, es una condición sobre el estado.
         */
        await admin.rpc("app_grant_cards", {
          p_user: nuevoId,
          p_instances: duelReadyCardIds().slice(0, 4).map((cardId) => ({ cardId, serial: null })),
          p_mint_delta: {}, p_origin: "admin",
        });
        const conCartas = await getLoop(admin, nuevoId);
        check("con cartas, abrir sobres vuelve a su prioridad normal",
          conCartas.steps[0]?.kind !== "open" || conCartas.steps[0]?.priority !== 0,
          `${conCartas.steps[0]?.kind} (prioridad ${conCartas.steps[0]?.priority})`);
      } finally {
        await admin.auth.admin.deleteUser(nuevoId).catch(() => {});
      }
    }
    // ══════════════════════════════════════════════════════════════════════
    console.log("\n## 5 · LA RUTA ÚNICA DE RECOMPENSA");
    // ══════════════════════════════════════════════════════════════════════
    {
      const { award } = await import("@/server/services/rewards");
      const before = await profileOf(userId);

      const res = await award(admin, {
        userId, ref: `qa:full:${stamp}`, reason: "qa_full",
        reward: {
          credits: 100, xp: 10, tokens: 5,
          cosmetics: ["titulo:qa-ciclo"],
        },
        points: 7,
      });
      check("una recompensa completa se concede en una sola llamada", res.applied === true);

      const after = await profileOf(userId);
      check("créditos, XP y puntos se mueven juntos",
        after.credits === before.credits + 100 && after.xp === before.xp + 10
        && after.points === before.points + 7);

      const { data: cos } = await admin.from("user_cosmetics")
        .select("cosmetic_id").eq("user_id", userId).eq("cosmetic_id", "titulo:qa-ciclo");
      check("el COSMÉTICO se entrega en la misma transacción, no aparte",
        ((cos ?? []) as unknown[]).length === 1);

      const { data: prof } = await admin.from("profiles").select("tokens").eq("id", userId).maybeSingle();
      check("las fichas también", ((prof as { tokens: number }).tokens) >= 5);

      // Materiales: se declara que no hay ruta en vez de perderlos en silencio.
      const mats = await award(admin, {
        userId, ref: `qa:mats:${stamp}`, reason: "qa_mats",
        reward: { credits: 1, materials: { rare: 3 } },
      });
      check("un tipo sin ruta de entrega se DECLARA, no se traga",
        mats.unsupported.includes("materials"), mats.unsupported.join(", "));
    }
  } finally {
    // ── Limpieza ──
    await admin.from("matches").delete().eq("event_id", eventId);
    const { data: pes } = await admin.from("pickem_events").select("id").eq("event_id", eventId);
    for (const pe of ((pes ?? []) as { id: string }[])) {
      await admin.from("pickem_questions").delete().eq("pickem_event_id", pe.id);
      await admin.from("pickem_scores").delete().eq("pickem_event_id", pe.id);
      await admin.from("pickem_submissions").delete().eq("pickem_event_id", pe.id);
      await admin.from("pickem_events").delete().eq("id", pe.id);
    }
    await admin.from("events").delete().eq("id", eventId);
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  }

  console.log(
    failures === 0
      ? "\n✅ EL CICLO DE JUEGO ESTÁ CONECTADO"
      : `\n❌ ${failures} comprobación(es) fallidas`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
