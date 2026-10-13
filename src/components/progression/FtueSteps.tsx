"use client";

/**
 * PRIMERA SESIÓN (Fase 27). Para una cuenta sin actividad, el hub explica el camino en cuatro
 * pasos —abrir el primer sobre, crear el equipo, jugar el primer duelo, progresar— marcando lo
 * hecho con datos reales (`ftueState`). No promete ninguna recompensa adicional: la de bienvenida
 * (6.000 créditos, 3 sobres iniciales + 1 estándar) ya está concedida por el servidor al registrarse.
 */
import Link from "next/link";
import { Stage } from "@/components/ui/Surface";
import type { FtueState } from "@/domain/progression/meta";

export function FtueSteps({ ftue, className }: { ftue: FtueState; className?: string }) {
  const done = ftue.steps.filter((s) => s.done).length;
  const next = ftue.steps.find((s) => !s.done) ?? null;
  return (
    <Stage tone="primary" grid className={`p-5 ${className ?? ""}`} data-ftue={done}>
      <span className="nx-label">Empieza aquí</span>
      <h2 className="mt-0.5 font-display text-h2 font-bold uppercase tracking-wide text-white">Tus primeros pasos</h2>
      <ol className="mt-3 grid gap-2 sm:grid-cols-4">
        {ftue.steps.map((s, i) => (
          <li key={s.id}>
            <Link
              href={s.href}
              aria-current={next?.id === s.id ? "step" : undefined}
              className={`nx-focus nx-clip-sm flex min-h-[56px] items-center gap-3 border px-3 py-2 transition ${
                s.done ? "border-ok/40 bg-ok/[0.06]" : next?.id === s.id ? "border-drl/60 bg-drl/[0.10]" : "border-white/10 bg-white/[0.02]"
              }`}
            >
              <span aria-hidden className={`nx-readout grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[12px] ${s.done ? "border-ok text-ok" : "border-white/20 text-white/70"}`}>
                {s.done ? "✓" : i + 1}
              </span>
              <span className={`text-[13px] ${s.done ? "text-white/60 line-through" : "text-white"}`}>{s.label}</span>
            </Link>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-caption text-ink-muted">
        {done} de {ftue.steps.length} hechos. Tu cuenta ya tiene los sobres y créditos de bienvenida.{" "}
        {/* Fase 40 · una sola guía: la primera sesión se sigue desde el vestíbulo (Player Journey). */}
        <Link href="/" className="nx-focus font-semibold text-drl-glow underline-offset-2 hover:underline" data-testid="ftue-to-journey">Seguir tu primera sesión en el vestíbulo ›</Link>
      </p>
    </Stage>
  );
}
