"use client";

/**
 * EL RECINTO — NEXUS ARENA (Fase 45 → Fase 50).
 *
 * ────────────────────────── QUÉ FALLABA ──────────────────────────
 *
 * La Fase 45 puso un LUGAR detrás de la mesa: gradientes, una retícula de suelo en fuga y dos
 * pilonas de luz. Era un fondo correcto, pero seguía siendo un fondo ABSTRACTO: una habitación
 * oscura con una rejilla. Nadie mira eso y piensa «estoy jugando la final».
 *
 * ────────────────────────── QUÉ HACE AHORA ──────────────────────────
 *
 * Construye un ESTADIO por capas, de atrás adelante:
 *
 *     1. aire        el gradiente profundo de siempre (lo que queda si la imagen no carga)
 *     2. estadio     la arquitectura, la grada y las pantallas: imagen propia de la arena (WebP)
 *     3. grada       el público late muy despacio
 *     4. luz rival   el techo se enciende en rojo/magenta: arriba juega el rival
 *     5. luz tuya    el suelo del escenario se enciende en cian: abajo juegas tú
 *     6. haces       cuatro focos que barren despacio (dos rojos arriba, dos cian abajo)
 *     7. suelo       reflejo del escenario en primer plano
 *     8. horizonte   la costura de luz donde se cruzan los dos bandos
 *     9. bruma       una banda baja que deriva
 *    10. baño        el bando que ataca, y el golpe del turno recién resuelto
 *    11. motas       doce, contadas
 *    12. viñeta      los bordes caen; el centro manda
 *
 * El fondo lo dicta la CONFIGURACIÓN de la arena (`lib/duel/arenas`): nombre, imágenes, acentos y
 * efectos. Otra arena es otra entrada en `ARENAS`, no otro componente.
 *
 * Ocupa el VIEWPORT (`fixed inset-0`): el estadio no termina donde termina el tablero. En pantalla
 * completa llena la pantalla entera, que es donde más se nota.
 *
 * ────────────────────────── QUÉ NO HACE ──────────────────────────
 *
 * No sabe nada de la partida salvo tres señales de PRESENTACIÓN que le llegan ya decididas
 * (`attacker`, `finalTurn`, `hit`). No lee la vista, no llama al servidor y no decide nada. Si se
 * borra este fichero, la partida se juega igual: sólo se juega en una habitación vacía.
 *
 * ────────────────────────── COSTE ──────────────────────────
 *
 * Una imagen (≈200 KB en escritorio, menos en móvil) y gradientes. Todo lo que se mueve lo hace
 * sobre `transform`/`opacity`, que el compositor mueve sin repintar; ningún filtro animado y
 * ninguna capa de grano (la Fase 44.1 midió que el grano a pantalla completa congela capturas).
 * Con `prefers-reduced-motion: reduce` no se mueve absolutamente nada (la regla vive en
 * `game-experience.css`).
 */
import { cn } from "@/lib/format";
import { arenaFor, type ArenaMode } from "@/lib/duel/arenas";
import { arenaBackgroundLayers, useDuelTheme } from "@/lib/duel/duelTheme";

/** Doce. No «las que hagan falta»: doce. */
const MOTAS = Array.from({ length: 12 }, (_, i) => i);

/** Cuatro focos, fijos: dos del rival (arriba) y dos tuyos (abajo). */
const HACES = [
  { id: "rival-l", lado: "rival" },
  { id: "rival-r", lado: "rival" },
  { id: "tu-l", lado: "tu" },
  { id: "tu-r", lado: "tu" },
] as const;

export type ArenaAttacker = "you" | "rival" | "none";

