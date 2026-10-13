"use client";

/**
 * LAS CINCO CARTAS — el acto que faltaba.
 *
 * ────────────────────────── QUÉ RESOLVÍA ──────────────────────────
 *
 * La ceremonia iba de la ROTURA del sobre directamente al giro de la primera carta. Entre
 * «el sobre se ha partido» y «esta es tu primera carta» no había nada: las otras cuatro no
 * existían en pantalla hasta que les llegaba el turno, y cuando llegaba, aparecían de la
 * nada. El jugador nunca veía lo que le había tocado como un CONJUNTO — que es exactamente
 * lo que se compra al comprar un sobre.
 *
 * Esta pieza es ese momento: las cartas SALEN del sobre, boca abajo, y se quedan ahí.
 *
 * ────────────────────────── DOS MODOS, UNA PIEZA ──────────────────────────
 *
 *   `hand`   El abanico a tamaño de objeto, justo después de la rotura. Las cartas emergen
 *            del punto donde estaba el sobre y se despliegan. Es el acto 5 del guion.
 *   `strip`  El mismo abanico reducido al pie mientras se revela una a una. Resuelve el
 *            «mantener las otras cartas visibles pero atenuadas»: las demás SIGUEN AHÍ, y
 *            cada una se tiñe con el color de su rareza en cuanto se descubre.
 *
 * El `strip` sustituye a la fila de puntos que tenía `CardReveal`. Un punto que representa
 * una carta y la carta misma son el mismo dato contado dos veces, y de las dos formas la
 * buena es la que enseña la carta.
 *
 * ────────────────────────── MÓVIL SIN CORTES ──────────────────────────
 *
 * Cinco o seis cartas de frente a 390 px no caben a tamaño fijo, y un carril con `overflow-x`
 * corta la primera y la última —es el fallo que `globals.css` ya documenta para la mesa de
 * duelo—. Se resuelve con dos cosas a la vez:
 *
 *   · **SOLAPAMIENTO.** Las cartas se pisan como una mano real (margen negativo) y a partir
 *     de `sm` se separan.
 *   · **REPARTO DEL ANCHO.** Cada carta es `flex-1` con un techo (`max-w`), así que su ancho
 *     sale de dividir el espacio DISPONIBLE, no de una constante. Con la primera versión
 *     —anchos fijos de 84 px— seis cartas medían 384 px dentro de un hueco de 358 y la
 *     primera y la última se salían del cuadro: el escenario es `overflow-hidden`, así que
 *     no había scroll que lo delatara, solo dos cartas cortadas. Medido a 390 px con el
 *     sobre Premium, que es el de seis.
 *
 * La proporción la mantiene `aspect-[5/7]` del propio dorso, así que al estrecharse la carta
 * baja de alto sola y tampoco aparece scroll vertical.
 *
 * No decide nada: recibe cuántas cartas hay y en qué estado está cada una. El color de
 * rareza lo trae ya resuelto quien llama, desde la variante REAL del dominio.
 */
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/format";
import { CardBack } from "./CardBack";
import { EASE } from "@/design/motion";

/** El estado de UNA carta del abanico. Lo decide la ceremonia, no esta pieza. */
export interface HandSlot {
  /** Ya se ha revelado: el hueco se tiñe con el color de su rareza real. */
  revealed: boolean;
  /** Color de la rareza real, si ya se reveló. Si no, se usa el acento del sobre. */
  color?: string;
}

