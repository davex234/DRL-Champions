"use client";

import { motion, useReducedMotion } from "framer-motion";

/**
 * EL SOBRE SELLADO — el objeto que se compra y se abre (Fase 9.6).
 *
 * EL PROBLEMA. En la captura `14-sobre-sellado`, lo que el jugador tiene delante en el
 * momento más importante del bucle de recompensa es **un rectángulo azul oscuro con un
 * cuadradito y la palabra NEXUS**. La Fase 9.5 lo agrandó en la tienda —bien— pero no
 * tocó el objeto: seguía siendo un `div` con borde de color y una rejilla de fondo.
 *
 * Un sobre de cromos es papel metalizado. Eso es lo que hay que dibujar, y se puede hacer
 * entero con degradados: no hace falta ni una imagen ni una petición de red.
 *
 * LAS CAPAS, y qué aporta cada una:
 *
 *   1. **Cuerpo metalizado.** Tres degradados cruzados en vez de uno plano. Un solo
 *      degradado se lee como «fondo de caja»; tres cruzados se leen como material.
 *   2. **Bandas de foil.** Franjas diagonales de bajo contraste que rompen la superficie.
 *      Son lo que hace que la luz «tenga por dónde correr».
 *   3. **Reflejo especular.** Una banda que barre. Ya existía; ahora se apaga durante el
 *      corte, porque un reflejo alegre mientras rasgas el sobre pelea con la tensión.
 *   4. **Troquel central.** Un sigilo angular propio, calado sobre el foil. Sustituye al
 *      cuadrado con una «N» dentro, que era un marcador de posición.
 *   5. **Costura perforada.** La línea por la que se rasga, con su troquelado. Antes el
 *      corte ocurría en una línea que no existía hasta que empezabas a cortar.
 *   6. **Carga.** La costura se ENCIENDE conforme arrastras. Es la realimentación que
 *      convierte un gesto en una ceremonia: ves que estás a punto de conseguirlo.
 *
 * `cutProgress` (0-1) gobierna 4, 5, 6 y el levantamiento de la solapa.
 *
 * COSTE. Todo es CSS y un SVG de nueve trazados. El único bucle es el reflejo, y se
 * detiene en cuanto empieza el corte. Con `prefers-reduced-motion` no hay ninguno.
 */
