"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";

/** Partículas ambientales flotando alrededor del sobre (fase 1). */
export function AmbientParticles({ color, count = 28 }: { color: string; count?: number }) {
  const particles = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: 2 + Math.random() * 4,
        duration: 4 + Math.random() * 5,
        delay: Math.random() * 4,
      })),
    [count],
  );

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {particles.map((p) => (
        <motion.span
          key={p.id}
          className="absolute rounded-full"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: p.size,
            height: p.size,
            background: color,
            boxShadow: `0 0 ${p.size * 2}px ${color}`,
          }}
          animate={{ y: [0, -40, 0], opacity: [0, 0.9, 0] }}
          transition={{ duration: p.duration, delay: p.delay, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

/** Explosión de partículas (fase 3, una sola vez). */
export function ParticleBurst({
  color,
  count = 60,
  big = false,
}: {
  color: string;
  count?: number;
  big?: boolean;
}) {
  const particles = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
        const dist = (big ? 260 : 160) + Math.random() * (big ? 320 : 200);
        return {
          id: i,
          x: Math.cos(angle) * dist,
          y: Math.sin(angle) * dist,
          size: 3 + Math.random() * (big ? 9 : 6),
          duration: 0.7 + Math.random() * 0.8,
        };
      }),
    [count, big],
  );

  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      {particles.map((p) => (
        <motion.span
          key={p.id}
          className="absolute rounded-full"
          style={{ width: p.size, height: p.size, background: color, boxShadow: `0 0 ${p.size * 2}px ${color}` }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
          animate={{ x: p.x, y: p.y, opacity: 0, scale: 0.2 }}
          transition={{ duration: p.duration, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}

const CONFETTI_COLORS = ["#ff2e63", "#19e3ff", "#ffd35c", "#37e6a0", "#7b5cff", "#ffffff"];

/** Confeti cayendo (cartas Winner). */
export function Confetti({ count = 70 }: { count?: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        delay: Math.random() * 0.6,
        duration: 1.6 + Math.random() * 1.8,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        rotate: Math.random() * 360,
        size: 6 + Math.random() * 8,
      })),
    [count],
  );
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((p) => (
        <motion.span
          key={p.id}
          className="absolute top-0"
          style={{ left: `${p.x}%`, width: p.size, height: p.size * 0.5, background: p.color }}
          initial={{ y: -30, opacity: 0, rotate: p.rotate }}
          animate={{ y: "110vh", opacity: [0, 1, 1, 0], rotate: p.rotate + 360 }}
          transition={{ duration: p.duration, delay: p.delay, ease: "easeIn" }}
        />
      ))}
    </div>
  );
}
