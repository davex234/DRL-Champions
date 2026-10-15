"use client";

/**
 * APERTURA DE SOBRES · LA SALA (2026-10-15). Un único fondo PERSISTENTE durante la revelación que toma la identidad de la
 * carta en escena (`domain/packs/atmosphere`): Masters lila, Icon marfil, Oro dorado… y luz neutra mientras se prepara
 * cada giro. Es una capa: no sabe de cartas ni de sobres, solo pinta el ambiente que le pasan.
 *
 * Transiciones: cada ambiente es una capa con su clave; la nueva ENTRA con un fundido y la anterior SALE más deprisa
 * (`ATMOSPHERE_EXIT_MS` < la preparación más corta), así que al girar una carta nunca queda el color de la anterior.
 * Dos cartas seguidas de la misma clase no parpadean: misma clave, misma capa.
 *
 * Coste: degradados CSS y, solo en clases altas, una corona que gira despacio y ≤ 14 motas. Movimiento reducido:
 * mismos colores, sin nada que se mueva (fundidos cortos).
 */
import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ATMOSPHERE_ENTER_MS, ATMOSPHERE_EXIT_MS, ATMOSPHERE_REDUCED_MS, type RevealAtmosphere as Atmosphere } from "@/domain/packs/atmosphere";

export function RevealAtmosphere({ atmosphere, reduced, cardUid }: {
  /** null = sin sala (el sobre aún cerrado, o el resumen): la capa se desvanece. */
  atmosphere: Atmosphere | null;
  reduced: boolean;
  /** La carta en escena (QA: qué carta manda en el color). */
  cardUid?: string | null;
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      data-testid="reveal-atmosphere"
      data-atmosphere={atmosphere?.key ?? "none"}
      data-tone={atmosphere?.tone ?? ""}
      data-tier={atmosphere ? String(atmosphere.tier) : ""}
      data-card-uid={cardUid ?? ""}
    >
      <AnimatePresence initial={false}>
        {atmosphere && <AtmosphereLayer key={atmosphere.key} a={atmosphere} reduced={reduced} />}
      </AnimatePresence>
    </div>
  );
}

function AtmosphereLayer({ a, reduced }: { a: Atmosphere; reduced: boolean }) {
  const light = a.tone === "light";
  const enter = (reduced ? ATMOSPHERE_REDUCED_MS : ATMOSPHERE_ENTER_MS) / 1000;
  const exit = (reduced ? ATMOSPHERE_REDUCED_MS : ATMOSPHERE_EXIT_MS) / 1000;
  const motes = useMemo(
    () => (reduced ? [] : Array.from({ length: a.motes }, (_, i) => ({
      id: i, left: 6 + ((i * 53) % 88), size: 2 + (i % 3), delay: (i * 0.37) % 4, dur: 6 + (i % 5) * 1.3, drift: (i % 2 ? 1 : -1) * (8 + (i % 4) * 6),
    }))),
    [a.motes, reduced],
  );

  return (
    <motion.div
      className="absolute inset-0 overflow-hidden"
      data-layer={a.key}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: enter, ease: "easeOut" } }}
      exit={{ opacity: 0, transition: { duration: exit, ease: "easeIn" } }}
    >
      {/* Fondo: el color de la clase de centro a borde. */}
      <div className="absolute inset-0" style={{ background: `radial-gradient(130% 95% at 50% 42%, ${a.mid} 0%, ${a.deep} ${light ? 95 : 82}%)` }} />
      {/* Foco cenital y suelo: la sala siempre tiene luz (también en las clases bajas). */}
      <div className="absolute inset-0" style={{
        background: `conic-gradient(from 180deg at 50% -12%, transparent 155deg, ${a.glow}${light ? "55" : "2e"} 172deg, ${a.glow}${light ? "80" : "44"} 180deg, ${a.glow}${light ? "55" : "2e"} 188deg, transparent 205deg)`,
      }} />
      <div className="absolute inset-x-0 bottom-0 h-[38%]" style={{ background: `radial-gradient(52% 70% at 50% 100%, ${a.glow}${light ? "66" : "30"}, transparent 72%)` }} />
      {/* Halo detrás de la carta. */}
      <div className="absolute left-1/2 top-[44%] h-[86vmin] w-[86vmin] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: `radial-gradient(closest-side, ${a.glow}${light ? "e6" : "5c"}, ${a.glow}${light ? "40" : "1c"} 55%, transparent 78%)` }} />

      {/* Corona de rayos (Masters, Champions, Prime, Icon). Gira muy despacio; reducido: quieta. */}
      {a.rays && (
        <motion.div
          className="absolute left-1/2 top-[44%] h-[170vmax] w-[170vmax]"
          style={{
            x: "-50%", y: "-50%",
            background: `repeating-conic-gradient(from 0deg at 50% 50%, ${a.highlight}${light ? "38" : "1a"} 0deg 4deg, transparent 4deg 15deg)`,
            maskImage: "radial-gradient(closest-side, rgba(0,0,0,0.9), transparent 62%)",
            WebkitMaskImage: "radial-gradient(closest-side, rgba(0,0,0,0.9), transparent 62%)",
          }}
          animate={reduced ? undefined : { rotate: 360 }}
          transition={reduced ? undefined : { duration: 90, ease: "linear", repeat: Infinity }}
          data-testid="atmosphere-rays"
        />
      )}

      {/* Reflejos metálicos (Plata, Oro, Champions, Icon): bandas diagonales que cruzan despacio. Reducido: una banda quieta. */}
      {a.sheen && (
        <motion.div
          className="absolute inset-y-0 -left-1/2 w-[200%]"
          style={{
            background: `repeating-linear-gradient(115deg, transparent 0 14%, ${a.highlight}${light ? "40" : "26"} 17%, transparent 21% 34%)`,
            mixBlendMode: light ? "multiply" : "screen",
          }}
          initial={{ x: "-6%" }}
          animate={reduced ? { x: "-6%" } : { x: ["-6%", "6%"] }}
          transition={reduced ? undefined : { duration: 9, ease: "easeInOut", repeat: Infinity, repeatType: "mirror" }}
          data-testid="atmosphere-sheen"
        />
      )}

      {/* Motas de luz que ascienden (clases altas). */}
      {motes.map((m) => (
        <motion.span
          key={m.id}
          className="absolute bottom-[-2%] rounded-full"
          style={{ left: `${m.left}%`, width: m.size, height: m.size, background: a.highlight, boxShadow: `0 0 ${m.size * 3}px ${a.glow}` }}
          initial={{ y: 0, opacity: 0 }}
          animate={{ y: "-95vh", x: m.drift, opacity: [0, light ? 0.75 : 0.85, 0] }}
          transition={{ duration: m.dur, delay: m.delay, ease: "linear", repeat: Infinity }}
        />
      ))}

      {/* Viñeta: oscura en las salas oscuras; cálida y suave en la sala clara (el marfil no se quema). Escala con la pantalla:
          a 390 px una viñeta fija de escritorio se comería toda la sala. */}
      <div className="absolute inset-0" style={{ boxShadow: light ? "inset 0 0 min(220px, 26vmin) min(40px, 5vmin) rgba(150,120,60,0.30)" : "inset 0 0 min(240px, 26vmin) min(70px, 7vmin) rgba(0,0,0,0.72)" }} />
    </motion.div>
  );
}
