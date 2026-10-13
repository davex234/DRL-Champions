"use client";

/**
 * F87 · «MIS PICK'EMS» en el hub de /pickems: los cuadros 2.0 publicados, en ACTIVOS / PRÓXIMOS / COMPLETADOS, con mi
 * progreso en cada uno (con sesión). Si no hay ninguno publicado no pinta NADA (el hub sigue como estaba).
 */
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/supabase/auth";
import { fetchBrackets, type BracketCard } from "@/lib/pickems/bracketClient";
import { PHASE_LABEL } from "@/domain/pickems/prediction";
import { NxButton } from "@/components/ui/NxButton";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { Badge } from "@/components/ui/Badge";

const GROUP = (c: BracketCard): "active" | "upcoming" | "done" =>
  c.phase === "SETTLED" || c.phase === "CANCELLED" ? "done" : c.phase === "UPCOMING" ? "upcoming" : "active";
const TITLE = { active: "Activos", upcoming: "Próximos", done: "Completados" } as const;

export function MyPickems() {
  const { user } = useAuth();
  const [cards, setCards] = useState<BracketCard[] | null>(null);
  useEffect(() => {
    let alive = true;
    setCards(null);
    fetchBrackets().then((r) => { if (alive) setCards(r.brackets); }).catch(() => { if (alive) setCards([]); });
    return () => { alive = false; };
  }, [user?.id]);
  if (!cards || cards.length === 0) return null;
  return (
    <section aria-label="Mis Pick'ems" className="space-y-4">
      <SectionTitle>Pick&apos;ems de cuadro</SectionTitle>
      {(["active", "upcoming", "done"] as const).map((g) => {
        const list = cards.filter((c) => GROUP(c) === g);
        if (!list.length) return null;
        return (
          <div key={g} className="space-y-2">
            <p className="nx-label">{TITLE[g]}</p>
            <ul className="grid gap-3 md:grid-cols-2">
              {list.map((c) => (
                <li key={c.id} className="nx-clip flex flex-col gap-2 p-4" style={{ background: "rgba(255,255,255,0.03)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.1)" }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="nx-label">{c.eventName ?? "Evento"} · {c.formatLabel}</p>
                      <p className="truncate font-display text-lg font-bold uppercase text-white">{c.title}</p>
                    </div>
                    <Badge tone={c.phase === "OPEN" ? "key" : c.phase === "SETTLED" ? "ok" : "muted"}>{PHASE_LABEL[c.phase]}</Badge>
                  </div>
                  <p className="text-sm text-ink-secondary">
                    {c.mine ? `${c.mine.picked} / ${c.matches} predicciones · ${c.mine.points} pts${c.mine.pending ? ` · ${c.mine.pending} por hacer` : ""}` : `${c.matches} partidos`}
                    {c.nextLockAt ? ` · cierra ${new Date(c.nextLockAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}
                    {c.hasRewards ? " · con recompensas" : ""}
                  </p>
                  <div>
                    <NxButton variant={c.mine?.claimable || (c.phase === "OPEN" && (c.mine?.pending ?? 1) > 0) ? "primary" : "secondary"} size="sm" href={`/pickems/cuadro/${c.slug}`}>
                      {c.mine?.claimable ? "Reclamar recompensa" : c.phase === "OPEN" ? (c.mine ? "Seguir prediciendo" : "Haz tus predicciones") : "Ver cuadro"}
                    </NxButton>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
