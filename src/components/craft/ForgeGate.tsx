"use client";

/**
 * FASE 69 · la Forja (`ForgePanel`) fabrica, mejora y desguaza cartas en el store LOCAL: con cuenta, eso inventaba
 * créditos y cartas en el HUD hasta la siguiente sincronización, y los materiales no los corregía nadie (no viven en
 * el servidor). No hay forja en el servidor, así que con cuenta la pestaña explica dónde está lo real: el desguace
 * del servidor vive en Inventario.
 */
import Link from "next/link";
import { ForgePanel } from "./ForgePanel";
import { Plate } from "@/components/ui/Surface";
import { useServerEconomy, SERVER_ECONOMY_ONLY } from "@/lib/game/serverEconomy";

export function ForgeGate() {
  const serverEconomy = useServerEconomy();
  if (!serverEconomy) return <ForgePanel />;
  return (
    <Plate className="p-5" data-testid="forge-server-notice">
      <p className="font-display text-sm font-bold uppercase tracking-[0.08em] text-white">La forja no está disponible con cuenta</p>
      <p className="mt-2 max-w-xl text-caption leading-relaxed text-ink-muted">{SERVER_ECONOMY_ONLY}</p>
      <p className="mt-3 text-caption text-ink-muted">
        Para convertir cartas repetidas en créditos usa el desguace de{" "}
        <Link href="/inventario" className="nx-action !text-drl">Inventario</Link>.
      </p>
    </Plate>
  );
}
