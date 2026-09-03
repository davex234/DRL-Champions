"use client";

/**
 * VESTÍBULO — el menú principal del juego (Fase 9.6).
 *
 * DE DÓNDE VIENE. La Fase 9B ya había arreglado lo peor: metió cartas por encima de la
 * línea de flotación y convirtió los modos en puertas con emblema. Pero al mirar la
 * captura `01-inicio` con ojos de jugador, la pantalla seguía respondiendo a la pregunta
 * equivocada.
 *
 * Lo primero, lo más grande y lo único con luz propia era **un torneo de VALORANT con un
 * botón de predicciones**. El modo propio del juego —Duelos, lo único que se JUEGA aquí—
 * era la primera de cuatro cajas en una fila, por debajo del pliegue. Y al final, cuatro
 * celdas con cifras: rango, nivel, colección, créditos. Eso último es un cuadro de mando,
 * y da igual el color que tenga.
 *
 * QUÉ CAMBIA. La jerarquía, que es lo que el encargo pedía:
 *
 *   PRINCIPAL   → **El escenario.** Ocupa la pantalla, tiene luz, retícula y cartas, y
 *                 solo ofrece una cosa: jugar un duelo. Dentro va el estado real de tu
 *                 mazo, porque «Jugar» sin saber si tienes mazo es un botón que falla.
 *   SECUNDARIO  → **Las puertas.** Torneos, Pick'ems y Entrenador, con su emblema.
 *   TERCIARIO   → **La tira de gestión.** Colección, Tienda, Progreso y Mundo, como
 *                 destinos de menú y no como modos de juego.
 *
 * Y las cuatro celdas de cifras **desaparecen como celdas**: pasan a ser el HUD del
 * escenario —emblema de rango, nivel, colección, créditos— sin una sola caja alrededor.
 * Un dato de videojuego no vive en una tarjeta; vive sobre el escenario.
 *
 * EL TORNEO NO SE PIERDE. Baja a su propia banda, «El circuito», con el directo, los
 * próximos partidos y la llamada a las predicciones intactos. Sigue estando entero: deja
 * de ser lo primero, que es distinto de dejar de estar.
 *
 * Los datos son los de siempre y llegan por las mismas funciones. La única lectura nueva
 * es la de mazos (`fetchDuelDecks`, la misma que usa `/duelos`), y falla en silencio: si
 * no se puede leer, el escenario ofrece jugar igual y el servidor decidirá.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { useGameStore } from "@/store/useGameStore";
import {
  fetchTournaments, fetchPickemEvent, fetchPickemQuestions, fetchMyAnswers,
  fetchMatches, fetchGlobalRanking, fetchLedger, fetchMyRankPosition,
  type TournamentRow, type MatchRow, type RankingRow, type LedgerRow,
} from "@/lib/game/client";
import { fetchDuelDecks } from "@/lib/duel/client";
import type { DuelDeckDTO } from "@/lib/duel/types";
import { fetchLoop, type LoopView } from "@/lib/game/loop";
import { NextUp } from "@/components/loop/NextUp";
import { fetchEvent, type EventView } from "@/lib/game/events";
import { LiveEventPanel } from "@/components/events/LiveEventPanel";
import { Toast } from "@/components/ui/Toast";
import { useToast } from "@/lib/useToast";
import { describeLedger, isReward } from "@/domain/pickems/ledger";
import { groupCollection } from "@/store/selectors";
import { TOTAL_CARDS, getCard } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { rankProgress, rankDisplay } from "@/domain/progression/rank";
import { levelFromXp } from "@/domain/progression/levels";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { Card3D } from "@/components/visual/Card3D";
import { ModeEmblem, type ModeId } from "@/components/visual/ModeEmblem";
import { RankEmblem } from "@/components/progression/RankEmblem";
import { Loading, ErrorState, EmptyState, DemoBadge } from "@/components/ui/States";
import { formatCredits, cn } from "@/lib/format";

const fmt = (s: string | null) =>
  s ? new Date(s).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

/**
 * SECUNDARIO. Los tres modos que cuelgan del calendario real de VALORANT. Duelos ya no
 * está en esta tabla: es el escenario, y meterlo aquí además sería enseñarlo dos veces.
 */
