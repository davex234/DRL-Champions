"use client";

/**
 * VESTÍBULO · HÉROE DE LA ACCIÓN PRINCIPAL (Fase 36).
 *
 * UNA decisión en pantalla: la que el servidor ha elegido con la prioridad única (`orderToday`). Contexto
 * (eyebrow), qué es (título), por qué (detalle), cuánto falta (progreso con denominador real), y el verbo.
 * La visual acompaña al tipo de acción; no inventa estado. Solo se mueve una línea de energía (y nada con
 * reduced motion). En partida a medias no se enseña nada de la partida más allá del modo y el rival público.
 */
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { NxButton } from "@/components/ui/NxButton";
import { Meter } from "@/components/ui/Meter";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/format";
import { TONE_RGB, type HeroModel, type HeroVisual } from "@/lib/dailyLoop/presentation";

const ACCENT: Record<HeroModel["tone"], "primary" | "gold" | "cyan"> = { key: "primary", gold: "gold", cyan: "cyan", violet: "primary", green: "cyan" };
const METER_TONE: Record<HeroModel["tone"], "key" | "gold" | "info" | "ok"> = { key: "key", gold: "gold", cyan: "info", violet: "info", green: "ok" };

const GLYPH: Record<HeroVisual, string> = {
  match: "▸", challenge: "⬡", claim: "✦", pickem: "◈", objective: "◐", packs: "▣", team: "⬢", campaign: "⟁", ranked: "◆", quick: "◆", live: "◉", account: "⬢",
};

const VISUAL_LABEL: Record<HeroVisual, string> = {
  match: "Partida en curso", challenge: "Reto", claim: "Recompensa", pickem: "Predicción", objective: "Objetivo", packs: "Sobres",
  team: "Equipo", campaign: "Campaña", ranked: "Competitivo", quick: "Partida rápida", live: "Directo", account: "Cuenta",
};

/**
 * Fase 44 · `tier`: «stage» = el héroe ES el escenario del lobby (la acción del día es jugar o continuar, y su botón es
 * el de JUGAR); «context» = debajo del escenario JUGAR, la acción del día con el mismo contenido y menos altura. El
 * contenido no cambia nunca: lo decide el Live Service.
 */
