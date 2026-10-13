"use client";

/**
 * ARNÉS QA · FASE 36 — `/design-system/fase36?scene=<escena>` (solo capturas y revisión).
 *
 * Renderiza el vestíbulo REAL (`DailyLobby`) con la acción decidida por el dominio REAL (`buildDailyLoop`)
 * sobre hechos QA SYNTHETIC (`./fixtures`). Sin sesión, sin red, sin BD. Cada escena lo dice arriba.
 */
import { useEffect, useState } from "react";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { DailyLobby, DailyLobbySkeleton } from "@/components/dailyLoop/DailyLobby";
import { buildDailyLoop } from "@/domain/dailyLoop";
import { QA_NOW, SCENES, SHOWCASE } from "./fixtures";

export default function Fase36QaPage() {
  return <HydrationGate><Harness /></HydrationGate>;
}

function Harness() {
  const [scene, setScene] = useState<string | null>(null);
  useEffect(() => { setScene(new URLSearchParams(window.location.search).get("scene") ?? "normal"); }, []);
  if (scene === null) return null;
  const s = SCENES[scene];
  if (!s) return <p className="text-caption text-ink-muted">Escena desconocida. Disponibles: {Object.keys(SCENES).join(", ")}</p>;
  return (
    <div className="space-y-3" data-scene={scene}>
      <p className="rounded border border-drl-gold/30 bg-drl-gold/[0.06] px-3 py-1 text-[11px] text-drl-gold/90" data-synthetic="true">
        QA SYNTHETIC · {s.note} · decisión del dominio real, datos inventados
      </p>
      {s.skeleton || !s.facts
        ? <DailyLobbySkeleton />
        : <DailyLobby snap={buildDailyLoop(s.facts)} now={s.facts.now || QA_NOW} network={s.network ?? "online"} stale={s.stale ?? false} showcase={s.showcase ? SHOWCASE : []} />}
    </div>
  );
}
