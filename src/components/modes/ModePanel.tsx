"use client";

/**
 * F71 · PLAY EXPERIENCE 2.0 — EL PANEL DE MODO.
 *
 * VER → ELEGIR → JUGAR. Un panel es una imagen, un título enorme, como mucho una micro-línea y UN botón. Sin
 * párrafos ni listas de funciones: el arte y el color dicen qué es; el botón, qué hacer. Presentación pura: el
 * destino, la etiqueta y el estado llegan hechos (de `gameModes()` y sus ayudantes).
 */
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/format";
import { focusEnvironment } from "@/components/dailyLoop/LobbyPlayStage";
import type { EnvironmentFocus } from "@/design/environment";
import { playSound } from "@/lib/sound";
import { getAgentArtwork } from "@/domain/tactics/agentArt";

export interface ModePanelProps {
  /** `data-testid` del panel (el `<article>`). El del CTA es `ctaTestId`. */
  testId: string;
  ctaTestId: string;
  /** Tinte del modo, «r,g,b». */
  rgb: string;
  focus: Exclude<EnvironmentFocus, null>;
  title: ReactNode;
  /** Una sola línea corta (p. ej. «7/15», «Combate 2/5», «#12 · 1184») o nada. */
  note?: string | null;
  cta: { label: string; href: string };
  /** La acción dominante de la pantalla (una por pantalla). */
  primary?: boolean;
  /** `data-cta` explícito (p. ej. «coach»); si `primary`, gana «primary». */
  ctaKind?: string;
  /** Arte decorativo, ya posicionado (absoluto) dentro del panel. */
  art: ReactNode;
  className?: string;
  titleClassName?: string;
  dataMode?: string;
}

export function ModePanel({ testId, ctaTestId, rgb, focus, title, note, cta, primary, ctaKind, art, className, titleClassName, dataMode }: ModePanelProps) {
  return (
    <article
      data-testid={testId}
      data-mode={dataMode}
      data-motion-level="1"
      onMouseEnter={() => { focusEnvironment(focus); playSound("ui.hover"); }}
      onMouseLeave={() => focusEnvironment(null)}
      onFocus={() => focusEnvironment(focus)}
      onBlur={() => focusEnvironment(null)}
      className={cn("nx-mode nx-clip relative isolate flex flex-col justify-end overflow-hidden", className)}
      style={{
        background: `linear-gradient(180deg, rgba(8,10,18,0.2), rgba(6,7,13,0.98)), radial-gradient(90% 70% at 50% 0%, rgba(${rgb},0.28), transparent 70%), #06070d`,
        boxShadow: `inset 0 0 0 1px rgba(${rgb},0.38), inset 0 1px 0 rgba(${rgb},0.85)`,
      }}
    >
      <div aria-hidden className="nx-mode-art pointer-events-none absolute inset-0 -z-10">{art}</div>
      {/* Legibilidad: el texto vive siempre sobre la parte baja, oscurecida. */}
      <span aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{ background: "linear-gradient(0deg, rgba(5,6,12,0.96) 0%, rgba(5,6,12,0.72) 34%, rgba(5,6,12,0) 70%)" }} />
      <span aria-hidden className="nx-mode-glow pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-1/2" style={{ background: `linear-gradient(0deg, rgba(${rgb},0.22), transparent)` }} />
      <div className="relative px-5 pb-5 pt-16 sm:px-6 sm:pb-6">
        <h2
          className={cn("font-display font-bold uppercase leading-[0.88] text-white", titleClassName ?? "text-[clamp(34px,4.2vw,56px)]")}
          style={{ textShadow: `0 0 34px rgba(${rgb},0.45), 0 2px 12px rgba(0,0,0,0.8)` }}
        >
          {title}
        </h2>
        {note && (
          <p data-testid="mode-note" className="nx-readout mt-2 font-display text-[15px] font-bold uppercase tracking-[0.14em]" style={{ color: `rgb(${rgb})` }}>
            {note}
          </p>
        )}
        <ModeCta rgb={rgb} href={cta.href} label={cta.label} testId={ctaTestId} dataCta={primary ? "primary" : ctaKind} />
      </div>
    </article>
  );
}

