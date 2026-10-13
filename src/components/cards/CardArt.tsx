"use client";

/**
 * CARD ART — la regla canónica de cómo se enseña una carta diseñada.
 *
 *     CARD ART = CARD VISUAL
 *
 * Las 331 cartas del catálogo son piezas TERMINADAS: el WebP ya trae el marco, la rareza, el
 * jugador, el OVR, las estadísticas y su silueta (750×1048, con margen transparente alrededor de
 * la carta). La interfaz no dibuja otra carta alrededor: ni fondo, ni borde, ni chaflán, ni
 * `border-radius`, ni `box-shadow` rectangular, ni relleno. El envoltorio, si hace falta, es
 * TÉCNICO (layout, eventos, selección, animación) y transparente.
 *
 * La profundidad y los estados se expresan sobre la SILUETA del asset, con `filter: drop-shadow`,
 * que respeta la transparencia de la imagen:
 *
 *   · reposo      → sombra física bajo la carta;
 *   · `glow`      → halo del color pedido (selección, rareza, bando) que sigue el contorno;
 *   · `dim`       → apagada (carta no poseída / usada) con filtros de color, no con un velo encima.
 *
 * Esta primitiva no conoce reglas, rarezas ni partidas: recibe una URL y cómo iluminarla.
 * `CardFace`, `CardThumb` y `DuelCard` la usan; una pantalla nueva que enseñe una carta debe
 * usarla también (lo fija `cardArt.contract.test`).
 */
import { cn } from "@/lib/format";

/** Medidas reales de los WebP del catálogo. La caja respeta esta proporción: nada se estira ni se recorta. */
export const CARD_ART_W = 750;
export const CARD_ART_H = 1048;
export const CARD_ART_RATIO = `${CARD_ART_W} / ${CARD_ART_H}`;

export type CardArtShadow = "none" | "rest" | "lifted";

/**
 * El filtro de la silueta. Una función aparte para poder probarla y para que quien anima una
 * carta (mano, duelo, revelación) componga el MISMO filtro que usa la carta en reposo.
 */
export function cardArtFilter({
  shadow = "rest",
  glow,
  glowSize = 14,
  dim = false,
}: {
  shadow?: CardArtShadow;
  /** Color del halo (hex/rgb). Sin él, no hay halo. */
  glow?: string | null;
  /** Radio del halo en px. */
  glowSize?: number;
  /** Apagada: no poseída, usada o bloqueada. */
  dim?: boolean;
} = {}): string | undefined {
  const partes: string[] = [];
  if (dim) partes.push("grayscale(0.9)", "brightness(0.5)");
  if (glow) partes.push(`drop-shadow(0 0 ${glowSize}px ${glow})`);
  if (shadow === "rest") partes.push("drop-shadow(0 6px 10px rgba(0,0,0,0.55))");
  if (shadow === "lifted") partes.push("drop-shadow(0 16px 22px rgba(0,0,0,0.7))");
  return partes.length ? partes.join(" ") : undefined;
}

export interface CardArtProps {
  src: string;
  alt: string;
  className?: string;
  shadow?: CardArtShadow;
  glow?: string | null;
  glowSize?: number;
  dim?: boolean;
  /** `eager` para la carta protagonista de una pantalla (revelación, detalle). */
  loading?: "lazy" | "eager";
  onError?: () => void;
  /** Tamaños para el navegador cuando la carta vive en una rejilla fluida. */
  sizes?: string;
}

export function CardArt({
  src, alt, className, shadow = "rest", glow = null, glowSize, dim = false, loading = "lazy", onError, sizes,
}: CardArtProps) {
  return (
    <img
      src={src}
      alt={alt}
      data-card-art
      width={CARD_ART_W}
      height={CARD_ART_H}
      loading={loading}
      decoding="async"
      draggable={false}
      onError={onError}
      sizes={sizes}
      /*
       * `nx-card-art` (globals.css) garantiza lo que NO lleva: fondo, borde, radio, sombra de caja.
       * `object-contain` y la proporción del asset: se ve el 100 % de la carta, sin recorte.
       */
      className={cn("nx-card-art block h-auto w-full select-none", className)}
      style={{ aspectRatio: CARD_ART_RATIO, filter: cardArtFilter({ shadow, glow, glowSize, dim }) }}
    />
  );
}
