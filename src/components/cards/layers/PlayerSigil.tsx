"use client";

/**
 * SIGILO DEL JUGADOR — arte de carta generado, original y determinista (Fase 9.5).
 *
 * EL PROBLEMA QUE RESUELVE
 *
 * No hay retratos de jugador. Hasta ahora, cuando faltaba la foto —es decir, SIEMPRE— la
 * carta dibujaba una silueta genérica: un círculo por cabeza, un trapecio por hombros y dos
 * iniciales encima. Todas las cartas del juego se veían igual, y eso es lo que hacía que la
 * colección pareciera una hoja de cálculo con colores.
 *
 * LA SOLUCIÓN
 *
 * Un emblema geométrico distinto para cada jugador, derivado de su identificador. No es un
 * marcador de posición gris: es arte con silueta propia, profundidad y color de rareza, que
 * hace que dos cartas se distingan a tres metros.
 *
 * TRES PROPIEDADES QUE IMPORTAN
 *
 *   1. **Determinista.** El mismo jugador da siempre el mismo emblema, en cualquier
 *      dispositivo y entre recargas. Si cambiara al azar, la colección dejaría de ser una
 *      colección: coleccionar exige que la carta sea reconocible.
 *   2. **Original.** Formas geométricas propias. Ni un asset, ni una silueta, ni un logo de
 *      nadie. Solo la gramática del género: energía, ángulos y un monograma.
 *   3. **Sustituible.** Es el RESPALDO de `PlayerPhoto`. El día que haya retratos
 *      autorizados, la foto gana y esto no se llega a dibujar. No hay que quitar nada.
 *
 * Todo es SVG en línea: sin red, sin imágenes que cargar y sin peticiones que fallen.
 */
import { useMemo } from "react";
import type { Player, RarityPalette } from "@/domain/cards/types";

/**
 * Generador determinista a partir de una cadena.
 *
 * Es el mismo `mulberry32` que usa el resto del proyecto para lo que tiene que ser
 * reproducible. Aquí solo dibuja: no toca ninguna regla de juego.
 */
function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Un polígono de N lados centrado, con rotación y radio dados. */
function polygon(cx: number, cy: number, r: number, sides: number, rotation: number): string {
  const pts: string[] = [];
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i / sides) * Math.PI * 2;
    pts.push(`${(cx + Math.cos(a) * r).toFixed(2)},${(cy + Math.sin(a) * r).toFixed(2)}`);
  }
  return pts.join(" ");
}

/**
 * Una esquirla: un triángulo alargado que sale del centro. Repetidas y variadas dan la
 * sensación de energía saliendo hacia fuera sin recurrir a ningún efecto caro.
 */
function shard(angle: number, inner: number, outer: number, width: number): string {
  const cx = 50;
  const cy = 54;
  const tip = [cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer];
  const a = [cx + Math.cos(angle - width) * inner, cy + Math.sin(angle - width) * inner];
  const b = [cx + Math.cos(angle + width) * inner, cy + Math.sin(angle + width) * inner];
  return `M${a[0].toFixed(2)},${a[1].toFixed(2)} L${tip[0].toFixed(2)},${tip[1].toFixed(2)} L${b[0].toFixed(2)},${b[1].toFixed(2)} Z`;
}

