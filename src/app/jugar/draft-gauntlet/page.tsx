"use client";

/**
 * `/jugar/draft-gauntlet` — DRAFT GAUNTLET (Fase 39) · «CONSTRUYE. ADÁPTATE. SOBREVIVE.»
 *
 * La pantalla no decide nada: pinta la foto del servidor, abre la vista previa de una opción y, SOLO al confirmar,
 * manda `choiceId` + `expectedVersion` + `actionId`. Un 409 trae la foto fresca y se dice. El combate se juega en la
 * arena canónica (`/duelos/jugar?draft=1`); al volver, la lectura reconcilia el resultado.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { Loading, NeedsAccount } from "@/components/ui/States";
import { DraftGauntletScreen, type DraftNotice } from "@/components/draft/DraftGauntletScreen";
import { DraftError, abandonDraft, pickDraft, startDraft, startDraftMatch, useDraft, type DraftSnapshot } from "@/lib/draft/client";
import { draftKeyIntent, pickUiReducer, type PickUi } from "@/lib/draft/presentation";
import { DRAFT_MATCH_HREF } from "@/domain/draft/rules";
import { syncFromServer } from "@/lib/game/sync";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("jugar");

export default function DraftGauntletPage() {
  useLocale();
  const { user, loading } = useAuth();
  if (loading) return <Loading label={tr("Preparando Draft Gauntlet…")} />;
  if (!isSupabaseConfigured() || !user) return <NeedsAccount what={tr("jugar Draft Gauntlet")} />;
  return <DraftGauntletRoute />;
}

function DraftGauntletRoute() {
  useLocale();
  const router = useRouter();
  const { load, reload, setSnapshot } = useDraft();
  const snapshot = load.state === "loading" ? null : load.snapshot;
  const offline = load.state === "offline";
  const run = snapshot?.run ?? null;
  const optionCount = run?.status === "DRAFTING" ? run.offer.length : 0;

  const [ui, dispatch] = useReducer((s: PickUi, e: Parameters<typeof pickUiReducer>[1]) => pickUiReducer(s, e, optionCount), { phase: "browse" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<DraftNotice | null>(null);
  const [abandonOpen, setAbandonOpen] = useState(false);
  const inFlight = useRef(false);

  // Una oferta nueva (otra elección, otra pestaña) cierra la vista previa: nunca se confirma una carta que ya no está.
  const offerKey = run?.status === "DRAFTING" ? `${run.runId}:${run.pickIndex}` : "";
  useEffect(() => { dispatch({ type: "settled" }); }, [offerKey]);

  const act = useCallback(async (fn: () => Promise<DraftSnapshot | { snapshot: DraftSnapshot }>, after?: (s: DraftSnapshot) => void) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const r = await fn();
      const snap = "snapshot" in r && !("mode" in r) ? r.snapshot : (r as DraftSnapshot);
      setSnapshot(snap);
      after?.(snap);
    } catch (e) {
      if (e instanceof DraftError && e.snapshot) {
        setSnapshot(e.snapshot);
        setNotice({ tone: "warn", text: e.code === "STALE_VERSION" ? tr("La run cambió en otra pestaña. Se ha actualizado.") : e.message });
      } else if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setNotice({ tone: "warn", text: tr("Sin conexión. No se ha enviado nada.") });
      } else {
        setNotice({ tone: "error", text: e instanceof Error ? e.message : tr("No se pudo completar la acción") });
        void reload();
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
      dispatch({ type: "settled" });
    }
  }, [setSnapshot, reload]);

  const confirm = useCallback(() => {
    if (ui.phase !== "preview" || !run || run.status !== "DRAFTING") return;
    const choiceId = run.offer[ui.index];
    if (!choiceId) return;
    dispatch({ type: "send" });
    void act(() => pickDraft(choiceId, run.version));
  }, [ui, run, act]);

  const disabled = offline || !snapshot || !snapshot.available;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const editable = !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
      const intent = draftKeyIntent({ key: e.key, repeat: e.repeat, editable }, ui, { optionCount, disabled: disabled || busy || abandonOpen || run?.status !== "DRAFTING" });
      if (!intent) return;
      e.preventDefault();
      if (intent.type === "select") dispatch({ type: "select", index: intent.index });
      else if (intent.type === "cancel") dispatch({ type: "cancel" });
      else confirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ui, optionCount, disabled, busy, abandonOpen, run?.status, confirm]);

  return (
    <div className="px-0 py-2">
      <DraftGauntletScreen
        snapshot={snapshot}
        loading={load.state === "loading"}
        offline={offline}
        busy={busy}
        ui={ui}
        notice={notice ?? (load.state === "error" && snapshot ? { tone: "error", text: load.message } : null)}
        abandonOpen={abandonOpen}
        onRetry={() => void reload()}
        onStart={() => void act(async () => {
          // F72 · ENTRAR: el servidor valida saldo, crea la run y cobra UNA vez. Si otra pestaña la creó sin cobrarla
          // aún, volver a entrar la completa con la misma clave de run (nunca dos cargos). Luego el HUD se resincroniza.
          let s = await startDraft();
          if (s.run?.entry && !s.run.entry.paid) s = await startDraft();
          await syncFromServer().catch(() => undefined);
          return s;
        })}
        onSelect={(index) => dispatch({ type: "select", index })}
        onCancel={() => dispatch({ type: "cancel" })}
        onConfirm={confirm}
        onStartMatch={() => { if (run) void act(() => startDraftMatch(run.version), () => router.push(DRAFT_MATCH_HREF)); }}
        onResumeMatch={() => router.push(DRAFT_MATCH_HREF)}
        onAbandonRequest={() => setAbandonOpen(true)}
        onAbandonCancel={() => setAbandonOpen(false)}
        onAbandonConfirm={() => { if (run) void act(() => abandonDraft(run.version), () => setAbandonOpen(false)); }}
      />
    </div>
  );
}
