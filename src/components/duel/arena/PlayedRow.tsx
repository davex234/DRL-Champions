"use client";

/**
 * LAS POSICIONES DE UN BANDO — la fila de huecos donde se depositan las cartas jugadas.
 *
 * ────────────────────────── POR QUÉ EXISTE ──────────────────────────
 *
 * Tres problemas, encontrados uno detrás del otro:
 *
 *   1. Al principio una carta jugada DESAPARECÍA: las tuyas se plegaban en un
 *      `<details>Cartas gastadas</details>` y las del rival no se enseñaban en ningún
 *      sitio, así que el tablero del turno 7 se veía igual que el del turno 1.
 *   2. Después se enseñaban, pero solo cuando existían. Sin cartas, cada lado era una
 *      línea de texto de nueve píxeles: la mesa parecía una caja vacía.
 *   3. Y por fin las posiciones existieron siempre… dentro de un carril con `overflow-x`
 *      centrado en una mesa mucho más ancha. Medido: **diez posiciones de 40-50 px
 *      ocupando 576 de 1.224 px, con 324 px de nada a cada lado.** Ese hueco muerto ERA
 *      el rectángulo oscuro del que se quejaba la pantalla. Y en móvil el mismo carril
 *      hacía lo contrario: 407 px de posiciones dentro de 334, así que la primera y la
 *      última se cortaban por la mitad.
 *
 * ────────────────────────── CÓMO SE RESUELVE ──────────────────────────
 *
 * La fila deja de ser un carril que se desplaza y pasa a ser una REJILLA que reparte el
 * ancho de la mesa entre las posiciones: `repeat(n, minmax(0,1fr))`. Como el ancho de la
 * mesa se calcula a partir de `--pos` (ver `ArenaSurface`), las posiciones llenan la mesa
 * por construcción. El hueco muerto no se reduce: deja de poder existir.
 *
 * ────────────────────────── MÓVIL: LA FILA CRECE CON LA PARTIDA (Fase 8) ──────────────────────────
 *
 * En móvil esto eran DOS FILAS DE CINCO, y ahí estaba el fallo que arrastraba Duelos: a
 * 390×844 las dos rejillas —la tuya y la del rival— ocupaban 366 px de los 645 de la mesa
 * enseñando VEINTE CASILLAS VACÍAS, y empujaban la mano entera por debajo del pliegue
 * (0 de 10 cartas visibles, 122 px de exceso). El jugador veía un cartón de bingo y no veía
 * sus cartas.
 *
 * Medido en el navegador, con la partida real y las cuatro alternativas puestas una a una:
 *
 *     dos filas de cinco (lo que había)   mano 779–892 · exceso 122 · visibles  0/10
 *     controles en una fila               mano 768–882 · exceso  55 · visibles  0/10
 *     sin el abanico del rival            mano 740–854 · exceso  27 · visibles  0/10
 *     UNA FILA                            mano 575–688 · exceso   0 · visibles 10/10
 *
 * Una sola fila era lo único que bastaba por sí solo, y devolvía 204 px. Pero una fila de
 * DIEZ posiciones fijas deja cada una en 30 px, y eso ya no es una carta: es un cuadrado de
 * color. Así que en móvil la fila no reserva diez: reserva LO JUGADO MÁS LA SIGUIENTE. En el
 * turno 1 son cuatro posiciones de 50 px —una carta reconocible— y en el turno 10 son diez
 * de 33. La fila mide lo que mide la partida.
 *
 * No se esconde ninguna carta jugada: lo que deja de reservarse son casillas de turnos que
 * todavía no han ocurrido. En `sm` y por encima sobra ancho y siguen estando las diez.
 *
 * ────────────────────────── DE DÓNDE SALE ──────────────────────────
 *
 * De `view.yourUsed` / `view.rivalUsed`, de `view.history` y de `view.totalTurns`, tal cual
 * llegan del servidor. Aquí no se cruza nada ni se decide ningún resultado: se busca el
 * turno de cada carta por su `uid` y se pinta lo que el Combat Resolver ya decidió.
 */
import { motion } from "framer-motion";
import { cn } from "@/lib/format";
import { DuelCard } from "../DuelCard";
import { Slot } from "./ArenaSurface";
import { EASE } from "@/design/motion";
import { ARENA_ACCENT } from "@/lib/duel/arenas";
import type { DuelDeckCardDTO, DuelTurnView, Side } from "@/lib/duel/types";

/** Qué pasó en el turno en el que se jugó esta carta, DESDE MI PUNTO DE VISTA. */
type Suerte = "win" | "loss" | "tie" | null;

