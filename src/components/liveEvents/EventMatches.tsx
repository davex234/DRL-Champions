"use client";

/**
 * PARTIDOS DEL EVENTO (Fase 30). Agrupados por fase y ronda tal como llegan; cada uno reutiliza
 * `MatchCard` (Fase 9) y enlaza al Match Center. La marca de predicción por partido sale del
 * snapshot (`pickem.byMatch`), corregida por el servidor. Fases largas se pliegan.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { MatchCard } from "@/components/tournaments/Match";
import { Rail } from "@/components/ui/Surface";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { Plate } from "@/components/ui/Surface";
import type { EventHubSnapshot, PickemView } from "@/server/services/liveEvents";

const PICK_LABEL: Record<PickemView["byMatch"][string]["state"], { label: string; tone: "info" | "ok" | "bad" | "muted" }> = {
  open: { label: "Puedes predecir", tone: "info" }, picked: { label: "Tu predicción", tone: "ok" }, locked: { label: "Predicción cerrada", tone: "muted" },
  correct: { label: "Acertaste", tone: "ok" }, wrong: { label: "Fallaste", tone: "bad" }, missed: { label: "Sin predicción", tone: "muted" },
};

const SHOW = 8;

export function EventMatches({ snap }: { snap: EventHubSnapshot }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const groups = useMemo(() => {
    const byStage = new Map<string, { name: string; rounds: Map<string, EventHubSnapshot["matches"]> }>();
    for (const m of snap.matches) {
      const sk = m.stage_id ?? "-";
      const st = byStage.get(sk) ?? { name: m.stageName ?? "Partidos", rounds: new Map() };
      const rk = m.round ?? "Partidos";
      const list = st.rounds.get(rk) ?? [];
      list.push(m); st.rounds.set(rk, list); byStage.set(sk, st);
    }
    const order = new Map(snap.stages.map((s, i) => [s.id, i]));
    return [...byStage.entries()].sort((a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99));
  }, [snap.matches, snap.stages]);

  if (snap.matches.length === 0) {
    return (
      <section aria-label="Partidos" data-testid="event-matches" data-count={0}>
        <SectionTitle>Partidos</SectionTitle>
        <Plate className="px-6 py-8 text-center"><p className="font-display text-h3 font-bold uppercase tracking-wide text-white">Sin partidos publicados</p><p className="mx-auto mt-1.5 max-w-[46ch] text-body text-ink-muted">El calendario todavía no está publicado.</p></Plate>
      </section>
    );
  }
  return (
    <section aria-label="Partidos" data-testid="event-matches" data-count={snap.matches.length} className="space-y-5">
      <SectionTitle>Partidos <span className="ml-2 text-ink-faint">({snap.matches.length})</span></SectionTitle>
      {groups.map(([stageKey, st]) => (
        <div key={stageKey} className="space-y-3">
          {groups.length > 1 && <Rail label={st.name} />}
          {[...st.rounds.entries()].map(([round, list]) => {
            const key = `${stageKey}:${round}`;
            const expanded = open[key] || list.length <= SHOW;
            const shown = expanded ? list : list.slice(0, SHOW);
            return (
              <section key={key} aria-label={round}>
                <p className="nx-label mb-2">{round} · {list.length}</p>
                <div className="grid gap-2">
                  {shown.map((m) => {
                    const pick = snap.pickem?.byMatch[m.id];
                    return (
                      <Link key={m.id} href={`/torneos/${snap.event.id}/partido/${m.id}`} className="nx-focus block" data-match={m.id} data-status={m.label}>
                        <MatchCard m={m} pick={pick ? PICK_LABEL[pick.state] : null} />
                      </Link>
                    );
                  })}
                </div>
                {!expanded && (
                  <button type="button" onClick={() => setOpen((o) => ({ ...o, [key]: true }))} className="nx-focus mt-2 min-h-[44px] font-display text-[11px] font-bold uppercase tracking-[0.12em] text-drl-cyan">
                    Ver los {list.length} partidos
                  </button>
                )}
              </section>
            );
          })}
        </div>
      ))}
    </section>
  );
}
