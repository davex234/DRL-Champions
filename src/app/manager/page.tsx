"use client";

/**
 * MÁNAGER — el hub de la CARRERA del entrenador (Career Fase 1/7).
 *
 * Si aún no existe entrenador, muestra la creación; si existe, su perfil/carrera. Solo
 * CONECTA el Manager Career Engine vía `useManagerStore`.
 */
import { useGameStore } from "@/store/useGameStore";
import { useManagerStore } from "@/store/useManagerStore";
import { CoachCreator } from "@/components/career/CoachCreator";
import { CoachProfile } from "@/components/career/CoachProfile";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("manager");

export default function ManagerPage() {
  useLocale();
  const hydrated = useGameStore((s) => s.hydrated);
  const hasCoach = useManagerStore((s) => s.career != null);

  if (!hydrated) {
    return <div className="grid h-64 place-items-center text-white/40">{t("Cargando carrera…")}</div>;
  }
  return hasCoach ? <CoachProfile /> : <CoachCreator />;
}
