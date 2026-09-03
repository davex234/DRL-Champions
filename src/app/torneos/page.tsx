"use client";

/**
 * TORNEOS — el circuito (`public.events`), recompuesto en la Fase 10.
 *
 * ────────────────────────── QUÉ RESPONDE ──────────────────────────
 *
 * Una pregunta, y en menos de un segundo: **¿qué está pasando ahora mismo?**
 *
 * Hasta la Fase 10 esta pantalla era un LISTADO: un titular, tres grupos por estado y
 * tarjetas del mismo tamaño para el torneo que se está jugando esta noche y para uno que
 * terminó hace ocho meses. La información estaba toda, pero la respuesta había que
 * buscarla.
 *
 * Ahora hay dos planos:
 *
 *   · **El escenario** — el torneo que importa (el que está en curso; si no hay ninguno,
 *     el siguiente), con su partido en directo, sus fechas y la llamada a predecir. Es lo
 *     único a lo que se puede entrar sin leer.
 *   · **El resto** — próximos y finalizados, en filas compactas. Siguen estando enteros,
 *     pero dejan de competir con lo que está vivo.
 *
 * Los torneos con `source = 'demo'` llevan distintivo: los datos de demostración no se
 * presentan nunca como si fueran reales.
 *
 * Los datos son los mismos de antes y llegan por las mismas funciones.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { fetchTournaments, fetchPickemQuestions, type TournamentRow } from "@/lib/game/client";
import { Loading, ErrorState, EmptyState, DemoBadge, NeedsAccount } from "@/components/ui/States";
import { cn } from "@/lib/format";

/** Pick'em asociado a un torneo, con cuántas preguntas siguen abiertas. */
interface PickemInfo { id: string; open: number; total: number }

const GROUPS: [string, string, string][] = [
  ["ongoing", "En curso", "border-drl-cyan/40 bg-drl-cyan/10 text-drl-cyan"],
  ["upcoming", "Próximos", "border-white/15 bg-white/5 text-white/60"],
  ["finished", "Finalizados", "border-white/10 bg-white/5 text-white/40"],
];

/** Tinte de cada estado, para los acentos del escenario y las filas. */
const TINT: Record<string, string> = {
  ongoing: "25,227,255",
  upcoming: "255,138,61",
  finished: "150,160,180",
};

function formatRange(a: string | null, b: string | null): string {
  if (!a) return "Fechas por confirmar";
  const f = (s: string) => new Date(s).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
  return b ? `${f(a)} — ${f(b)}` : f(a);
}

