"use client";

/**
 * CEREMONIA FINAL — no una tabla, un cierre de FINAL. Reúne lo que los motores ya
 * produjeron (Match, Narrative, Economy, Reward) en una pantalla espectacular:
 * ganador, marcador, MVP, revelación, momento del partido, punto de inflexión,
 * gráfico de momentum, nota del entrenador, resumen IA y la hoja del partido. Solo MUESTRA.
 *
 * F69 · F68-010: aquí se pintaba «+N créditos / +N XP» que solo existían en el store local y
 * el servidor nunca abonó. El Coach es entrenamiento: la hoja enseña cifras REALES del partido
 * (rondas, bajas) y dice claramente que no suma créditos ni XP.
 */
import { useEffect } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import type { MatchState } from "@/match";
import type { CoachMatchSummary } from "@/lib/match/rewards";
import { coachRating, utilityStory } from "@/lib/match/moments";
import { matchCompositions } from "@/lib/match/lineups";
import { playCue } from "@/lib/sound";
import { cn } from "@/lib/format";
import type { EstadoRegistro } from "@/lib/match/history";
import { NxButton } from "@/components/ui/NxButton";
import { ns as i18nNs, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = i18nNs("coach");

const GRADE_HEX: Record<string, string> = { S: "#ffce4f", A: "#37e6a0", B: "#19e3ff", C: "#ffd35c", D: "#ff6b6b" };

export function MatchCeremony({ match, summary }: {
  match: MatchState;
  summary: CoachMatchSummary | null;
}) {
  useLocale();
  const won = match.winner === "home";
  const names = match.config.teamNames ?? { home: t("Local"), away: t("Rival") };
  const ns = match.narrative;
  const rating = coachRating(match);
  const comp = matchCompositions(match.config.rosters.home, match.config.rosters.away);
  const utilBeat = utilityStory(match);

  useEffect(() => { playCue(won ? "victory" : "defeat"); }, [won]);

  // foto del MVP por nombre (de cualquiera de los dos rosters)
  const imgByName = new Map<string, string | undefined>();
  for (const r of [...match.config.rosters.home, ...match.config.rosters.away]) imgByName.set(r.name, r.meta?.image);
  const mvpName = match.mvp?.name ?? ns?.summary.mvp ?? null;

  // revelación = héroe que no es el MVP, si lo hay
  const breakout = ns?.heroes.find((h) => h.name !== mvpName) ?? ns?.heroes[0] ?? null;
  const villain = ns?.villains?.[0] ?? null;
  const keyMoment = ns?.keyMoments[0] ?? null;
  const accent = won ? "#37e6a0" : "#ff4d6a";

  return (
    <div className="animate-rise space-y-4">
      {/* HERO */}
      <div className="relative overflow-hidden rounded-3xl border border-white/10 p-8 text-center"
        style={{ background: `radial-gradient(120% 120% at 50% -10%, ${accent}22, #0a0e14 70%)` }}>
        <ShineSweep />
        <motion.p initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          className="font-display text-sm uppercase tracking-[0.5em]" style={{ color: accent }}>
          {won ? t("Victoria") : t("Derrota")}
        </motion.p>
        <motion.h1 initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 160, damping: 16 }}
          className="mt-1 font-display text-3xl font-black uppercase tracking-wide text-white md:text-4xl">
          {won ? td(names.home) : td(names.away)}
        </motion.h1>
        <motion.div initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.15, type: "spring", stiffness: 140, damping: 14 }}
          className="mt-2 font-display text-6xl font-black tabular-nums text-white md:text-7xl">
          {match.score.home}<span className="px-2 text-white/25">–</span>{match.score.away}
        </motion.div>
        <p className="mt-2 text-sm text-white/50">{td(names.home)} {t("vs")} {td(names.away)} · {match.history.length} {t("rondas")}</p>
        {ns?.summary.headline && <p className="mx-auto mt-2 max-w-lg text-sm text-white/75">{td(ns.summary.headline)}</p>}
      </div>

      {/* DESTACADOS */}
      <div className="grid gap-3 sm:grid-cols-3">
        <HeroCard title={t("MVP del partido")} accent="#ffce4f" image={mvpName ? imgByName.get(mvpName) : undefined}
          name={mvpName ?? "—"} sub={t("{v} bajas", { v: match.mvp?.kills ?? 0 })} />
        <HeroCard title={t("Revelación")} accent="#19e3ff" image={breakout ? imgByName.get(breakout.name) : undefined}
          name={breakout?.name ?? "—"} sub={td(breakout?.reason) ?? "—"} />
        <div className="rounded-2xl border border-white/10 bg-base-800/60 p-4">
          <p className="text-[10px] uppercase tracking-widest text-white/40">{t("Nota del entrenador")}</p>
          <div className="mt-1 flex items-center gap-3">
            <span className="font-display text-5xl font-black leading-none" style={{ color: GRADE_HEX[rating.grade] }}>{td(rating.grade)}</span>
            <div>
              <p className="font-display text-sm font-bold text-white">{td(rating.label)}</p>
              <p className="text-[11px] text-white/45">{t("Táctica")} {td(rating.tactical)} · {Math.round(rating.roundWinRate * 100)}{t("% rondas ·")} {rating.variety} {t("estrategias")}</p>
            </div>
          </div>
        </div>
      </div>

      {/* MOMENTUM + MOMENTO CLAVE */}
      <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr]">
        <div className="rounded-2xl border border-white/10 bg-base-800/60 p-4">
          <p className="mb-2 text-[10px] uppercase tracking-widest text-white/40">{t("Momentum del partido")}</p>
          {ns && ns.momentum.series.length > 1
            ? <MomentumGraph series={ns.momentum.series} homeIsA={homeIsA(match)} />
            : <p className="text-sm text-white/40">{t("Sin datos de momentum.")}</p>}
          <div className="mt-1 flex justify-between text-[9px] uppercase tracking-widest text-white/30">
            <span>R1</span><span>{ns?.summary.turningPoint != null ? t("Inflexión: R{turningPoint}", { turningPoint: ns.summary.turningPoint }) : ""}</span><span>R{match.history.length}</span>
          </div>
        </div>
        <div className="space-y-3">
          <InfoCard title={t("Momento del partido")}>
            {keyMoment ? <p className="text-sm text-white/80">R{keyMoment.event.round} · {td(keyMoment.why)}</p> : <p className="text-white/40">—</p>}
          </InfoCard>
          <InfoCard title={t("Estilo y forma")}>
            <p className="text-sm font-bold text-white">{td(comp.ours.archetypeLabel)}</p>
            <p className="mt-0.5 text-[12px] text-white/60">{comp.ours.playstyle.slice(0, 2).join(" · ")}</p>
            <p className="mt-1 border-t border-white/10 pt-1 text-[12px] text-white/50">{ns?.match.shape.descriptors.join(" · ") || ns?.match.shape.id || "—"}</p>
            {utilBeat && <p className="mt-1 text-[12px] text-amber-200/80">⚙ {td(utilBeat)}</p>}
          </InfoCard>
          <InfoCard title={t("Resumen IA")}>
            <p className="text-[13px] leading-snug text-white/70">{td(ns?.summary.beats[0]?.text) ?? td(ns?.summary.headline) ?? "—"}</p>
            {villain && <p className="mt-1 border-t border-white/10 pt-1 text-[12px] text-rose-300/80">{t("Villano:")} <b className="text-white/80">{villain.name}</b> · {td(villain.reason)}</p>}
          </InfoCard>
        </div>
      </div>

      {/* HOJA DEL PARTIDO — cifras reales del simulador; el Coach no reparte créditos ni XP (F68-010). */}
      {summary && (
        <div className="flex flex-wrap items-center justify-center gap-6 rounded-2xl border border-white/10 bg-base-800/60 p-4" data-testid="coach-match-sheet">
          <Stat label={t("Rondas ganadas")} value={String(match.score.home)} />
          <Stat label={t("Rondas jugadas")} value={String(match.history.length)} />
          <Stat label={t("Bajas del equipo")} value={String(summary.teamKills)} />
          <p className="basis-full text-center text-[12px] text-white/45" data-testid="coach-training-note">
            {t("Partido de entrenamiento: no suma créditos ni XP.")}
          </p>
          {/*
            Aquí iban «Récord» y «Racha», leídos de `useGameStore.record`: un contador LOCAL,
            por navegador, que no sabe nada de `coach_matches`. En la misma sesión el final
            decía 7-2 y el expediente 3-1. El balance tiene ahora un único dueño —el historial
            del servidor— y se lee en «Partidos jugados» y en la Carrera, no aquí.
          */}
        </div>
      )}
    </div>
  );
}

