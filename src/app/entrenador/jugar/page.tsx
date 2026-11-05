"use client";

/**
 * `/entrenador/jugar` — QUICK PLAY (FASE 51.3, simplificado en 51.3.1).
 *
 *   JUGAR → elige composición → JUGAR → (revelación del mapa) → partido.
 *   Sin ninguna composición: JUGAR → elige 5 agentes → GUARDAR Y JUGAR → partido.
 *
 * ─────────────── ESTO NO ES UN EDITOR ───────────────
 *
 * La primera versión reutilizaba `CompositionBuilder` entero y, sin composiciones, JUGAR se convertía
 * en el editor avanzado: selector de mapa, nombre, huecos, buscador, filtros por clase y contadores.
 * Para EMPEZAR UNA PARTIDA eso son decisiones que nadie ha pedido. Aquí solo se elige: una
 * composición, o cinco agentes. El mapa y el nombre los pone el sistema (`quickPlay.ts`), la
 * plantilla no aparece —si la hay válida el partido la usa; si no, Equipo NEXUS— y la dificultad
 * vive en «Opciones», con su valor de siempre.
 *
 * La herramienta completa sigue intacta en `/entrenador/composiciones`.
 *
 * ─────────────── CARGANDO ≠ VACÍO ≠ ERROR ───────────────
 *
 * Si la lectura falla (con Supabase inalcanzable la ruta responde 401 «No autenticado») NO se dice
 * «crea tu primera composición»: eso haría pasar un fallo del servidor por «no tienes ninguna» y
 * empujaría a crear una que quizá ya existe. Se dice que no se ha podido cargar y se ofrece
 * reintentar. `quickPlayScreen` decide, y es puro.
 */
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/supabase/auth";
import { NeedsAccount } from "@/components/ui/States";
import { getTacticalMap } from "@/domain/tactics/maps";
import type { Composition } from "@/domain/tactics/composition";
import {
  playableCompositions, quickPlayHref, pickMapForNewComposition, quickPlayScreen,
  compositionsErrorText, autoCompositionName, DEFAULT_DIFFICULTY, DIFFICULTIES, type Difficulty,
} from "@/domain/tactics/quickPlay";
import { fetchCompositions, saveComposition, TacticsError } from "@/lib/tactics/client";
import { MapThumb } from "@/components/tactics/MapThumb";
import { CompositionStrip } from "@/components/tactics/CompositionBuilder";
import { QuickComposer } from "@/components/tactics/QuickComposer";
import { CoachHeader } from "@/components/coach/tc/CoachFrame";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { cn } from "@/lib/format";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("entrenador");

const DIF_LABEL: Record<Difficulty, string> = { easy: "Fácil", normal: "Normal", hard: "Difícil" };
/** Con Supabase caído la ruta tarda ~38 s en fallar: no se espera tanto para enseñar el error. */
const LECTURA_MS = 20000;

export default function JugarPage() {
  return (
    <Suspense fallback={null}>
      <HydrationGate>
        <Jugar />
      </HydrationGate>
    </Suspense>
  );
}

