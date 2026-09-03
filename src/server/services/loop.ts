/**
 * EL CICLO DE JUEGO (Fase 10, SOLO SERVIDOR).
 *
 * ────────────────────────── QUÉ RESPONDE ──────────────────────────
 *
 * Una sola pregunta, la que un jugador se hace al entrar: **¿qué hago ahora?**
 *
 * La auditoría de la Fase 10 encontró que NEXUS tenía todas las piezas —torneos,
 * predicciones, duelos, sobres, colección, mazos, pase, rango— y ninguna sabía de las
 * otras. Cada pantalla contaba su parte y el jugador tenía que montar el recorrido en su
 * cabeza. Eso es lo que hace que un producto se sienta como una colección de páginas.
 *
 * Este servicio recorre el estado REAL del jugador y devuelve los pasos que tiene
 * disponibles ahora mismo, en orden. No es una lista de enlaces: cada paso existe porque
 * hay un dato del servidor que lo justifica, y desaparece cuando deja de haberlo.
 *
 * ────────────────────────── POR QUÉ EN EL SERVIDOR ──────────────────────────
 *
 * Porque las cifras que deciden qué enseñar —sobres sin abrir, predicciones pendientes,
 * niveles reclamables, mazo válido— son todas server-authoritative. Calcularlo en el
 * navegador significaría o bien pedir seis endpoints y recomponer, o bien fiarse del
 * store local, que es una caché. El vestíbulo pediría seis cosas para pintar una tira.
 *
 * ────────────────────────── EL ORDEN NO ES DECORATIVO ──────────────────────────
 *
 * Los pasos se ordenan por PRIORIDAD, y la prioridad codifica una idea del ciclo:
 *
 *   1. Lo que está a medias (una partida en curso) — abandonar algo empezado es peor
 *      que no empezarlo.
 *   2. Lo que caduca (una predicción que cierra hoy) — es lo único que se puede perder.
 *   3. Lo que ya te has ganado y no has recogido (recompensas, niveles, sobres).
 *   4. Lo que te desbloquea el resto (construir un mazo).
 *   5. Lo que siempre se puede hacer (jugar un duelo).
 *
 * ────────────────────────── LO QUE NO HACE ──────────────────────────
 *
 * No concede nada, no escribe nada y no decide ninguna regla. Es de solo lectura.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getProgression } from "./progression";
import { listDecks } from "./duels";
import { rankProgress } from "@/domain/progression/rank";

/** Categorías de paso. La interfaz decide el color y el icono a partir de esto. */
export type LoopStepKind =
  | "resume"      // una partida en curso
  | "predict"     // predicciones abiertas sin responder
  | "claim"       // recompensas / niveles / misiones por reclamar
  | "open"        // sobres sin abrir
  | "build"       // no hay mazo válido
  | "play"        // jugar un duelo
  | "explore";    // el circuito: qué está pasando ahora

export interface LoopStep {
  id: string;
  kind: LoopStepKind;
  /** Qué hacer, en imperativo y en tres palabras. */
  label: string;
  /** Por qué aparece, con la cifra real que lo justifica. */
  detail: string;
  href: string;
  /** Cantidad asociada, cuando la hay (sobres, predicciones, niveles). */
  count?: number;
  /** Menor = antes. */
  priority: number;
  /** Caduca: lo que se puede perder si no se hace. */
  urgent?: boolean;
}

export interface LoopView {
  steps: LoopStep[];
  /** El estado competitivo, para que el vestíbulo no tenga que pedirlo aparte. */
  rank: {
    points: number;
    label: string;
    tierId: string;
    color: string;
    progress: number;
    toNext: number;
    nextLabel: string | null;
    unranked: boolean;
  };
  /** Lo que está pasando en el circuito ahora mismo. */
  circuit: {
    eventId: string;
    name: string;
    isDemo: boolean;
    status: string;
    liveMatch: { teamA: string; teamB: string } | null;
    openQuestions: number;
    pendingPicks: number;
  } | null;
  /** Resumen de duelos, para la ficha del jugador. */
  duels: { played: number; won: number };
}

const HOUR = 3600_000;

