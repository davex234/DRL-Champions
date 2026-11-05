"use client";

/**
 * EL TROQUEL DEL SOBRE — seis símbolos, una sola familia.
 *
 * ────────────────────────── QUÉ RESUELVE ──────────────────────────
 *
 * Los dieciséis sobres del catálogo llevaban EL MISMO símbolo: el hexágono de NEXUS con dos
 * cuñas enfrentadas. Cambiaba el color y nada más, así que un Sobre Inicial y un Sobre
 * Champions eran el mismo objeto — y el encargo lo dice sin rodeos: «no queremos la misma
 * bolsa cambiando de color».
 *
 * ────────────────────────── LA GRAMÁTICA ──────────────────────────
 *
 * Lo que hace familia NO es el símbolo: es **el hexágono que lo contiene**. Los seis comparten
 * marco, grosor de trazo, ángulos de 30°/60° y el mismo vocabulario monolínea con un solo
 * relleno. Lo que cambia es lo que hay DENTRO, y cada uno dice qué clase de producto es:
 *
 *   `nexus`     dos cuñas enfrentadas — el sigilo de la casa, el producto base.
 *   `ascent`    un galón ascendente — el primer sobre, el que empieza algo.
 *   `meridian`  un meridiano y su paralelo — una región del circuito.
 *   `crest`     un escudo con el monograma REAL del equipo dentro.
 *   `laurel`    dos ramas enfrentadas — competición.
 *   `medal`     una estrella troquelada sobre corona — colección histórica.
 *
 * Ninguno es un icono de librería ni un emoji: son trazados propios, del mismo idioma
 * geométrico que el chaflán de NEXUS.
 *
 * ────────────────────────── COSTE ──────────────────────────
 *
 * Un SVG de pocos trazados, sin dependencias, sin imágenes y sin animación propia. Se
 * dimensiona en porcentaje, así que el mismo símbolo sirve a 40 px en el carril de la tienda y
 * a 272 en la ceremonia.
 */
import type { PackSigilKind } from "./packIdentity";
import { td } from "@/i18n/runtime";

