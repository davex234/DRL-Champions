"use client";

/**
 * FASE 62 · LO QUE ACABAS DE RECOGER.
 *
 * Tras un reclamo aceptado por el servidor, se enseña lo recibido con un peso proporcional (`rewardTier`):
 *   · minor    → una tira abajo que se va sola (2,4 s);
 *   · standard → la misma tira con énfasis;
 *   · major    → una tarjeta centrada con pausa (carta, varios sobres o muchos créditos), que se cierra al tocar.
 * Si entre lo recibido hay un SOBRE, «Abrir sobre» lleva a la ceremonia REAL (`/abrir/<id>`, F57): no hay apertura
 * paralela. Con movimiento reducido: fundidos, mismos tiempos de lectura. Nada se concede aquí.
 */
import { useEffect } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/format";
import { EASE } from "@/design/motion";
import { playSound } from "@/lib/sound";
import { RewardDisplay, rewardItemsFor } from "./RewardDisplay";
import { rewardTier } from "@/domain/rewards/display";
import type { Claimable } from "@/domain/progression/hub";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("rewards");

export function RewardReveal({ claimed, onClose }: { claimed: Claimable[]; onClose: () => void }) {
  useLocale();
  const reduced = !!useReducedMotion();
  const items = claimed.flatMap((c) => rewardItemsFor(c.reward, { seasonXp: c.seasonXp }));
  const tier = rewardTier(items);
  const pack = claimed.map((c) => c.reward.packId).find(Boolean) ?? null;

  useEffect(() => {
    playSound(tier === "major" ? "mission.complete" : "ui.confirm");
    if (tier === "major") return;
    const id = window.setTimeout(onClose, 2400);
    return () => window.clearTimeout(id);
  }, [tier, onClose]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "Enter") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const body = (
    <>
      <span className="nx-label !text-[10px] text-drl-gold">{claimed.length === 1 ? t("Recompensa recogida") : t("{length} recompensas recogidas", { length: claimed.length })}</span>
      <div className="mt-2 flex flex-col gap-2">
        {claimed.map((c) => (
          <div key={c.key} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[12.5px] text-white/80">{td(c.label)}</span>
            <RewardDisplay reward={c.reward} seasonXp={c.seasonXp} size={tier === "major" ? "md" : "sm"} />
          </div>
        ))}
      </div>
      {pack && (
        <Link href={`/abrir/${pack}`} className="nx-f62-cta is-gold mt-3 inline-flex" data-testid="reveal-open-pack">{t("Abrir sobre")}</Link>
      )}
    </>
  );

  if (tier === "major") {
    return (
      <motion.div
        role="dialog" aria-modal="true" aria-label={t("Recompensas recogidas")} data-testid="reward-reveal" data-tier={tier}
        className="fixed inset-0 z-[85] grid place-items-center bg-black/70 px-4"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}
      >
        <motion.div
          className="nx-f62-claims w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: reduced ? 0.2 : 0.34, ease: EASE.out }}
        >
          {body}
          <button type="button" onClick={onClose} className="nx-f62-cta mt-4 w-full">{t("Seguir")}</button>
        </motion.div>
      </motion.div>
    );
  }
  /* El centrado va en un contenedor que NO se anima: framer-motion escribe `transform` y pisaría un `-translate-x-1/2`. */
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[85] md:bottom-8 flex justify-center px-4">
      <motion.div
        role="status" aria-live="polite" data-testid="reward-reveal" data-tier={tier}
        className={cn("nx-f62-claims pointer-events-auto w-full max-w-[460px] p-4", tier === "standard" && "is-standard")}
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
        transition={{ duration: 0.22, ease: EASE.out }} onClick={onClose}
      >
        {body}
      </motion.div>
    </div>
  );
}
