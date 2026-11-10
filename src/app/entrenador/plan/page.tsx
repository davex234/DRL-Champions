"use client";

/**
 * `/entrenador/plan?match=<id>` — EL PLAN TÁCTICO DE UNA PARTIDA. FASE 51: el briefing de partido.
 *
 * ────────────────────────── LO QUE NO SE INVENTA ──────────────────────────
 *
 * Todo lo que se enseña de la partida —mapa, rival, marcador, fecha— sale de `coach_matches`. Si
 * un dato no está, no se pinta un hueco con un guion inventado: no se pinta.
 *
 * ────────────────────────── FASE 51 · TRES ENTRADAS, NINGUNA ROTA ──────────────────────────
 *
 *   · SIN `?match`: la pantalla ya no es un callejón («Falta la partida»). Enseña TUS partidas
 *     reales para elegir una, o un estado vacío con el camino para jugar la primera.
 *   · CON `?match` que no es tuyo, no existe o está mal formado: el servidor responde 404 igual en
 *     los tres casos (`GET /api/game/coach-matches?id=`), y aquí se enseña un «no encontrada»
 *     que no repite el identificador ni distingue ajeno de inexistente. Antes se cargaba la
 *     pantalla entera con el mapa vacío y las jugadas de nadie.
 *   · CON un `?match` tuyo: el plan, leído con UNA petición de esa partida y no buscándola entre
 *     las sesenta últimas (una partida antigua desaparecía del plan).
 *
 * ────────────────────────── DOS FILTROS, Y EL QUE MANDA ──────────────────────────
 *
 * La biblioteca sólo ofrece jugadas DEL MAPA de la partida. Ese filtro es una comodidad, no la
 * regla: el servidor vuelve a comprobarlo y responde 409.
 */
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/supabase/auth";
import { NeedsAccount } from "@/components/ui/States";
import { getTacticalMap } from "@/domain/tactics/maps";
import { isComplete, type Composition } from "@/domain/tactics/composition";
import { CompositionStrip } from "@/components/tactics/CompositionBuilder";
import { MapThumb } from "@/components/tactics/MapThumb";
import { TacticalTheater } from "@/components/tactics/TacticalTheater";
import { CoachHeader } from "@/components/coach/tc/CoachFrame";
import { CoachIcon } from "@/components/coach/tc/CoachIcons";
import {
  fetchCompositions, fetchMatchStrats, assignStrat, unassignStrat, fetchCoachMatch, fetchCoachMatches,
  fetchStrats, TacticsError, type AssignedStrat, type StratRow, type CoachMatchSummary,
} from "@/lib/tactics/client";
import { cn } from "@/lib/format";
import { playerMessage } from "@/components/ui/game/GameStates";
import { ns, td, getIntlLocale } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const t = ns("entrenador");

