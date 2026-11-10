"use client";

/**
 * MATERIAL DE LA CARTA — el tratamiento de superficie que le da su rareza.
 *
 * ────────────────────────── QUÉ FALLABA ──────────────────────────
 *
 * La versión anterior decidía los efectos con cinco banderas construidas a partir del NOMBRE
 * de la animación (`animation === "metallic"`, `["extended","winner",…].includes(...)`). Es un
 * mecanismo que se rompe en silencio: basta con que una variante use un nombre que nadie metió
 * en las listas para que no reciba nada. Y pasó:
 *
 *     animación    efectos   variantes
 *     metallic       1/5     Plata (rank 2)
 *     special        0/5     Prime (rank 10, /300) · Clutch King (rank 12, /120)
 *
 * **Clutch King, serie de 120, se dibujaba con menos tratamiento que una Plata.** No era una
 * decisión de diseño: era un hueco en una lista.
 *
 * ────────────────────────── CÓMO SE RESUELVE ──────────────────────────
 *
 * El material se deriva del **`rank`**, que es la ordenación real de rareza del dominio y un
 * número: no hay forma de que una variante quede fuera. `animation` deja de decidir si hay
 * tratamiento y pasa a decidir solo el SABOR (partículas, rayos), que es para lo que sirve.
 *
 *     rank  1      MATE        superficie seca
 *     rank  2–5    PULIDO      barrido metálico
 *     rank  6–9    ENERGÍA     + aura interior
 *     rank 10–12   PREMIUM     + filo energético (prime · clutch · top-* · masters-mvp)
 *     rank 13+     LEGENDARIA  + holo (+ rayos y partículas)
 *
 * Cualquier variante futura cae en su escalón sola. Y la escalera es monótona: una carta de
 * rank alto NUNCA puede recibir menos tratamiento que una de rank bajo.
 *
 * ────────────────────────── EL COSTE, Y CÓMO SE PAGA ──────────────────────────
 *
 * Medido en `/mercado` con 54 cartas: **39 capas con `mix-blend-mode` y 85 nodos movidos por
 * framer-motion a la vez**. El holo animaba `background-position`, que repinta cada fotograma,
 * y ni `aura` ni el holo estaban limitados por el tamaño —solo lo estaban los rayos y las
 * partículas—, así que las rejillas pagaban efectos pensados para una carta sola.
 *
 * La respuesta NO es quitarle el tratamiento premium a una carta rara: es que el MISMO material
 * se dibuje quieto cuando hay muchas cartas. `density` decide eso:
 *
 *     "detail"  una carta protagonista  → material animado completo
 *     "grid"    muchas cartas a la vez  → mismo material, ESTÁTICO (cero bucles)
 *     "list"    filas densas            → solo el tinte del material
 *
 * En `grid` no se monta un solo `motion.div`: los barridos y el holo son gradientes fijos con
 * el mismo ángulo y el mismo color que su versión animada. Se conserva lo que distingue una
 * rareza de otra —que es el aspecto— y se deja de pagar lo que no se mira —que es el bucle—.
 *
 * `prefers-reduced-motion` degrada a `grid` aunque el contexto sea `detail`: la preferencia
 * pide no ver movimiento, y aquí eso se puede conceder sin perder ni un dato ni una rareza.
 */
import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { VariantDef } from "@/domain/cards/types";

/** Escalones de material. Salen del `rank`, nunca de un nombre. */
export type CardMaterial = "mate" | "pulido" | "energia" | "premium" | "legendaria";

/** Cuánta carta hay en pantalla. Decide si el material se anima o se queda quieto. */
export type CardDensity = "detail" | "grid" | "list";

/**
 * El material que le toca a un rango.
 *
 * Exportada porque es la ESCALERA DE RAREZA del producto y hay un test que comprueba dos
 * cosas sobre ella: que es monótona (a más rank, nunca menos material) y que las 37 variantes
 * caen en un escalón. Mientras eso se cumpla, el fallo de `special` no puede repetirse.
 */
export function materialForRank(rank: number): CardMaterial {
  if (rank <= 1) return "mate";
  if (rank <= 5) return "pulido";
  if (rank <= 9) return "energia";
  if (rank <= 12) return "premium";
  return "legendaria";
}

