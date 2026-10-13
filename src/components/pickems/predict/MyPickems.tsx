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
import { ns, td, getIntlLocale } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("pickems");

const GROUP = (c: BracketCard): "active" | "upcoming" | "done" =>
  c.phase === "SETTLED" || c.phase === "CANCELLED" ? "done" : c.phase === "UPCOMING" ? "upcoming" : "active";
const TITLE = { active: "Activos", upcoming: "Próximos", done: "Completados" } as const;

export function MyPickems() {
  useLocale();
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
    <section aria-label={t("Mis Pick'ems")} className="space-y-4">
      <SectionTitle>{t("Pick'ems de cuadro")}</SectionTitle>
      {(["active", "upcoming", "done"] as const).map((g) => {
        const list = cards.filter((c) => GROUP(c) === g);
        if (!list.length) return null;
        return (
          <div key={g} className="space-y-2">
            <p className="nx-label">{td(TITLE[g])}</p>
            <ul className="grid gap-3 md:grid-cols-2">
              {list.map((c) => (
                <li key={c.id} className="nx-clip flex flex-col gap-2 p-4" style={{ background: "rgba(255,255,255,0.03)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.1)" }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="nx-label">{td(c.eventName) ?? t("Evento")} · {td(c.formatLabel)}</p>
                      <p className="truncate font-display text-lg font-bold uppercase text-white">{td(c.title)}</p>
                    </div>
                    <Badge tone={c.phase === "OPEN" ? "key" : c.phase === "SETTLED" ? "ok" : "muted"}>{td(PHASE_LABEL[c.phase])}</Badge>
                  </div>
                  <p className="text-sm text-ink-secondary">
                    {c.mine ? t("{picked} / {matches} predicciones · {points} pts{v}", { picked: c.mine.picked, matches: c.matches, points: c.mine.points, v: c.mine.pending ? t(" · {pending} por hacer", { pending: c.mine.pending }) : "" }) : t("{matches} partidos", { matches: c.matches })}
                    {c.nextLockAt ? t(" · cierra {undefined}", { undefined: new Date(c.nextLockAt).toLocaleString(getIntlLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) }) : ""}
                    {c.hasRewards ? (" " + t("· con recompensas")) : ""}
                  </p>
                  <div>
                    <NxButton variant={c.mine?.claimable || (c.phase === "OPEN" && (c.mine?.pending ?? 1) > 0) ? "primary" : "secondary"} size="sm" href={`/pickems/cuadro/${c.slug}`}>
                      {c.mine?.claimable ? t("Reclamar recompensa") : c.phase === "OPEN" ? (c.mine ? t("Seguir prediciendo") : t("Haz tus predicciones")) : t("Ver cuadro")}
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
