"use client";

/**
 * ARNÉS QA · FASE 42 — `/design-system/fase42?scene=<escena>` (solo capturas y revisión).
 *
 * LIVE SERVICE sobre las piezas REALES: vestíbulo (`DailyLobby` + `buildDailyLoop`) y «Qué sigue» (`NextUpAfter`)
 * debajo de un resultado. Hechos de cuenta QA SYNTHETIC (`./fixtures`). Sin sesión, sin red, sin BD. El reloj que se
 * pinta es la estimación del servidor (`estimateServerNow`) aunque la escena desvíe el reloj del navegador.
 */
import { useEffect, useMemo, useState } from "react";
import { MotionConfig } from "framer-motion";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { DailyLobby } from "@/components/dailyLoop/DailyLobby";
import { NextUpAfter } from "@/components/liveService/NextUpAfter";
import { buildDailyLoop } from "@/domain/dailyLoop";
import { estimateServerNow } from "@/domain/season/time";
import { FASE42_SCENES, SCENES, type AfterScene, type HomeScene } from "./fixtures";

export default function Fase42QaPage() {
  return <HydrationGate><Harness /></HydrationGate>;
}

function Harness() {
  const [scene, setScene] = useState<string | null>(null);
  useEffect(() => { setScene(new URLSearchParams(window.location.search).get("scene") ?? "normal-today"); }, []);
  useEffect(() => {
    if (scene !== "keyboard") return;
    const id = window.setTimeout(() => document.querySelector<HTMLElement>('[data-testid="daily-lobby"] a[href], [data-testid="daily-lobby"] button')?.focus(), 900);
    return () => window.clearTimeout(id);
  }, [scene]);
  if (scene === null) return null;
  if (!(FASE42_SCENES as readonly string[]).includes(scene)) {
    return <p className="text-caption text-ink-muted">Escena desconocida. Disponibles: {FASE42_SCENES.join(", ")}</p>;
  }
  const s = SCENES[scene as keyof typeof SCENES];
  return (
    <MotionConfig reducedMotion="user">
      <div className="space-y-3" data-scene={scene}>
        <p className="border border-drl-gold/30 bg-drl-gold/[0.06] px-3 py-1 text-[11px] text-drl-gold/90" data-synthetic="true">
          QA SYNTHETIC · {s.note} · piezas y dominio reales, hechos de cuenta inventados
        </p>
        {s.kind === "home" ? <Home s={s} /> : <After s={s} />}
      </div>
    </MotionConfig>
  );
}

function Home({ s }: { s: HomeScene }) {
  const snap = useMemo(() => buildDailyLoop(s.facts), [s]);
  // El navegador «cree» que es serverNow + desvío; la foto se recibió en ese instante: la estimación vuelve a serverNow.
  const now = useMemo(() => {
    const clientNow = s.facts.now + (s.skewMs ?? 0);
    return estimateServerNow({ serverNow: snap.serverNow, receivedAt: clientNow }, clientNow);
  }, [s, snap]);
  return (
    <>
      {s.skewMs !== undefined && (
        <p className="text-[11px] text-ink-muted" data-testid="qa-clock">
          Reloj del navegador {new Date(s.facts.now + s.skewMs).toISOString().slice(11, 16)} UTC · serverNow {new Date(snap.serverNow).toISOString().slice(11, 16)} UTC · pintado con {new Date(now).toISOString().slice(11, 16)} UTC
        </p>
      )}
      <DailyLobby snap={snap} now={now} network={s.network ?? "online"} />
    </>
  );
}

function After({ s }: { s: AfterScene }) {
  const snap = useMemo(() => buildDailyLoop(s.facts), [s]);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <section className="nx-clip-sm border border-white/10 bg-black/40 p-5 text-center">
        <p className="font-display text-[12px] font-bold uppercase tracking-[0.18em] text-white/55">Resultado (maqueta)</p>
        <h1 className="mt-1 font-display text-[28px] font-bold uppercase text-white">{s.title}</h1>
      </section>
      <NextUpAfter context={s.context} snap={snap} />
    </div>
  );
}