/** Lo que el pie dice del registro. `enviando` es el instante entre el final y la respuesta. */
export type RegistroFinal = EstadoRegistro | "enviando";

const REGISTRO: Record<RegistroFinal, { texto: string; tono: string }> = {
  enviando: { texto: "Registrando el partido en tu expediente…", tono: "text-ink-muted" },
  guardado: { texto: "Partido registrado en tu expediente.", tono: "text-ok" },
  "ya-estaba": { texto: "Este partido ya constaba en tu expediente.", tono: "text-ok" },
  "sin-sesion": { texto: "Sin sesión: este partido no queda en ningún historial.", tono: "text-ink-muted" },
  error: { texto: "No se pudo registrar el partido.", tono: "text-drl-glow" },
};

/**
 * LAS ACCIONES DEL FINAL — ancladas al pie del viewport, no al final de la ceremonia.
 *
 * Antes eran una fila de botones debajo de la ceremonia entera: héroe, destacados, momentum,
 * tres tarjetas y recompensas. A 1440×900 había que desplazarse para encontrar la revancha, y
 * al lado había un «Guardar replay» deshabilitado que no hacía nada —un botón muerto, que es
 * exactamente lo que el encargo prohíbe—. Se quita: no existe el replay guardado y no se finge.
 *
 * Tres salidas, en el orden del recorrido que pide el encargo:
 *
 *   REVANCHA           — el camino principal: vuelve a jugar. Sortea el lado otra vez.
 *   PARTIDOS JUGADOS   — el siguiente paso del circuito: ver este partido en el expediente.
 *   CENTRO TÁCTICO     — salir del partido.
 *
 * Y el ESTADO DEL REGISTRO, dicho en una línea, porque es lo que hace que «Partidos jugados»
 * sea una promesa y no un enlace a ciegas: si falla, se dice y se ofrece reintentar (la ruta es
 * idempotente); sin sesión, se dice que no se guarda en vez de dejar creer que sí.
 *
 * En móvil se apoya ENCIMA de la barra de navegación inferior (`--nx-mobilebar`), no debajo.
 */