function Jugar() {
  useLocale();
  const router = useRouter();
  /* `?comp=` = la composición recién guardada en /entrenador/composiciones (?volver=jugar): llega elegida. */
  const compParam = useSearchParams().get("comp");
  const { user, loading: authLoading } = useAuth();

  const [comps, setComps] = useState<Composition[] | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<{ text: string; status: number | null } | null>(null);
  const [selId, setSelId] = useState<string | null>(compParam);
  const [difficulty, setDifficulty] = useState<Difficulty>(DEFAULT_DIFFICULTY);
  const [creando, setCreando] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const leer = useCallback(() => {
    setCargando(true);
    setError(null);
    return fetchCompositions({ signal: AbortSignal.timeout(LECTURA_MS) })
      .then((c) => { setComps(c); setError(null); })
      .catch((e: unknown) => {
        const status = e instanceof TacticsError ? e.status : null;
        setComps(null);
        setError({ text: compositionsErrorText(status), status });
      })
      .finally(() => setCargando(false));
  }, []);

  useEffect(() => { if (user) void leer(); }, [user, leer]);

  const jugables = useMemo(() => playableCompositions(comps ?? []), [comps]);
  const otras = useMemo(() => (comps ?? []).filter((c) => !jugables.includes(c)), [comps, jugables]);
  const sel = jugables.find((c) => c.id === selId) ?? null;
  /* Con una sola composición jugable ya está elegida: un toque menos. */
  useEffect(() => {
    if (jugables.length === 0 || (selId && jugables.some((c) => c.id === selId))) return;
    if (jugables.length === 1) setSelId(jugables[0].id);
  }, [jugables, selId]);

  const jugar = (c: Composition) => {
    const href = quickPlayHref(c, difficulty);
    if (href) router.push(href);
  };

  /** Guardar y jugar: el nombre y el mapa los pone el sistema; no se pregunta nada. */
  const guardarYJugar = async (agentIds: string[]) => {
    setSaving(true); setSaveError(null);
    try {
      const guardada = await saveComposition({
        name: autoCompositionName((comps ?? []).map((c) => c.name)),
        mapId: pickMapForNewComposition(Math.random()),
        agentIds,
        notes: "",
      });
      const href = quickPlayHref(guardada, difficulty);
      if (href) router.push(href);
      else { setSaveError(t("La composición no ha quedado lista para jugar. Inténtalo otra vez.")); setSaving(false); }
    } catch (e) {
      setSaveError(e instanceof TacticsError ? e.message : t("No se ha podido guardar. Inténtalo otra vez."));
      setSaving(false);
    }
  };

  if (authLoading) return null;
  if (!user) return <NeedsAccount what={t("tus composiciones")} />;

  const pantalla = creando && !error && !cargando ? "create" : quickPlayScreen({ loading: cargando, error: !!error, playable: jugables.length });

  return (
    <div className="space-y-5" data-testid="play-flow" data-screen={pantalla}>
      <CoachHeader
        className="!mb-0"
        kicker={t("Tactical Coach · Jugar")}
        title={pantalla === "create" ? <>{t("Elige")} <span className="text-[#2fe0ff]">{t("5 agentes")}</span></> : <>{t("Elige")} <span className="text-[#2fe0ff]">{t("composición")}</span></>}
        line={pantalla === "create" ? t("Se guarda sola y empieza la partida. El mapa lo ponemos nosotros.") : t("Pulsa una y juega.")}
      />

      {/* ═══ CARGANDO: nada que decidir todavía ═══ */}
      {pantalla === "loading" && (
        <p className="nx-label text-white/45" data-testid="play-loading" aria-live="polite">{t("Cargando composiciones…")}</p>
      )}

      {/* ═══ ERROR ≠ VACÍO: se dice y se reintenta. Sin editor debajo ═══ */}
      {pantalla === "error" && error && (
        <div role="alert" className="nx-coach-panel mx-auto max-w-xl space-y-4 p-8 text-center" data-tone="mag" data-testid="play-error">
          <p className="nx-coach-kicker !text-[#ff5aa8]">{t("No se ha podido cargar")}</p>
          <h2 className="font-display text-xl font-bold uppercase tracking-wide text-white">{td(error.text)}</h2>
          <p className="text-sm text-white/55">{t("No hemos tocado nada: tus composiciones siguen donde estaban.")}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" className="nx-coach-btn" onClick={() => void leer()} data-testid="play-retry">{t("Reintentar")}</button>
            <Link href="/entrenador" className="nx-coach-btn" data-variant="ghost">{t("Volver al centro")}</Link>
          </div>
          {process.env.NODE_ENV !== "production" && error.status != null && (
            <p className="nx-label text-white/35" data-testid="play-error-diag">{t("GET /api/game/compositions ·")} {error.status}</p>
          )}
        </div>
      )}

      {/* ═══ ELIGE COMPOSICIÓN ═══ */}
      {pantalla === "choose" && (
        <>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" role="radiogroup" aria-label={t("Composición")} data-testid="play-comp-list">
            {jugables.map((c) => {
              const on = c.id === selId;
              const mapa = getTacticalMap(c.mapId);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setSelId(c.id)}
                    onDoubleClick={() => jugar(c)}
                    data-testid={`play-comp-${c.id}`}
                    className={cn("nx-coach-module group flex w-full items-center gap-3 p-3 text-left", on && "!shadow-[inset_0_0_0_2px_rgba(47,224,255,0.95),0_0_26px_-6px_rgba(47,224,255,0.9)]")}
                  >
                    {mapa && <span aria-hidden className="w-[62px] shrink-0 bg-[#070a10] p-0.5"><MapThumb map={mapa} /></span>}
                    <span className="min-w-0 flex-1">
                      <b className="block truncate font-display text-[15px] font-extrabold uppercase tracking-[0.04em] text-white">{c.name}</b>
                      <span className="mt-1.5 block"><CompositionStrip agentIds={c.agentIds} size={26} /></span>
                      <span className="nx-label mt-1 block !text-white/40">{mapa?.name ?? c.mapId}</span>
                    </span>
                    {on && <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#2fe0ff] text-[14px] font-bold text-[#021420]">✓</span>}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap items-center gap-4" data-testid="play-go-bar">
            <button
              type="button"
              className="nx-play-cta"
              disabled={!sel}
              style={sel ? undefined : { opacity: 0.4, filter: "none" }}
              onClick={() => sel && jugar(sel)}
              data-testid="play-start"
            >
              {t("Jugar")}
            </button>
            <button type="button" onClick={() => { setCreando(true); setSaveError(null); }} className="nx-coach-btn" data-variant="ghost" data-testid="play-new-comp">
              {t("+ Nueva composición")}
            </button>
            {!sel && <span className="text-[13px] text-white/55">{t("Elige una composición.")}</span>}
          </div>

          {otras.length > 0 && (
            <p className="text-[12.5px] text-white/45" data-testid="play-incomplete-comps">
              {t("{n, plural, one {{n} composición incompleta} other {{n} composiciones incompletas}}", { n: otras.length })}.{" "}
              <Link href="/entrenador/composiciones" className="text-[#2fe0ff] underline">{t("Completarlas en Composiciones")}</Link>
            </p>
          )}
        </>
      )}

      {/* ═══ ELIGE 5 AGENTES (sin composiciones, o «+ Nueva») ═══ */}
      {pantalla === "create" && (
        <>
          <QuickComposer onPlay={(ids) => void guardarYJugar(ids)} saving={saving} error={td(saveError)} />
          {jugables.length > 0 && (
            <button type="button" onClick={() => setCreando(false)} className="nx-coach-btn" data-variant="ghost" data-testid="play-back-list">
              {t("← Volver a mis composiciones")}
            </button>
          )}
        </>
      )}

      {/* ═══ OPCIONES: secundarias y cerradas. Ni plantilla, ni estrategias, ni plan ═══ */}
      {pantalla !== "loading" && pantalla !== "error" && (
        <details className="nx-coach-panel-flat group px-4 py-3" data-testid="play-options">
          <summary className="nx-focus flex min-h-[40px] cursor-pointer list-none items-center gap-2 font-display text-[12px] font-bold uppercase tracking-[0.16em] text-white/60">
            {t("Opciones")} <span aria-hidden className="transition-transform group-open:rotate-90">›</span>
            <span className="ml-auto font-normal normal-case tracking-normal text-white/40">{t("Rival")} {DIF_LABEL[difficulty].toLowerCase()}</span>
          </summary>
          <div className="mt-3">
            <p className="nx-coach-kicker mb-2">{t("Rival")}</p>
            <div role="radiogroup" aria-label={t("Dificultad del rival")} className="flex flex-wrap gap-1.5">
              {DIFFICULTIES.map((d) => (
                <button key={d} type="button" role="radio" aria-checked={difficulty === d} onClick={() => setDifficulty(d)} className="nx-coach-tool !px-4" data-testid={`play-dif-${d}`}>
                  {td(DIF_LABEL[d])}
                </button>
              ))}
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
