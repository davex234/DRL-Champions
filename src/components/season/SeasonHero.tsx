"use client";

/**
 * HÉROE DE TEMPORADA (Fase 34) — «NEXUS — TEMPORADA 1», estado, cuenta atrás del servidor, tiempo
 * transcurrido, progreso del PASE (y, aparte, el nivel de CUENTA) y una llamada a la acción.
 *
 * Todo lo que dice llega en la foto del servidor. Decoración: CSS/SVG estático; lo único animado lleva
 * `motion-safe:` y se apaga con movimiento reducido.
 */
import { cn } from "@/lib/format";
import { NxButton } from "@/components/ui/NxButton";
import { PRESENTATION_LABEL, type SeasonPresentation } from "@/domain/season/calendar";
import { elapsedFraction, formatShortDate, type ServerClock } from "@/domain/season/time";
import type { SeasonHubSnapshot } from "@/server/services/season";
import type { TodayAction } from "@/domain/progression/meta";
import { SeasonCountdown } from "./SeasonCountdown";
import { RewardVisual, rewardLabel } from "./SeasonRewards";

const THEME: Record<SeasonPresentation, { rgb: string; accent: string; glyph: string }> = {
  UPCOMING: { rgb: "123,92,255", accent: "text-[#b7a4ff]", glyph: "◇" },
  ACTIVE: { rgb: "25,227,255", accent: "text-drl-cyan", glyph: "◆" },
  ENDING_SOON: { rgb: "255,211,92", accent: "text-drl-gold", glyph: "◆" },
  FINAL_DAY: { rgb: "255,160,70", accent: "text-drl-gold", glyph: "◆" },
  ENDED: { rgb: "180,170,150", accent: "text-white/70", glyph: "■" },
};

export function heroCta(snap: SeasonHubSnapshot): { label: string; href: string } {
  const s = snap.season;
  if (!snap.personal) return { label: "Entra para seguir tu temporada", href: "/cuenta" };
  if (s.status === "ENDED") return { label: "Ver tu resumen", href: "#resumen" };
  if (s.status === "UPCOMING") return { label: "Ver calendario", href: "#calendario" };
  const first: TodayAction | undefined = snap.personal.actions[0];
  if (first) return { label: first.label, href: first.href };
  return { label: "Juega ranked", href: "/duelos/pvp" };
}