export default function TorneosPage() {
  const configured = isSupabaseConfigured();
  const [rows, setRows] = useState<TournamentRow[]>([]);
  const [pickems, setPickems] = useState<Record<string, PickemInfo>>({});
  /** Nº de equipos por torneo: es parte de lo que define un torneo, junto a fechas y sede. */
  const [teams, setTeams] = useState<Record<string, number>>({});
  /** El partido que se está jugando AHORA en el torneo destacado, si lo hay. */
  const [live, setLive] = useState<{ eventId: string; teamA: string; teamB: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const list = await fetchTournaments();
      setRows(list);

      const sb = getSupabase();
      if (sb && list.length > 0) {
        const { data } = await sb.from("pickem_events")
          .select("id, event_id").in("event_id", list.map((t) => t.id));
        const entries = await Promise.all(
          ((data as { id: string; event_id: string }[]) ?? []).map(async (pe) => {
            const qs = await fetchPickemQuestions(pe.id);
            return [pe.event_id, {
              id: pe.id,
              open: qs.filter((q) => !q.locked).length,
              total: qs.length,
            }] as const;
          }),
        );
        setPickems(Object.fromEntries(entries));

        // Los equipos se cuentan a partir de los partidos publicados: no hace falta
        // una tabla de inscripciones para decir «8 equipos» en la tarjeta.
        const { data: ms } = await sb.from("matches")
          .select("event_id, team_a_id, team_b_id").in("event_id", list.map((t) => t.id));
        const byEvent: Record<string, Set<string>> = {};
        for (const m of ((ms ?? []) as { event_id: string; team_a_id: string | null; team_b_id: string | null }[])) {
          const set = (byEvent[m.event_id] ??= new Set<string>());
          if (m.team_a_id) set.add(m.team_a_id);
          if (m.team_b_id) set.add(m.team_b_id);
        }
        setTeams(Object.fromEntries(Object.entries(byEvent).map(([k, v]) => [k, v.size])));

        /*
         * El partido en directo. Es LA razón por la que alguien abre esta pantalla en
         * mitad de un torneo, y hasta la Fase 10 no aparecía por ninguna parte: había que
         * entrar en la ficha del torneo para descubrir que había algo en juego.
         */
        const { data: liveRows } = await sb.from("matches")
          .select("event_id, team_a, team_b").eq("status", "live")
          .in("event_id", list.map((t) => t.id)).limit(1);
        const lm = ((liveRows ?? []) as { event_id: string; team_a: string | null; team_b: string | null }[])[0];
        setLive(lm?.team_a && lm?.team_b
          ? { eventId: lm.event_id, teamA: lm.team_a, teamB: lm.team_b }
          : null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar los torneos");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (configured) load(); else setLoading(false); }, [configured, load]);

  // El destacado es el primero en curso; si no hay, el próximo más cercano.
  const featuredId = useMemo(() => {
    const ongoing = rows.find((t) => t.status === "ongoing");
    if (ongoing) return ongoing.id;
    return rows.find((t) => t.status === "upcoming")?.id ?? null;
  }, [rows]);

  const grouped = useMemo(
    () => GROUPS.map(([status, label, tone]) =>
      [status, label, tone, rows.filter((r) => r.status === status)] as const)
      .filter(([, , , list]) => list.length > 0),
    [rows],
  );

  const otros = useMemo(
    () => rows.filter((r) => !GROUPS.some(([s]) => s === r.status)), [rows]);

  const featured = useMemo(
    () => rows.find((t) => t.id === featuredId) ?? null, [rows, featuredId]);

  /** Lo que se lista abajo: todo menos el destacado, que ya tiene su escenario. */
  const groupedRest = useMemo(
    () => grouped
      .map(([status, label, tone, list]) =>
        [status, label, tone, list.filter((t) => t.id !== featuredId)] as const)
      .filter(([, , , list]) => list.length > 0),
    [grouped, featuredId],
  );

  return (
    <section className="animate-rise">
      <header className="mb-6">
        <span className="nx-label">Jugar</span>
        <h1 className="mt-1 font-display text-[clamp(28px,5vw,44px)] font-bold uppercase leading-none text-white">
          El circuito
        </h1>
        <p className="mt-2 max-w-2xl text-[15px] text-white/55">
          El competitivo de VALORANT, dentro de NEXUS. Acierta los ganadores y los puntos
          van a tu rango.
        </p>
      </header>

      {!configured ? (
        <NeedsAccount what="El circuito competitivo" />
      ) : loading ? (
        <Loading label="Cargando torneos" />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : rows.length === 0 ? (
        <EmptyState icon="🏆" title="Todavía no hay torneos"
          hint="Cuando se sincronice el circuito competitivo aparecerán aquí." />
      ) : (
        <div className="space-y-8">
          {/* ═══════════════ EL TORNEO QUE IMPORTA ═══════════════ */}
          {featured && (
            <Featured
              t={featured}
              pickem={pickems[featured.id]}
              teams={teams[featured.id]}
              live={live && live.eventId === featured.id ? live : null}
            />
          )}

          {groupedRest.map(([status, label, tone, list]) => (
            <div key={status}>
              <h2 className="mb-3 font-display text-sm uppercase tracking-widest text-white/40">
                {label} <span className="text-white/25">({list.length})</span>
              </h2>
              <div className="grid gap-2">
                {list.map((t) => (
                  <Row key={t.id} t={t} status={status} pickem={pickems[t.id]} teams={teams[t.id]} />
                ))}
              </div>
            </div>
          ))}

          {otros.length > 0 && (
            <div>
              <h2 className="mb-3 font-display text-sm uppercase tracking-widest text-white/40">
                Otros <span className="text-white/25">({otros.length})</span>
              </h2>
              <div className="grid gap-2">
                {otros.map((t) => (
                  <Row key={t.id} t={t} status={t.status} pickem={pickems[t.id]} teams={teams[t.id]} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * EL ESCENARIO DEL CIRCUITO.
 *
 * Un solo torneo, el que está vivo. Lleva lo que decide si merece la pena entrar: si hay
 * partido en directo, cuántas predicciones siguen abiertas y cuándo se juega. Todo lo
 * demás (equipos, sede, premio) va debajo como contexto, no como titular.
 */
function Featured({
  t, pickem, teams, live,
}: {
  t: TournamentRow;
  pickem?: PickemInfo;
  teams?: number;
  live: { teamA: string; teamB: string } | null;
}) {
  const tint = TINT[t.status] ?? TINT.upcoming;
  const open = pickem?.open ?? 0;

  return (
    <section
      className="nx-stage nx-stage-grid nx-clip relative overflow-hidden"
      style={{ ["--nx-tint" as string]: tint.replace(/,/g, " ") }}
      aria-label="Torneo destacado"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{ background: `radial-gradient(720px 340px at 10% 118%, rgb(${tint} / 0.30), transparent 66%)` }}
      />

      {/* La cinta de directo: lo único que caduca de esta pantalla. */}
      {live && (
        <div className="relative flex items-center gap-3 border-b border-white/10 bg-black/35 px-5 py-2.5 sm:px-8">
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-drl px-2.5 py-1 font-display text-[10px] font-bold uppercase tracking-label text-white">
            <span className="h-1.5 w-1.5 rounded-full bg-white motion-safe:animate-pulse-glow" />
            En directo
          </span>
          <span className="min-w-0 flex-1 truncate font-display text-[13px] font-bold uppercase tracking-[0.06em] text-white/85">
            {live.teamA} <span className="text-white/30">vs</span> {live.teamB}
          </span>
        </div>
      )}

      <div className="relative px-5 py-7 sm:px-8 sm:py-9">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="nx-label"
            style={{ color: `rgb(${tint})` }}
          >
            {t.status === "ongoing" ? "En curso" : t.status === "upcoming" ? "Próximo" : t.status}
          </span>
          {t.source === "demo" && <DemoBadge />}
          {t.region && <span className="nx-label">{t.region}</span>}
        </div>

        <h2 className="mt-2 font-display text-[clamp(26px,5.5vw,46px)] font-bold uppercase leading-[0.95] text-white">
          {t.name}
        </h2>

        <div className="mt-4 flex flex-wrap gap-x-8 gap-y-4">
          <div>
            <span className="nx-label block">Fechas</span>
            <span className="mt-1 block text-[14px] text-white/70">{formatRange(t.start_date, t.end_date)}</span>
          </div>
          {teams ? (
            <div>
              <span className="nx-label block">Equipos</span>
              <span className="nx-readout mt-1 block text-[20px] text-white">{teams}</span>
            </div>
          ) : null}
          {t.location && (
            <div>
              <span className="nx-label block">Sede</span>
              <span className="mt-1 block text-[14px] text-white/70">{t.location}</span>
            </div>
          )}
          <div>
            <span className="nx-label block">Predicciones</span>
            <span
              className="nx-readout mt-1 block text-[20px]"
              style={{ color: open > 0 ? "#19e3ff" : "rgba(255,255,255,0.35)" }}
            >
              {open > 0 ? `${open} abiertas` : pickem ? "Cerradas" : "—"}
            </span>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2.5">
          {open > 0 && (
            <Link
              href="/pickems"
              className="nx-clip-sm bg-drl px-6 py-3.5 font-display text-[14px] font-bold uppercase tracking-[0.14em] text-white shadow-glow transition duration-fast hover:brightness-110"
            >
              Hacer mis predicciones
            </Link>
          )}
          <Link
            href={`/torneos/${t.id}`}
            className={cn(
              "nx-clip-sm px-6 py-3.5 font-display text-[14px] uppercase tracking-[0.14em] transition duration-fast",
              open > 0
                ? "border border-white/18 font-bold text-white/80 hover:border-white/40 hover:text-white"
                : "bg-drl font-bold text-white shadow-glow hover:brightness-110",
            )}
          >
            Ver el torneo
          </Link>
        </div>
      </div>
    </section>
  );
}

/**
 * Una fila del resto del circuito.
 *
 * Compacta a propósito: un torneo que terminó hace ocho meses y el que se juega esta
 * noche no pueden ocupar lo mismo. Sigue llevando lo que se consulta —fechas, equipos y
 * si tiene predicciones abiertas— pero deja de competir con el escenario.
 */
function Row({
  t, status, pickem, teams,
}: {
  t: TournamentRow;
  status: string;
  pickem?: PickemInfo;
  teams?: number;
}) {
  const tint = TINT[status] ?? TINT.finished;
  const open = pickem?.open ?? 0;

  return (
    <Link
      href={`/torneos/${t.id}`}
      className="nx-clip-sm group flex flex-wrap items-center gap-x-4 gap-y-2 border border-white/[0.09] bg-white/[0.025] px-4 py-3 transition duration-fast hover:border-white/25 hover:bg-white/[0.05]"
    >
      <span
        aria-hidden
        className="h-8 w-[3px] shrink-0 rounded-full"
        style={{ background: `rgb(${tint})`, boxShadow: `0 0 10px rgb(${tint} / 0.7)` }}
      />

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <b className="truncate font-display text-[15px] font-bold uppercase tracking-[0.04em] text-white">
            {t.name}
          </b>
          {t.source === "demo" && <DemoBadge />}
        </span>
        <span className="mt-0.5 block text-[12px] text-white/40">
          {formatRange(t.start_date, t.end_date)}
          {t.region ? ` · ${t.region}` : ""}
          {teams ? ` · ${teams} equipos` : ""}
        </span>
      </span>

      {open > 0 && (
        <span className="nx-label shrink-0 !text-drl-cyan">
          {open} {open === 1 ? "predicción" : "predicciones"}
        </span>
      )}
      <span aria-hidden className="shrink-0 font-display text-[12px] text-white/25 transition-transform duration-fast group-hover:translate-x-1">
        →
      </span>
    </Link>
  );
}
