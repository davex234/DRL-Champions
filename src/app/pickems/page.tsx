"use client";

/**
 * PICK'EMS — centro de predicciones.
 *
 * Lista los Pick'ems del circuito con MI estado en cada uno y permite predecir
 * aquí mismo, con el MISMO panel que usa la ficha del torneo
 * (`components/pickems/PickemPanel`). No hay dos implementaciones del guardado.
 *
 * Si solo hay un Pick'em, se abre directamente: en la demo no tiene sentido
 * obligar a un clic extra para llegar a la funcionalidad estrella.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { useAuth } from "@/lib/supabase/auth";
import {
  fetchPickemQuestions, fetchMyAnswers, fetchMyScore,
  type MyScore,
} from "@/lib/game/client";
import { maxPoints } from "@/domain/pickems/rewards";
import { PickemPanel } from "@/components/pickems/PickemPanel";
import { RankBadge } from "@/components/progression/RankBadge";
import { Loading, ErrorState, EmptyState, DemoBadge, NeedsAccount } from "@/components/ui/States";
import { Toast } from "@/components/ui/Toast";
import { useToast } from "@/lib/useToast";
import { cn } from "@/lib/format";

interface Row {
  id: string;
  eventId: string;
  eventName: string;
  isDemo: boolean;
  open: number;
  answered: number;
  questions: number;
  points: number;
  maxPoints: number;
}

export default function PickemsPage() {
  const configured = isSupabaseConfigured();
  const { user, profile, refreshProfile } = useAuth();
  const { toast, notify } = useToast();

  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const sb = getSupabase();
      if (!sb) { setRows([]); return; }

      const { data, error: qErr } = await sb
        .from("pickem_events")
        .select("id, title, locks_at, status, event_id, events(name, source)")
        .order("locks_at", { ascending: true });
      if (qErr) throw new Error(qErr.message);

      const base = (data ?? []) as unknown as {
        id: string; title: string; event_id: string;
        events: { name: string; source: string } | null;
      }[];

      // Las cifras por Pick'em (abiertas / respondidas / puntos) SOLO se pintan en el
      // selector, y el selector solo aparece con más de un Pick'em. Pedirlas cuando hay
      // uno solo — el caso de la demo — duplicaba exactamente las consultas que el panel
      // vuelve a hacer un instante después, y retrasaba la pantalla estrella sin pintar
      // nada nuevo.
      const detailed = base.length > 1;

      const enriched = await Promise.all(base.map(async (pe) => {
        const head = {
          id: pe.id,
          eventId: pe.event_id,
          eventName: pe.events?.name ?? pe.title,
          isDemo: pe.events?.source === "demo",
        };
        if (!detailed) {
          return { ...head, open: 0, answered: 0, questions: 0, points: 0, maxPoints: 0 } satisfies Row;
        }
        const questions = await fetchPickemQuestions(pe.id);
        const mine = user ? await fetchMyAnswers(pe.id) : {};
        const score = user ? await fetchMyScore(pe.id) : null;
        return {
          ...head,
          open: questions.filter((q) => !q.locked).length,
          answered: Object.keys(mine).length,
          questions: questions.length,
          points: score?.points ?? 0,
          maxPoints: maxPoints(questions.map((q) => q.points)),
        } satisfies Row;
      }));

      setRows(enriched);
      // Con un solo Pick'em, abrirlo directamente.
      setSelected((s) => s ?? (enriched.length === 1 ? enriched[0].id : null));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar los Pick'ems");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { if (configured) load(); else setLoading(false); }, [configured, load]);

  /*
   * Refresco tras una corrección: se actualiza la cabecera de rango y la lista, pero
   * NO se vuelve a poner la pantalla en «Cargando». Hacerlo desmontaba el panel, que
   * al remontarse volvía a avisar, y la pantalla entraba en un bucle de recargas.
   */
  const onScoreChange = useCallback((_s: MyScore | null) => {
    refreshProfile();
    load();
  }, [refreshProfile, load]);

  const active = rows.find((r) => r.id === selected) ?? null;

  return (
    <section className="animate-rise">
      <header className="mb-6">
        <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-white">
          Pick&apos;ems
        </h1>
        <p className="mt-1 text-white/50">
          Predice los resultados del competitivo, suma puntos y sube de rango.
        </p>
      </header>

      {!configured ? (
        <NeedsAccount what="Tus predicciones" />
      ) : loading ? (
        <Loading label="Cargando Pick'ems" />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
        <>
          {user && profile && (
            <div className="mb-6">
              <RankBadge points={profile.points ?? 0} compact />
            </div>
          )}

          {rows.length === 0 ? (
            <EmptyState icon="🗳️" title="Todavía no hay Pick'ems"
              hint="Aparecerán en cuanto haya un torneo con predicciones abiertas."
              action={{ href: "/torneos", label: "Ver torneos" }} />
          ) : (
            <>
              {/* Selector: solo si hay más de uno. */}
              {rows.length > 1 && (
                <div className="mb-5 space-y-2">
                  {rows.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setSelected(r.id)}
                      className={cn(
                        "w-full rounded-2xl border p-4 text-left transition",
                        selected === r.id
                          ? "border-drl/50 bg-drl/10"
                          : "border-white/10 bg-base-700/40 hover:border-white/25",
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn("rounded-full border px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-wider",
                          r.open > 0 ? "border-drl-cyan/40 bg-drl-cyan/10 text-drl-cyan"
                                     : "border-white/10 bg-white/5 text-white/40")}>
                          {r.open > 0 ? `${r.open} abiertas` : "Cerrado"}
                        </span>
                        {r.isDemo && <DemoBadge />}
                      </div>
                      <p className="mt-2 font-display text-lg font-bold uppercase tracking-wide text-white">
                        {r.eventName}
                      </p>
                      {user && (
                        <p className="mt-1 text-sm text-white/55">
                          {r.answered} de {r.questions} respondidas ·{" "}
                          <span className="text-drl-gold">{r.points} / {r.maxPoints} pts</span>
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {active && (
                <>
                  {rows.length === 1 && (
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <h2 className="font-display text-xl font-bold uppercase tracking-wide text-white">
                          {active.eventName}
                        </h2>
                        {active.isDemo && <DemoBadge />}
                      </div>
                      <Link href={`/torneos/${active.eventId}`}
                        className="nx-action">
                        Ver torneo y partidos →
                      </Link>
                    </div>
                  )}

                  {!user ? (
                    <NeedsAccount what="Tus predicciones" />
                  ) : (
                    <PickemPanel
                      pickemEventId={active.id}
                      userId={user.id}
                      onNotify={notify}
                      onScoreChange={onScoreChange}
                      eventName={active.eventName}
                      totalPoints={profile?.points ?? 0}
                    />
                  )}
                </>
              )}
            </>
          )}
        </>
      )}

      <Toast toast={toast} />
    </section>
  );
}
