"use client";

import { usePathname } from "next/navigation";
import { useGameStore } from "@/store/useGameStore";
import { GameLoader } from "@/components/ui/game/GameLoader";
import { GamePanelState } from "@/components/ui/game/GameStates";
import { useEconomyView } from "@/lib/game/serverEconomy";
import { ECONOMY_UNAVAILABLE } from "@/lib/game/localEconomy";
import { hydrateAccount } from "@/lib/game/sync";
import { ns, td } from "@/i18n/runtime";
import { useI18nReady, useLocale } from "@/i18n/react";

const t = ns("layout");

/**
 * Evita el desajuste de hidratación SSR/cliente: no renderiza los hijos
 * (que dependen del estado persistido en localStorage) hasta que Zustand
 * ha rehidratado en el cliente.
 *
 * Fase 44 · mientras tanto, el cargador de juego (marca NEXUS), no un spinner.
 *
 * F81.2 · y hasta saber DE QUIÉN es el inventario: con sesión (o sesión resolviéndose) los hijos no se pintan con la
 * caché ni con la demo, solo con el estado del servidor de esta cuenta (`useEconomyView`); el visitante confirmado sigue
 * en su modo demo. Si la cuenta no se puede recuperar: reintento, nunca carga infinita ni cifras inventadas. El panel
 * de administración no lleva CloudSync (otro armazón) ni inventario: solo espera a la rehidratación.
 */
export function HydrationGate({ children }: { children: React.ReactNode }) {
  useLocale();
  const hydrated = useGameStore((s) => s.hydrated);
  // I18N · el idioma inicial se decide antes de pintar: nunca se ve una pantalla en español que luego cambia.
  const i18nReady = useI18nReady();
  const view = useEconomyView();
  const pathname = usePathname() ?? "";
  const admin = pathname === "/admin" || pathname.startsWith("/admin/");

  if (!hydrated || !i18nReady) return <GameLoader label={t("Cargando NEXUS")} />;
  if (admin || view === "server" || view === "guest") return <>{children}</>;
  if (view === "unknown") return <GameLoader label={t("Cargando tu cuenta")} />;

  return (
    <GamePanelState
      role="alert"
      testId="economy-unavailable"
      glyph="alert"
      tone="key"
      eyebrow={t("Tu cuenta")}
      title={t("No se ha podido cargar")}
      hint={td(ECONOMY_UNAVAILABLE)}
      primary={view === "error"
        ? { label: t("Reintentar"), onClick: () => void hydrateAccount() }
        : { label: t("Reintentar"), onClick: () => window.location.reload() }}
      secondary={[{ label: t("Volver al lobby"), href: "/" }]}
    />
  );
}