export function PlayerSigil({
  player,
  palette,
  /** Rango de la variante: cuanto mayor, más denso y luminoso el emblema. */
  rank = 1,
  /**
   * Efectos caros. `feGaussianBlur` cuesta, y en la rejilla de la colección hay sesenta
   * cartas a la vez: sesenta desenfoques se notan al desplazarse en un móvil. En cartas
   * pequeñas el rastro difuso no aporta nada que se vea, así que se apaga.
   */
  rich = false,
}: {
  player: Player;
  palette: RarityPalette;
  rank?: number;
  rich?: boolean;
}) {
  // El identificador es estable; el emblema, por tanto, también.
  const art = useMemo(() => {
    const rnd = seededRandom(player.id);

    /*
      Entre 5 y 9 esquirlas en carta grande; 4 o 5 en la pequeña.
      Cada esquirla es un nodo, y en la rejilla de la colección hay sesenta cartas a la
      vez: la diferencia entre 9 y 5 son 240 nodos menos en el documento. A tamaño de
      rejilla no se distingue una de otra, así que se paga solo donde se ve.
    */
    const count = rich ? 5 + Math.floor(rnd() * 5) : 4 + Math.floor(rnd() * 2);
    const spin = rnd() * Math.PI * 2;
    const shards = Array.from({ length: count }, (_, i) => {
      const angle = spin + (i / count) * Math.PI * 2 + (rnd() - 0.5) * 0.35;
      const outer = 40 + rnd() * 34;
      const inner = 11 + rnd() * 8;
      const width = 0.12 + rnd() * 0.18;
      return { d: shard(angle, inner, outer, width), o: 0.55 + rnd() * 0.4 };
    });

    return {
      shards,
      coreSides: 6 + Math.floor(rnd() * 3), // hexágono, heptágono u octógono
      coreRot: rnd() * Math.PI,
      coreR: 22 + rnd() * 6,
      ringR: 33 + rnd() * 7,
      // Las de rareza alta llevan un anillo interior extra.
      innerRing: rank >= 5 && rich,
      tilt: (rnd() - 0.5) * 16,
    };
  }, [player.id, rank, rich]);

  /*
   * Los identificadores de gradiente tienen que ser ÚNICOS en todo el documento: en la
   * colección hay decenas de cartas a la vez y, si se repiten, el navegador aplica el
   * primero a todas y salen todas del mismo color.
   */
  const uid = `sg-${player.id.replace(/[^a-z0-9]/gi, "")}`;
  const mono = player.nick.slice(0, 2).toUpperCase();

  return (
    <div className="absolute inset-0 grid place-items-center overflow-hidden">
      <svg
        viewBox="0 0 100 120"
        className="h-full w-full"
        aria-hidden
        style={{ transform: `rotate(${art.tilt * 0.15}deg)` }}
      >
        <defs>
          <radialGradient id={`${uid}-glow`} cx="50%" cy="45%" r="55%">
            <stop offset="0%" stopColor={palette.secondary} stopOpacity="0.75" />
            <stop offset="55%" stopColor={palette.primary} stopOpacity="0.30" />
            <stop offset="100%" stopColor={palette.primary} stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${uid}-shard`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={palette.secondary} stopOpacity="0.9" />
            <stop offset="100%" stopColor={palette.primary} stopOpacity="0.25" />
          </linearGradient>
          <radialGradient id={`${uid}-vignette`} cx="50%" cy="48%" r="60%">
            <stop offset="0%" stopColor="#05070e" stopOpacity="0.72" />
            <stop offset="62%" stopColor="#05070e" stopOpacity="0.42" />
            <stop offset="100%" stopColor="#05070e" stopOpacity="0" />
          </radialGradient>
          {/*
            El filtro de desenfoque SOLO se declara si se va a usar. Un `<filter>` sin usar
            sigue siendo nodos en el documento, y multiplicado por sesenta cartas se nota.
          */}
          {rich && (
            <filter id={`${uid}-soft`} x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="3" />
            </filter>
          )}
        </defs>

        {/*
          Fondo OSCURO bajo el emblema. Sin esto, las esquirlas se dibujaban sobre el
          degradado claro de la carta y se perdían: el resultado era un emblema lavado que
          no se leía a tamaño de rejilla. Un juego de cartas se mira de lejos.
        */}
        <ellipse cx="50" cy="54" rx="48" ry="50" fill={`url(#${uid}-vignette)`} />

        {/* Halo de color: da profundidad y separa el emblema del marco. */}
        <ellipse cx="50" cy="52" rx="46" ry="46" fill={`url(#${uid}-glow)`} />

        {/* Esquirlas: primero un rastro difuso (solo en cartas grandes), luego la forma sólida. */}
        {rich && (
          <g filter={`url(#${uid}-soft)`} opacity="0.5">
            {art.shards.map((s, i) => (
              <path key={`b${i}`} d={s.d} fill={palette.secondary} opacity={s.o * 0.6} />
            ))}
          </g>
        )}
        <g>
          {art.shards.map((s, i) => (
            <path key={i} d={s.d} fill={`url(#${uid}-shard)`} opacity={s.o} />
          ))}
        </g>

        {/* Anillos. */}
        <circle
          cx="50" cy="54" r={art.ringR}
          fill="none"
          stroke={palette.secondary}
          strokeOpacity="0.75"
          strokeWidth="1"
          strokeDasharray="4 3"
        />
        {art.innerRing && (
          <circle
            cx="50" cy="54" r={art.ringR - 5}
            fill="none"
            stroke={palette.text}
            strokeOpacity="0.5"
            strokeWidth="0.6"
          />
        )}

        {/*
          Núcleo OSCURO con borde luminoso. Antes era un polígono claro sobre fondo claro y
          el monograma no se leía; invertirlo lo convierte en el ancla de la composición.
        */}
        <polygon
          points={polygon(50, 54, art.coreR + 2.5, art.coreSides, art.coreRot)}
          fill="none"
          stroke={palette.secondary}
          strokeOpacity="0.55"
          strokeWidth="0.8"
        />
        <polygon
          points={polygon(50, 54, art.coreR, art.coreSides, art.coreRot)}
          fill="rgba(8,10,18,0.86)"
          stroke={palette.secondary}
          strokeWidth="1.4"
        />
        {/* Un punto de luz interior: el núcleo deja de ser un agujero plano. */}
        {rich && (
          <polygon
            points={polygon(50, 51, art.coreR * 0.72, art.coreSides, art.coreRot)}
            fill={palette.secondary}
            opacity="0.12"
          />
        )}

        {/*
          Monograma DENTRO del núcleo, en claro.
          Ojo con `palette.text`: en las paletas claras (Icon, Oro) es un color OSCURO,
          pensado para leerse sobre el fondo claro de la carta. Al invertir el núcleo a
          negro, usarlo dejaba el monograma negro sobre negro e ilegible. Aquí manda el
          núcleo, así que el texto es claro y la rareza la lleva el borde.
        */}
        <text
          x="50"
          y="54.5"
          textAnchor="middle"
          dominantBaseline="central"
          fill="#f2f5ff"
          fontSize="19"
          fontWeight="700"
          letterSpacing="0.5"
          style={{ fontFamily: "var(--font-display), system-ui, sans-serif" }}
        >
          {mono}
        </text>

        {/* Base: apoya el emblema y funde con el degradado inferior de la carta. */}
        <path
          d="M18 104 L50 96 L82 104 L82 120 L18 120 Z"
          fill={palette.primary}
          opacity="0.18"
        />
      </svg>
    </div>
  );
}