export function SeasonHero({ snap, clock, onExpire, className }: { snap: SeasonHubSnapshot; clock: ServerClock | null; onExpire?: () => void; className?: string }) {
  const s = snap.season;
  const theme = THEME[s.presentation];
  const elapsed = elapsedFraction(s.startsAtMs, s.endsAtMs, snap.serverNow);
  const day = Math.min(Math.ceil(s.durationMs / 86_400_000), Math.max(0, Math.floor(s.elapsedMs / 86_400_000) + (s.status === "ACTIVE" ? 1 : 0)));
  const totalDays = Math.round(s.durationMs / 86_400_000);
  const pass = snap.personal?.pass ?? null;
  const cta = heroCta(snap);
  const [kicker, rest] = s.displayName.includes("·") ? s.displayName.split("·").map((x) => x.trim()) : [s.name, null];

  return (
    <section
      aria-labelledby="season-title"
      data-testid="season-hero"
      data-presentation={s.presentation}
      className={cn("nx-clip relative isolate overflow-hidden border px-5 py-6 sm:px-8 sm:py-9", className)}
      style={{
        borderColor: `rgba(${theme.rgb},0.35)`,
        background: `radial-gradient(90% 120% at 85% 20%, rgba(${theme.rgb},0.22), transparent 60%), radial-gradient(60% 80% at 0% 100%, rgba(255,46,99,0.10), transparent 70%), linear-gradient(180deg, #0b0f1a, #06070d)`,
      }}
    >
      {/* Geometría NEXUS: anillos y retícula, estáticos. */}
      <svg aria-hidden className="pointer-events-none absolute -right-24 -top-24 -z-10 h-[520px] w-[520px] opacity-40 sm:-right-10" viewBox="0 0 400 400">
        {[180, 140, 100, 60].map((r, i) => (
          <polygon key={r} fill="none" stroke={`rgba(${theme.rgb},${0.5 - i * 0.1})`} strokeWidth={i === 0 ? 1.5 : 1}
            points={Array.from({ length: 6 }, (_, k) => { const a = (Math.PI / 3) * k - Math.PI / 6; return `${200 + r * Math.cos(a)},${200 + r * Math.sin(a)}`; }).join(" ")} />
        ))}
      </svg>
      <span aria-hidden className="pointer-events-none absolute inset-0 -z-10 opacity-[0.07]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)", backgroundSize: "44px 44px" }} />
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px motion-safe:animate-pulse" style={{ background: `linear-gradient(90deg, transparent, rgba(${theme.rgb},0.9), transparent)` }} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-end">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className="nx-label">NEXUS · Campaña</span>
            <span data-testid="season-status" className={cn("inline-flex items-center gap-1.5 rounded-[3px] border px-2 py-0.5 font-display text-[11px] font-bold uppercase tracking-[0.16em]", theme.accent)} style={{ borderColor: `rgba(${theme.rgb},0.5)`, background: `rgba(${theme.rgb},0.08)` }}>
              <span aria-hidden>{theme.glyph}</span>{PRESENTATION_LABEL[s.presentation]}
            </span>
            {/* «Archivo» solo para una temporada TERMINADA que no es la actual (una próxima no es archivo). */}
            {!snap.isCurrent && s.status === "ENDED" && <span className="nx-label !text-white/50">Archivo</span>}
          </p>
          <h1 id="season-title" className="mt-3 font-display text-[clamp(34px,6.4vw,76px)] font-bold uppercase leading-[0.9] tracking-[0.01em] text-white">
            NEXUS <span className="text-white/30">—</span> <span className={theme.accent} style={{ textShadow: `0 0 40px rgba(${theme.rgb},0.45)` }}>{kicker}</span>
          </h1>
          {rest && <p className="mt-2 font-display text-[clamp(16px,2vw,22px)] font-bold uppercase tracking-[0.22em] text-white/60">{rest}</p>}

          {/* Tiempo transcurrido: solo tiempo. No es un «% de temporada completada». */}
          <div className="mt-6 max-w-xl">
            <div className="flex items-baseline justify-between gap-2 text-caption">
              <time dateTime={s.startsAt} className="text-ink-muted">{formatShortDate(s.startsAtMs)}</time>
              <span className="nx-label">{s.status === "UPCOMING" ? `${totalDays} días de temporada` : s.status === "ENDED" ? `${totalDays} días · finalizada` : `Día ${day} de ${totalDays}`}</span>
              <time dateTime={s.endsAt} className="text-ink-muted">{formatShortDate(s.endsAtMs)}</time>
            </div>
            <div className="relative mt-1.5 h-2 overflow-hidden rounded-full bg-black/60" role="progressbar" aria-label="Tiempo transcurrido de la temporada" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(elapsed * 100)} aria-valuetext={s.status === "UPCOMING" ? "Aún no ha empezado" : s.status === "ENDED" ? "Finalizada" : `Día ${day} de ${totalDays}`}>
              <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${elapsed * 100}%`, background: `linear-gradient(90deg, rgba(${theme.rgb},0.5), rgba(${theme.rgb},1))`, boxShadow: `0 0 12px rgba(${theme.rgb},0.8)` }} />
              {Array.from({ length: Math.max(0, Math.round(totalDays / 7) - 1) }, (_, i) => (
                <span key={i} aria-hidden className="absolute inset-y-0 w-px bg-white/15" style={{ left: `${((i + 1) * 7 * 86_400_000 / s.durationMs) * 100}%` }} />
              ))}
            </div>
          </div>
        </div>

        <div className="min-w-0 lg:justify-self-end">
          <SeasonCountdown season={s} clock={clock} onExpire={onExpire} />
        </div>
      </div>

      <div className="mt-7 flex flex-col gap-4 border-t border-white/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
        {pass ? (
          /*
           * FASE 52 · EL NIVEL DE TEMPORADA, protagonista y legible en 3 segundos: la medalla, la barra de XP
           * de PASE con sus cifras reales y lo que da el siguiente nivel. El nivel de CUENTA va aparte y
           * rotulado: son dos progresiones distintas.
           */
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-6 gap-y-4" data-testid="hero-pass">
            <div className="flex items-center gap-4" data-testid="hero-level">
              <span className="relative grid h-[84px] w-[84px] shrink-0 place-items-center" aria-hidden>
                <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
                  <polygon points="50,3 91,26 91,74 50,97 9,74 9,26" fill="rgba(6,10,20,0.9)" stroke={`rgba(${theme.rgb},0.95)`} strokeWidth="3" />
                  <polygon points="50,12 83,31 83,69 50,88 17,69 17,31" fill="none" stroke={`rgba(${theme.rgb},0.3)`} strokeWidth="1.5" />
                </svg>
                <b className="relative font-display text-[34px] font-extrabold leading-none text-white" style={{ textShadow: `0 0 18px rgba(${theme.rgb},0.8)` }}>{pass.level}</b>
              </span>
              <span>
                <span className="nx-label">Nivel de temporada</span>
                <p className="font-display text-[24px] font-extrabold uppercase leading-none text-white">Nivel {pass.level}<span className="text-[15px] text-white/40"> / {pass.maxLevel}</span></p>
              </span>
            </div>
            <div className="min-w-[200px] flex-1">
              <div className="h-3 overflow-hidden rounded-full bg-black/60 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" role="progressbar" aria-label={`XP de pase: ${pass.xpIntoLevel} de ${pass.xpForNext}`} aria-valuemin={0} aria-valuemax={pass.xpForNext} aria-valuenow={pass.xpIntoLevel}>
                <span className="block h-full rounded-full transition-[width] duration-700 motion-reduce:transition-none" style={{ width: `${pass.progress * 100}%`, background: `linear-gradient(90deg, rgba(${theme.rgb},0.6), rgba(${theme.rgb},1))`, boxShadow: `0 0 12px rgba(${theme.rgb},0.8)` }} />
              </div>
              <p className="mt-1.5 flex flex-wrap justify-between gap-2 font-display text-[12px] font-bold uppercase tracking-[0.12em] text-white/75">
                <span><b className="tabular-nums text-white">{new Intl.NumberFormat("es-ES", { useGrouping: "always" }).format(pass.xpIntoLevel)}</b> / {new Intl.NumberFormat("es-ES", { useGrouping: "always" }).format(pass.xpForNext)} XP de pase</span>
                {pass.level < pass.maxLevel && <span className="text-white/50">Faltan {new Intl.NumberFormat("es-ES", { useGrouping: "always" }).format(Math.max(0, pass.xpForNext - pass.xpIntoLevel))}</span>}
              </p>
            </div>
            {pass.nextReward && (
              <div className="flex items-center gap-3" data-testid="hero-next-reward">
                <RewardVisual reward={pass.nextReward.reward} size={56} />
                <span className="leading-tight">
                  <span className="nx-label !text-[#ffd35c]">Siguiente · nivel {pass.nextReward.level}</span>
                  <b className="block max-w-[180px] font-display text-[13px] uppercase text-white">{rewardLabel(pass.nextReward.reward)}</b>
                </span>
              </div>
            )}
            {snap.personal && (
              <div title="La XP de cuenta sube tu nivel de perfil; la XP de pase solo la dan las misiones." className="border-l border-white/10 pl-4">
                <span className="nx-label">Nivel de cuenta</span>
                <p className="nx-readout text-[20px] leading-none text-white/70">{snap.personal.account.level}</p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-caption text-ink-muted">{snap.personal ? (s.status === "UPCOMING" ? "El pase de esta temporada se abre cuando empiece." : "Tu recorrido de esta temporada está en el resumen.") : "Entra con tu cuenta para ver tu pase, tus objetivos y tu ranked de esta temporada."}</p>
        )}
        <NxButton variant="primary" size="lg" href={cta.href} className="shrink-0" data-testid="hero-cta">{cta.label}</NxButton>
      </div>
    </section>
  );
}
