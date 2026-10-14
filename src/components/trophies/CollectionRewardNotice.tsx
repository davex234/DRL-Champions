"use client";

/**
 * COLECCIONES POR EQUIPO · aviso de una recompensa guardada en segundo plano («G2 completado · +300 XP de temporada ·
 * Insignia de EMEA desbloqueada»). Lo monta el armazón del juego (no las rutas inmersivas: no tapa la apertura de un
 * sobre ni un duelo; el aviso espera a la siguiente pantalla normal). Dura lo mismo que el de Colecciones: con el
 * arranque, la cortinilla tapa los primeros segundos.
 */
import { useEffect } from "react";
import { Toast } from "@/components/ui/Toast";
import { useToast } from "@/lib/useToast";
import { useCollectionRewardStore, type RewardSummary } from "@/lib/teamCollections/rewardNotice";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("coleccion");

/** Lo que se acaba de guardar, en una frase. La usan este aviso y la pantalla de Colecciones. */
export function rewardText(r: RewardSummary): string | null {
  const parts: string[] = [];
  if (r.first.length === 1) parts.push(t("{equipo} completado", { equipo: r.first[0] }));
  else if (r.first.length > 1) parts.push(t("{n} equipos completados", { n: r.first.length }));
  if (r.xp > 0) parts.push(t("+{xp} XP de temporada", { xp: r.xp }));
  for (const region of r.regions) parts.push(t("Insignia de {region} desbloqueada", { region: td(region) }));
  return parts.length ? parts.join(" · ") : null;
}

export const REWARD_NOTICE_MS = 6500;

export function CollectionRewardNotice() {
  useLocale();
  const { toast, notify } = useToast(REWARD_NOTICE_MS);
  const pending = useCollectionRewardStore((s) => s.pending);
  useEffect(() => {
    // Lo que quedó sin enseñar en esta pestaña (recarga o navegación completa) y lo que llegue mientras está montado.
    const v = useCollectionRewardStore.getState().take();
    const text = v ? rewardText(v) : null;
    if (text) notify(text);
  }, [pending, notify]);
  return <Toast toast={toast} />;
}
