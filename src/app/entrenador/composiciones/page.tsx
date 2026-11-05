"use client";

/**
 * `/entrenador/composiciones` — TEAM COMPOSITION LAB (Tactical Coach 4.0).
 *
 * Se ve, se crea, se edita, se duplica y se borra, por mapa. La regla la aplica el servidor (y desde
 * la Fase 51 valida el cuerpo crudo: solo agentes del roster activo, nada del modelo anterior); esta
 * pantalla usa las mismas funciones del dominio para avisar antes de enviar.
 *
 * FASE 51 · De gestor a laboratorio: la planta del mapa elegido manda en un panel propio (con cuántas
 * composiciones hay en él y los atajos a la pizarra y al estudio del mapa), los doce mapas son una
 * tira de miniaturas ligeras y cada composición es una ficha con sus cinco agentes a tamaño de
 * reconocer. Una composición antigua con agentes del modelo anterior lo dice con una etiqueta: ya no
 * se puede volver a guardar así hasta sustituirlos.
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/supabase/auth";
import { NeedsAccount } from "@/components/ui/States";
import { availableMaps } from "@/domain/tactics/maps";
import { isComplete, legacyAgentIds, type Composition } from "@/domain/tactics/composition";
import { CompositionBuilder, CompositionStrip } from "@/components/tactics/CompositionBuilder";
import { MapThumb } from "@/components/tactics/MapThumb";
import { CoachHeader } from "@/components/coach/tc/CoachFrame";
import { CoachIcon } from "@/components/coach/tc/CoachIcons";
import { fetchCompositions, saveComposition, deleteComposition, TacticsError } from "@/lib/tactics/client";
import { cn } from "@/lib/format";
import { playerMessage } from "@/components/ui/game/GameStates";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("entrenador");

/** `useSearchParams` necesita su frontera de Suspense o `next build` aborta el prerender. */
export default function ComposicionesPage() {
  return (
    <Suspense fallback={null}>
      <ComposicionesLab />
    </Suspense>
  );
}

