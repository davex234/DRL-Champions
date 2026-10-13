"use client";

/**
 * REVISAR — el modo de presentación del entrenador.
 *
 * La pizarra es para dibujar; esto es para EXPLICAR. El mapa ocupa todo lo que puede, no
 * hay ninguna herramienta a la vista y solo se avanza: paso anterior, paso siguiente.
 *
 * ────────────────────────── LO QUE SE VE ES LO QUE SE GUARDÓ ──────────────────────────
 *
 * Cada paso pinta **su propio estado**, tal cual salió de la base de datos. No se
 * interpola, no se anima entre pasos y no se recalcula nada: si en el paso 3 el Centinela
 * estaba en el sitio B, en el paso 3 se ve en el sitio B. Un modo de revisión que
 * «reconstruye» el estado es un modo de revisión en el que no se puede confiar.
 *
 * El tablero va en `readOnly`: aquí no se mueve ni se borra nada. Zoom y pan sí, porque
 * enseñar una jugada es acercarse a un rincón concreto.
 */
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { Loading, ErrorState, NeedsAccount } from "@/components/ui/States";
import { Plate, Piece, Recessed } from "@/components/ui/Surface";
import { NxButton } from "@/components/ui/NxButton";
import { Badge } from "@/components/ui/Badge";
import { Readout } from "@/components/ui/Readout";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { StrategyBoard } from "@/components/tactics/StrategyBoard";
import { fitCamera, type Camera } from "@/components/tactics/MapCanvas";
import {
  getTacticalMap, availableMaps, SIDE_LABEL, countObjects, type TacticalMap,
} from "@/domain/tactics";
import { fetchStrats, StratError, type StratRow } from "@/lib/tactics/client";
import { cn } from "@/lib/format";

export default function RevisarPage() {
  return (
    <Suspense fallback={<Marco><Loading label="Cargando…" /></Marco>}>
      <Revisar />
    </Suspense>
  );
}