export async function getLoop(
  admin: SupabaseClient, userId: string, now = Date.now(),
): Promise<LoopView> {
  const [
    profileRes, packsRes, activeDuelRes, decksRes, cardsRes, duelsRes, winsRes, circuit,
  ] = await Promise.all([
    admin.from("profiles").select("points, credits").eq("id", userId).maybeSingle(),
    admin.from("user_packs").select("pack_id, qty").eq("user_id", userId).gt("qty", 0),
    admin.from("duel_matches").select("id").eq("user_id", userId).eq("status", "IN_PROGRESS")
      .order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    /*
     * Los mazos se piden al SERVICIO de duelos, no a la tabla. `listDecks` resuelve la
     * propiedad real y valida con `validateDuelDeck`, que es la misma función que usa el
     * servidor al empezar una partida. Escribir aquí una segunda idea de «mazo válido»
     * garantizaría que algún día el vestíbulo dijera que puedes jugar justo cuando el
     * servidor va a rechazarte.
     */
    listDecks(admin, userId),
    admin.from("user_cards").select("uid", { count: "exact", head: true }).eq("user_id", userId),
    admin.from("duel_matches").select("id", { count: "exact", head: true })
      .eq("user_id", userId).in("status", ["COMPLETED", "DRAW", "UNRESOLVED"]),
    admin.from("duel_matches").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("winner", "A"),
    loadCircuit(admin, userId, now),
  ]);

  const points = (profileRes.data as { points: number } | null)?.points ?? 0;
  const rank = rankProgress(points);

  const packs = ((packsRes.data ?? []) as { pack_id: string; qty: number }[])
    .reduce((s, r) => s + r.qty, 0);

  const steps: LoopStep[] = [];

  // ── 1. Una partida a medias ──
  if (activeDuelRes.data) {
    steps.push({
      id: "resume-duel",
      kind: "resume",
      label: "Retoma tu duelo",
      detail: "Tienes una partida sin terminar.",
      href: "/duelos/jugar",
      priority: 1,
      urgent: true,
    });
  }

  // ── 2. Lo que caduca ──
  if (circuit && circuit.pendingPicks > 0) {
    steps.push({
      id: "predict",
      kind: "predict",
      label: "Haz tus predicciones",
      detail: `${circuit.pendingPicks} ${circuit.pendingPicks === 1 ? "partido abierto" : "partidos abiertos"} en ${circuit.name}.`,
      href: "/pickems",
      count: circuit.pendingPicks,
      priority: 2,
      urgent: true,
    });
  }

  // ── 3. Lo que ya te has ganado ──
  /*
   * La progresión se pide ENTERA porque es una sola lectura que ya resuelve niveles
   * reclamables, misiones completas y logros completos. Pedir tres consultas sueltas
   * para recomponer aquí lo mismo sería duplicar la lógica del pase.
   */
  const prog = await getProgression(admin, userId).catch(() => null);
  if (prog?.ok && prog.data) {
    const v = prog.data;
    const levels = (["free", "competitive", "premium"] as const)
      .reduce((n, t) => n + v.tracks[t].filter((l) => l.claimable).length, 0);
    const missions = v.missions.filter((m) => m.complete && !m.claimed).length;
    const achievements = v.achievements.filter((a) => a.complete && !a.claimed).length;
    const total = levels + missions + achievements;
    if (total > 0) {
      const parts: string[] = [];
      if (levels) parts.push(`${levels} ${levels === 1 ? "nivel del pase" : "niveles del pase"}`);
      if (missions) parts.push(`${missions} ${missions === 1 ? "misión" : "misiones"}`);
      if (achievements) parts.push(`${achievements} ${achievements === 1 ? "logro" : "logros"}`);
      steps.push({
        id: "claim",
        kind: "claim",
        label: "Reclama lo tuyo",
        detail: `${parts.join(" · ")} sin reclamar.`,
        href: "/logros",
        count: total,
        priority: 3,
      });
    }
  }

  /*
   * PRIORIDAD DE PRIMERA VEZ (Fase 15).
   *
   * La auditoría de primera experiencia encontró que a alguien recién registrado —cero
   * cartas, cuatro sobres de bienvenida sin abrir— lo PRIMERO que se le proponía era hacer
   * predicciones sobre un torneo de Valorant. Para quien vuelve está bien (caduca); para
   * quien entra por primera vez es desconcertante: todavía no ha visto una sola carta.
   *
   * Sin cartas, solo hay una cosa sensata que hacer, y es abrir los sobres. La regla no es
   * un caso especial para un usuario concreto: es una condición sobre el ESTADO —«no tienes
   * ninguna carta y sí tienes sobres»— que deja de cumplirse en cuanto abre el primero.
   */
  const ownedCount = cardsRes.count ?? 0;
  const sinNingunaCarta = ownedCount === 0 && packs > 0;

  if (packs > 0) {
    steps.push({
      id: "open-packs",
      kind: "open",
      label: "Abre tus sobres",
      detail: sinNingunaCarta
        ? `Tienes ${packs} ${packs === 1 ? "sobre" : "sobres"} de bienvenida. Ábrelos y empieza tu colección.`
        : `Tienes ${packs} ${packs === 1 ? "sobre" : "sobres"} sin abrir.`,
      href: "/inventario",
      count: packs,
      // Delante de todo si es lo único que puede hacer; en su sitio de siempre si no.
      priority: sinNingunaCarta ? 0 : 4,
    });
  }

  // ── 4. Lo que desbloquea el resto ──
  const decks = decksRes.ok ? (decksRes.data?.decks ?? []) : [];
  const hasValidDeck = decks.some((d) => d.valid);

  if (!hasValidDeck) {
    steps.push({
      id: "build-deck",
      kind: "build",
      label: decks.length === 0 ? "Construye tu mazo" : "Termina tu mazo",
      /*
       * ADÓNDE SE LE MANDA (Fase 15). Antes, con menos de diez cartas, este paso decía
       * «empieza abriendo un sobre» y enlazaba a la TIENDA, que es donde se COMPRAN. Un
       * jugador nuevo tiene cuatro sobres sin abrir y lo que necesita es el inventario, que
       * es donde se ABREN — y es además adonde apunta el paso «Abre tus sobres» para esa
       * misma acción. El texto y el destino decían cosas distintas.
       */
      detail: ownedCount < 10
        ? packs > 0
          ? "Necesitas diez cartas para competir. Abre los sobres que ya tienes."
          : "Necesitas diez cartas para competir. Consigue un sobre en la tienda."
        : "Diez cartas, dos de cada rol. Sin mazo no se puede duelar.",
      href: ownedCount < 10 ? (packs > 0 ? "/inventario" : "/tienda") : "/duelos/mazos",
      priority: 5,
    });
  } else if (!activeDuelRes.data) {
    // ── 5. Lo que siempre se puede hacer ──
    steps.push({
      id: "play-duel",
      kind: "play",
      label: "Juega un duelo",
      detail: rank.unranked
        ? "Gana tu primer duelo y entra en la escalera de rango."
        : `Ganar en normal suma 14 puntos hacia ${rank.next?.label ?? "el rango máximo"}.`,
      href: "/duelos/jugar",
      priority: 6,
    });
  }

  // ── 6. Qué está pasando ──
  if (circuit) {
    steps.push({
      id: "circuit",
      kind: "explore",
      label: circuit.liveMatch ? "Hay partido en directo" : "Sigue el circuito",
      detail: circuit.liveMatch
        ? `${circuit.liveMatch.teamA} vs ${circuit.liveMatch.teamB} · ${circuit.name}`
        : circuit.name,
      href: `/torneos/${circuit.eventId}`,
      priority: 7,
    });
  }

  steps.sort((a, b) => a.priority - b.priority);

  return {
    steps,
    rank: {
      points,
      label: rank.label,
      tierId: rank.tier.id,
      color: rank.tier.color,
      progress: rank.progress,
      toNext: rank.toNext,
      nextLabel: rank.next?.label ?? null,
      unranked: rank.unranked,
    },
    circuit,
    duels: { played: duelsRes.count ?? 0, won: winsRes.count ?? 0 },
  };
}

