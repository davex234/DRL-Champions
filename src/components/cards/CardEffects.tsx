"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import type { VariantDef } from "@/domain/cards/types";

/**
 * Capa de efectos visuales por rareza, superpuesta dentro del marco de la carta.
 *
 * - Bronce: brillo suave.
 * - Plata: metal pulido (barrido de luz).
 * - Oro: reflejos dorados.
 * - Winner: partículas.
 * - MVP: aura especial.
 * - Champions MVP / legendaria: efectos legendarios (rayos + aura).
 * - Icon: efectos exclusivos (holo + rayos + partículas).
 *
 * `rich` activa los efectos caros (partículas/rayos), reservados para cartas
 * grandes (revelado, inspección) para no penalizar las rejillas con muchas cartas.
 */
export function CardEffects({ variant, rich }: { variant: VariantDef; rich: boolean }) {
  const { animation, palette } = variant;
  const color = palette.primary;

  const sweep =
    animation === "metallic" || animation === "premium" || variant.id === "gold";
  const aura = ["extended", "winner", "cinematic", "legendary", "icon"].includes(animation);
  const rays = rich && ["cinematic", "legendary", "icon"].includes(animation);
  const particles = rich && ["winner", "icon"].includes(animation);
  const legendary = ["legendary", "icon"].includes(animation);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
      {/* Brillo suave interior (todas, intensidad por rareza) */}
      <div
        className="absolute inset-0"
        style={{
          boxShadow: `inset 0 0 ${aura ? 50 : 24}px ${color}${aura ? "55" : "22"}`,
        }}
      />

      {/* Barrido de luz metálico / dorado */}
      {sweep && (
        <motion.div
          className="absolute inset-y-0 w-1/3 -skew-x-12"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)",
            mixBlendMode: "overlay",
          }}
          animate={{ x: ["-160%", "360%"] }}
          transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut", repeatDelay: 1.2 }}
        />
      )}

      {/* Rayos giratorios (legendarias / icon) */}
      {rays && (
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

      {/* Aura pulsante (MVP+) */}
      {aura && (
        <motion.div
          className="absolute inset-0 rounded-2xl"
          style={{ boxShadow: `inset 0 0 60px ${color}` }}
          animate={{ opacity: [0.25, 0.6, 0.25] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      {/* Holo arcoíris exclusivo (icon / legendarias) */}
      {legendary && (
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
      )}

      {/* Partículas internas (Winner / Icon) */}
      {particles && <InnerParticles color={color} />}
    </div>
  );
}

function InnerParticles({ color }: { color: string }) {
  const dots = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        size: 2 + Math.random() * 3,
        duration: 2.5 + Math.random() * 2.5,
        delay: Math.random() * 2,
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
