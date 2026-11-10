"use client";

/**
 * LAUNCHER — ARTWORK PROCEDURAL.
 *
 * ────────────────────────── POR QUÉ NO HAY JPG ──────────────────────────
 *
 * Un launcher premium se sostiene sobre arte grande. Este cliente no trae un solo binario de
 * arte (`public/players` y `public/teams` están vacíos), así que meter cuatro `<img>` a
 * ficheros inexistentes habría dado exactamente lo que el encargo prohíbe: un maquetado.
 *
 * En su lugar, el escenario se DIBUJA: capas de gradiente, siluetas angulares generadas con
 * un generador determinista sembrado por juego, un haz de luz y una retícula. Misma semilla,
 * mismo escenario en cada arranque; juegos distintos, escenarios reconociblemente distintos.
 *
 * Cuesta cero bytes de red, escala a cualquier resolución sin pixelarse y se compone solo con
 * `transform` y `opacity`, que es lo que permite el parallax a 60 fps de la capa superior.
 */
import { useMemo } from "react";
import { noise } from "@/launcher";
import type { Game } from "@/launcher";
import { cn } from "@/lib/format";

export type ArtworkVariant = "hero" | "tile" | "thumb";

/** Perfil angular de una cordillera/skyline. Determinista para (semilla, capa). */
function ridgePath(seed: number, layer: number, points: number, baseY: number, amp: number): string {
  const step = 1000 / points;
  let d = `M -40 620 L -40 ${baseY}`;
  for (let i = 0; i <= points; i++) {
    const n = noise(seed + layer * 977, i);
    const n2 = noise(seed + layer * 977, i + 500);
    const y = baseY - n * amp - (n2 > 0.82 ? amp * 0.55 : 0);
    d += ` L ${(i * step).toFixed(1)} ${y.toFixed(1)}`;
  }
  return `${d} L 1040 ${baseY} L 1040 620 Z`;
}

/** Torres/pilares del primer plano: rectángulos chaflanados de alturas dispares. */
function pillars(seed: number, count: number): { x: number; w: number; h: number; cut: number }[] {
  const out: { x: number; w: number; h: number; cut: number }[] = [];
  for (let i = 0; i < count; i++) {
    const n = noise(seed + 313, i);
    const n2 = noise(seed + 719, i);
    out.push({
      x: (i / count) * 1000 + n * 40 - 20,
      w: 26 + n2 * 54,
      h: 110 + n * 260,
      cut: 10 + n2 * 22,
    });
  }
  return out;
}