/**
 * El torneo que importa ahora mismo y mi situación en él.
 *
 * «El que importa» es el que está en curso; si no hay ninguno, el siguiente. Es la misma
 * regla que ya usaba el vestíbulo, escrita una sola vez y en el servidor.
 */
async function loadCircuit(
  admin: SupabaseClient, userId: string, now: number,
): Promise<LoopView["circuit"]> {
  const { data: events } = await admin
    .from("events").select("id, name, status, source, start_date")
    .in("status", ["ongoing", "upcoming"])
    .order("status", { ascending: true })
    .order("start_date", { ascending: true })
    .limit(8);

  const list = ((events ?? []) as { id: string; name: string; status: string; source: string }[]);
  const ev = list.find((e) => e.status === "ongoing") ?? list[0];
  if (!ev) return null;

  const [{ data: live }, { data: pe }] = await Promise.all([
    admin.from("matches").select("team_a, team_b").eq("event_id", ev.id).eq("status", "live")
      .limit(1).maybeSingle(),
    admin.from("pickem_events").select("id").eq("event_id", ev.id)
      .order("created_at", { ascending: true }).limit(1).maybeSingle(),
  ]);

  let openQuestions = 0;
  let pendingPicks = 0;
  const pickemId = (pe as { id: string } | null)?.id ?? null;

  if (pickemId) {
    const { data: qs } = await admin
      .from("pickem_questions").select("id, locks_at").eq("pickem_event_id", pickemId);
    const open = ((qs ?? []) as { id: string; locks_at: string }[])
      .filter((q) => new Date(q.locks_at).getTime() > now);
    openQuestions = open.length;

    if (open.length > 0) {
      const { data: sub } = await admin
        .from("pickem_submissions").select("id").eq("user_id", userId)
        .eq("pickem_event_id", pickemId).maybeSingle();
      const submissionId = (sub as { id: string } | null)?.id ?? null;
      if (!submissionId) {
        pendingPicks = open.length;
      } else {
        const { data: answers } = await admin
          .from("pickem_answers").select("question_id").eq("submission_id", submissionId);
        const answered = new Set(((answers ?? []) as { question_id: string }[]).map((a) => a.question_id));
        pendingPicks = open.filter((q) => !answered.has(q.id)).length;
      }
    }
  }

  const l = live as { team_a: string | null; team_b: string | null } | null;
  return {
    eventId: ev.id,
    name: ev.name,
    isDemo: ev.source === "demo",
    status: ev.status,
    liveMatch: l?.team_a && l?.team_b ? { teamA: l.team_a, teamB: l.team_b } : null,
    openQuestions,
    pendingPicks,
  };
}

/** Exportado para las pruebas: cuánto falta, en horas, para que algo caduque. */
export const hoursUntil = (iso: string, now = Date.now()): number =>
  (new Date(iso).getTime() - now) / HOUR;
