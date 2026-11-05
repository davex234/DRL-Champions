"use client";

/**
 * ARNÉS QA · FASE 39 — `/design-system/fase39?state=<estado>` (solo capturas y revisión).
 *
 * Renderiza la sala de guerra REAL (`DraftGauntletScreen`, `GauntletMap`, `DraftResultBanner`) con fotos construidas
 * por el dominio real sobre el catálogo del código (`./fixtures`). Sin sesión, sin red, sin servidor. Los botones
 * del arnés solo mueven la vista previa local, para poder capturar la interacción.
 */
import { useEffect, useReducer, useState } from "react";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { DraftGauntletScreen } from "@/components/draft/DraftGauntletScreen";
import { DraftResultBanner } from "@/components/draft/DraftResultBanner";
import { pickUiReducer, type PickUi } from "@/lib/draft/presentation";
import { FASE39_STATES, fase39Fixture, type Fase39State } from "./fixtures";

export default function Fase39QaPage() {
  return <HydrationGate><Harness /></HydrationGate>;
}

function Harness() {
  const [state, setState] = useState<string | null>(null);
  useEffect(() => { setState(new URLSearchParams(window.location.search).get("state") ?? "landing"); }, []);
  if (state === null) return null;
  if (!(FASE39_STATES as readonly string[]).includes(state)) {
    return <p className="text-caption text-ink-muted">Estado desconocido. Disponibles: {FASE39_STATES.join(", ")}</p>;
  }
  return <Scene key={state} state={state as Fase39State} />;
}

function Scene({ state }: { state: Fase39State }) {
  const f = fase39Fixture(state);
  const optionCount = f.snapshot?.run?.offer.length ?? 0;
  const [ui, dispatch] = useReducer((s: PickUi, e: Parameters<typeof pickUiReducer>[1]) => pickUiReducer(s, e, optionCount), f.ui);
  const [abandonOpen, setAbandonOpen] = useState(!!f.abandonOpen);
  return (
    <div data-state={state} className="py-2">
      {f.result && (
        <div className="mx-auto mb-4 w-full max-w-[1180px]" data-testid="harness-arena-result">
          <p className="nx-label">Arena · resultado (dentro del ResultScreen canónico)</p>
          <DraftResultBanner copy={f.result} onBack={() => undefined} onRefresh={() => undefined} />
        </div>
      )}
      <DraftGauntletScreen
        snapshot={f.snapshot} ui={ui} busy={f.busy} offline={f.offline} loading={f.loading} notice={f.notice ?? null}
        abandonOpen={abandonOpen} forceArtFallback={f.forceArtFallback}
        onStart={() => undefined}
        onSelect={(index) => dispatch({ type: "select", index })}
        onCancel={() => dispatch({ type: "cancel" })}
        onConfirm={() => undefined}
        onStartMatch={() => undefined}
        onResumeMatch={() => undefined}
        onAbandonRequest={() => setAbandonOpen(true)}
        onAbandonConfirm={() => setAbandonOpen(false)}
        onAbandonCancel={() => setAbandonOpen(false)}
        onRetry={() => undefined}
      />
      <p className="pointer-events-none fixed bottom-2 left-2 max-w-[70vw] border border-drl-gold/30 bg-black/80 px-2 py-0.5 text-[10px] text-drl-gold/90" style={{ zIndex: 2147483000 }} data-synthetic="true">
        QA SYNTHETIC · {f.note}
      </p>
    </div>
  );
}