/**
 * F72.5 · EL CTA DEL PANEL: la acción final de la tarjeta, la MISMA pieza para los tres modos con el color de cada uno
 * (oro de campaña, magenta de duelos, cian de coach). Botón grande, sólido, a todo el ancho útil, con el chaflán de la
 * casa (`nx-clip-sm`), la pulsación (`nx-press`), un filete técnico y una flecha que avanza al apuntar
 * (`game-experience.css`, `.nx-mode-cta`). La flecha es SVG: el texto del enlace sigue siendo solo la etiqueta.
 *
 * Tinta: oscura sobre fondos claros (oro, cian); blanca sobre el magenta, que con 19 px en negrita es texto GRANDE
 * (WCAG AA 3:1; el magenta da 3,6:1). El foco se pinta HACIA DENTRO: el chaflán es un `clip-path` y recortaría un anillo
 * exterior. `data-cta` no cambia su significado: sigue marcando la única acción dominante de la pantalla.
 */
export function ModeCta({ rgb, href, label, testId, dataCta }: { rgb: string; href: string; label: string; testId: string; dataCta?: string }) {
  const [r, g, b] = rgb.split(",").map((v) => Number(v) / 255);
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const light = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) > 0.4;
  return (
    <Link
      href={href}
      data-cta={dataCta}
      data-testid={testId}
      onClick={() => playSound("play.confirm")}
      className="nx-mode-cta nx-clip-sm nx-press relative mt-5 flex min-h-[64px] w-full items-center justify-between gap-4 px-5 font-display text-[19px] font-bold uppercase leading-tight tracking-[0.12em] sm:min-h-[68px] sm:px-6"
      style={{ ["--cta-rgb" as string]: rgb, ["--cta-ink" as string]: light ? "#07080e" : "#ffffff" } as CSSProperties}
    >
      <span data-cta-label className="min-w-0">{label}</span>
      <span aria-hidden className="flex shrink-0 items-center gap-2.5">
        <span className="nx-mode-cta-ticks"><i /><i /><i /></span>
        <svg data-cta-arrow className="nx-mode-cta-arrow" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="square">
          <path d="M3 12h16M13 6l6 6-6 6" />
        </svg>
      </span>
    </Link>
  );
}

const AGENT_MASK = {
  maskImage: "radial-gradient(70% 75% at 50% 38%, #000 50%, transparent 100%)",
  WebkitMaskImage: "radial-gradient(70% 75% at 50% 38%, #000 50%, transparent 100%)",
} as const;

/**
 * Cuerpo entero de un agente como arte de panel. La ruta sale de la PUERTA ÚNICA del arte (`getAgentArtwork`, F59/F60:
 * manifiesto + arte vivo del CMS), nunca compuesta a mano. Sin arte → nada (el tinte del panel basta).
 * El fondo de estudio del retrato opaco se funde con una máscara radial.
 */
export function AgentPanelArt({ agentId, side, width = "78%", opacity = 0.9 }: { agentId: string; side: "left" | "right" | "center"; width?: string; opacity?: number }) {
  const art = getAgentArtwork(agentId, "full");
  if (!art) return null;
  const pos = side === "left" ? { left: "-8%", right: "auto" } : side === "right" ? { left: "auto", right: "-8%" } : { left: "50%", right: "auto", transform: "translateX(-50%)" };
  return <PanelImage src={art.src} position="center top" style={{ ...pos, width, opacity, ...AGENT_MASK }} />;
}

/** Arte de imagen a sangre: `object-cover`, carga diferida salvo el primero, sin tamaños desmedidos. */
export function PanelImage({ src, srcSet, sizes, position = "center", eager, className, style }: {
  src: string; srcSet?: string; sizes?: string; position?: string; eager?: boolean; className?: string; style?: React.CSSProperties;
}) {
  return (
    <img
      src={src}
      srcSet={srcSet}
      sizes={sizes}
      alt=""
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      className={cn("absolute inset-0 h-full w-full object-cover", className)}
      style={{ objectPosition: position, ...style }}
    />
  );
}
