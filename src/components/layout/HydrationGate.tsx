"use client";

import { useGameStore } from "@/store/useGameStore";

/**
 * Evita el desajuste de hidratación SSR/cliente: no renderiza los hijos
 * (que dependen del estado persistido en localStorage) hasta que Zustand
 * ha rehidratado en el cliente.
 */
export function HydrationGate({ children }: { children: React.ReactNode }) {
  const hydrated = useGameStore((s) => s.hydrated);

  if (!hydrated) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-drl border-t-transparent" />
          <p className="font-display text-sm uppercase tracking-widest text-white/50">
            Cargando DRL Champions
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