const MODES: { id: ModeId; href: string; label: string; tag: string; line: string; tint: string }[] = [
  { id: "torneos",    href: "/torneos",    label: "Torneos",    tag: "Competición", line: "Sigue el circuito y compite por la clasificación.", tint: "255,138,61" },
  { id: "pickems",    href: "/pickems",    label: "Pick'ems",   tag: "Predicción",  line: "Acierta los partidos reales y gana puntos de rango.", tint: "25,227,255" },
  { id: "entrenador", href: "/entrenador", label: "Entrenador", tag: "Táctico",     line: "Dirige un partido ronda a ronda desde el banquillo.", tint: "63,192,122" },
];

/** TERCIARIO. Destinos de gestión. No son modos y no deben parecerlo. */
const UTILITIES = [
  { href: "/coleccion", label: "Colección", tint: "123,92,255" },
  { href: "/tienda",    label: "Tienda",    tint: "255,211,92" },
  { href: "/logros",    label: "Progreso",  tint: "25,227,255" },
  { href: "/mundo",     label: "Mundo",     tint: "63,192,122" },
];

export default function HomePage() {
  const configured = isSupabaseConfigured();
  const { user, profile } = useAuth();

  const ownedCards = useGameStore((s) => s.ownedCards);
  const credits = useGameStore((s) => s.credits);
  const xp = useGameStore((s) => s.xp);
  const unopened = useGameStore((s) => s.unopenedPacks);

  const [featured, setFeatured] = useState<TournamentRow | null>(null);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [pickemId, setPickemId] = useState<string | null>(null);
  const [openQuestions, setOpenQuestions] = useState(0);
  const [pendingPicks, setPendingPicks] = useState(0);
  const [ranking, setRanking] = useState<RankingRow[]>([]);
  const [myPos, setMyPos] = useState<number | null>(null);
  const [rewards, setRewards] = useState<LedgerRow[]>([]);
  const [decks, setDecks] = useState<DuelDeckDTO[] | null>(null);
  const [loop, setLoop] = useState<LoopView | null>(null);
  const [liveEvent, setLiveEvent] = useState<EventView | null>(null);
  const { toast, notify } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const all = await fetchTournaments();
      const t = all.find((x) => x.status === "ongoing")
        ?? all.find((x) => x.status === "upcoming")
        ?? all[0] ?? null;
      setFeatured(t);

      if (t) {
        const [ms, pe] = await Promise.all([fetchMatches(t.id), fetchPickemEvent(t.id)]);
        setMatches(ms);
        if (pe) {
          setPickemId(pe.id);
          const qs = await fetchPickemQuestions(pe.id);
          const open = qs.filter((q) => !q.locked);
          setOpenQuestions(open.length);
          if (user) {
            const mine = await fetchMyAnswers(pe.id);
            setPendingPicks(open.filter((q) => !mine[q.id]).length);
          }
        }
      }

      setRanking(await fetchGlobalRanking());
      if (user) {
        const [led, pos] = await Promise.all([
          fetchLedger(20),
          fetchMyRankPosition(profile?.points ?? 0),
        ]);
        setRewards(led.filter((r) => isReward(r.reason)));
        setMyPos(pos);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el inicio");
    } finally {
      setLoading(false);
    }
  }, [user, profile?.points]);

  useEffect(() => { if (configured) load(); else setLoading(false); }, [configured, load]);

  /*
   * Los mazos van APARTE del resto de la carga. Si `/api/game/duel/decks` falla, el
   * vestíbulo entero no puede quedarse en un estado de error: el escenario sigue
   * ofreciendo jugar y el servidor rechazará la partida si no hay mazo válido, que es
   * quien tiene que decidirlo.
   */
  useEffect(() => {
    if (!configured || !user) { setDecks(null); return; }
    let alive = true;
    fetchDuelDecks()
      .then((d) => { if (alive) setDecks(d.decks); })
      .catch(() => { if (alive) setDecks([]); });
    return () => { alive = false; };
  }, [configured, user]);

  /*
   * EL CICLO DE JUEGO (Fase 10). Una sola lectura que devuelve qué puede hacer el jugador
   * ahora mismo: la partida a medias, las predicciones que caducan, lo que tiene sin
   * reclamar, los sobres sin abrir y si le falta mazo.
   *
   * Va aparte del resto de la carga, como los mazos, y falla en silencio: el vestíbulo no
   * puede quedarse en un estado de error porque una tira de sugerencias no haya llegado.
   */
  useEffect(() => {
    if (!configured || !user) { setLoop(null); return; }
    let alive = true;
    fetchLoop()
      .then((l) => { if (alive) setLoop(l); })
      .catch(() => { if (alive) setLoop(null); });
    return () => { alive = false; };
  }, [configured, user]);

  /*
   * El evento en vivo. Se recarga a mano (`reloadEvent`) despues de cobrar un desafio
   * porque el progreso y lo cobrado los decide el servidor: reconstruir la vista aqui
   * seria volver a tener dos fuentes de verdad, que es justo lo que la Fase 12 cierra.
   */
  const reloadEvent = useCallback(() => {
    if (!configured || !user) { setLiveEvent(null); return; }
    fetchEvent().then(setLiveEvent).catch(() => setLiveEvent(null));
  }, [configured, user]);

  useEffect(() => { reloadEvent(); }, [reloadEvent]);

  const distinct = useMemo(() => groupCollection(ownedCards).size, [ownedCards]);
  const totalPacks = useMemo(() => Object.values(unopened).reduce((s, n) => s + n, 0), [unopened]);
  const liveMatch = useMemo(() => matches.find((m) => m.status === "live") ?? null, [matches]);
  const nextMatches = useMemo(() => matches.filter((m) => m.status !== "finished").slice(0, 4), [matches]);
  const lastReward = rewards[0] ?? null;

  /** El mazo que se llevaría a una partida: el primero válido, y si no, el más reciente. */
  const activeDeck = useMemo(() => {
    if (!decks || decks.length === 0) return null;
    return decks.find((d) => d.valid) ?? decks[0];
  }, [decks]);

  /**
   * Tus tres mejores cartas: las de mayor rareza y, a igualdad, mayor media. Es lo que
   * un jugador enseñaría si le preguntaras qué tiene. No hay relleno: si no tienes
   * cartas, la vitrina no aparece.
   */
  const showcase = useMemo(() => {
    const seen = new Set<string>();
    return ownedCards
      .map((o) => ({ owned: o, def: getCard(o.cardId) }))
      .filter((x): x is { owned: typeof ownedCards[number]; def: NonNullable<ReturnType<typeof getCard>> } => !!x.def)
      .filter((x) => (seen.has(x.def.id) ? false : (seen.add(x.def.id), true)))
      .sort((a, b) =>
        getVariant(b.def.variantId).rank - getVariant(a.def.variantId).rank || b.def.ovr - a.def.ovr)
      .slice(0, 3);
  }, [ownedCards]);

  const level = levelFromXp(xp);
  const rank = rankProgress(profile?.points ?? 0);
  const display = rankDisplay(profile?.points ?? 0, myPos);

  return (
    <div className="space-y-8">
      {!configured ? (
        <EmptyState icon="🌐" title="Modo local"
          hint="Configura la cuenta online para acceder a torneos, Pick'ems y clasificación."
          action={{ href: "/cuenta", label: "Ver cuenta" }} />
      ) : loading ? (
        <Loading label="Cargando" />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
        <>
          {/* ═══════════════════ ESCENARIO — el modo principal ═══════════════════ */}
          <section
            className="nx-stage nx-stage-grid nx-clip relative overflow-hidden"
            aria-label="Duelos"
          >
            {/*
              Luz del escenario. Dos focos: uno frío arriba a la derecha que recorta el
              abanico de cartas y uno cálido abajo a la izquierda sobre el que se apoya el
              titular. Es lo que da PROFUNDIDAD: un solo degradado plano se lee como fondo.
            */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 -z-10"
              style={{
                background:
                  "radial-gradient(760px 420px at 8% 108%, rgba(255,46,99,0.34), transparent 66%), radial-gradient(680px 460px at 88% -12%, rgba(25,227,255,0.16), transparent 62%)",
              }}
            />

            {/*
              CINTA DE DIRECTO. Lo que antes ocupaba todo el héroe cabe en una tira: dice
              que hay algo pasando ahora mismo y lleva a ello de un clic. La información
              completa vive abajo, en «El circuito».
            */}
            {featured && (
              <Link
                href={`/torneos/${featured.id}`}
                className="group relative flex items-center gap-3 border-b border-white/10 bg-black/35 px-5 py-2.5 transition-colors duration-fast hover:bg-black/55 sm:px-8"
              >
                {liveMatch ? (
                  <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-drl px-2.5 py-1 font-display text-[10px] font-bold uppercase tracking-label text-white">
                    <span className="h-1.5 w-1.5 rounded-full bg-white motion-safe:animate-pulse-glow" />
                    En directo
                  </span>
                ) : (
                  <span className="shrink-0 rounded-full border border-drl-cyan/40 bg-drl-cyan/10 px-2.5 py-1 font-display text-[10px] font-bold uppercase tracking-label text-drl-cyan">
                    Circuito
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate font-display text-[13px] font-bold uppercase tracking-[0.08em] text-white/85">
                  {featured.name}
                </span>
                {liveMatch && (
                  <span className="hidden shrink-0 truncate text-[12px] text-white/50 sm:block">
                    {liveMatch.team_a} vs {liveMatch.team_b}
                  </span>
                )}
                <span aria-hidden className="shrink-0 font-display text-[11px] text-drl transition-transform duration-fast group-hover:translate-x-1">→</span>
              </Link>
            )}

            <div className="relative grid gap-8 px-5 py-8 sm:px-9 sm:py-12 lg:grid-cols-[1.05fr_minmax(0,0.95fr)] lg:items-center">
              {/* ── Columna de acción ── */}
              <div className="min-w-0">
                <span className="nx-label !text-drl">Modo principal · 1 vs 1</span>

                {/*
                  El titular es el MODO, no el producto. Un vestíbulo que se encabeza con
                  el nombre del juego no dice qué hacer; uno que se encabeza con «DUELOS»
                  sí. El nombre del producto ya está en la barra superior.
                */}
                <h1 className="mt-2 font-display text-[clamp(46px,9vw,88px)] font-bold uppercase leading-[0.88] tracking-[-0.01em] text-white">
                  Duelos
                </h1>
                <p className="mt-3 max-w-md text-[15px] leading-relaxed text-white/60">
                  Tu mazo contra un rival. Diez turnos, una estadística por carta y ningún
                  dado: gana quien lee mejor al otro.
                </p>

                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <Link
                    href={user ? "/duelos" : "/cuenta"}
                    className="nx-clip-sm group relative overflow-hidden bg-drl px-8 py-4 font-display text-[15px] font-bold uppercase tracking-[0.14em] text-white shadow-glow transition duration-fast hover:brightness-110"
                  >
                    <span className="relative">Jugar ahora</span>
                    {/* Barrido de luz al pasar por encima: el botón principal responde. */}
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-y-0 -left-full w-1/2 skew-x-12 bg-white/25 transition-transform duration-slow ease-out group-hover:translate-x-[300%] motion-reduce:hidden"
                    />
                  </Link>
                  <Link
                    href="/duelos/mazos"
                    className="nx-clip-sm border border-white/18 px-6 py-4 font-display text-[13px] font-bold uppercase tracking-[0.14em] text-white/75 transition duration-fast hover:border-white/40 hover:text-white"
                  >
                    Mis mazos
                  </Link>
                </div>

                {/*
                  ESTADO DEL MAZO. «Jugar ahora» sin saber si hay mazo es un botón que
                  lleva a un error. Aquí se dice antes de pulsar, y con el dato real que
                  devuelve la misma API que usa `/duelos`.
                */}
                {user && decks !== null && (
                  <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 font-display text-[12px] uppercase tracking-[0.1em]">
                    {activeDeck ? (
                      <>
                        <span className={activeDeck.valid ? "text-ok" : "text-warn"}>
                          {activeDeck.valid ? "◆ Mazo listo" : "◆ Mazo incompleto"}
                        </span>
                        <span className="text-white/35">·</span>
                        <span className="text-white/55">{activeDeck.name}</span>
                        <span className="text-white/35">·</span>
                        <span className="nx-readout text-white/70">{activeDeck.cards.length}/10</span>
                        {activeDeck.sumOvr > 0 && (
                          <>
                            <span className="text-white/35">·</span>
                            <span className="nx-readout text-drl-cyan">OVR {activeDeck.sumOvr}</span>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="text-warn">◆ Sin mazo</span>
                        {/*
                          Enlace con altura de CONTROL, no de texto. La primera versión lo
                          dejó dentro de la frase: 194×18 px, que `ux:verify` marcó a 390 y
                          768 px por quedarse bajo el suelo de 32. Un destino que se pulsa
                          con el pulgar no puede tener la altura de una línea de texto.
                        */}
                        <Link
                          href="/duelos/mazos"
                          className="nx-clip-sm inline-flex min-h-[32px] items-center border border-white/18 px-3 text-white/75 transition duration-fast hover:border-white/40 hover:text-white"
                        >
                          Construye el tuyo
                        </Link>
                      </>
                    )}
                  </p>
                )}
              </div>

              {/*
                ABANICO. Se solapan y se inclinan como cartas en la mano, no como tres
                columnas de una rejilla: es lo que hace que se lean como OBJETOS.

                Fase 9.6: **también en móvil.** Antes solo aparecía a partir de `lg`, así
                que a 390 px —donde más se entra— el vestíbulo de un juego de cartas
                seguía sin enseñar una sola carta. Ahora entra debajo del titular, más
                pequeño y sin inclinación 3D (con el dedo encima, girar la carta la tapa).
              */}
              {showcase.length > 0 && (
                <div className="flex justify-center lg:justify-end" aria-label="Lo mejor de tu colección">
                  <div className="flex items-center px-6 sm:px-10">
                    {showcase.slice(0, 3).map((c, i) => {
                      const v = getVariant(c.def.variantId);
                      return (
                        /*
                          La colocación del abanico va en un ENVOLTORIO, no en `Card3D`: el
                          componente anima su propio `transform` y escribirle otro encima
                          haría que uno pisara al otro.
                        */
                        <div
                          key={c.owned.uid}
                          style={{
                            marginLeft: i === 0 ? 0 : -26,
                            transform: `rotate(${(i - 1) * 6}deg) translateY(${i === 1 ? -12 : 4}px)`,
                            zIndex: i === 1 ? 3 : 2 - Math.abs(i - 1),
                          }}
                        >
                          <Card3D
                            /* El halo continuo, solo en la carta del centro: tres a la vez se funden. */
                            mode={i === 1 && v.rank >= 5 ? "legendary" : "hover"}
                            glow={v.palette.primary}
                            delay={0.12 + i * 0.09}
                            className="w-[92px] sm:w-[124px] xl:w-[146px]"
                          >
                            <PlayerCard card={c.def} serial={c.owned.serial} />
                          </Card3D>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/*
              ═══ HUD DEL JUGADOR ═══
              Esto es lo que antes eran cuatro tarjetas al final de la pantalla. Un dato de
              videojuego no vive en una caja: vive sobre el escenario, con su etiqueta
              encima y una línea de acento debajo. Mismos cuatro datos, mismos destinos,
              cero cajas.
            */}
            {user && (
              <div className="relative flex flex-wrap items-center gap-x-8 gap-y-4 border-t border-white/10 bg-black/30 px-5 py-4 sm:px-9">
                <Link href="/ranking" className="group flex items-center gap-3" aria-label="Tu rango">
                  <RankEmblem
                    tierId={display.champion ? "nexus" : rank.tier.id}
                    color={display.color}
                    champion={display.champion}
                    division={rank.division}
                    divisions={rank.tier.divisions}
                    size={44}
                    className="shrink-0 transition-transform duration-fast group-hover:scale-110"
                  />
                  <span className="min-w-0">
                    <span className="nx-label block">Rango</span>
                    <span
                      className="nx-readout block text-[19px] leading-tight"
                      style={{ color: display.color }}
                    >
                      {display.label}
                    </span>
                    <span className="block text-[11px] text-white/40">
                      {myPos ? `Puesto ${myPos} del mundo` : `${rank.points} pts`}
                    </span>
                  </span>
                </Link>

                <span aria-hidden className="hidden h-10 w-px bg-white/10 sm:block" />

                <HudReadout
                  href="/cuenta" label="Nivel" value={String(level.level)}
                  foot={`${level.xpIntoLevel} / ${level.xpForNext} XP`}
                  accent="#19e3ff" progress={level.progress}
                />
                <HudReadout
                  href="/coleccion" label="Colección" value={String(distinct)}
                  suffix={` / ${TOTAL_CARDS}`}
                  foot={`${ownedCards.length} cartas en total`}
                  accent="#7b5cff" progress={TOTAL_CARDS ? distinct / TOTAL_CARDS : 0}
                />
                <HudReadout
                  href={totalPacks > 0 ? "/inventario" : "/tienda"} label="Créditos"
                  value={formatCredits(credits)}
                  foot={totalPacks > 0
                    ? `${totalPacks} ${totalPacks === 1 ? "sobre" : "sobres"} sin abrir`
                    : "Sin sobres pendientes"}
                  accent="#ffd35c"
                />
              </div>
            )}
          </section>

          {/*
            ═══════════════════ QUÉ HACER AHORA ═══════════════════
            La tira que hila las piezas. Va inmediatamente debajo del escenario porque es
            lo segundo que se mira: primero «a qué juego», después «qué tengo pendiente».
          */}
          {loop && loop.steps.length > 0 && <NextUp steps={loop.steps} />}

          {/*
            ═══════════════════ EL EVENTO EN VIVO ═══════════════════
            Va despues de la tira y antes de los modos: es contenido que CADUCA, asi que
            tiene que verse antes que las puertas permanentes, pero no puede tapar «que
            hacer ahora», que es lo que resuelve la sesion de hoy.
          */}
          {liveEvent && (
            <LiveEventPanel view={liveEvent} onChanged={reloadEvent} notify={notify} />
          )}

          {/* ═══════════════════ SECUNDARIO — las otras puertas ═══════════════════ */}
          <section aria-label="Modos de juego">
            <h2 className="nx-label mb-3">Otros modos</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {MODES.map((m) => (
                <Link
                  key={m.href}
                  href={m.href}
                  className={cn(
                    "nx-clip group relative isolate flex min-h-[164px] flex-col justify-end overflow-hidden",
                    "border border-white/10 p-5 transition duration-normal ease-out",
                    "hover:-translate-y-1 hover:border-white/30",
                  )}
                  style={{ background: `linear-gradient(150deg, rgba(${m.tint},0.20), rgba(255,255,255,0.02) 58%)` }}
                >
                  <span
                    aria-hidden
                    className="nx-bloom -right-10 -top-12 h-48 w-48"
                    style={{ background: `rgb(${m.tint})` }}
                  />

                  {/*
                    El emblema vive DETRÁS del texto, grande y recortado por el borde. Un
                    icono pequeño en una esquina se lee como decoración; a este tamaño se
                    lee como identidad del modo.
                  */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute -right-5 -top-5 -z-10 h-32 w-32 opacity-25 transition-all duration-normal ease-out group-hover:scale-105 group-hover:opacity-45"
                  >
                    <ModeEmblem mode={m.id} color={m.tint} />
                  </span>

                  <span className="nx-label" style={{ color: `rgb(${m.tint})` }}>{m.tag}</span>
                  <span className="mt-1 block font-display text-3xl font-bold uppercase leading-none tracking-wide text-white">
                    {m.label}
                  </span>
                  <span className="mt-2 block max-w-[26ch] text-[13px] leading-snug text-white/55">
                    {m.line}
                  </span>
                  <span
                    aria-hidden
                    className="mt-4 block h-[3px] w-10 rounded-full transition-[width] duration-normal ease-out group-hover:w-24"
                    style={{ background: `rgb(${m.tint})`, boxShadow: `0 0 14px rgb(${m.tint} / 0.9)` }}
                  />
                </Link>
              ))}
            </div>

            {/*
              TERCIARIO. Cuatro destinos de gestión en una tira baja. Con el mismo tamaño
              que las puertas competirían con ellas, y no son modos de juego: son sitios a
              los que se va a hacer algo concreto y se vuelve.
            */}
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {UTILITIES.map((u) => (
                <Link
                  key={u.href}
                  href={u.href}
                  className="nx-clip-sm group flex items-center justify-between border border-white/[0.08] bg-white/[0.025] px-4 py-3 transition duration-fast hover:bg-white/[0.06]"
                >
                  <span className="font-display text-[13px] font-bold uppercase tracking-[0.12em] text-white/65 transition-colors duration-fast group-hover:text-white">
                    {u.label}
                  </span>
                  <span
                    aria-hidden
                    className="h-2 w-2 rounded-full transition-transform duration-fast group-hover:scale-150"
                    style={{ background: `rgb(${u.tint})`, boxShadow: `0 0 10px rgb(${u.tint} / 0.8)` }}
                  />
                </Link>
              ))}
            </div>
          </section>

          {/* ═══════════════════ EL CIRCUITO ═══════════════════ */}
          {featured ? (
            <section className="nx-panel nx-clip overflow-hidden" aria-label="El circuito">
              <div className="relative grid gap-6 p-5 sm:p-7 lg:grid-cols-[1fr_minmax(0,0.85fr)]">
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 -z-10"
                  style={{ background: "radial-gradient(560px 260px at 6% 110%, rgba(255,138,61,0.16), transparent 66%)" }}
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="nx-label !text-[#ff8a3d]">El circuito</span>
                    {featured.source === "demo" && <DemoBadge />}
                  </div>
                  <h2 className="mt-1.5 font-display text-[clamp(22px,4vw,34px)] font-bold uppercase leading-tight text-white">
                    {featured.name}
                  </h2>
                  <p className="mt-2 max-w-lg text-[14px] leading-relaxed text-white/55">
                    {user && pickemId
                      ? openQuestions === 0
                        ? "Las predicciones de este torneo están cerradas."
                        : pendingPicks > 0
                          ? `Te ${pendingPicks === 1 ? "queda 1 predicción" : `quedan ${pendingPicks} predicciones`} por hacer de ${openQuestions} ${openQuestions === 1 ? "abierta" : "abiertas"}.`
                          : `Ya has respondido las ${openQuestions} predicciones abiertas.`
                      : "Sigue el competitivo de VALORANT, predice los resultados y colecciona a los profesionales."}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2.5">
                    {pickemId && openQuestions > 0 && (
                      <Link
                        href="/pickems"
                        className="nx-clip-sm bg-drl px-5 py-3 font-display text-[13px] font-bold uppercase tracking-[0.12em] text-white shadow-glow transition duration-fast hover:brightness-110"
                      >
                        Hacer mis predicciones
                      </Link>
                    )}
                    <Link
                      href={`/torneos/${featured.id}`}
                      className={cn(
                        "nx-clip-sm px-5 py-3 font-display text-[13px] uppercase tracking-[0.12em] transition duration-fast",
                        pickemId && openQuestions > 0
                          ? "border border-white/18 text-white/80 hover:bg-white/[0.08]"
                          : "bg-drl font-bold text-white shadow-glow hover:brightness-110",
                      )}
                    >
                      Ver el torneo
                    </Link>
                  </div>
                </div>

                {nextMatches.length > 0 && (
                  <div className="min-w-0">
                    <p className="nx-label mb-2.5">Próximos partidos</p>
                    <ul className="grid gap-1.5">
                      {nextMatches.map((m) => (
                        <li
                          key={m.id}
                          className="flex items-center gap-3 rounded-control bg-white/[0.035] px-3 py-2 text-[13px]"
                        >
                          {/*
                            Los dos equipos van juntos alrededor del «VS», no empujados a
                            los extremos: separados por medio panel dejan de leerse como un
                            enfrentamiento y pasan a leerse como dos columnas de una tabla.
                          */}
                          <span className="flex min-w-0 flex-1 items-center gap-2.5">
                            <span className="min-w-0 flex-1 truncate text-right text-white/80">{m.team_a}</span>
                            <span className="shrink-0 font-display text-[11px] font-bold text-white/25">VS</span>
                            <span className="min-w-0 flex-1 truncate text-white/80">{m.team_b}</span>
                          </span>
                          <span
                            className={cn(
                              "hidden w-[86px] shrink-0 text-right font-display text-[10px] uppercase tracking-wide sm:block",
                              m.status === "live" ? "text-drl-cyan" : "text-white/30",
                            )}
                          >
                            {m.status === "live" ? "● En vivo" : fmt(m.start_time)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </section>
          ) : (
            <EmptyState icon="🏆" title="Todavía no hay torneos"
              hint="Cuando se publique el próximo torneo aparecerá aquí." />
          )}

          {/* ═══════════════════ Clasificación y recompensas ═══════════════════ */}
          <div className="grid gap-5 lg:grid-cols-2">
            {ranking.length > 0 && (
              <section aria-label="Clasificación">
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h2 className="nx-label">Mejores pronosticadores</h2>
                  <Link href="/ranking" className="nx-action">
                    Clasificación completa →
                  </Link>
                </div>
                <ol className="nx-panel divide-y divide-white/[0.06] overflow-hidden">
                  {ranking.slice(0, 5).map((r, i) => (
                    <li
                      key={r.id}
                      className={cn(
                        "flex items-center gap-3 px-4 py-2.5",
                        r.id === user?.id && "bg-drl/[0.09]",
                      )}
                    >
                      <span
                        className={cn(
                          "w-5 text-center font-display text-sm font-bold tabular-nums",
                          i === 0 ? "text-drl-gold" : i === 1 ? "text-white/70" : i === 2 ? "text-rarity-bronze" : "text-white/35",
                        )}
                      >
                        {i + 1}
                      </span>
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-control bg-white/[0.06] text-base">{r.avatar}</span>
                      <span className="min-w-0 flex-1 truncate text-[14px] text-white/85">
                        {r.username}
                        {r.id === user?.id && <span className="ml-2 font-display text-[10px] uppercase tracking-wide text-drl">tú</span>}
                      </span>
                      {/* El rango del puesto, no solo su cifra: la escalera se ve en la lista. */}
                      <RankEmblem
                        tierId={rankProgress(r.points).tier.id}
                        color={rankProgress(r.points).tier.color}
                        size={22}
                        className="shrink-0 opacity-80"
                      />
                      <span className="w-12 shrink-0 text-right font-display text-sm font-bold tabular-nums text-drl-gold">{r.points}</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {user && (
              <section aria-label="Recompensas">
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h2 className="nx-label">Última recompensa</h2>
                  <Link href="/recompensas" className="nx-action">
                    Ver todas →
                  </Link>
                </div>
                {lastReward ? (
                  <div className="nx-panel nx-rail flex items-center gap-4 px-5 py-4" style={{ ["--nx-tint" as string]: "63 192 122" }}>
                    <span className="text-3xl" aria-hidden>🎁</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display text-base font-bold uppercase tracking-wide text-white">
                        {describeLedger(lastReward.reason, lastReward.ref).label}
                      </p>
                      <p className="text-[13px] text-white/50">
                        {lastReward.delta > 0 ? `🪙 ${formatCredits(lastReward.delta)} · ` : ""}
                        {new Date(lastReward.created_at).toLocaleDateString("es-ES", { day: "numeric", month: "long" })}
                      </p>
                    </div>
                    <p className="shrink-0 font-display text-sm font-bold tabular-nums text-ok">
                      {rewards.length}
                    </p>
                  </div>
                ) : (
                  <p className="rounded-panel border border-dashed border-white/12 px-5 py-6 text-center text-[13px] text-white/50">
                    Todavía no has ganado recompensas. Haz tus predicciones y llegarán al corregirse el torneo.
                  </p>
                )}
              </section>
            )}
          </div>
        </>
      )}

      {/* El aviso de lo que acaba de cobrarse. Sin el, cobrar un desafio no dice nada. */}
      <Toast toast={toast} />
    </div>
  );
}

/**
 * Un dato del HUD. Etiqueta arriba, cifra grande, pie pequeño y —si tiene sentido— una
 * línea de progreso de 2 px. **Sin caja**: lo que separa un dato de otro es el espacio y
 * el divisor del contenedor, no un borde por cada cifra.
 */
function HudReadout({
  label, value, suffix, foot, accent, progress, href,
}: {
  label: string;
  value: string;
  suffix?: string;
  foot: string;
  accent: string;
  progress?: number;
  href: string;
}) {
  return (
    <Link href={href} className="group min-w-[104px]">
      <span className="nx-label block">{label}</span>
      <span className="nx-readout mt-1 block text-[22px]" style={{ color: accent }}>
        {value}
        {suffix && <span className="text-[13px] text-white/30">{suffix}</span>}
      </span>
      {progress !== undefined && (
        <span className="mt-1.5 block h-[2px] w-full max-w-[120px] overflow-hidden rounded-full bg-white/12">
          <span
            className="block h-full rounded-full transition-[width] duration-slow ease-out"
            style={{ width: `${Math.round(progress * 100)}%`, background: accent }}
          />
        </span>
      )}
      <span className="mt-1 block text-[11px] text-white/40 transition-colors duration-fast group-hover:text-white/60">
        {foot}
      </span>
    </Link>
  );
}