export function CeremonyActions({ registro, onRetry, onAgain }: {
  registro: RegistroFinal;
  onRetry: () => void;
  onAgain: () => void;
}) {
  useLocale();
  const estado = REGISTRO[registro];
  return (
    <>
      {/*
        `fixed`, no `sticky`. `globals.css` pone `overflow-x: hidden` en `html` y `body`, y eso
        convierte a `body` en un contenedor de desplazamiento que nunca se desplaza: un `sticky`
        dentro de él no se pega a nada. El QA en Chrome lo midió —la revancha acababa a 1.818 px en
        un viewport de 900—. Cambiar esa regla global para arreglar una pantalla movería todas.

        Un `fixed` no ocupa sitio, así que este hueco reserva el suyo: sin él, el pie taparía el
        final de la retransmisión de cierre al llegar abajo.
      */}
      <div aria-hidden className="h-44 sm:h-28 lg:h-24" />
      <div
        data-ceremony-actions
        className="fixed inset-x-0 bottom-[var(--nx-mobilebar)] z-40 lg:bottom-0 lg:pb-[env(safe-area-inset-bottom)]"
      >
        <div className="mx-auto w-full max-w-[1480px] px-4 pb-2 md:px-8 lg:pb-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border border-white/10 bg-[rgba(6,7,13,0.94)] px-3 py-2.5 shadow-[0_-12px_32px_rgba(0,0,0,0.55)] backdrop-blur sm:px-4">
            <p role="status" aria-live="polite" className={cn("min-w-0 basis-full text-caption sm:flex-1 sm:basis-auto", estado.tono)}>
              {td(estado.texto)}
              {registro === "error" && (
                <button type="button" onClick={onRetry} className="nx-action ml-2 min-h-[32px]">{t("Reintentar")}</button>
              )}
              {registro === "sin-sesion" && (
                <Link href="/cuenta" className="nx-action ml-2">{t("Entrar")}</Link>
              )}
            </p>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
              {registro !== "sin-sesion" && (
                <NxButton variant="secondary" size="md" href="/entrenador/partidos" className="flex-1 sm:flex-none">
                  {t("Partidos jugados")}
                </NxButton>
              )}
              <NxButton variant="ghost" size="md" href="/entrenador" className="flex-1 sm:flex-none">
                {t("Centro táctico")}
              </NxButton>
              <NxButton
                variant="primary"
                size="lg"
                className="w-full sm:w-auto sm:min-w-[220px]"
                onClick={() => { playCue("ui"); onAgain(); }}
              >
                {t("Revancha")}
              </NxButton>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/** ¿El equipo home corresponde al equipo "A" de la narrativa? (para orientar el momentum). */
function homeIsA(match: MatchState): boolean {
  const ns = match.narrative;
  if (!ns) return true;
  const homeNames = new Set(match.config.rosters.home.map((r) => r.name));
  return ns.match.teams.A.players.some((n) => homeNames.has(n));
}

function MomentumGraph({ series, homeIsA }: { series: { round: number; value: number }[]; homeIsA: boolean }) {
  const W = 600, H = 90, mid = H / 2;
  const n = series.length;
  // valor +100 = control de A; lo orientamos para que ARRIBA/verde sea el equipo home
  const val = (v: number) => (homeIsA ? v : -v);
  const pts = series.map((p, i) => {
    const x = (i / (n - 1)) * W;
    const y = mid - (val(p.value) / 100) * (mid - 6);
    return [x, y] as const;
  });
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `0,${mid} ${line} ${W},${mid}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-24 w-full">
      <defs>
        <linearGradient id="mom" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#37e6a0" stopOpacity="0.35" />
          <stop offset="50%" stopColor="#37e6a0" stopOpacity="0.02" />
          <stop offset="50%" stopColor="#ff4d6a" stopOpacity="0.02" />
          <stop offset="100%" stopColor="#ff4d6a" stopOpacity="0.35" />
        </linearGradient>
      </defs>
      <line x1="0" y1={mid} x2={W} y2={mid} stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="4 4" />
      <motion.polygon points={area} fill="url(#mom)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }} />
      <motion.polyline points={line} fill="none" stroke="#e8eef5" strokeWidth="2" strokeLinejoin="round"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1, ease: "easeOut" }} />
    </svg>
  );
}

function ShineSweep() {
  return (
    <motion.div initial={{ x: "-120%" }} animate={{ x: "220%" }} transition={{ duration: 1.4, ease: "easeOut" }}
      className="pointer-events-none absolute inset-y-0 w-1/3 -skew-x-12 bg-white/5" />
  );
}

function HeroCard({ title, accent, image, name, sub }: { title: string; accent: string; image?: string; name: string; sub: string }) {
  useLocale();
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-base-800/60 p-4">
      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-white/5" style={{ boxShadow: `0 0 18px ${accent}44` }}>
        {image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt={name} className="h-full w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        )}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-widest" style={{ color: accent }}>{td(title)}</p>
        <p className="truncate font-display text-lg font-bold uppercase text-white">{name}</p>
        <p className="truncate text-[11px] text-white/45">{td(sub)}</p>
      </div>
    </div>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  useLocale();
  return (
    <div className="rounded-2xl border border-white/10 bg-base-800/60 p-4">
      <p className="mb-1 text-[10px] uppercase tracking-widest text-white/40">{td(title)}</p>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  useLocale();
  return (
    <div className="text-center">
      <p className="font-display text-2xl font-black text-white">{td(value)}</p>
      <p className="text-[10px] uppercase tracking-widest text-white/40">{td(label)}</p>
    </div>
  );
}
