"use client";

/**
 * TACTICAL COACH 4.0 — EL CENTRO DE MANDO (`/entrenador`).
 *
 * ────────────────────────── QUÉ CAMBIA EN LA FASE 51 ──────────────────────────
 *
 * El hub anterior abría con «JUGAR · Dirige un partido» y dejaba las herramientas tácticas —pizarra,
 * composiciones, plan— como una lista secundaria. Leído así, el entrenador era un simulador con
 * accesorios. Pero lo que la sala ofrece de verdad es PREPARACIÓN: componer, dibujar, planificar,
 * presentar y, al final, dirigir. El centro de mando lo enseña en ese orden:
 *
 *   1. HERO        — qué es esta sala y los dos gestos principales (pizarra y partido).
 *   2. ACTIVIDAD   — cifras REALES (jugadas, composiciones, partidos, titulares, última actividad).
 *                    Lo que no llega (sin sesión, sin red) no se pinta: nada de ceros inventados.
 *   3. EL FLUJO    — composición → jugada → plan → presentación → dirigir/revisar, con su estado.
 *   4. MÓDULOS     — las seis salas, cada una con su identidad y su dato.
 *   5. PLAN        — el plan táctico cuelga de un partido dirigido: aquí están los recientes.
 *   6. MAPAS       — los doce, en miniatura ligera.
 *
 * Ninguna funcionalidad desaparece: plantilla y carrera siguen enlazadas, y dirigir partido sigue
 * pidiendo cinco titulares como antes.
 *
 * FASE 51.1 · SIMPLIFICACIÓN. Un usuario nuevo no tiene que entender nueve salas para empezar: el
 * hero tiene UNA acción protagonista, JUGAR (`/entrenador/jugar`: equipo → mapa → partida). Las
 * herramientas siguen todas, agrupadas por para qué sirven: PREPARACIÓN (pizarra, composiciones,
 * plan), ANÁLISIS (mapas, partidos) y EQUIPO (plantilla). «El método» y la tira de mapas salen
 * del hub: eran más lectura antes de poder jugar.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { useTeamStore } from "@/store/useTeamStore";
import { TACTICAL_MAPS, getTacticalMap } from "@/domain/tactics";
import { TeamCardStrip } from "@/components/coach/roster/TeamRosterEditor";
import { MapThumb } from "@/components/tactics/MapThumb";
import { AgentPortrait } from "@/components/agents/AgentArt";
import { agentById } from "@/components/tactics/AgentEmblem";
import { TacticalHeroArt } from "@/components/coach/tc/TacticalHeroArt";
import { CoachIcon, type CoachIconName } from "@/components/coach/tc/CoachIcons";
import { fetchStrats, fetchCompositions, fetchCoachMatches, type CoachMatchSummary } from "@/lib/tactics/client";
import { cn } from "@/lib/format";
import { ns, td, getIntlLocale } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("entrenador");

export default function EntrenadorPage() {
  return (
    <HydrationGate>
      <CoachHub />
    </HydrationGate>
  );
}

/** Lectura con tres estados: la cifra, «no se pudo» (no se pinta) o cargando. */
type Dato<T> = T | null | undefined;