function Revisar() {
  const configured = isSupabaseConfigured();
  const { user } = useAuth();
  const params = useSearchParams();
  const idPedido = params.get("id");

  const [rows, setRows] = useState<StratRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [id, setId] = useState<string | null>(idPedido);
  const [step, setStep] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchStrats();
      setRows(r);
      setId((prev) => prev ?? r[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof StratError ? e.message : "No se pudieron cargar tus estrategias");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (configured && user) void load();
    else setLoading(false);
  }, [configured, user, load]);

  // FULL GAME AUDIT · con `?id=` desconocido ya no se abre OTRA estrategia en silencio: se dice que no existe.
  const row = useMemo(() => (id ? rows.find((r) => r.id === id) ?? null : rows[0] ?? null), [rows, id]);
  const missing = !!id && rows.length > 0 && !row;
  const map: TacticalMap = getTacticalMap(row?.plan.mapId ?? "") ?? availableMaps()[0];
  const [camera, setCamera] = useState<Camera>(() => fitCamera(map));

  useEffect(() => { setCamera(fitCamera(map)); setStep(0); }, [map.id, row?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Flechas del teclado: es como se pasa una presentación. */
  useEffect(() => {
    if (!row) return;
    const total = row.plan.steps.length;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown") setStep((i) => Math.min(total - 1, i + 1));
      if (e.key === "ArrowLeft" || e.key === "PageUp") setStep((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [row]);

  if (!configured) return <Marco><ErrorState message="Esta instalación no tiene servidor." /></Marco>;
  if (!user) return <Marco><NeedsAccount what="Tus estrategias" /></Marco>;
  if (loading) return <Marco><Loading label="Cargando estrategias…" /></Marco>;
  if (error) return <Marco><ErrorState message={error} onRetry={() => void load()} /></Marco>;

  if (!row) {
    return (
      <Marco>
        <Plate className="px-6 py-14 text-center">
          <p className="font-display text-h2 font-bold uppercase tracking-wide text-white">
            {missing ? "Esa estrategia no existe" : "No hay nada que revisar"}
          </p>
          <p className="mx-auto mt-1.5 max-w-[52ch] text-body text-ink-muted">
            {missing ? "Puede que la hayas borrado. Elige otra en la pizarra." : "Cuando guardes una estrategia en la pizarra podrás repasarla aquí paso a paso."}
          </p>
          <NxButton variant="primary" accent="gold" size="lg" href="/entrenador/strats" className="mt-5">
            Ir a la pizarra
          </NxButton>
        </Plate>
      </Marco>
    );
  }

  const total = row.plan.steps.length;
  const i = Math.min(step, total - 1);
  const actual = row.plan.steps[i];

  return (
    <Marco
      titulo={row.name}
      sub={`${map.name} · ${SIDE_LABEL[row.plan.side]} · ${total} paso${total === 1 ? "" : "s"}`}
      selector={
        /*
         * FASE 10 · El único `<select>` nativo del Entrenador. Un desplegable del sistema
         * operativo en medio de una herramienta táctil rompe el idioma y, en móvil, abre una
         * rueda nativa encima del mapa. Con dos o tres estrategias son botones; con más,
         * siguen siendo botones y el carril se desplaza.
         */
        rows.length > 1 ? (
          <Recessed depth="sm" className="flex max-w-full gap-1 overflow-x-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Estrategia">
            {rows.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => { setId(r.id); setStep(0); }}
                aria-pressed={r.id === row.id}
                className={cn(
                  "nx-clip-sm min-h-[44px] shrink-0 px-3 font-display text-[12px] font-bold uppercase tracking-wide transition duration-fast",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-drl-gold",
                  r.id === row.id ? "bg-drl-gold text-base-900" : "text-ink-muted hover:text-white",
                )}
              >
                {r.name}
              </button>
            ))}
          </Recessed>
        ) : null
      }
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="min-w-0 space-y-3">
          <StrategyBoard
            readOnly
            map={map}
            state={actual.state}
            camera={camera}
            onCamera={setCamera}
            tool={{ kind: "select" }}
            selectedId={null}
            /* En presentación el mapa manda todavía más que en el editor: aquí no hay nada que dibujar. */
            className="h-[min(60vh,500px)] w-full sm:h-[min(68vh,620px)] lg:h-[min(80vh,880px)]"
            actions={{
              onSelect: () => {}, onMove: () => {}, onPlacePlayer: () => {},
              onPlaceUtility: () => {}, onPlaceText: () => {}, onDraw: () => {},
            }}
          />

          {/* ── Línea de tiempo ── */}
          <Plate className="p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <NxButton
                variant="secondary"
                size="md"
                onClick={() => setStep((n) => Math.max(0, n - 1))}
                disabled={i === 0}
              >
                ← Anterior
              </NxButton>
              <span className="nx-label">Paso {i + 1} de {total}</span>
              <NxButton
                variant="secondary"
                size="md"
                onClick={() => setStep((n) => Math.min(total - 1, n + 1))}
                disabled={i >= total - 1}
              >
                Siguiente →
              </NxButton>
            </div>

            <ol className="flex gap-1.5 overflow-x-auto pb-1">
              {row.plan.steps.map((s, k) => (
                <li key={s.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => setStep(k)}
                    aria-pressed={k === i}
                    className={cn(
                      "nx-clip-sm min-h-[52px] px-3 py-1.5 text-left transition duration-fast",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-drl-gold",
                      k === i
                        ? "bg-drl-gold/12 shadow-[inset_0_0_0_1px_rgba(255,211,92,0.6)]"
                        : "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.3)]",
                    )}
                  >
                    <span className={cn("nx-label block", k === i && "!text-drl-gold")}>
                      Paso {k + 1}
                    </span>
                    <span className={cn(
                      "block whitespace-nowrap font-display text-[13px] font-bold",
                      k === i ? "text-white" : "text-ink-secondary",
                    )}>
                      {s.label}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </Plate>
        </section>

        <aside className="space-y-3">
          <Piece tone="gold" className="p-4">
            <Badge tone="gold">Paso {i + 1}</Badge>
            <h2 className="mt-2 font-display text-h1 font-bold uppercase leading-tight text-white">
              {actual.label}
            </h2>
            {actual.notes ? (
              <p className="mt-2 whitespace-pre-line text-body leading-relaxed text-ink-secondary">
                {actual.notes}
              </p>
            ) : (
              <p className="mt-2 text-body text-ink-faint">Este paso no lleva notas.</p>
            )}

            {/* Qué hay en el paso, con la pieza de la cifra competitiva. */}
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-edge pt-3 sm:grid-cols-4 lg:grid-cols-2">
              <Cifra t="Jugadores" v={actual.state.players.length} />
              <Cifra t="Utilidades" v={actual.state.utilities.length} />
              <Cifra t="Dibujos" v={actual.state.drawings.length} />
              <Cifra t="Notas" v={actual.state.annotations.length} />
            </dl>
          </Piece>

          {row.plan.description && (
            <Plate className="p-4">
              <SectionTitle as="h2">La jugada</SectionTitle>
              <p className="whitespace-pre-line text-body leading-relaxed text-ink-secondary">
                {row.plan.description}
              </p>
            </Plate>
          )}

          <Plate className="p-3">
            <Recessed depth="sm" className="px-3 py-2.5">
              <p className="text-caption leading-relaxed text-ink-muted">
                {countObjects(actual.state)} objetos en este paso. Usa las flechas del teclado
                para pasar, y Ctrl + rueda para acercarte.
              </p>
            </Recessed>
            <NxButton variant="secondary" size="md" block href="/entrenador/strats" className="mt-2">
              Editar en la pizarra →
            </NxButton>
          </Plate>
        </aside>
      </div>
    </Marco>
  );
}

function Cifra({ t, v }: { t: string; v: number }) {
  return (
    <div>
      <dt className="nx-label">{t}</dt>
      <dd><Readout size="sm" value={v} /></dd>
    </div>
  );
}

function Marco({
  children, titulo = "Revisar", sub, selector,
}: {
  children: React.ReactNode;
  titulo?: string;
  sub?: string;
  selector?: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      {/*
        FASE 10 · EJECUCIÓN, NO EDICIÓN. La cabecera dice en una tira de qué estrategia se
        trata y en qué modo se está; el resto del alto es del mapa.
      */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <Badge tone="gold" dot>Revisión</Badge>
            {sub && <span className="nx-label truncate">{sub}</span>}
          </span>
          <h1 className="mt-1 truncate font-display text-[clamp(20px,2.8vw,30px)] font-bold uppercase leading-none text-white">
            {titulo}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selector}
          <NxButton variant="secondary" size="md" href="/entrenador/strats">Pizarra →</NxButton>
        </div>
      </header>
      {children}
    </div>
  );
}