export function DailyHero({ hero, actionId, offline = false, tier = "stage", play = false }: { hero: HeroModel; actionId: string; offline?: boolean; tier?: "stage" | "context"; play?: boolean }) {
  const reduce = useReducedMotion();
  const rgb = TONE_RGB[hero.tone];
  const context = tier === "context";
  return (
    <section
      aria-labelledby="daily-hero-title"
      data-testid="daily-hero"
      data-action={actionId}
      data-visual={hero.visual}
      data-tier={tier}
      className="nx-clip relative isolate overflow-hidden border"
      style={{
        borderColor: `rgba(${rgb}, 0.38)`,
        background:
          `radial-gradient(820px 420px at 6% 112%, rgba(${rgb}, 0.30), transparent 64%),` +
          "radial-gradient(640px 420px at 92% -18%, rgba(25,227,255,0.12), transparent 60%)," +
          "linear-gradient(160deg, rgba(12,15,26,0.72), rgba(6,8,14,0.86))",
      }}
    >
      <span aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-grid opacity-30" />
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-px overflow-hidden">
        <span className="nx-lobby-sweep block h-px w-1/2" style={{ background: `linear-gradient(90deg, transparent, rgb(${rgb}), transparent)` }} />
      </span>
      <HeroGeometry rgb={rgb} glyph={GLYPH[hero.visual]} />

      <div className={cn("relative grid gap-6 px-5 sm:px-9 lg:items-center", context ? "py-5 sm:py-6 lg:grid-cols-[minmax(0,1fr)_auto]" : "py-7 sm:py-10 lg:grid-cols-[minmax(0,1fr)_minmax(240px,300px)]")}>
        <motion.div
          key={actionId}
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: "easeOut" }}
          className="min-w-0"
        >
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-display text-[12px] font-bold uppercase tracking-[0.18em]" style={{ color: `rgb(${rgb})` }}>
              {hero.eyebrow}
            </span>
            {hero.urgent && !hero.deadline && <Badge tone="warn">Ahora</Badge>}
            {hero.deadline && <Badge tone={hero.deadline.urgency === "VERY_SOON" ? "warn" : "info"} dot><span data-testid="daily-hero-deadline" data-urgency={hero.deadline.urgency}>{hero.deadline.label}</span></Badge>}
          </p>
          <h1 id="daily-hero-title" className={cn("mt-2 break-words font-display font-bold uppercase leading-[0.94] tracking-[-0.005em] text-white", context ? "text-[clamp(24px,3.4vw,38px)]" : "text-[clamp(30px,5.6vw,62px)]")}>
            {hero.title}
          </h1>
          <p className="mt-3 max-w-xl text-body leading-relaxed text-ink-muted">{hero.detail}</p>
          {hero.reason && (
            <p className="mt-2 max-w-xl text-[14px] font-semibold text-white/85" data-testid="daily-hero-reason">
              <span className="sr-only">Por qué: </span><span aria-hidden className="mr-1.5" style={{ color: `rgb(${rgb})` }}>›</span>{hero.reason}
            </p>
          )}

          {hero.progress && (
            <div className="mt-5 max-w-md">
              <div className="mb-1.5 flex items-baseline justify-between gap-3 font-display text-[12px] font-bold uppercase tracking-[0.12em] text-white/70">
                <span>Progreso</span>
                <span className="nx-readout text-[15px] text-white">{hero.progress.label}</span>
              </div>
              <Meter value={hero.progress.pct} tone={METER_TONE[hero.tone]} height={10} label={`Progreso ${hero.progress.label}`} />
            </div>
          )}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            {hero.cta.disabled ? (
              // Sin acento: el relleno del acento va por `style` y taparía el aspecto desactivado del sistema.
              <NxButton variant="primary" size="lg" disabled className="w-full sm:w-auto" data-testid="daily-primary-cta">
                {hero.cta.label}
              </NxButton>
            ) : play && !context ? (
              // Fase 44 · jugar/continuar: el botón del héroe es el botón JUGAR del juego (misma pieza visual que el armazón).
              <span className="nx-play-wrap w-full sm:w-auto">
                <span aria-hidden className="nx-play-halo" />
                <Link href={hero.cta.href} className="nx-play w-full sm:w-auto" data-size="hero" data-kind={hero.visual === "match" ? "resume" : "play"} data-game-cta="play" data-cta="primary" data-testid="daily-primary-cta">
                  {hero.cta.label}
                </Link>
              </span>
            ) : (
              <NxButton variant="primary" accent={ACCENT[hero.tone]} size={context ? "md" : "lg"} href={hero.cta.href} className="w-full sm:w-auto" data-testid="daily-primary-cta" data-cta={context ? "context" : "primary"}>
                {hero.cta.label}
              </NxButton>
            )}
            {hero.secondary && (hero.secondary.disabled ? (
              <NxButton variant="secondary" size="lg" disabled className="w-full sm:w-auto">{hero.secondary.label}</NxButton>
            ) : (
              <NxButton variant="secondary" size="lg" href={hero.secondary.href} className="w-full sm:w-auto" data-testid="daily-secondary-cta">{hero.secondary.label}</NxButton>
            ))}
          </div>
          {offline && (
            <p role="status" className="mt-3 font-display text-[12px] font-bold uppercase tracking-[0.12em] text-warn">
              Sin conexión · las acciones vuelven cuando recuperes la red
            </p>
          )}
        </motion.div>

        {!context && (
          <aside aria-label={VISUAL_LABEL[hero.visual]} className="min-w-0">
            <HeroEmblem hero={hero} rgb={rgb} />
          </aside>
        )}
      </div>
    </section>
  );
}

function HeroEmblem({ hero, rgb }: { hero: HeroModel; rgb: string }) {
  return (
    <div className="relative hidden aspect-square w-full max-w-[280px] place-items-center justify-self-end lg:grid" aria-hidden>
      <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full">
        <polygon points="100,8 180,54 180,146 100,192 20,146 20,54" fill="none" stroke={`rgba(${rgb}, 0.45)`} strokeWidth="1.5" />
        <polygon points="100,34 158,67 158,133 100,166 42,133 42,67" fill={`rgba(${rgb}, 0.07)`} stroke={`rgba(${rgb}, 0.25)`} strokeWidth="1" />
        <path d="M20 54 L100 100 L180 54 M100 100 L100 192" fill="none" stroke={`rgba(${rgb}, 0.35)`} strokeWidth="1" className="nx-energy" />
      </svg>
      <span className="relative text-center">
        <span className="block font-display text-[64px] leading-none" style={{ color: `rgb(${rgb})`, textShadow: `0 0 36px rgba(${rgb}, 0.6)` }}>
          {hero.count !== null ? hero.count : GLYPH[hero.visual]}
        </span>
        <span className="mt-2 block font-display text-[12px] font-bold uppercase tracking-[0.16em] text-white/70">{VISUAL_LABEL[hero.visual]}</span>
      </span>
    </div>
  );
}

function HeroGeometry({ rgb, glyph }: { rgb: string; glyph: string }) {
  return (
    <span aria-hidden className="pointer-events-none absolute -right-10 -top-10 -z-10 select-none font-display text-[220px] leading-none opacity-[0.06] lg:hidden" style={{ color: `rgb(${rgb})` }}>
      {glyph}
    </span>
  );
}
