"use client";

/**
 * F83 · ARNÉS QA DE LA RUTA DE TEMPORADA (`/design-system/fase83?scene=…`). 404 en producción (middleware), salvo
 * `NEXUS_QA_HARNESS=1`. Monta las piezas REALES (`SeasonTrackScreen`, `SeasonPostMatch`, `SeasonLevelUp`) con vistas
 * construidas por el dominio sobre la plantilla real de la Temporada 2. Sin servidor ni BD.
 *
 *   scene = active | claim | fresh | max | grace | scheduled | none | postmatch | levelup | multilevel
 */
import { useEffect, useState } from "react";
import { SeasonTrackScreen } from "@/components/seasonTrack/SeasonTrackScreen";
import { SeasonLevelUp, SeasonPostMatchView } from "@/components/seasonTrack/SeasonMoments";
import { EmptyState } from "@/components/ui/States";
import { ACTIVE, CLAIM, FRESH, MAX, GRACE, SCHEDULED, NONE, POSTMATCH, MULTI } from "./fixtures";

const SCENES = ["active", "claim", "fresh", "max", "grace", "scheduled", "none", "postmatch", "levelup", "multilevel"] as const;
type Scene = (typeof SCENES)[number];
const DATA = { active: ACTIVE, claim: CLAIM, fresh: FRESH, max: MAX, grace: GRACE, scheduled: SCHEDULED } as const;

export default function Fase83Harness() {
  const [scene, setScene] = useState<Scene | null>(null);
  const [claiming, setClaiming] = useState<number | null>(null);
  const [moment, setMoment] = useState(true);
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("scene") as Scene;
    setScene(SCENES.includes(s) ? s : "active");
  }, []);
  if (!scene) return null;
  return (
    <main data-harness="fase83" data-scene={scene} className="min-h-screen px-4 py-6 sm:px-6 lg:py-10">
      {scene in DATA && <SeasonTrackScreen data={DATA[scene as keyof typeof DATA]} onClaim={(l) => { setClaiming(l); setTimeout(() => setClaiming(null), 800); }} claimingLevel={claiming} />}
      {scene === "none" && NONE.phase === "NONE" && <EmptyState icon="🗓️" title="Próxima temporada" hint="Todavía no hay una temporada de la ruta en curso. Vuelve pronto." action={{ href: "/", label: "Volver al inicio" }} />}
      {scene === "postmatch" && <div className="mx-auto max-w-md"><SeasonPostMatchView matchId="qa-m1" data={POSTMATCH} /></div>}
      {scene === "levelup" && moment && <SeasonLevelUp from={11} to={12} rewards={1} onClose={() => setMoment(false)} />}
      {scene === "multilevel" && <div className="mx-auto max-w-md"><SeasonPostMatchView matchId="qa-big" data={MULTI} /></div>}
    </main>
  );
}
