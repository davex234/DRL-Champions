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
import { peekProgression, type ProgressionView } from "./progression";
import { nearObjective, type MetaObjective } from "@/domain/progression/meta";
import { readCompetitivePosition } from "./competitive";
import { isProvisional } from "@/domain/cardgame/rating/types";
import { listDecks } from "./duels";
import { readCampaignSummary } from "./campaign";
import { rankProgress } from "@/domain/progression/rank";
import { countPlayedMatches, countWonMatches } from "./matchCounts";

/** Categorías de paso. La interfaz decide el color y el icono a partir de esto. */
export type LoopStepKind =
  | "resume"      // una partida en curso
  | "predict"     // predicciones abiertas sin responder
  | "claim"       // recompensas / niveles / misiones por reclamar
  | "open"        // sobres sin abrir
  | "build"       // no hay mazo válido
  | "play"        // jugar un duelo
  | "objective"   // un objetivo a medio camino (Fase 27)
  | "challenge"   // un reto privado recibido, pendiente (Fase 29)
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
  /** Fase 27 · cifras del pase para la home: objetivos sin reclamar y recompensas reclamables. `null` si el pase no se pudo leer. */
  progression: { activeObjectives: number; claimable: number } | null;
  /** Fase 28 · foto competitiva REAL (rating, partidas, posición o null). `null` si no se pudo leer. */
  competitive: { rating: number; gamesPlayed: number; provisional: boolean; position: number | null; rankedTotal: number } | null;
}

const HOUR = 3600_000;

