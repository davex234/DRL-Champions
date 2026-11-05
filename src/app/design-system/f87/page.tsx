"use client";

/**
 * F87 · ARNÉS QA DE PICK'EMS 2.0 (`/design-system/f87?scene=…&mode=desktop|mobile`). 404 en producción (middleware),
 * salvo `NEXUS_QA_HARNESS=1`. Monta las piezas REALES (`PredictView` → `PredictBoard` → `PredictMatchCard`) con vistas
 * construidas por el dominio (snapshot real de Champions 2026 + fixtures ficticios). Los picks del arnés usan la MISMA
 * invalidación de descendientes; no hay servidor: nada se guarda.
 *
 *   scene = playoffs | playoffs-anon | playoffs-progress | groups | groups-claimed | single | rr | void
 */
import { useEffect, useMemo, useState } from "react";
import { PredictView } from "@/components/pickems/predict/PredictScreen";
import { contextOfView } from "@/lib/pickems/bracketClient";
import { invalidatedBy, pendingPicks, scoreEntry } from "@/domain/pickems/prediction";
import { scene as build, SCENES } from "./fixtures";

export default function F87Harness() {
  const [name, setName] = useState<string | null>(null);
  const [mode, setMode] = useState<"desktop" | "mobile" | undefined>(undefined);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const s = q.get("scene") ?? "playoffs";
    setName((SCENES as readonly string[]).includes(s) ? s : "playoffs");
    const m = q.get("mode");
    setMode(m === "mobile" || m === "desktop" ? m : undefined);
  }, []);
  const built = useMemo(() => (name ? build(name) : null), [name]);
  const [picks, setPicks] = useState<Record<string, string> | null>(null);
  const [notice, setNotice] = useState<{ matchId: string; status: "saved" | "saving" | "error"; message: string } | null>(null);
  if (!built) return null;
  const v = built.view;
  const ctx = contextOfView(v);
  const p = picks ?? built.picks;
  const locked = new Set(v.nodes.filter((n) => n.locked).map((n) => n.matchId));
  const live = v.me ? scoreEntry(ctx, p, (id) => locked.has(id)) : null;
  const pending = v.me ? pendingPicks(ctx, p, (id) => !locked.has(id)).length : 0;
  const onPick = (matchId: string, teamId: string | null) => {
    const { next, cleared } = invalidatedBy(ctx, p, matchId, teamId, (id) => !locked.has(id));
    setPicks(next);
    setNotice({ matchId, status: "saved", message: cleared.length ? `Guardado (arnés) · ${cleared.length} posterior(es) quitada(s)` : "Guardado (arnés)" });
  };
  return (
    <main data-harness="f87" data-scene={name} className="min-h-screen px-4 py-6 sm:px-6 lg:py-10">
      <p className="nx-label mb-3 text-warn" data-testid="harness-note">
        Arnés de QA · {name?.startsWith("playoffs") || name === "void" ? "playoffs reales de Champions 2026 con cruces de perdedores DE PRUEBA" : name?.startsWith("groups") ? "fase de grupos REAL de Champions 2026" : "fixture ficticio"}
        {name === "playoffs-progress" ? " · resultados de cuartos SIMULADOS" : ""} · nada se guarda
      </p>
      <PredictView v={v} ctx={ctx} picks={p} notice={notice} inFlight={null} signedIn={!!v.me} live={live} pending={pending}
        onPick={onPick} onClaim={() => setNotice({ matchId: "", status: "saved", message: "Reclamo (arnés)" })} claiming={false} claimMsg={null} forceMode={mode} />
    </main>
  );
}