/** Orden de los escalones, para poder compararlos. */
export const MATERIAL_ORDER: CardMaterial[] = ["mate", "pulido", "energia", "premium", "legendaria"];

/** Qué capas lleva cada material. `animation` solo añade sabor sobre esto. */
function capas(material: CardMaterial, animation: string) {
  const i = MATERIAL_ORDER.indexOf(material);
  return {
    /** Barrido metálico. Desde PULIDO. */
    sweep: i >= 1,
    /** Aura interior de color. Desde ENERGÍA. */
    aura: i >= 2,
    /** Filo energético en el canto. Desde PREMIUM — es lo que rescata a `special`. */
    edge: i >= 3,
    /** Holo tornasolado. Desde LEGENDARIA. */
    holo: i >= 4,
    /** Sabor: rayos giratorios. Caro, solo en cartas protagonistas. */
    rays: i >= 3 && ["cinematic", "legendary", "icon", "special"].includes(animation),
    /** Sabor: partículas ascendentes. La más cara de todas. */
    particles: i >= 2 && ["winner", "icon"].includes(animation),
  };
}

/**
 * El contexto EFECTIVO en el que se dibuja el material.
 *
 * Pura y exportada para que se pueda comprobar: la degradación por `prefers-reduced-motion`
 * es una promesa de accesibilidad, y una promesa que no tiene test es una intención.
 *
 *   · movimiento reducido ⇒ `grid` SIEMPRE. Quieto, pero con el material entero: la
 *     preferencia pide no ver movimiento, no perder la rareza de la carta.
 *   · `rich` (API anterior) manda sobre `density` si viene.
 */
export function resolveDensity(
  density: CardDensity,
  rich: boolean | undefined,
  reduced: boolean | null,
): CardDensity {
  if (reduced) return density === "list" ? "list" : "grid";
  if (rich === true) return "detail";
  if (rich === false) return "grid";
  return density;
}