export async function getLoop(
  admin: SupabaseClient, userId: string, now = Date.now(),
  /** Fase 27: el meta-snapshot ya ha leído el pase; se reutiliza para no leerlo dos veces. */
  progression?: ProgressionView | null,
): Promise<LoopView> {
  const [
    profileRes, packsRes, activeDuelRes, decksRes, cardsRes, duelsRes, winsRes, circuit,
  ] = await Promise.all([
    admin.from("profiles").select("points, credits").eq("id", userId).maybeSingle(),
    admin.from("user_packs").select("pack_id, qty").eq("user_id", userId).gt("qty", 0),
    // Solo el duelo contra el bot: una partida de dos personas se retoma en /duelos/pvp, no aquí.
    admin.from("duel_matches").select("id").eq("user_id", userId).eq("mode", "PVE").eq("status", "IN_PROGRESS")
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
    // CORE GAME LOOP · «partidas que cuentan» (`matchCounts`): PvE + ranked en los dos asientos; ni privadas, ni
    // torneos, ni Draft (Fase 39).
    countPlayedMatches(admin, userId),
    countWonMatches(admin, userId),
    loadCircuit(admin, userId, now),
  ]);
  // Fase 35 · Road to Champions como paso SECUNDARIO (una lectura acotada; sin 0051, `null` y no hay paso).
  const campaign = await readCampaignSummary(admin, userId).catch(() => null);

  const points = (profileRes.data as { points: number } | null)?.points ?? 0;
  const rank = rankProgress(points);

  const packs = ((packsRes.data ?? []) as { pack_id: string; qty: number }[])
    .reduce((s, r) => s + r.qty, 0);

  const steps: LoopStep[] = [];
  let progressionSummary: LoopView["progression"] = null;

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

  /*
   * FASE 29 · SOCIAL EN LA HOME. Una partida de dos personas a medias (ranked o privada) manda
   * sobre todo; un reto privado recibido y pendiente va justo detrás, por delante de las
   * recompensas. Las tablas nacen con la migración 0048: si aún no existen, no hay paso.
   */
  const social = await loadSocialSteps(admin, userId).catch(() => ({ activeMatchId: null, pendingChallenges: 0 }));
  if (social.activeMatchId) {
    steps.push({
      id: "resume-pvp",
      kind: "resume",
      label: "Retoma tu duelo",
      detail: "Tienes una partida contra otra persona sin terminar.",
      href: `/duelos/pvp?match=${social.activeMatchId}`,
      priority: 0.5,
      urgent: true,
    });
  }
  if (social.pendingChallenges > 0) {
    steps.push({
      id: "challenge",
      kind: "challenge",
      label: "Responde al reto",
      detail: `${social.pendingChallenges} ${social.pendingChallenges === 1 ? "reto privado espera" : "retos privados esperan"} tu respuesta.`,
      href: "/social?tab=retos",
      count: social.pendingChallenges,
      priority: 1.5,
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
  const prog = progression !== undefined
    ? (progression ? { ok: true, data: progression } : null)
    // Fase 42 · GET sin escrituras: la vista QUE CORRESPONDE a `now` (rotación pura), nunca `getProgression`.
    : await peekProgression(admin, userId, now).then((r) => (r.ok && r.data ? { ok: true, data: r.data.view } : null)).catch(() => null);
  if (prog?.ok && prog.data) {
    const v = prog.data;
    const levels = (["free", "competitive", "premium"] as const)
      .reduce((n, t) => n + v.tracks[t].filter((l) => l.claimable).length, 0);
    const missions = v.missions.filter((m) => m.complete && !m.claimed).length;
    const achievements = v.achievements.filter((a) => a.complete && !a.claimed).length;
    const total = levels + missions + achievements;
    progressionSummary = { activeObjectives: v.missions.filter((m) => !m.claimed).length, claimable: total };
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
  /*
   * FASE 27 · UN OBJETIVO A MEDIO CAMINO. Entre «reclama lo tuyo» y «abre tus sobres»: lo que
   * está a punto de dar recompensa. Se elige con la misma regla pura del meta (`nearObjective`).
   */
  if (prog?.ok && prog.data) {
    const near = nearObjective(prog.data.missions as MetaObjective[]);
    if (near) {
      steps.push({
        id: `objective-${near.id}`,
        kind: "objective",
        label: "Continúa tu objetivo",
        detail: `${near.label} · ${near.current} / ${near.goal}`,
        href: "/misiones",
        priority: 3.5,
        urgent: near.expiresAt !== null,
      });
    }
  }

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
      label: decks.length === 0 ? "Crea tu primer equipo" : "Termina tu equipo",
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
        : "Diez cartas, dos de cada rol. Sin equipo no se puede duelar.",
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
    /*
     * FASE 35 · CONTINUAR ROAD TO CHAMPIONS. Detrás de «Juega un duelo» (6 → 6.5) y del mismo tipo `play`: la
     * prioridad compartida (`todayActions`) no cambia y la recomendación única de la home sigue siendo la de
     * siempre. Solo con equipo válido, sin partida a medias y con la campaña disponible y sin terminar.
     */
    if (campaign && !campaign.complete && campaign.next) {
      steps.push({
        id: "campaign",
        kind: "play",
        label: campaign.completed === 0 ? "Empieza Road to Champions" : "Continúa Road to Champions",
        detail: `${campaign.completed}/${campaign.total} nodos · siguiente: ${campaign.next.name} contra ${campaign.next.team}.`,
        href: `/jugar/road-to-champions?node=${campaign.next.nodeId}`,
        priority: 6.5,
      });
    }
  }

  // ── 6. Qué está pasando ──
  if (circuit) {
    steps.push({
      id: "circuit",
      kind: "explore",
      // Fase 44 · NO FAKE LIVE: un evento de demo con un partido `live` en BD no es «en directo».
      label: circuit.liveMatch && !circuit.isDemo ? "Hay partido en directo" : "Sigue el circuito",
      detail: circuit.liveMatch && !circuit.isDemo
        ? `${circuit.liveMatch.teamA} vs ${circuit.liveMatch.teamB} · ${circuit.name}`
        : circuit.name,
      href: `/torneos/${circuit.eventId}`,
      priority: 7,
    });
  }

  steps.sort((a, b) => a.priority - b.priority);

  /* FASE 28 · la foto competitiva para la home: solo lectura (rating real + recuento de posición). */
  let competitive: LoopView["competitive"] = null;
  try {
    // Fase 42 · lectura pura: sin ficha no se crea (antes `ensureRating` la insertaba 1000/0 al leer).
    const p = await readCompetitivePosition(admin, userId);
    if (p.ok && p.data) {
      const row = p.data.row;
      competitive = { rating: row?.rating ?? 1000, gamesPlayed: row?.games_played ?? 0, provisional: isProvisional(row?.games_played ?? 0), position: p.data.position, rankedTotal: p.data.rankedTotal };
    }
  } catch { competitive = null; }

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
    progression: progressionSummary,
    competitive,
  };
}

/**
 * Fase 29 · lo social que compite por la home: la partida de dos personas en curso (ranked o
 * privada, como jugador A o B) y los retos privados recibidos aún vigentes. Solo lecturas.
 */
async function loadSocialSteps(admin: SupabaseClient, userId: string): Promise<{ activeMatchId: string | null; pendingChallenges: number }> {
  const [live, ch] = await Promise.all([
    admin.from("duel_matches").select("id").in("mode", ["PVP", "PVP_PRIVATE"]).eq("status", "IN_PROGRESS").is("closed_reason", null)
      .or(`user_id.eq.${userId},player_b_id.eq.${userId}`).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("duel_challenges").select("id", { count: "exact", head: true })
      .eq("challenged_id", userId).eq("status", "PENDING").gt("expires_at", new Date().toISOString()),
  ]);
  if (ch.error) throw new Error(ch.error.message);
  return { activeMatchId: (live.data as { id: string } | null)?.id ?? null, pendingChallenges: ch.count ?? 0 };
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