const MARCA: Record<Exclude<Suerte, null>, { letra: string; titulo: string }> = {
  win: { letra: "G", titulo: "Turno ganado" },
  loss: { letra: "P", titulo: "Turno perdido" },
  tie: { letra: "E", titulo: "Turno empatado" },
};

/**
 * FASE 50 · EL COLOR ES DE QUIEN SE LLEVÓ EL PUNTO, no de «bien o mal para este lado». Cian si el
 * turno lo ganaste tú, rojo si lo ganó el rival, ámbar si fue empate: el mismo código que la pista
 * de los diez turnos del HUD. Se LEE `outcome`; no se compara nada.
 */
function colorDelPunto(turno: DuelTurnView | undefined): string {
  if (!turno) return ARENA_ACCENT.draw;
  return turno.outcome === "TIE" ? ARENA_ACCENT.draw : turno.outcome === "A" ? ARENA_ACCENT.player : ARENA_ACCENT.opponent;
}

/**
 * Traduce el veredicto del turno al punto de vista de un lado.
 *
 * **Se LEE `outcome`, no se recalcula.** El Combat Resolver ya decidió quién ganó ese
 * enfrentamiento y lo dejó escrito como `"A" | "B" | "TIE"` —`A` es siempre el jugador—.
 * Comparar aquí `you.value` con `rival.value` sería reimplementar la regla en la interfaz.
 */
function suerteDe(turno: DuelTurnView | undefined, lado: Side): Suerte {
  if (!turno) return null;
  if (turno.outcome === "TIE") return "tie";
  const ganaElJugador = turno.outcome === "A";
  const mio = lado === "A" ? ganaElJugador : !ganaElJugador;
  return mio ? "win" : "loss";
}

