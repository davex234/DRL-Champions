"use client";

/**
 * COMPRA DE SOBRES — un solo camino, reutilizable (Fase 21.1).
 *
 * El catálogo (`/packs`) y su ficha comparten esta orquestación para NO duplicar la lógica de
 * compra. No es lógica nueva: es exactamente la que ya usa la tienda —con sesión, el servidor
 * cobra y valida (`buyPackOnline`); sin ella, la economía local (`useGameStore.buyPack`)—. El
 * precio, el saldo, el ledger, la idempotencia y el ciclo de vida los decide el backend; aquí
 * solo se elige la ruta y se traduce el error para enseñarlo.
 */
import { useCallback } from "react";
import { useGameStore } from "@/store/useGameStore";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { buyPackOnline } from "@/lib/game/sync";
import { useServerEconomy, SESSION_PENDING } from "@/lib/game/serverEconomy";
import { ns } from "@/i18n/runtime";

const t = ns("game");

export interface PackPurchase {
  /** true si hay sesión: la compra la cobra y valida el servidor. */
  online: boolean;
  /** Compra un sobre por el flujo existente. Devuelve ok + mensaje de error legible si falla. */
  purchase: (packId: string, ref?: string) => Promise<{ ok: boolean; error?: string }>;
}

export function usePackPurchase(): PackPurchase {
  const { user } = useAuth();
  const online = isSupabaseConfigured() && !!user;
  const serverEconomy = useServerEconomy();
  const buyPackLocal = useGameStore((s) => s.buyPack);

  const purchase = useCallback(
    async (packId: string, ref?: string): Promise<{ ok: boolean; error?: string }> => {
      if (online) {
        try {
          await buyPackOnline(packId, ref);
          return { ok: true };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : t("No se pudo comprar el sobre") };
        }
      }
      if (serverEconomy) return { ok: false, error: SESSION_PENDING }; // F69 · sesión resolviéndose
      const res = buyPackLocal(packId);
      return res.ok ? { ok: true } : { ok: false, error: res.error ?? t("No se pudo comprar el sobre") };
    },
    [online, serverEconomy, buyPackLocal],
  );

  return { online, purchase };
}