const SIDE_LABEL: Record<string, string> = { attack: "Ataque", defense: "Defensa" };
const SIDE_COLOR: Record<string, string> = { attack: "#ff2e8c", defense: "#2fe0ff" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CoachMatch = CoachMatchSummary;

/**
 * `useSearchParams()` obliga a Next a renderizar en cliente la rama que lo llama; sin `<Suspense>`
 * el prerender de `next build` aborta (missing-suspense-with-csr-bailout).
 */
export default function PlanTacticoPage() {
  useLocale();
  return (
    <Suspense fallback={<p className="nx-label text-white/40">{t("Cargando…")}</p>}>
      <PlanTactico />
    </Suspense>
  );
}

function PlanTactico() {
  useLocale();
  const { user, loading } = useAuth();
  const params = useSearchParams();
  const matchId = params.get("match") ?? "";

  if (loading) return null;
  if (!user) return <NeedsAccount what={t("el plan táctico")} />;
  if (!matchId) return <ElegirPartida />;
  return <PlanDePartida key={matchId} matchId={matchId} />;
}

/* ═══════════════════════ SIN PARTIDA: elegir una real ═══════════════════════ */

function ElegirPartida() {
  useLocale();
  const [lista, setLista] = useState<CoachMatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetchCoachMatches(12)
      .then((r) => { if (vivo) setLista(r.matches); })
      .catch(() => { if (vivo) setError(t("No se pudieron leer tus partidos.")); });
    return () => { vivo = false; };
  }, []);

  return (
    <div data-testid="plan-select-match">
      <CoachHeader
        kicker={t("Match Plan · preparación")}
        title={<>{fill(t("Plan de {palabra}", slots("palabra")), { palabra: <span className="text-[#2fe0ff]">{t("partido")}</span> })}</>}
        line={t("Elige una partida real y prepara su plan: composición del mapa, jugadas de ataque y defensa, y presentación al equipo.")}
        actions={<Link href="/entrenador/partido" className="nx-coach-btn">{t("Dirigir un partido")}</Link>}
      />

      {error && <p className="nx-coach-conflict px-4 py-3 text-[13px] text-white">{playerMessage(error)}</p>}
      {!error && lista === null && <p className="nx-label text-white/40">{t("Cargando tus partidos…")}</p>}

      {lista && lista.length === 0 && (
        <section data-testid="plan-no-matches" className="nx-coach-panel relative overflow-hidden px-6 py-10 text-center">
          <span aria-hidden className="mx-auto mb-3 grid h-14 w-14 place-items-center text-[#2fe0ff]"><CoachIcon name="plan" size={40} /></span>
          <h2 className="font-display text-[22px] font-extrabold uppercase text-white">{t("Todavía no hay partidas")}</h2>
          <p className="nx-coach-muted mx-auto mt-2 max-w-md text-[14px] leading-relaxed">
            {t("El plan se hace sobre una partida que hayas dirigido. Juega la primera y vuelve aquí para prepararla.")}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Link href="/entrenador/partido" className="nx-coach-btn">{t("Dirigir partido")}</Link>
            <Link href="/entrenador/strats" className="nx-coach-btn" data-variant="ghost">{t("Ir a la pizarra")}</Link>
          </div>
        </section>
      )}

      {lista && lista.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="plan-match-list">
          {lista.map((m) => {
            const mapa = getTacticalMap(m.mapId);
            return (
              <li key={m.id}>
                <Link
                  href={`/entrenador/plan?match=${m.id}`}
                  data-testid={`plan-match-${m.id}`}
                  className="nx-coach-module group flex items-center gap-3 p-3"
                >
                  {mapa && (
                    <span aria-hidden className="w-[76px] shrink-0 overflow-hidden bg-[#070a10] p-0.5 shadow-[inset_0_0_0_1px_rgba(47,224,255,0.2)]">
                      <MapThumb map={mapa} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <b className="block truncate font-display text-[15px] font-extrabold uppercase tracking-[0.04em] text-white">
                      {mapa?.name ?? m.mapId}
                    </b>
                    {m.rivalName && <span className="block truncate text-[12.5px] text-white/60">{t("vs")} {m.rivalName}</span>}
                    {m.finishedAt && <span className="nx-label block !text-white/35">{new Date(m.finishedAt).toLocaleDateString(getIntlLocale())}</span>}
                  </span>
                  <span className="shrink-0 text-right">
                    <b className="nx-readout block text-[20px] leading-none text-white">
                      {m.scoreHome}<span className="mx-0.5 text-white/30">-</span>{m.scoreAway}
                    </b>
                    <span className={cn("nx-label", m.won ? "!text-[rgb(63,214,150)]" : "!text-[#ff5aa8]")}>
                      {m.won ? t("Victoria") : t("Derrota")}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ═══════════════════════ CON PARTIDA: el plan ═══════════════════════ */

function PlanDePartida({ matchId }: { matchId: string }) {
  useLocale();
  const [match, setMatch] = useState<CoachMatch | null>(null);
  const [noEncontrada, setNoEncontrada] = useState(false);
  const [strats, setStrats] = useState<StratRow[]>([]);
  const [comps, setComps] = useState<Composition[]>([]);
  const [asignadas, setAsignadas] = useState<AssignedStrat[]>([]);
  const [compId, setCompId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  /** La jugada que se está presentando a pantalla completa. */
  const [presentando, setPresentando] = useState<StratRow | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    // Un id mal formado ni siquiera viaja: la respuesta sería el mismo 404.
    if (!UUID_RE.test(matchId)) { setNoEncontrada(true); setCargando(false); return; }
    try {
      let fila: CoachMatch;
      try {
        fila = await fetchCoachMatch(matchId);
      } catch (e) {
        if (e instanceof TacticsError && e.status === 404) { setNoEncontrada(true); return; }
        throw e;
      }
      const [s, c, a] = await Promise.all([fetchStrats(), fetchCompositions(), fetchMatchStrats(matchId)]);
      setMatch(fila);
      setStrats(s); setComps(c); setAsignadas(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("No se pudo cargar el plan"));
    } finally {
      setCargando(false);
    }
  }, [matchId]);

  useEffect(() => { void cargar(); }, [cargar]);

  const mapa = match ? getTacticalMap(match.mapId) : null;

  /* Sólo jugadas DE ESTE MAPA: las de otro no significan nada aquí. */
  const disponibles = useMemo(
    () => strats.filter((s) => match && s.mapId === match.mapId),
    [strats, match],
  );
  const compsDelMapa = useMemo(
    () => comps.filter((c) => match && c.mapId === match.mapId),
    [comps, match],
  );
  const comp = compsDelMapa.find((c) => c.id === compId) ?? null;
  const asignadaIds = useMemo(() => new Set(asignadas.map((a) => a.stratId)), [asignadas]);

  const alternar = useCallback(async (s: StratRow) => {
    setError(null);
    try {
      if (asignadaIds.has(s.id)) await unassignStrat(matchId, s.id);
      else await assignStrat(matchId, s.id);
      setAsignadas(await fetchMatchStrats(matchId));
    } catch (e) {
      // El 409 de mapa cruzado llega aquí con su mensaje: se enseña tal cual, no como «error».
      setError(e instanceof TacticsError ? e.message : t("No se pudo cambiar la asignación"));
    }
  }, [asignadaIds, matchId]);

  if (noEncontrada) {
    return (
      <section data-testid="plan-not-found" className="nx-coach-panel mx-auto max-w-xl px-6 py-10 text-center" data-tone="mag">
        <p className="nx-coach-kicker !text-[#ff5aa8]">{t("Match Plan")}</p>
        <h1 className="mt-2 font-display text-[26px] font-extrabold uppercase text-white">{t("Partida no encontrada")}</h1>
        <p className="nx-coach-muted mx-auto mt-2 max-w-sm text-[14px] leading-relaxed">
          {t("Ese enlace no lleva a ninguna de tus partidas. Elige una de tu historial para preparar su plan.")}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link href="/entrenador/plan" className="nx-coach-btn">{t("Seleccionar partido")}</Link>
          <Link href="/entrenador/partidos" className="nx-coach-btn" data-variant="ghost">{t("Ver partidos")}</Link>
        </div>
      </section>
    );
  }

  if (cargando && !match) return <p className="nx-label text-white/40">{t("Cargando el plan…")}</p>;
  if (!match) {
    return (
      <section className="nx-coach-conflict px-4 py-3 text-[13px] text-white">
        {td(error) ?? t("No se pudo cargar el plan")}{" "}
        <button type="button" className="nx-coach-btn ml-2" data-variant="ghost" data-size="sm" onClick={() => void cargar()}>{t("Reintentar")}</button>
      </section>
    );
  }

  return (
    <div data-testid="tactical-plan">
      {presentando && (
        <TacticalTheater
          strat={presentando.plan}
          agentIds={comp?.agentIds ?? []}
          open
          onClose={() => setPresentando(null)}
        />
      )}

      {/* ═══ EL BRIEFING: la planta del mapa, el rival y el marcador. Sólo datos reales. ═══ */}
      <header className="nx-coach-panel nx-coach-rise relative mb-5 flex flex-wrap items-center gap-5 overflow-hidden p-4 sm:p-5">
        {mapa && (
          <span aria-hidden className="relative hidden w-[132px] shrink-0 overflow-hidden bg-[#070a10] p-1 shadow-[inset_0_0_0_1px_rgba(47,224,255,0.3)] sm:block">
            <MapThumb map={mapa} />
            {(["tl", "tr", "bl", "br"] as const).map((c) => <span key={c} className="nx-coach-corner !h-3 !w-3" data-c={c} />)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="nx-coach-kicker">{t("Match Plan · briefing")}</p>
          <h1 className="mt-1 font-display text-[clamp(26px,4vh,46px)] font-extrabold uppercase leading-none tracking-[0.04em] text-white">
            {mapa?.name ?? match.mapId}
          </h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-white/55">
            {match.teamName && <span className="font-display uppercase tracking-wide text-white/80">{match.teamName}</span>}
            {match.rivalName && (
              <span className="font-display uppercase tracking-wide">
                <span className="text-white/35">{t("vs")} </span>
                <b className="text-white">{match.rivalName}</b>
              </span>
            )}
            {match.finishedAt && <span>{new Date(match.finishedAt).toLocaleDateString(getIntlLocale())}</span>}
          </p>
        </div>
        {match.scoreHome != null && match.scoreAway != null && (
          <span className="shrink-0 text-right">
            <span className="nx-label block !text-[9px] text-white/40">{t("Resultado")}</span>
            <b className="nx-readout text-[34px] leading-none text-white">
              {match.scoreHome}<span className="mx-1 text-white/30">-</span>{match.scoreAway}
            </b>
          </span>
        )}
        <span className="shrink-0 text-right">
          <span className="nx-label block !text-[9px] text-white/40">{t("En el plan")}</span>
          <b className="nx-readout text-[34px] leading-none text-[#2fe0ff]" style={{ textShadow: "0 0 16px rgba(47,224,255,0.5)" }}>{asignadas.length}</b>
        </span>
        <Link href="/entrenador/plan" className="nx-coach-btn w-full sm:w-auto" data-variant="ghost" data-size="sm">{t("Cambiar partida")}</Link>
      </header>

      {error && <p data-testid="plan-error" className="nx-coach-conflict mb-4 px-3 py-2 text-[13px] text-white">{playerMessage(error)}</p>}

      <div className="grid gap-5 lg:grid-cols-[minmax(260px,360px)_minmax(0,1fr)]">
        {/* ═══ COMPOSICIÓN ═══ */}
        <section data-testid="plan-composition">
          <h2 className="nx-coach-kicker mb-2">{t("01 · Composición")}</h2>
          {compsDelMapa.length === 0 ? (
            <p className="nx-coach-panel-flat px-4 py-6 text-center text-[13px] text-white/50">
              {fill(t("No hay composiciones en {mapa}. {enlace}", { mapa: mapa?.name ?? match.mapId, ...slots("enlace") }), {
                enlace: <Link href="/entrenador/composiciones" className="text-[#2fe0ff] underline">{t("Crear una")}</Link>,
              })}
            </p>
          ) : (
            <ul className="grid gap-2">
              {compsDelMapa.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    data-testid={`pick-comp-${c.id}`}
                    aria-pressed={compId === c.id}
                    onClick={() => setCompId(compId === c.id ? null : c.id)}
                    className="nx-coach-tool w-full !justify-between gap-3 !px-3 !py-2.5 text-left"
                  >
                    <span className="min-w-0">
                      <b className="block truncate font-display text-[13px] font-bold uppercase tracking-[0.06em] text-white">{c.name}</b>
                      <span className={cn("nx-label", isComplete(c) ? "!text-[rgb(63,214,150)]" : "!text-[#ffd35c]")}>{c.agentIds.length} / 5</span>
                    </span>
                    <CompositionStrip agentIds={c.agentIds} size={24} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ═══ JUGADAS ═══ */}
        <section data-testid="plan-strats">
          <h2 className="nx-coach-kicker mb-2">{t("02 · Jugadas de {mapa}", { mapa: mapa?.name ?? match.mapId })}</h2>
          {disponibles.length === 0 ? (
            <p className="nx-coach-panel-flat px-4 py-6 text-center text-[13px] text-white/50">
              {t("No hay jugadas guardadas en este mapa.")}{" "}
              <Link href="/entrenador/strats" className="text-[#2fe0ff] underline">{t("Ir a la pizarra")}</Link>
            </p>
          ) : (
            (["attack", "defense"] as const).map((lado) => {
              const grupo = disponibles.filter((s) => s.side === lado);
              const color = SIDE_COLOR[lado];
              return (
                /* Atacar y defender son dos preparaciones distintas: dos bloques, cada uno con su canto. */
                <div
                  key={lado}
                  data-testid={`plan-side-${lado}`}
                  className="nx-coach-panel-flat mb-3 overflow-hidden"
                  style={{ boxShadow: `inset 0 0 0 1px ${color}33, inset 3px 0 0 ${color}` }}
                >
                  <h3 className="flex items-baseline justify-between gap-2 px-3 py-2">
                    <span className="nx-label !text-[11px]" style={{ color }}>
                      {lado === "attack" ? "▲" : "▼"} {td(SIDE_LABEL[lado])}
                    </span>
                    <span className="nx-label !text-[9px] text-white/35">
                      {grupo.length === 0 ? t("sin jugadas") : t("{n, plural, one {{n} jugada} other {{n} jugadas}}", { n: grupo.length })}
                    </span>
                  </h3>
                  {grupo.length === 0 ? (
                    <p className="px-3 pb-3 text-[12.5px] leading-relaxed text-white/45">
                      {lado === "attack" ? t("Ninguna jugada de ataque guardada en {map}.", { map: mapa?.name ?? match.mapId }) : t("Ninguna jugada de defensa guardada en {map}.", { map: mapa?.name ?? match.mapId })}{" "}
                      <Link href="/entrenador/strats" className="text-[#2fe0ff] underline">{t("Dibujar una")}</Link>
                    </p>
                  ) : (
                  <ul className="grid gap-1.5 px-2 pb-2">
                    {grupo.map((s) => {
                      const puesta = asignadaIds.has(s.id);
                      /* COMPATIBILIDAD, dicha y no escondida: si la jugada se creó con otra composición, se avisa. */
                      const otraComp = comp && s.plan && (s.plan as unknown as { compositionId?: string }).compositionId
                        && (s.plan as unknown as { compositionId?: string }).compositionId !== comp.id;
                      return (
                        <li key={s.id}
                          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                          style={{
                            background: puesta ? "rgba(63,214,150,0.08)" : "rgba(255,255,255,0.02)",
                            boxShadow: `inset 0 0 0 1px ${puesta ? "rgba(63,214,150,0.45)" : "rgba(47,224,255,0.12)"}`,
                          }}>
                          <span className="min-w-0">
                            <b className="block truncate font-display text-[12.5px] font-bold uppercase tracking-[0.06em] text-white">{s.name}</b>
                            <span className="nx-label text-white/45">{t("{n, plural, one {# paso} other {# pasos}}", { n: s.steps })}</span>
                            {otraComp && (
                              <span data-testid="comp-incompatible" className="nx-label block !text-[9px] !text-[#ffd35c]">
                                {t("Creada con otra composición")}
                              </span>
                            )}
                          </span>
                          {/* Presentar pesa más que asignar, y abrir es un enlace discreto. */}
                          <span className="flex shrink-0 items-center gap-1.5">
                            <Link href={`/entrenador/strats?abrir=${s.id}`}
                              title={t("Abrir en la pizarra")}
                              className="nx-label nx-focus px-2 py-1.5 text-white/50 hover:text-white">
                              {t("Abrir")}
                            </Link>
                            <button type="button" data-testid={`assign-${s.id}`} onClick={() => void alternar(s)}
                              className="nx-coach-btn" data-variant="ghost" data-size="sm" aria-pressed={puesta}>
                              {puesta ? t("Quitar del plan") : t("Asignar")}
                            </button>
                            <button type="button" data-testid={`present-${s.id}`} onClick={() => setPresentando(s)}
                              title={t("Presentar a pantalla completa")}
                              className="nx-coach-btn" data-size="sm">
                              <CoachIcon name="present" size={14} /> {t("Presentar")}
                            </button>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  )}
                </div>
              );
            })
          )}
        </section>
      </div>

      {/* ═══ LO ASIGNADO: lo que se lleva a la partida ═══ */}
      <section className="mt-6" data-testid="plan-assigned">
        <h2 className="nx-coach-kicker mb-2">{t("03 · En el plan ·")} {asignadas.length}</h2>
        {asignadas.length === 0 ? (
          <p className="text-[13px] text-white/45">{t("Todavía no has asignado ninguna jugada.")}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {asignadas.map((a) => (
              <li key={a.id} className="nx-coach-panel-flat flex items-center gap-2 px-3 py-2">
                <span className="nx-label" style={{ color: SIDE_COLOR[a.side] ?? "#fff" }}>
                  {a.side === "attack" ? "▲" : "▼"}
                </span>
                <b className="font-display text-[12px] font-bold uppercase tracking-[0.06em] text-white">{a.name}</b>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