function CoachHub() {
  useLocale();
  const teams = useTeamStore((s) => s.teams);
  const activeTeamId = useTeamStore((s) => s.activeTeamId);
  const active = teams.find((t) => t.id === activeTeamId) ?? teams[0] ?? null;
  const titulares = active ? active.starters.length : 0;
  const listo = titulares === 5;

  /*
   * Tres lecturas del servidor, en paralelo y sin escrituras. Cada una falla por separado: sin sesión
   * o sin red la cifra no se enseña, y el resto de la sala sigue funcionando.
   */
  const [jugadas, setJugadas] = useState<Dato<{ n: number; last: string | null }>>(undefined);
  const [comps, setComps] = useState<Dato<{ n: number; last: string | null; agentIds: string[] }>>(undefined);
  const [partidos, setPartidos] = useState<Dato<{ total: number; recent: CoachMatchSummary[] }>>(undefined);
  useEffect(() => {
    let vivo = true;
    fetchStrats()
      .then((rows) => { if (vivo) setJugadas({ n: rows.length, last: rows[0]?.updatedAt ?? null }); })
      .catch(() => { if (vivo) setJugadas(null); });
    fetchCompositions()
      .then((rows) => {
        if (!vivo) return;
        const last = rows.map((c) => c.updatedAt).sort().at(-1) ?? null;
        // F59 · los cinco de la composición más reciente (dato real, no decoración).
        const reciente = [...rows].sort((x, y) => y.updatedAt.localeCompare(x.updatedAt))[0];
        setComps({ n: rows.length, last, agentIds: reciente?.agentIds ?? [] });
      })
      .catch(() => { if (vivo) setComps(null); });
    fetchCoachMatches(3)
      .then((r) => { if (vivo) setPartidos({ total: r.total, recent: r.matches }); })
      .catch(() => { if (vivo) setPartidos(null); });
    return () => { vivo = false; };
  }, []);

  const ultima = [jugadas?.last, comps?.last, partidos?.recent[0]?.finishedAt]
    .filter((x): x is string => !!x).sort().at(-1) ?? null;

  const preparacion: Modulo[] = [
    {
      href: "/entrenador/strats", icon: "board", title: tr("Pizarra"), tint: "47,224,255", big: true,
      line: tr("Diseña jugadas: el mapa, tus cinco, utilidades, trazos y pasos."),
      dato: jugadas ? tr("{n, plural, one {{n} jugada} other {{n} jugadas}}", { n: jugadas.n }) : null, cta: tr("Abrir pizarra"), art: "ascent",
    },
    {
      href: "/entrenador/composiciones", icon: "comp", title: tr("Composiciones"), tint: "52,124,255",
      line: tr("Elige los cinco agentes para cada mapa."),
      dato: comps ? tr("{n, plural, one {{n} composición} other {{n} composiciones}}", { n: comps.n }) : null, cta: tr("Componer"),
      agents: comps?.agentIds,
    },
    {
      href: "/entrenador/plan", icon: "plan", title: tr("Plan"), tint: "255,211,92",
      line: tr("Prepara estrategias para un partido."),
      dato: partidos ? (partidos.total > 0 ? tr("{n, plural, one {{n} partido para planificar} other {{n} partidos para planificar}}", { n: partidos.total }) : tr("Necesita un partido")) : null, cta: tr("Planificar"),
    },
  ];
  const analisis: Modulo[] = [
    {
      href: "/entrenador/mapas", icon: "maps", title: tr("Mapas"), tint: "120,210,255",
      line: tr("Estudia los {length}: zoom y sitios.", { length: TACTICAL_MAPS.length }), dato: tr("{n} mapas", { n: TACTICAL_MAPS.length }), cta: tr("Estudiar"), art: "haven",
    },
    {
      href: "/entrenador/partidos", icon: "history", title: tr("Partidos"), tint: "226,236,255",
      line: tr("Tu historial: resultado, rival y mapa."),
      dato: partidos ? tr("{n, plural, one {{n} jugado} other {{n} jugados}}", { n: partidos.total }) : null, cta: tr("Ver historial"),
    },
  ];

  return (
    <div className="space-y-6" data-testid="coach-hub">
      {/* ═══ 1 · HERO ═══ */}
      <section className="nx-coach-hero nx-coach-rise flex flex-col justify-between gap-6 px-6 py-7 sm:px-10 sm:py-9" aria-labelledby="coach-hero-title">
        <TacticalHeroArt className="nx-coach-hero-art h-full w-full" />
        <div className="max-w-[640px]">
          <p className="nx-coach-kicker">{tr("NEXUS · Centro táctico")}</p>
          <h1 id="coach-hero-title" className="nx-coach-hero-title mt-3">{tr("Tactical")} <em>{tr("Coach")}</em></h1>
          <p className="mt-3 font-display text-[clamp(14px,1.6vw,19px)] font-bold uppercase tracking-[0.34em] text-white/80">
            {tr("Prepara · Analiza · Domina")}
          </p>
          <p className="nx-coach-muted mt-3 max-w-[520px] text-[14.5px] leading-relaxed">
            {tr("Prepara estrategias, crea tu equipo y dirige partidas.")}
          </p>
          {/* LA acción de la sala. Todo lo demás es opcional para empezar. */}
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <Link href="/entrenador/jugar" className="nx-play-cta" data-testid="hub-play">
              <CoachIcon name="match" size={24} /> {tr("Jugar")}
            </Link>
            <span className="max-w-[260px] text-[13px] leading-snug text-white/65">
              {tr("Elige composición y juega. El mapa sale solo.")}
            </span>
          </div>
          {active && active.starters.length > 0 && (
            <div className="mt-4" aria-label={tr("Tu equipo activo")}><TeamCardStrip starters={active.starters} size={46} /></div>
          )}
          <div className="mt-5 flex flex-wrap gap-2.5">
            <Link href="/entrenador/strats" className="nx-coach-btn" data-variant="ghost" data-size="sm" data-testid="hub-open-board">
              <CoachIcon name="board" size={16} /> {tr("Abrir la pizarra")}
            </Link>
          </div>
        </div>

        {/* ═══ 2 · ACTIVIDAD: solo cifras reales ═══ */}
        <dl className="grid max-w-[760px] grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-5" data-testid="coach-activity">
          {jugadas && <Stat v={jugadas.n} l={tr("Jugadas")} />}
          {comps && <Stat v={comps.n} l={tr("Composiciones")} />}
          {partidos && <Stat v={partidos.total} l={tr("Partidos")} />}
          <Stat v={`${titulares}/5`} l={tr("Titulares")} />
          {ultima && <Stat v={fechaCorta(ultima)} l={tr("Última actividad")} />}
        </dl>
      </section>

      {/* ═══ 3 · PREPARACIÓN ═══ */}
      <Grupo titulo={tr("Preparación")} linea={tr("Opcional: para planificar antes de jugar.")}>
        <section aria-label={tr("Preparación")} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {preparacion.map((m, i) => <ModuleCard key={m.href} m={m} delay={80 + i * 50} />)}
        </section>
      </Grupo>

      {/* ═══ 4 · ANÁLISIS ═══ */}
      <Grupo titulo={tr("Análisis")} linea={tr("Estudia mapas y revisa tus partidas.")}>
        <section aria-label={tr("Análisis")} className="grid gap-3 sm:grid-cols-2">
          {analisis.map((m, i) => <ModuleCard key={m.href} m={m} delay={200 + i * 50} />)}
        </section>
      </Grupo>

      {/* ═══ 5 · EL PLAN CUELGA DE UN PARTIDO ═══ */}
      <section aria-labelledby="coach-plan-title" className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="nx-coach-panel px-5 py-5" data-tone="gold">
          <p className="nx-coach-kicker" style={{ color: "rgb(255,211,92)" }}>{tr("Plan de partido")}</p>
          <h2 id="coach-plan-title" className="mt-2 font-display text-[22px] font-extrabold uppercase leading-none text-white">{tr("Prepara cada partido")}</h2>
          <p className="nx-coach-muted mt-2 text-[13.5px] leading-relaxed">
            {tr("Cada partido dirigido tiene su plan: la composición que usarás y las jugadas de ese mapa, listas para presentarlas al equipo.")}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/entrenador/plan" className="nx-coach-btn" data-variant="gold" data-size="sm">{tr("Seleccionar partido")}</Link>
            <Link href="/entrenador/jugar" className="nx-coach-btn" data-variant="ghost" data-size="sm">{tr("Jugar uno nuevo")}</Link>
          </div>
        </div>
        <div className="nx-coach-panel-flat px-4 py-4" data-testid="coach-recent-matches">
          <p className="nx-coach-kicker mb-3">{tr("Partidos recientes")}</p>
          {partidos === undefined && <p className="nx-coach-muted text-[13px]">{tr("Leyendo tu expediente…")}</p>}
          {partidos === null && <p className="nx-coach-muted text-[13px]">{tr("Tu expediente se guarda en tu cuenta. Inicia sesión para verlo.")}</p>}
          {partidos && partidos.recent.length === 0 && (
            <p className="nx-coach-muted text-[13px]">{tr("Todavía no has jugado ninguna partida. Pulsa JUGAR y su plan aparecerá aquí.")}</p>
          )}
          {partidos && partidos.recent.length > 0 && (
            <ul className="grid gap-2">
              {partidos.recent.map((m) => {
                const mapa = getTacticalMap(m.mapId);
                return (
                  <li key={m.id} className="flex items-center gap-3 bg-white/[0.02] px-2.5 py-2 shadow-[inset_0_0_0_1px_rgba(47,224,255,0.1)]">
                    {mapa && <span aria-hidden className="h-11 w-11 shrink-0 overflow-hidden bg-[#050a14]"><MapThumb map={mapa} /></span>}
                    <span className="min-w-0 flex-1">
                      <b className="block truncate font-display text-[13px] font-bold uppercase tracking-[0.06em] text-white">
                        {mapa?.name ?? m.mapId} {tr("· vs")} {m.rivalName}
                      </b>
                      <span className="nx-coach-muted text-[12px]">
                        <span className={m.won ? "text-[rgb(63,214,150)]" : "text-[rgb(255,46,140)]"}>{m.won ? tr("Victoria") : tr("Derrota")}</span>{" "}
                        {m.scoreHome}–{m.scoreAway} · {fechaCorta(m.finishedAt)}
                      </span>
                    </span>
                    <Link href={`/entrenador/plan?match=${m.id}`} className="nx-coach-btn shrink-0" data-variant="ghost" data-size="sm">{tr("Plan")}</Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* ═══ 6 · EQUIPO ═══ */}
      <Grupo titulo={tr("Equipo")} linea={tr("Tus cinco jugadores, como sus cartas.")}>
        <Link href="/entrenador/equipos" className="nx-coach-module group flex flex-wrap items-center gap-4 p-4" data-testid="coach-module-team">
          <span className="nx-coach-module-icon"><CoachIcon name="team" size={20} /></span>
          <span className="min-w-0">
            <b className="block font-display text-[19px] font-extrabold uppercase leading-none text-white">{tr("Plantilla")}</b>
            <span className="nx-coach-muted mt-1 block text-[13px]">{tr("Gestiona tus cinco jugadores/cartas · Titulares")} {titulares}/5</span>
          </span>
          {active && active.starters.length > 0 && <TeamCardStrip starters={active.starters} size={40} className="ml-auto" />}
        </Link>
        <p className="mt-2"><Link href="/carrera" className="nx-action">{tr("Tu carrera de entrenador →")}</Link></p>
      </Grupo>
    </div>
  );
}

interface Modulo {
  href: string;
  icon: CoachIconName;
  title: string;
  line: string;
  tint: string;
  dato: string | null;
  cta: string;
  big?: boolean;
  art?: string;
  /** F59 · caras de agentes reales ligadas al dato del módulo (la última composición). */
  agents?: string[];
}

function ModuleCard({ m, delay }: { m: Modulo; delay: number }) {
  useLocale();
  const mapa = m.art ? getTacticalMap(m.art) : null;
  return (
    <Link
      href={m.href}
      className={cn("nx-coach-module nx-coach-rise group", m.big && "sm:col-span-2 xl:col-span-2 xl:row-span-1")}
      style={{ ["--mod" as string]: m.tint, ["--d" as string]: `${delay}ms` }}
      data-testid={`coach-module-${m.icon}`}
    >
      {mapa && (
        <span aria-hidden className="nx-coach-module-art"><MapThumb map={mapa} /></span>
      )}
      <span className="nx-coach-module-icon"><CoachIcon name={m.icon} size={20} /></span>
      <b className="mt-3 block font-display text-[19px] font-extrabold uppercase leading-none tracking-[0.03em] text-white">{td(m.title)}</b>
      <span className="nx-coach-muted mt-1.5 block max-w-[34ch] text-[13px] leading-snug">{td(m.line)}</span>
      {m.agents && m.agents.length > 0 && (
        <span className="mt-3 flex items-center gap-1" data-testid="coach-module-agents" aria-label={tr("Última composición")}>
          {m.agents.map((id) => <AgentPortrait key={id} agentId={id} size={30} title={agentById(id)?.name} />)}
        </span>
      )}
      <span className="mt-auto flex items-end justify-between gap-3 pt-4">
        {m.dato ? <span className="font-display text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: `rgb(${m.tint})` }}>{td(m.dato)}</span> : <span />}
        <span className="font-display text-[11px] font-bold uppercase tracking-[0.16em] text-white/70 transition group-hover:text-white">{td(m.cta)} →</span>
      </span>
    </Link>
  );
}

function Grupo({ titulo, linea, children }: { titulo: string; linea: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="nx-coach-kicker">{td(titulo)}</h2>
        <span className="nx-coach-muted text-[12.5px]">{td(linea)}</span>
      </div>
      {children}
    </div>
  );
}

function Stat({ v, l }: { v: number | string; l: string }) {
  return (
    <div className="nx-coach-stat">
      <dt className="sr-only">{td(l)}</dt>
      <dd><b>{v}</b><span aria-hidden>{td(l)}</span></dd>
    </div>
  );
}

function fechaCorta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(getIntlLocale(), { day: "numeric", month: "short" });
}