export function PackSigil({
  kind,
  accent,
  monogram,
  rings = 1,
  rich = false,
  gradientId = "nxsigil",
  className,
  style,
}: {
  kind: PackSigilKind;
  accent: string;
  /** Solo lo usa `crest`: las siglas reales del equipo. */
  monogram?: string | null;
  /** Anillos exteriores del troquel. Los pone el escalón del sobre, no la categoría. */
  rings?: number;
  /** Relleno degradado del trazo (escalones altos). */
  rich?: boolean;
  /** Id del degradado. Único por instancia: dos SVG con el mismo id se pisan. */
  gradientId?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const trazo = rich ? `url(#${gradientId})` : accent;

  return (
    <svg viewBox="0 0 100 100" className={className} style={style} aria-hidden fill="none">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
          <stop offset="100%" stopColor={accent} stopOpacity="0.85" />
        </linearGradient>
      </defs>

      {/*
        ANILLOS DEL TROQUEL. Uno es un sello; tres son una acuñación. Los decide el ESCALÓN,
        así que un sobre de equipo base y uno legendario comparten símbolo y no material.
      */}
      {Array.from({ length: rings }, (_, i) => (
        <circle
          key={i}
          cx="50" cy="50" r={44 - i * 4}
          stroke={accent} strokeWidth="1.4" strokeDasharray="7 6"
          opacity={0.55 - i * 0.14}
        />
      ))}

      {/* EL HEXÁGONO. La firma de la familia: idéntico en las seis categorías. */}
      <path d="M50 10 L84 30 L84 70 L50 90 L16 70 L16 30 Z" stroke={trazo} strokeWidth="2.2" />

      {kind === "nexus" && (
        <>
          <path d="M34 34 L52 50 L34 66 Z" fill={accent} fillOpacity="0.5" stroke={trazo} strokeWidth="1.8" />
          <path d="M66 34 L48 50 L66 66 Z" fill={accent} fillOpacity="0.2" stroke={trazo} strokeWidth="1.8" />
        </>
      )}

      {kind === "ascent" && (
        <>
          {/* Galón ascendente: el gesto de empezar. */}
          <path d="M32 60 L50 40 L68 60" stroke={trazo} strokeWidth="3" strokeLinecap="square" />
          <path d="M32 72 L50 52 L68 72" stroke={accent} strokeWidth="2" strokeOpacity="0.45" strokeLinecap="square" />
          <path d="M44 34 L50 26 L56 34 Z" fill={accent} fillOpacity="0.55" stroke={trazo} strokeWidth="1.4" />
        </>
      )}

      {kind === "meridian" && (
        <>
          {/* Un meridiano y su paralelo: una porción del circuito, no un planeta entero. */}
          <circle cx="50" cy="50" r="22" stroke={trazo} strokeWidth="2" />
          <ellipse cx="50" cy="50" rx="9" ry="22" stroke={accent} strokeWidth="1.6" strokeOpacity="0.75" />
          <path d="M28 50 L72 50" stroke={accent} strokeWidth="1.6" strokeOpacity="0.75" />
          <path d="M50 28 L50 72" stroke={accent} strokeWidth="1.2" strokeOpacity="0.4" />
        </>
      )}

      {kind === "crest" && (
        <>
          {/*
            ESCUDO con el monograma del equipo. El texto son las siglas REALES
            (`teamMonogram`), no un adorno: es lo que identifica el producto de un vistazo.
          */}
          <path d="M50 28 L70 36 L70 54 Q70 66 50 74 Q30 66 30 54 L30 36 Z" stroke={trazo} strokeWidth="2" fill={accent} fillOpacity="0.12" />
          {monogram && (
            <text
              x="50" y="56"
              textAnchor="middle"
              fill={accent}
              style={{
                fontFamily: "var(--font-display), system-ui, sans-serif",
                fontWeight: 700,
                // Las siglas van de 2 a 4 caracteres: el cuerpo se ajusta para que «NAVI»
                // no se salga del escudo que «TH» deja holgado.
                fontSize: monogram.length >= 4 ? 15 : monogram.length === 3 ? 18 : 22,
                letterSpacing: "0.02em",
              }}
            >
              {td(monogram)}
            </text>
          )}
        </>
      )}

      {kind === "laurel" && (
        <>
          {/* Dos ramas enfrentadas y una cuña central: competición. */}
          <path d="M36 68 Q26 50 36 32" stroke={trazo} strokeWidth="2.2" />
          <path d="M64 68 Q74 50 64 32" stroke={trazo} strokeWidth="2.2" />
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <path d={`M36 ${62 - i * 12} L27 ${58 - i * 12}`} stroke={accent} strokeWidth="1.8" strokeOpacity="0.8" />
              <path d={`M64 ${62 - i * 12} L73 ${58 - i * 12}`} stroke={accent} strokeWidth="1.8" strokeOpacity="0.8" />
            </g>
          ))}
          <path d="M50 36 L57 50 L50 64 L43 50 Z" fill={accent} fillOpacity="0.45" stroke={trazo} strokeWidth="1.6" />
        </>
      )}

      {kind === "medal" && (
        <>
          {/* Estrella troquelada sobre corona: lo histórico, lo que ya no se vuelve a acuñar. */}
          <circle cx="50" cy="50" r="24" stroke={trazo} strokeWidth="2" />
          <path
            d="M50 32 L55 45 L69 45 L58 53 L62 66 L50 58 L38 66 L42 53 L31 45 L45 45 Z"
            fill={accent} fillOpacity="0.5" stroke={trazo} strokeWidth="1.5"
          />
          <path d="M26 50 Q50 64 74 50" stroke={accent} strokeWidth="1.4" strokeOpacity="0.5" />
        </>
      )}
    </svg>
  );
}