function ComposicionesLab() {
  useLocale();
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const mapas = useMemo(() => availableMaps(), []);
  /*
   * FASE 51.1 · VENIR DESDE JUGAR. `?map=` abre ese mapa (solo si es del catálogo), `?nueva=1` abre
   * el creador y `?volver=jugar` devuelve al asistente al guardar, con la composición recién
   * creada elegida. El destino de vuelta es FIJO: no se acepta una URL arbitraria.
   */
  const mapaPedido = mapas.some((m) => m.id === params.get("map")) ? (params.get("map") as string) : null;
  const volverAJugar = params.get("volver") === "jugar";
  const [mapId, setMapId] = useState(mapaPedido ?? mapas[0]?.id ?? "ascent");
  const [todas, setTodas] = useState<Composition[]>([]);
  const [cargando, setCargando] = useState(true);
  const [editando, setEditando] = useState<Composition | null | "nueva">(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    setCargando(true);
    try { setTodas(await fetchCompositions()); }
    catch (e) { setError(e instanceof Error ? e.message : t("No se pudieron cargar")); }
    finally { setCargando(false); }
  }, []);

  useEffect(() => { if (user) void recargar(); }, [user, recargar]);

  /*
   * ── EL MAPA CON EL QUE SE ABRE ── donde más trabajo hay, una sola vez. En cuanto el entrenador
   * elige mapa a mano, manda él. Desempate: el orden del catálogo.
   */
  const yaElegido = useRef(mapaPedido !== null);
  const nuevaPedida = useRef(params.get("nueva") === "1");
  useEffect(() => {
    if (!nuevaPedida.current || !user) return;
    nuevaPedida.current = false;
    setEditando("nueva");
  }, [user]);
  useEffect(() => {
    if (yaElegido.current || todas.length === 0) return;
    yaElegido.current = true;
    const cuenta = new Map<string, number>();
    for (const c of todas) cuenta.set(c.mapId, (cuenta.get(c.mapId) ?? 0) + 1);
    let mejor = "";
    let n = 0;
    for (const m of mapas) {
      const k = cuenta.get(m.id) ?? 0;
      if (k > n) { n = k; mejor = m.id; }
    }
    if (mejor) setMapId(mejor);
  }, [todas, mapas]);

  const delMapa = useMemo(() => todas.filter((c) => c.mapId === mapId), [todas, mapId]);
  const mapa = mapas.find((m) => m.id === mapId);

  const guardar = useCallback(async (c: { id?: string; name: string; mapId: string; agentIds: string[]; notes: string }) => {
    setGuardando(true);
    setError(null);
    try {
      const guardada = await saveComposition(c);
      setEditando(null);
      if (volverAJugar && guardada?.id) {
        router.push(`/entrenador/jugar?paso=composicion&map=${encodeURIComponent(guardada.mapId)}&comp=${encodeURIComponent(guardada.id)}`);
        return;
      }
      await recargar();
    } catch (e) {
      // El mensaje del servidor es el bueno: dice exactamente qué regla se ha roto.
      setError(e instanceof TacticsError ? e.message : t("No se pudo guardar"));
    } finally {
      setGuardando(false);
    }
  }, [recargar, volverAJugar, router]);

  /* Duplicar es crear una copia EN EL MISMO MAPA: las posiciones de otro mapa no significarían nada. */
  const duplicar = useCallback(async (c: Composition) => {
    await guardar({ name: `${c.name} (copia)`.slice(0, 60), mapId: c.mapId, agentIds: c.agentIds, notes: c.notes });
  }, [guardar]);

  /* Borrar se confirma EN LA PROPIA FILA (el producto prohíbe `window.confirm`). */
  const [confirmando, setConfirmando] = useState<string | null>(null);

  const borrar = useCallback(async (c: Composition) => {
    try { await deleteComposition(c.id); setConfirmando(null); await recargar(); }
    catch (e) { setError(e instanceof Error ? e.message : t("No se pudo borrar")); }
  }, [recargar]);

  if (loading) return null;
  if (!user) return <NeedsAccount what={t("tus composiciones")} />;

  return (
    <main className="w-full pb-8" data-testid="composition-lab">
      <CoachHeader
        kicker={t("Tactical Coach · Composiciones")}
        title={<>{t("Team")} <span className="text-[#2fe0ff]">{t("Composition")}</span> {t("Lab")}</>}
        line={t("Cinco agentes del roster real por mapa. Elige el mapa, llena los cinco puestos y guárdala para llevarla a la pizarra y al plan de partido.")}
        actions={
          <>
            <Link href="/entrenador" className="nx-coach-btn" data-variant="ghost" data-size="sm">{t("← El Entrenador")}</Link>
            <Link href="/entrenador/strats" className="nx-coach-btn" data-variant="ghost" data-size="sm">{t("Ir a la pizarra →")}</Link>
          </>
        }
      />
      {volverAJugar && (
        <p data-testid="back-to-play" className="nx-coach-panel-flat mb-4 flex flex-wrap items-center gap-3 px-4 py-3 text-[13px] text-white/80">
          <b className="font-display uppercase tracking-[0.12em] text-[#2fe0ff]">{t("Jugar")}</b>
          {t("Crea la composición para {map}: al guardarla vuelves directamente a tu partida.", { map: mapa?.name ?? mapId })}
          <Link href={`/entrenador/jugar?paso=composicion&map=${encodeURIComponent(mapId)}`} className="nx-coach-btn ml-auto" data-variant="ghost" data-size="sm">{t("Volver sin guardar")}</Link>
        </p>
      )}

      {/* ═══ LOS DOCE MAPAS: la planta se reconoce antes que el nombre ═══ */}
      <div
        role="radiogroup"
        aria-label={t("Mapa")}
        className="mb-5 grid grid-cols-4 gap-1.5 sm:grid-cols-6 xl:grid-cols-12"
        data-testid="map-selector"
      >
        {mapas.map((m) => {
          const n = todas.filter((c) => c.mapId === m.id).length;
          const on = m.id === mapId;
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={on}
              data-testid={`map-${m.id}`}
              onClick={() => { setMapId(m.id); setEditando(null); }}
              title={t("{name} · {sites} sitios", { name: m.name, sites: m.sites })}
              className={cn(
                "group relative min-w-0 overflow-hidden p-1 text-left transition duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2fe0ff]",
                on
                  ? "bg-[rgba(47,224,255,0.1)] shadow-[inset_0_0_0_1.5px_rgba(47,224,255,0.9),0_0_16px_-6px_rgba(47,224,255,0.9)]"
                  : "bg-white/[0.02] shadow-[inset_0_0_0_1px_rgba(47,224,255,0.12)] hover:shadow-[inset_0_0_0_1px_rgba(47,224,255,0.45)]",
              )}
            >
              <span className="block aspect-square overflow-hidden bg-[#050a14]">
                <MapThumb map={m} className={cn(!on && "opacity-55 transition-opacity duration-150 group-hover:opacity-100")} />
              </span>
              <span className="mt-1 flex items-baseline justify-between gap-1 px-0.5">
                <span className={cn("truncate font-display text-[10.5px] font-bold uppercase tracking-[0.12em]", on ? "text-[#2fe0ff]" : "text-white/70")}>
                  {m.name}
                </span>
                {n > 0 && <span className="nx-readout shrink-0 text-[10.5px] text-white/50">{n}</span>}
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* ═══ EL LABORATORIO: constructor o fichas ═══ */}
        <section className="nx-coach-panel min-w-0 px-4 py-5 sm:px-6" aria-label={t("Composiciones de {v}", { v: mapa?.name ?? mapId })}>
          {editando ? (
            <CompositionBuilder
              mapId={mapId}
              mapName={mapa?.name ?? mapId}
              value={editando === "nueva" ? null : editando}
              saving={guardando}
              error={td(error)}
              onSave={guardar}
              onCancel={() => { setEditando(null); setError(null); }}
            />
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <p className="nx-coach-kicker">
                  {cargando ? t("Cargando…") : t("{length} en {v}", { length: delMapa.length, v: mapa?.name ?? mapId })}
                </p>
                <button
                  type="button"
                  data-testid="new-composition"
                  onClick={() => { setEditando("nueva"); setError(null); }}
                  className="nx-coach-btn"
                >
                  {t("+ Nueva composición")}
                </button>
              </div>

              {error && <p className="mb-3 text-[12.5px] text-[#ff5aa8]">{playerMessage(error)}</p>}

              {delMapa.length === 0 && !cargando ? (
                <div className="grid place-items-center gap-3 px-4 py-12 text-center">
                  <span className="text-[#2fe0ff]/70"><CoachIcon name="comp" size={40} /></span>
                  <p className="font-display text-[16px] font-bold uppercase tracking-[0.08em] text-white">
                    {t("Todavía no hay composiciones en {mapa}.", { mapa: mapa?.name ?? mapId })}
                  </p>
                  <p className="nx-coach-muted max-w-sm text-[13px]">{t("Monta los cinco que jugarán este mapa. Se puede guardar a medias.")}</p>
                </div>
              ) : (
                <ul className="grid gap-3 md:grid-cols-2" data-testid="composition-list">
                  {delMapa.map((c) => {
                    const antiguos = legacyAgentIds(c.agentIds);
                    return (
                      <li
                        key={c.id}
                        data-testid={`composition-${c.id}`}
                        className="flex flex-col gap-3 px-4 py-3.5"
                        style={{
                          background: "linear-gradient(180deg, rgba(47,224,255,0.06), rgba(4,8,16,0.55))",
                          boxShadow: `inset 0 0 0 1px ${isComplete(c) ? "rgba(63,214,150,0.35)" : "rgba(47,224,255,0.16)"}`,
                        }}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <b className="min-w-0 truncate font-display text-[16px] font-extrabold uppercase tracking-[0.05em] text-white">{c.name}</b>
                          <span className={cn("nx-label shrink-0", isComplete(c) ? "!text-[rgb(63,214,150)]" : "!text-[#ffd35c]")}>
                            {c.agentIds.length} / 5{c.primary ? (" " + t("· Principal")) : ""}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          <CompositionStrip agentIds={c.agentIds} size={40} />
                        </div>
                        {antiguos.length > 0 && (
                          <span data-testid={`legacy-${c.id}`} className="self-start px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-[0.14em] text-[#9aa4bf] shadow-[inset_0_0_0_1px_rgba(154,164,191,0.45)]">
                            {t("{n, plural, one {Modelo anterior · {n} agente por sustituir} other {Modelo anterior · {n} agentes por sustituir}}", { n: antiguos.length })}
                          </span>
                        )}

                        <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-[rgba(47,224,255,0.1)] pt-2.5">
                          <button type="button" onClick={() => setEditando(c)} data-testid={`edit-${c.id}`} className="nx-coach-btn" data-variant="ghost" data-size="sm">{t("Editar")}</button>
                          <button type="button" onClick={() => void duplicar(c)} className="nx-coach-btn" data-variant="ghost" data-size="sm">{t("Duplicar")}</button>
                          {confirmando === c.id ? (
                            <span className="flex flex-wrap items-center gap-1.5" data-testid={`confirm-${c.id}`}>
                              <span className="text-[11px] text-white/55">{t("¿Seguro? Las jugadas que la usaban se quedan sin composición.")}</span>
                              <button type="button" onClick={() => void borrar(c)} className="nx-coach-btn" data-variant="mag" data-size="sm">{t("Sí, borrar")}</button>
                              <button type="button" onClick={() => setConfirmando(null)} className="nx-coach-btn" data-variant="ghost" data-size="sm">{t("No")}</button>
                            </span>
                          ) : (
                            <button type="button" onClick={() => setConfirmando(c.id)} className="ml-auto min-h-[36px] px-3 font-display text-[11px] font-bold uppercase tracking-[0.14em] text-[#ff5aa8] shadow-[inset_0_0_0_1px_rgba(255,46,140,0.45)] hover:bg-[rgba(255,46,140,0.1)]">{t("Borrar")}</button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </section>

        {/* ═══ EL MAPA ELEGIDO: la planta grande y los atajos ═══ */}
        {mapa && (
          <aside className="nx-coach-panel-flat order-first h-fit p-3 xl:order-none xl:sticky xl:top-4" aria-label={t("Mapa {name}", { name: mapa.name })}>
            <div className="relative aspect-square overflow-hidden bg-[#040810] shadow-[inset_0_0_0_1px_rgba(47,224,255,0.2)]">
              <MapThumb map={mapa} priority />
              <span aria-hidden className="nx-coach-corner" data-c="tl" /><span aria-hidden className="nx-coach-corner" data-c="tr" />
              <span aria-hidden className="nx-coach-corner" data-c="bl" /><span aria-hidden className="nx-coach-corner" data-c="br" />
            </div>
            <div className="mt-3 flex items-baseline justify-between gap-2">
              <b className="font-display text-[22px] font-extrabold uppercase leading-none text-white">{mapa.name}</b>
              <span className="nx-label !text-[#2fe0ff]">{mapa.sites} {t("sitios")}</span>
            </div>
            <p className="nx-coach-muted mt-1.5 text-[12.5px] leading-snug">{td(mapa.identity)}</p>
            <div className="mt-3 grid grid-cols-2 gap-1.5">
              <Link href="/entrenador/strats" className="nx-coach-btn" data-variant="ghost" data-size="sm">{t("Pizarra")}</Link>
              <Link href={`/entrenador/mapas#${mapa.id}`} className="nx-coach-btn" data-variant="ghost" data-size="sm">{t("Estudiar")}</Link>
            </div>
          </aside>
        )}
      </div>
    </main>
  );
}