export function ArenaEnvironment({
  attacker = "none",
  finalTurn = false,
  hit = "none",
  variant = "quick",
  className,
}: {
  /** Quién ataca este turno. Tiñe el horizonte y el baño de luz. */
  attacker?: ArenaAttacker;
  /** Turno 10: el recinto se calienta. */
  finalTurn?: boolean;
  /** Resolución recién ocurrida: el mundo acusa el golpe. */
  hit?: "win" | "loss" | "tie" | "none";
  /** Modo de la partida: decide QUÉ arena se monta (hoy todas son NEXUS Champions). */
  variant?: ArenaMode;
  className?: string;
}) {
  const arena = arenaFor(variant);
  const efectos = arena.ambient;
  /* F71 · temática de duelo del panel (solo visual). Sin tema, o si su imagen falla, queda el fondo de la arena. */
  const theme = useDuelTheme();
  const bg = arenaBackgroundLayers(theme, arena.background);

  return (
    <div
      aria-hidden
      data-arena-env={variant}
      data-arena-id={arena.arenaId}
      data-duel-theme={theme?.slug ?? "default"}
      data-attacker={attacker}
      data-final={finalTurn ? "true" : "false"}
      data-hit={hit}
      className={cn("nx-arena-env pointer-events-none fixed inset-0 overflow-hidden", className)}
      style={
        {
          "--arena-bg-wide": bg.wide,
          "--arena-bg-narrow": bg.narrow,
        } as React.CSSProperties
      }
    >
      {/* 1 · EL AIRE. Lo que queda si la imagen del estadio aún no ha llegado. */}
      <span className="nx-arena-env-sky" />

      {/* 2 · EL ESTADIO. Arquitectura, grada y pantallas: la imagen propia de la arena. */}
      <span className="nx-arena-env-stage" />

      {/* 3 · LA GRADA. El público late muy despacio: el sitio está lleno. */}
      {efectos.crowd && <span className="nx-arena-env-crowd" />}

      {/* 4 y 5 · LA LUZ DE CADA BANDO. Rojo arriba, cian abajo: se entiende antes de leer. */}
      <span className="nx-arena-env-light nx-arena-env-light-rival" />
      <span className="nx-arena-env-light nx-arena-env-light-tu" />

      {/* 6 · LOS HACES. Cuatro focos, contados, barriendo despacio. */}
      {efectos.beams &&
        HACES.map((h) => <span key={h.id} className={cn("nx-arena-env-beam", `nx-arena-env-beam-${h.id}`)} data-lado={h.lado} />)}

      {/* 7 · EL SUELO DEL ESCENARIO. Retícula en fuga y reflejo en primer plano. */}
      <span className="nx-arena-env-floor" />
      <span className="nx-arena-env-roof" />

      {/* 8 · EL HORIZONTE. La costura de luz entre los dos bandos; late muy despacio. */}
      <span className="nx-arena-env-horizon" />

      {/* Las pilonas de la Fase 45 se quedan como paredes del recinto, ahora en los tonos de bando. */}
      <span className="nx-arena-env-pylon nx-arena-env-pylon-l" />
      <span className="nx-arena-env-pylon nx-arena-env-pylon-r" />

      {/* 9 · LA BRUMA. Una banda baja que deriva: da aire entre el público y el escenario. */}
      {efectos.haze && <span className="nx-arena-env-haze" />}

      {/* 10 · EL BAÑO DEL ATACANTE y el golpe del turno. */}
      <span className="nx-arena-env-wash" />

      {/*
        LAS MOTAS. Doce. Cada una lleva su fase y su carril en variables para que no salgan
        las doce a la vez ni por el mismo sitio; el movimiento es una traslación vertical
        lenta y nada más.
      */}
      {efectos.motes && (
        <span className="nx-arena-env-motes">
          {MOTAS.map((i) => (
            <span
              key={i}
              className="nx-arena-env-mote"
              style={
                {
                  "--m-x": `${(i * 8.5 + 4) % 100}%`,
                  "--m-d": `${14 + (i % 5) * 3.5}s`,
                  "--m-delay": `${i * -2.4}s`,
                  "--m-s": `${1 + (i % 3) * 0.6}px`,
                } as React.CSSProperties
              }
            />
          ))}
        </span>
      )}

      {/* 12 · LA VIÑETA. Los bordes caen para que el centro sea lo único que manda. */}
      <span className="nx-arena-env-vignette" />
    </div>
  );
}