export function CardEffects({
  variant,
  density = "grid",
  /** Compatibilidad: `rich` era la API anterior. `true` ⇒ `detail`. */
  rich,
}: {
  variant: VariantDef;
  density?: CardDensity;
  rich?: boolean;
}) {
  const reduced = useReducedMotion();
  const { palette, animation, rank } = variant;
  const color = palette.primary;

  const material = materialForRank(rank);
  const c = capas(material, animation);

  const efectivo = resolveDensity(density, rich, reduced);
  const animado = efectivo === "detail";

  if (efectivo === "list") {
    // Filas densas: solo el tinte, un nodo, cero coste.
    return (
      <div
        className="pointer-events-none absolute inset-0"
        style={{ boxShadow: `inset 0 0 18px ${color}22` }}
        aria-hidden
      />
    );
  }

  return (
    /*
     * Sin recorte propio: hereda el de la SUPERFICIE de la carta, que ya lleva el chaflán.
     * Antes tenía un `rounded-2xl` escrito a mano, desacoplado del marco: al cambiar la
     * geometría de la carta, los efectos habrían seguido recortando en redondo.
     */
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {/* Brillo interior. Sube con el material: es la base de toda la escalera. */}
      <div
        className="absolute inset-0"
        style={{ boxShadow: `inset 0 0 ${c.aura ? 48 : 24}px ${color}${c.aura ? "4d" : "22"}` }}
      />

      {/* PULIDO — barrido metálico. Animado solo cuando la carta es protagonista. */}
      {c.sweep && (animado ? (
        <motion.div
          className="absolute inset-y-0 w-1/3 -skew-x-12"
          style={{
            background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)",
            mixBlendMode: "overlay",
          }}
          animate={{ x: ["-160%", "360%"] }}
          transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut", repeatDelay: 1.2 }}
        />
      ) : (
        /* Mismo barrido, quieto y sin mezcla: un gradiente y nada más. */
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(115deg, transparent 32%, rgba(255,255,255,0.22) 47%, transparent 62%)" }}
        />
      ))}

      {/* ENERGÍA — aura de color. Late en detalle; en rejilla se queda encendida. */}
      {c.aura && (animado ? (
        <motion.div
          className="absolute inset-0"
          style={{ boxShadow: `inset 0 0 60px ${color}` }}
          animate={{ opacity: [0.25, 0.6, 0.25] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        />
      ) : (
        <div className="absolute inset-0" style={{ boxShadow: `inset 0 0 46px ${color}`, opacity: 0.42 }} />
      ))}

      {/*
        PREMIUM — filo energético en el canto.
        Es la capa que existe para que `special` (Prime, Clutch King) tenga tratamiento propio
        por encima de PULIDO. Es un `box-shadow` interior: no añade nodo ni pinta cada
        fotograma, así que puede quedarse también en las rejillas.
      */}
      {c.edge && (
        <div
          className="absolute inset-0"
          style={{ boxShadow: `inset 0 0 0 1.5px ${color}aa, inset 0 0 14px -2px ${color}` }}
        />
      )}

      {/* LEGENDARIA — holo tornasolado. */}
      {c.holo && (animado ? (
        <motion.div
          className="absolute inset-0 opacity-30"
          style={{
            background:
              "linear-gradient(115deg, transparent 25%, rgba(255,255,255,0.5) 45%, rgba(120,200,255,0.4) 50%, rgba(255,180,255,0.4) 55%, transparent 75%)",
            backgroundSize: "250% 250%",
            mixBlendMode: "overlay",
          }}
          animate={{ backgroundPosition: ["0% 0%", "200% 200%"] }}
          transition={{ duration: 5, repeat: Infinity, ease: "linear" }}
        />
      ) : (
        /*
          Quieto. Antes esto animaba `background-position`, que REPINTA cada fotograma y se
          ejecutaba en todas las rejillas: era el efecto más caro del sistema y el que menos
          se mira. Fijo se reconoce igual de bien.
        */
        <div
          className="absolute inset-0 opacity-[0.22]"
          style={{
            background:
              "linear-gradient(115deg, transparent 28%, rgba(255,255,255,0.45) 44%, rgba(120,200,255,0.38) 50%, rgba(255,180,255,0.38) 56%, transparent 74%)",
          }}
        />
      ))}

      {/* SABOR — rayos. Solo en la carta protagonista: es un nodo del doble de tamaño girando. */}
      {c.rays && animado && (
        <motion.div
          className="absolute left-1/2 top-1/2 h-[200%] w-[200%] -translate-x-1/2 -translate-y-1/2 opacity-25"
          style={{
            background: `conic-gradient(from 0deg, transparent 0deg, ${color} 5deg, transparent 11deg, transparent 28deg, ${color} 33deg, transparent 39deg)`,
            mixBlendMode: "screen",
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 22, repeat: Infinity, ease: "linear" }}
        />
      )}

      {/* SABOR — partículas. Catorce nodos en bucle: nunca fuera de la carta protagonista. */}
      {c.particles && animado && <InnerParticles color={color} />}
    </div>
  );
}

/**
 * Partículas ascendentes.
 *
 * Las posiciones son DETERMINISTAS a partir del índice, no aleatorias. Antes salían de
 * `Math.random()` dentro de un `useMemo`, y este es un componente cliente que Next también
 * renderiza en servidor: servidor y navegador generaban valores distintos y eso es una
 * discrepancia de hidratación esperando a que alguien monte una carta grande en SSR.
 */
function InnerParticles({ color }: { color: string }) {
  const dots = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => ({
        id: i,
        x: (i * 37) % 100,
        size: 2 + ((i * 7) % 3),
        duration: 2.5 + ((i * 13) % 25) / 10,
        delay: ((i * 11) % 20) / 10,
      })),
    [],
  );
  return (
    <>
      {dots.map((d) => (
        <motion.span
          key={d.id}
          className="absolute rounded-full"
          style={{
            left: `${d.x}%`,
            bottom: -6,
            width: d.size,
            height: d.size,
            background: color,
            boxShadow: `0 0 ${d.size * 2}px ${color}`,
          }}
          animate={{ y: [-0, -140], opacity: [0, 1, 0] }}
          transition={{ duration: d.duration, delay: d.delay, repeat: Infinity, ease: "easeOut" }}
        />
      ))}
    </>
  );
}