export function PackHand({
  slots,
  accent,
  mode,
  activeIndex = -1,
  charge = 0,
  chargeColor,
  className,
}: {
  slots: HandSlot[];
  accent: string;
  mode: "hand" | "strip";
  /** Cuál se está revelando ahora (solo `strip`). */
  activeIndex?: number;
  /** Carga de anticipación de la carta activa, 0-1. */
  charge?: number;
  chargeColor?: string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const n = slots.length;
  /* El centro del abanico: es desde donde salen las cartas y hacia donde colapsan. */
  const centro = (n - 1) / 2;

  return (
    <div
      className={cn(
        "flex w-full items-end justify-center px-2",
        // Un techo para que en pantallas muy anchas el abanico no se vuelva un mural.
        mode === "hand" ? "max-w-[980px] sm:gap-3" : "max-w-[420px] gap-1 sm:gap-1.5",
        className,
      )}
      aria-hidden
    >
      {slots.map((slot, i) => {
        const activa = mode === "strip" && i === activeIndex;
        const color = slot.revealed ? (slot.color ?? accent) : accent;

        /*
          LA SALIDA DEL SOBRE. Cada carta arranca en el centro del abanico —donde estaba el
          sobre— encogida y girada, y viaja a su hueco. El desplazamiento inicial se expresa
          en PORCENTAJE del ancho de la propia carta, así que funciona igual a 84 px en un
          móvil y a 124 en un escritorio sin calcular nada en JavaScript.
        */
        const entrada =
          mode === "hand"
            ? reduced
              // Fase 57.1 · reducido: suben poco (sin escala ni giro) y de una en una, para que se lea que salen del sobre.
              ? { initial: { opacity: 0, y: 40 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.45, delay: i * 0.12, ease: EASE.out } }
              : {
                  // Fase 57 · salen de la boca del sobre: desde abajo y juntas, inclinadas hacia atrás.
                  initial: { opacity: 0, x: `${(centro - i) * 104}%`, y: 150, scale: 0.5, rotateZ: 0, rotateX: 40 },
                  /*
                    El giro del abanico es CORTO a propósito (±4,5° en el sobre de seis). El
                    `transform` no lo ve el layout, así que cada grado de más es ancho que la
                    caja no ha reservado — y en las cartas de los extremos eso se convierte en
                    un corte contra el borde del escenario. El `px-2` del contenedor absorbe lo
                    que este ángulo se sale.
                  */
                  animate: { opacity: 1, x: "0%", y: 0, scale: 1, rotateZ: (i - centro) * 1.8, rotateX: 0 },
                  transition: { duration: 0.7, delay: 0.04 + i * 0.09, ease: EASE.out },
                }
            : { initial: false as const, animate: { opacity: 1 }, transition: { duration: 0.2 } };

        return (
          <motion.div
            key={i}
            className={cn(
              // `min-w-0 flex-1` + techo: el ancho se REPARTE, nunca se impone. Es lo que
              // garantiza que seis cartas quepan enteras a 390 px sin cortarse.
              "relative min-w-0 flex-1",
              // Margen negativo = mano de cartas. El primero nunca se desplaza.
              mode === "hand"
                ? "max-w-[148px] -ml-6 first:ml-0 sm:ml-0"
                : "max-w-[44px] -ml-2 first:ml-0 sm:ml-0",
            )}
            style={{ zIndex: activa ? 10 : i }}
            {...entrada}
          >
            <div
              className={cn(
                "transition-[opacity,transform] duration-normal ease-out",
                // Las ya reveladas y las pendientes se ATENÚAN: la activa es la protagonista.
                mode === "strip" && !activa && "opacity-45",
                mode === "strip" && activa && "-translate-y-1.5",
              )}
            >
              {/* `w-full`: la medida la pone el hueco que le reparte el abanico. */}
              <CardBack
                accent={color}
                charged={activa ? charge : 0}
                chargeColor={chargeColor}
                pulse={mode === "hand"}
                className="w-full"
              />
            </div>

            {/*
              MARCA DE REVELADA. Un filo del color de su rareza al pie de la carta. Es lo que
              convierte el abanico en el marcador de la ceremonia: de un vistazo se ve cuántas
              van, y de qué han sido.
            */}
            {mode === "strip" && slot.revealed && (
              <span
                aria-hidden
                className="absolute inset-x-1 -bottom-1 h-[3px] rounded-full"
                style={{ background: color, boxShadow: `0 0 10px ${color}` }}
              />
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