export function SealedPack({
  accent,
  name,
  cutProgress,
  width = 260,
}: {
  accent: string;
  name: string;
  cutProgress: number;
  /** Ancho en px. La tienda lo usa a escala reducida; la ceremonia, a tamaño completo. */
  width?: number;
}) {
  const reduced = useReducedMotion();
  const opened = cutProgress > 0.001;
  const height = Math.round(width * (380 / 260));
  const flap = Math.round(height * 0.175);

  // Escala tipográfica atada al ancho: el mismo objeto sirve a 150 px en la tienda y a
  // 300 en la ceremonia sin que el texto se descoloque.
  const k = width / 260;

  return (
    <div
      className="relative"
      style={{ width, height, transformStyle: "preserve-3d" }}
    >
      {/* Resplandor de fondo. Crece con el corte: la energía «sale» del sobre. */}
      <div
        className="absolute -inset-8 -z-10 rounded-[40px] blur-3xl transition-opacity duration-normal"
        style={{ background: accent, opacity: 0.42 + cutProgress * 0.4 }}
      />

      {/* ── Cuerpo ── */}
      <div
        className="nx-clip absolute inset-0 overflow-hidden border-2 shadow-card"
        style={{
          borderColor: accent,
          // Tres degradados cruzados: metal, no fondo de caja.
          background: `
            linear-gradient(160deg, ${accent}26 0%, transparent 38%),
            radial-gradient(120% 80% at 50% -10%, rgba(255,255,255,0.10), transparent 60%),
            linear-gradient(180deg, #171a2b 0%, #080a12 55%, #12141f 100%)`,
          ["--nx-chamfer" as string]: `${Math.round(20 * k)}px`,
        }}
      >
        {/* Bandas de foil. Diagonales, opacidad baja: rompen la superficie sin ensuciarla. */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.55]"
          style={{
            backgroundImage: `repeating-linear-gradient(115deg, ${accent}00 0px, ${accent}14 2px, ${accent}00 9px, ${accent}00 26px)`,
          }}
        />
        <div aria-hidden className="absolute inset-0 bg-grid opacity-25" />

        {/* Franja de acento diagonal, detrás del troquel. */}
        <div
          aria-hidden
          className="absolute -inset-x-10 top-[46%] h-24 -translate-y-1/2 -rotate-12 opacity-25 blur-md"
          style={{ background: accent }}
        />

        {/* Reflejo especular. Se apaga al empezar a cortar: no compite con la tensión. */}
        {!reduced && !opened && (
          <motion.div
            aria-hidden
            className="absolute inset-y-0 w-1/3 -skew-x-12"
            style={{
              background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)",
            }}
            animate={{ x: ["-150%", "350%"] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut", repeatDelay: 0.6 }}
          />
        )}

        {/* ── Troquel central: el sigilo de NEXUS, calado sobre el foil ── */}
        <div className="absolute inset-x-0 flex flex-col items-center" style={{ top: flap + 26 * k }}>
          <svg
            viewBox="0 0 100 100"
            style={{ width: 92 * k, height: 92 * k }}
            aria-hidden
            fill="none"
          >
            <defs>
              <linearGradient id="nxpack" x1="0" y1="0" x2="0.4" y2="1">
                <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
                <stop offset="100%" stopColor={accent} stopOpacity="0.85" />
              </linearGradient>
            </defs>
            {/* Anillo exterior segmentado: el troquel del papel. */}
            <circle cx="50" cy="50" r="44" stroke={accent} strokeWidth="1.4" strokeDasharray="7 6" opacity="0.55" />
            {/* Hexágono base. */}
            <path d="M50 10 L84 30 L84 70 L50 90 L16 70 L16 30 Z" stroke="url(#nxpack)" strokeWidth="2.2" />
            {/* Núcleo: dos cuñas enfrentadas — la misma idea que el emblema de Duelos. */}
            <path d="M34 34 L52 50 L34 66 Z" fill={accent} fillOpacity="0.5" stroke="url(#nxpack)" strokeWidth="1.8" />
            <path d="M66 34 L48 50 L66 66 Z" fill={accent} fillOpacity="0.2" stroke="url(#nxpack)" strokeWidth="1.8" />
          </svg>

          <p
            className="mt-2 font-display font-bold uppercase text-white"
            style={{ fontSize: 22 * k, letterSpacing: `${0.28 * k}em`, textIndent: `${0.28 * k}em` }}
          >
            Nexus
          </p>
          <p
            className="font-display uppercase text-white/45"
            style={{ fontSize: 9 * k, letterSpacing: `${0.34 * k}em`, textIndent: `${0.34 * k}em` }}
          >
            Valorant Cards
          </p>
        </div>

        {/* ── Banda inferior con el nombre del sobre ── */}
        <div
          className="absolute inset-x-0 bottom-0 border-t px-4 py-3 text-center"
          style={{ borderColor: `${accent}44`, background: `linear-gradient(0deg, ${accent}22, transparent)` }}
        >
          <p
            className="font-display font-bold uppercase"
            style={{ color: accent, fontSize: 14 * k, letterSpacing: `${0.14 * k}em` }}
          >
            {name}
          </p>
        </div>
      </div>

      {/*
        ── Costura perforada ──
        La línea por la que se rasga EXISTE antes de rasgar. Antes solo aparecía al empezar
        el corte, así que el sobre no decía por dónde se abría y el gesto era adivinanza.
      */}
      <div
        aria-hidden
        className="absolute left-3 right-3 z-20"
        style={{
          top: flap,
          height: 2,
          background: `repeating-linear-gradient(90deg, ${accent}66 0 6px, transparent 6px 12px)`,
          opacity: opened ? 0 : 0.8,
        }}
      />

      {/* Carga: la costura se enciende de izquierda a derecha conforme arrastras. */}
      <motion.div
        aria-hidden
        className="absolute left-3 right-3 z-20 origin-left"
        style={{
          top: flap - 1,
          height: 4,
          background: `linear-gradient(90deg, #fff, ${accent})`,
          boxShadow: `0 0 20px #fff, 0 0 36px ${accent}`,
          scaleX: cutProgress,
          opacity: opened ? 1 : 0,
        }}
      />

      {/* ── Solapa superior, que se levanta al cortar ── */}
      <motion.div
        className="absolute inset-x-0 top-0 z-10 overflow-hidden border-2"
        style={{
          height: flap,
          borderColor: accent,
          borderBottom: "none",
          background: `linear-gradient(160deg, #1e2233 0%, #0a0c16 100%)`,
          transformOrigin: "top center",
          transformPerspective: 700,
          rotateX: -160 * cutProgress,
          clipPath: `polygon(0 0, calc(100% - ${Math.round(20 * k)}px) 0, 100% ${Math.round(20 * k)}px, 100% 100%, 0 100%)`,
        }}
      >
        <div aria-hidden className="absolute inset-0 bg-grid opacity-30" />
        <div
          aria-hidden
          className="absolute inset-0 opacity-50"
          style={{
            backgroundImage: `repeating-linear-gradient(115deg, ${accent}00 0px, ${accent}14 2px, ${accent}00 9px, ${accent}00 26px)`,
          }}
        />
      </motion.div>
    </div>
  );
}