export function GameArtwork({
  game, variant = "hero", className, parallax = true,
}: { game: Game; variant?: ArtworkVariant; className?: string; parallax?: boolean }) {
  const { key, accent, deep } = game.palette;
  const seed = game.artSeed;

  const shapes = useMemo(() => {
    const detail = variant === "hero" ? 1 : 0.55;
    return {
      far: ridgePath(seed, 1, Math.round(16 * detail) + 6, 430, 150),
      mid: ridgePath(seed, 2, Math.round(20 * detail) + 6, 500, 190),
      near: pillars(seed, variant === "hero" ? 13 : 7),
    };
  }, [seed, variant]);

  const id = `art-${game.id}-${variant}`;
  // El parallax se sirve por variables CSS que escribe `useParallax`: cero renders de React.
  const layer = (depth: number): React.CSSProperties =>
    parallax
      ? { transform: `translate3d(calc(var(--px,0) * ${depth}px), calc(var(--py,0) * ${depth * 0.6}px), 0)`, willChange: "transform" }
      : {};

  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} aria-hidden>
      {/* Cielo: el color del juego, oscurecido hasta el negro del lienzo. */}
      <div
        className="absolute -inset-[6%]"
        style={{
          ...layer(6),
          background:
            `radial-gradient(120% 90% at 72% 14%, ${key}55, transparent 58%),` +
            `radial-gradient(90% 70% at 20% 92%, ${accent}22, transparent 62%),` +
            `linear-gradient(170deg, ${deep} 0%, #05060b 78%)`,
        }}
      />

      {/* Astro / bloom principal. */}
      <div
        className="absolute rounded-full"
        style={{
          ...layer(12),
          top: variant === "hero" ? "8%" : "6%",
          right: "16%",
          width: variant === "hero" ? 260 : 130,
          height: variant === "hero" ? 260 : 130,
          background: `radial-gradient(circle, ${accent}dd 0%, ${key}44 38%, transparent 68%)`,
          filter: "blur(2px)",
        }}
      />

      {/* Escenario. Un único SVG con las tres profundidades. */}
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1000 600"
        preserveAspectRatio="xMidYMid slice"
        style={layer(18)}
      >
        <defs>
          <linearGradient id={`${id}-far`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={key} stopOpacity="0.30" />
            <stop offset="100%" stopColor="#05060b" stopOpacity="0.85" />
          </linearGradient>
          <linearGradient id={`${id}-mid`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={deep} stopOpacity="0.95" />
            <stop offset="100%" stopColor="#04050a" />
          </linearGradient>
          <linearGradient id={`${id}-beam`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.55" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Haz de luz diagonal: la iluminación cinematográfica del plano. */}
        <polygon points="620,-40 900,-40 480,640 300,640" fill={`url(#${id}-beam)`} opacity="0.5" />

        <path d={shapes.far} fill={`url(#${id}-far)`} />
        <path d={shapes.mid} fill={`url(#${id}-mid)`} />
        {/* Filo iluminado de la cresta media: separa los planos sin dibujar un borde. */}
        <path d={shapes.mid} fill="none" stroke={accent} strokeOpacity="0.35" strokeWidth="1.5" />
      </svg>

      {/* Primer plano: pilares troquelados, la capa que más se mueve con el ratón. */}
      <svg
        className="absolute inset-x-0 bottom-0 h-[62%] w-full"
        viewBox="0 0 1000 380"
        preserveAspectRatio="xMidYMax slice"
        style={layer(30)}
      >
        {shapes.near.map((p, i) => (
          <polygon
            key={i}
            points={`${p.x},380 ${p.x},${380 - p.h + p.cut} ${p.x + p.cut},${380 - p.h} ${p.x + p.w},${380 - p.h} ${p.x + p.w},380`}
            fill="#04050a"
            stroke={key}
            strokeOpacity={0.22}
            strokeWidth={1}
          />
        ))}
      </svg>

      {/* Retícula técnica + viñeta + caída a negro por la izquierda (donde vive el texto). */}
      <div className="absolute inset-0 bg-grid opacity-[0.35]" style={layer(4)} />
      <div
        className="absolute inset-0"
        style={{
          background:
            variant === "hero"
              ? "linear-gradient(90deg, rgba(4,5,10,0.97) 0%, rgba(4,5,10,0.82) 30%, rgba(4,5,10,0.25) 62%, rgba(4,5,10,0.55) 100%)"
              : "linear-gradient(180deg, rgba(4,5,10,0.05) 0%, rgba(4,5,10,0.88) 100%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(130% 100% at 50% 50%, transparent 42%, rgba(0,0,0,0.75) 100%)" }}
      />
    </div>
  );
}

/**
 * Artwork de una noticia: mismo lenguaje visual, sin juego detrás. Se le pasa semilla y
 * acento para que dos noticias nunca se vean iguales.
 */
export function NewsArtwork({ seed, accent, className }: { seed: number; accent: string; className?: string }) {
  const path = useMemo(() => ridgePath(seed, 3, 12, 460, 170), [seed]);
  const id = `news-${seed}`;
  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} aria-hidden>
      <div
        className="absolute inset-0"
        style={{ background: `radial-gradient(100% 80% at 70% 10%, ${accent}44, transparent 60%), linear-gradient(165deg,#0a0c15,#05060b)` }}
      />
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.32" />
            <stop offset="100%" stopColor="#05060b" />
          </linearGradient>
        </defs>
        <path d={path} fill={`url(#${id})`} />
        <path d={path} fill="none" stroke={accent} strokeOpacity="0.4" strokeWidth="1.5" />
      </svg>
      <div className="absolute inset-0 bg-grid opacity-25" />
      <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, transparent 30%, rgba(5,6,11,0.92) 100%)" }} />
    </div>
  );
}
