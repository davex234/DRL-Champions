"use client";

/**
 * CARDVISUAL — la cara de la carta cuando existe un artwork hecho a mano.
 *
 * ────────────────────────── QUÉ RESUELVE ──────────────────────────
 *
 * Las cartas de NEXUS se diseñan a mano. Hasta ahora el juego solo sabía dibujarlas por
 * capas (`CardRenderer`, `DuelCard`): retrato, escudo, bandera, marco de la variante. Ese
 * dibujado sigue siendo la cara oficial y no se toca. Esto solo decide UNA cosa: si este
 * ejemplar concreto tiene un fichero final, se enseña el fichero; si no, se enseña lo de
 * siempre, exactamente igual que antes.
 *
 * ────────────────────────── NO DUPLICA NADA ──────────────────────────
 *
 * No sabe pintar cartas. No conoce variantes, rarezas ni estadísticas. Es un `<img>` con una
 * red de seguridad y, cuando la red se activa, cede el sitio a `children` —que es el
 * `Card3D`/`PlayerCard` que la pantalla ya construía—. Por eso se envuelve alrededor y no se
 * mete dentro: `Card3D` es el envoltorio físico (volumen, brillo, cuños de estado) y sigue
 * siéndolo tanto si la cara es el fichero como si es el dibujado por capas.
 *
 * ────────────────────────── LA RED DE SEGURIDAD ──────────────────────────
 *
 * El fallback no es un detalle: es el contrato. Cinco caminos llevan al dibujado de siempre.
 *
 *   · sin `uid`               — modo local, o una carta del catálogo que no posees.
 *   · sin ejemplar en el mapa — esa versión no tiene artwork subido.
 *   · URL ausente o rara      — `artworkPintable` la rechaza antes de tocar el DOM.
 *   · la imagen falla         — `onError` y se cede el sitio, sin hueco ni icono roto.
 *   · sin `minted_version`    — el servidor no la incluyó en el mapa, así que no hay entrada.
 *
 * Lo que NUNCA pasa es enseñar el artwork de otra versión: este componente no elige artwork.
 * Recibe un `uid` de ejemplar y busca esa entrada; si no está, no hay sustituto que buscar.
 */
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/format";
import { useArtworkStore } from "@/store/useArtworkStore";
import { artworkPintable, type CardArtworkRef } from "@/domain/cards/artwork";
import { CardArt } from "./CardArt";
import { td } from "@/i18n/runtime";

export interface CardFaceProps {
  /** El artwork ya resuelto. `undefined` = no hay, y se dibuja como siempre. */
  artwork?: CardArtworkRef;
  /** El dibujado por capas de toda la vida. Es el fallback, y nunca deja de existir. */
  children: ReactNode;
  /** Texto alternativo. Sin él la imagen sería un hueco mudo para un lector de pantalla. */
  alt: string;
  /** Se propaga al contenedor para que la carta ocupe lo mismo pinte lo que pinte. */
  className?: string;
  /**
   * OBSOLETO (limpieza global de cartas): el fichero ya no se recorta con chaflán ni lleva
   * sombra de caja — la carta ES el asset. Se acepta para no romper a quien lo pasa.
   */
  chamfer?: string;
}

/**
 * LA DECISIÓN, aislada del componente.
 *
 * Es una línea, y aun así vive aparte: es EL contrato de este bloque —cuándo se enseña el
 * fichero y cuándo se cede al dibujado de siempre— y separada se puede probar entera sin
 * montar React ni un navegador. El componente de abajo no decide nada más que esto.
 */
export function debePintarArtwork(
  artwork: CardArtworkRef | undefined | null, falló: boolean,
): boolean {
  return artworkPintable(artwork) && !falló;
}

/**
 * LA CARA, sin saber de dónde salió el artwork.
 *
 * Separada de `CardVisual` a propósito: así se puede probar entera —qué se emite, con qué
 * dimensiones, y los cinco caminos al fallback— sin montar el almacén ni un navegador. Quien
 * la usa directamente es el duelo, que resuelve su artwork por su cuenta.
 */
export function CardFace({ artwork, children, alt, className }: CardFaceProps) {
  /*
   * «Esta imagen concreta falló». Se reinicia cuando cambia la URL: si el diseñador sube una
   * corrección, un fallo anterior no puede condenar al ejemplar a no volver a intentarlo.
   */
  const [falló, setFalló] = useState(false);
  useEffect(() => { setFalló(false); }, [artwork?.url]);

  if (!debePintarArtwork(artwork, falló)) return <>{children}</>;
  const url = artwork!.url as string;

  /*
   * CARD ART = CARD VISUAL. Hasta aquí el fichero iba dentro de una caja con chaflán (`nx-clip`)
   * y `shadow-card`: el chaflán le cortaba las esquinas a la carta y la sombra de caja dibujaba
   * un rectángulo alrededor de su margen transparente — otra carta alrededor de la carta. Ahora
   * el contenedor es técnico (medida y posición) y transparente, y la imagen es `CardArt`:
   * dimensiones reales 750×1048, `object-contain`, sombra sobre la silueta. `chamfer` se acepta
   * por compatibilidad y ya no pinta nada.
   */
  return (
    <div className={cn("relative", className)} data-card-art-wrap>
      <CardArt src={url} alt={td(alt)} onError={() => setFalló(true)} />
    </div>
  );
}

export interface CardVisualProps extends Omit<CardFaceProps, "artwork"> {
  /** El ejemplar. Sin él no hay artwork que buscar y se dibuja como siempre. */
  uid?: string | null;
}

/**
 * LA CARA CONECTADA — busca el artwork de ESTE ejemplar y se lo da a `CardFace`.
 *
 * La búsqueda es un acceso directo por `uid` al mapa que ya vino con el estado: ni una
 * petición más por carta, que es lo que permite que la colección pinte cientos de golpe.
 *
 * En el render de SERVIDOR el mapa está vacío —el almacén se llena tras la sesión, en el
 * navegador—, así que la primera pintada es el dibujado por capas y el artwork entra al
 * hidratar. Es lo correcto: el HTML del servidor no puede contener los ficheros de un
 * jugador que todavía no se ha identificado.
 */
export function CardVisual({ uid, ...resto }: CardVisualProps) {
  const artwork = useArtworkStore((s) => (uid ? s.byUid[uid] : undefined));
  return <CardFace artwork={artwork} {...resto} />;
}