export function PlayedRow({
  cards, turns, side, tone, slots, className,
}: {
  cards: DuelDeckCardDTO[];
  turns: DuelTurnView[];
  /** `"A"` eres tú, `"B"` el rival (vocabulario del dominio). */
  side: Side;
  tone: string;
  /** Cuántas posiciones tiene la mesa: los turnos de la partida. */
  slots: number;
  className?: string;
}) {
  /*
   * MÓVIL: una fila, tan larga como la partida. Lo jugado más la posición que viene, con un
   * mínimo de cuatro para que la mesa no arranque con una tira de una casilla. Se calcula
   * aquí y no con una clase suelta porque el número de posiciones lo manda la partida
   * (`totalTurns`), no una constante.
   */
  const enMóvil = Math.min(slots, Math.max(cards.length + 1, 4));

  return (
    <div
      className={cn(
        "nx-posiciones grid w-full justify-items-center gap-[var(--pos-gap)]",
        /*
         * FASE 45 · LA FILA RESERVA SU ALTURA, LAS CASILLAS VACÍAS NO LA GASTAN.
         *
         * Antes las diez posiciones eran diez placas con forma de carta —`--pos` de ancho por
         * 1,4 de alto—, llenas o no. En el turno 1 eso son VEINTE rectángulos vacíos, y a 1440
         * ocupan más superficie que las cartas, el marcador y el enfrentamiento juntos. Un
         * tablero cuyo elemento dominante es el hueco se lee como una rejilla de datos.
         *
         * Ahora la casilla vacía es una FICHA baja (un tercio de carta): sigue diciendo «aquí
         * cabe un turno» y sigue encendiéndose la que viene, pero deja de competir. La altura
         * de la fila se reserva igualmente, así que la mesa NO se mueve a media partida —lo que
         * costó arreglar en su día—: lo que cambia es que el espacio reservado ahora lo ocupa
         * el recinto, no veinte cajas.
         */
        "min-h-[calc(var(--pos)*1.16)]",
        side === "A" ? "items-end" : "items-start",
        className,
      )}
      /* `nx-posiciones` usa estas dos: la fila corta en móvil, las diez de frente en `sm`. */
      style={{ "--pos-cols": slots, "--pos-cols-sm": enMóvil } as React.CSSProperties}
      role="list"
      aria-label={side === "A" ? "Tus cartas en la mesa" : "Cartas del rival en la mesa"}
    >
      {Array.from({ length: slots }, (_, i) => {
        const c = cards[i];
        const turno = c ? turns.find((t) => (side === "A" ? t.you.uid : t.rival.uid) === c.uid) : undefined;
        const suerte = suerteDe(turno, side);
        const marca = suerte ? { ...MARCA[suerte], color: colorDelPunto(turno) } : null;
        /* La siguiente posición libre se enciende: ahí va a caer la carta de este turno. */
        const proxima = !c && i === cards.length;
        /*
         * LA ÚLTIMA JUGADA. La carta del turno recién resuelto es la única que el jugador
         * necesita distinguir del resto: sin esto, el tablero del turno 7 es una fila de
         * siete cartas iguales y no se sabe cuál acaba de caer. El realce es un filo y una
         * sombra —no un badge más— y desaparece en cuanto llega la siguiente.
         */
        const ultima = Boolean(c) && i === cards.length - 1;

        return (
          <Slot
            key={c?.uid ?? `hueco-${i}`}
            tone={tone}
            filled={Boolean(c)}
            active={proxima}
            /*
             * EL NÚMERO, SOLO EN LA QUE VIENE. Con las diez numeradas, una mesa sin jugar
             * eran veinte cifras compitiendo con las cartas: el tablero se leía como un
             * cartón de bingo y la carta recién jugada no destacaba sobre nada. La posición
             * sigue viéndose —es una placa hundida con sus escuadras—; lo que se retira es
             * el rótulo de un turno que todavía no ha pasado.
             */
            index={!c && proxima ? i + 1 : undefined}
            /*
             * La posición nunca pasa de `--pos`: es la medida de la que sale toda la mesa.
             * `nx-pos-extra` son las casillas de turnos que aún no han llegado: en móvil no
             * se pintan —la fila mide lo que mide la partida— y a partir de `sm` vuelven,
             * porque ahí sobra ancho y la mesa se lee mejor con sus diez posiciones.
             */
            className={cn(
              "w-full max-w-[calc(var(--pos)*0.82)]",
              /* Llena: la carta manda y toma la proporción 5:7. Vacía: una ficha baja. */
              c ? "aspect-[5/7]" : "h-[calc(var(--pos)*0.34)]",
              i >= enMóvil && "nx-pos-extra",
            )}
          >
            {/*
              EL ASENTAMIENTO. Cuando la carta cae, el hueco DEVUELVE el golpe: un destello
              corto del filo de la placa, que se apaga solo. No es decoración: es lo que hace
              que la carta se lea como apoyada sobre algo y no pegada encima. Un único nodo,
              sin bucle, y solo en la posición que acaba de recibir carta.
            */}
            {ultima && (
              <motion.span
                key={`golpe-${c!.uid}`}
                aria-hidden
                className="pointer-events-none absolute -inset-1 rounded-[9px]"
                initial={{ opacity: 0.85, scale: 0.94 }}
                animate={{ opacity: 0, scale: 1.06 }}
                transition={{ duration: 0.5, ease: EASE.out }}
                style={{ boxShadow: `0 0 0 2px ${tone}, 0 0 22px -2px ${tone}` }}
              />
            )}

            {c && (
              <motion.div
                role="listitem"
                /*
                 * COLOCACIÓN. La carta llega desde su lado de la mesa, se posa y da un
                 * golpe corto. No aparece: se pone. La diferencia entre las dos cosas es
                 * justo lo que separa «una lista de cartas» de «una partida».
                 */
                initial={{ opacity: 0, y: side === "A" ? 54 : -54, scale: 1.18, rotateX: side === "A" ? -24 : 24 }}
                animate={{ opacity: 1, y: 0, scale: 1, rotateX: 0 }}
                transition={{ duration: 0.44, ease: EASE.out }}
                /*
                 * `absolute inset-0`: el envoltorio TIENE que tener el tamaño del hueco.
                 * Con `relative` su ancho era automático, así que el `!w-full` de la carta
                 * se resolvía contra un padre sin ancho y la carta colapsaba a cero: en la
                 * mesa solo quedaba flotando su insignia de resultado.
                 */
                className="absolute inset-0"
                style={{
                  transformPerspective: 900,
                  filter: ultima
                    ? `drop-shadow(0 8px 14px rgba(0,0,0,0.85)) drop-shadow(0 0 12px ${tone}55)`
                    : "drop-shadow(0 7px 12px rgba(0,0,0,0.8))",
                }}
              >
                {/* La carta llena su posición: el hueco manda sobre el tamaño, no al revés. */}
                <DuelCard
                  card={c}
                  size="xs"
                  highlightStat={turno ? (side === "A" ? turno.you.stat : turno.rival.stat) : null}
                  className="!w-full"
                />

                {/* Filo de resultado: el borde inferior se tiñe con lo que pasó ese turno. */}
                {marca && (
                  <>
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] rounded-b-xl"
                      style={{ background: marca.color, boxShadow: `0 0 10px ${marca.color}` }}
                    />
                    <span
                      className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full border font-display text-[8px] font-bold"
                      style={{ background: "#0b0f18", borderColor: marca.color, color: marca.color }}
                      title={`${marca.titulo} · turno ${turno?.number}`}
                    >
                      {marca.letra}
                    </span>
                  </>
                )}
              </motion.div>
            )}
          </Slot>
        );
      })}
    </div>
  );
}
