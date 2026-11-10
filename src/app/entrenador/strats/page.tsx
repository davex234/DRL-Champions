"use client";

/**
 * PIZARRA — el editor de estrategias del Entrenador. FASE 51: la SALA DE GUERRA.
 *
 * El mapa es el protagonista. Arriba, el HUD de la jugada (nombre, bando, deshacer/rehacer,
 * guardar, presentar). A la izquierda, las herramientas. A la derecha, el equipo y lo que se
 * edita. Abajo, la línea de pasos 01–12. Es un EDITOR, no un visor: para repasar una jugada paso
 * a paso está `/entrenador/strats/revisar`.
 *
 * ────────────────────────── QUÉ ES Y QUÉ NO ES ──────────────────────────
 *
 *   · SÍ es: doce mapas, cinco fichas de rol, utilidades tipadas, dibujo libre, textos y
 *     una secuencia de pasos en la que **cada paso guarda su propio estado**.
 *   · NO es: una simulación. No calcula quién gana la ronda, no toca el motor de partido y
 *     no da ninguna ventaja en un duelo. Es la pizarra, y eso es todo lo que promete.
 *
 * ────────────────────────── FASE 51 · DESHACER Y NO PISAR ──────────────────────────
 *
 *   · DESHACER/REHACER de verdad: la jugada vive en un historial (`domain/tactics/history.ts`,
 *     puro y probado) con tope de 80 entradas. Arrastrar una ficha o escribir un nombre se agrupan
 *     en UNA entrada por gesto. Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z y Ctrl+Y, nunca dentro de un campo de
 *     texto. Deshacer NO guarda: sigue haciendo falta pulsar Guardar (no hay autoguardado).
 *   · CERROJO OPTIMISTA: se guarda con la versión que se abrió (`saveStratVersioned`). Si otra
 *     sesión la cambió entretanto, el servidor responde 409 y aquí se dice, con dos salidas
 *     explícitas: recargar la última versión o guardar la tuya como copia. Nunca se pisa en
 *     silencio y nunca se mezcla.
 *
 * ────────────────────────── LAS COORDENADAS NO SE TOCAN ──────────────────────────
 *
 * Siguen siendo 0..100 sobre `map.frame`, y la mesa sigue teniendo la proporción del encuadre
 * del mapa. Lo que cambia es el marco alrededor, no qué punto significa cada número.
 */
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { Loading, ErrorState, NeedsAccount } from "@/components/ui/States";
import { Toast } from "@/components/ui/Toast";
import { useToast } from "@/lib/useToast";
import { TacticalTheater } from "@/components/tactics/TacticalTheater";
import { StrategyBoard, type Tool } from "@/components/tactics/StrategyBoard";
import { AgentPicker, AbilityPicker } from "@/components/tactics/AgentPicker";
import { AgentPortrait } from "@/components/agents/AgentArt";
import { MapPicker } from "@/components/tactics/MapPicker";
import { fitCamera, type Camera } from "@/components/tactics/MapCanvas";
import { UtilityGlyph } from "@/components/tactics/UtilityGlyph";
import { ToolGlyph } from "@/components/tactics/ToolGlyph";
import { CoachIcon } from "@/components/coach/tc/CoachIcons";
import {
  emptyStrat, addStep, removeStep, renameStep, updateStep,
  addPlayer, addUtility, addDrawing, addAnnotation, moveObject, removeObject, setTarget,
  getTacticalMap, availableMaps, validateStrat, countObjects,
  SIDE_LABEL, UTILITY_KINDS, UTILITY_LABEL, UTILITY_COLOR, DRAW_KINDS, DRAW_LABEL, DRAW_COLORS,
  ROLE_COLOR, TEAM_SIZE, MAX_STEPS, DEFAULT_MAP_ID,
  type Strat, type Side, type StepState, type DrawColor, type TacticalMap, type UtilityKind,
} from "@/domain/tactics";
import {
  createHistory, commit, undo, redo, canUndo, canRedo, historyShortcut, HISTORY_LIMIT, type EditHistory,
} from "@/domain/tactics/history";
import { DUEL_ROLES } from "@/domain/cardgame";
// El catálogo REAL de habilidades: para poner nombre a una marca, no para inventarlo.
import { getTacticalAbility, abilityDisplayName, agentDisplayName } from "@/domain/tactics/roster";
import type { RoleId } from "@/domain/cards/types";
import {
  fetchStrats, saveStratVersioned, deleteStrat, duplicateStrat, StratError, TacticsError, type StratRow,
} from "@/lib/tactics/client";
import { ROLE_ABBR } from "@/lib/flags";
import { cn } from "@/lib/format";
import { ns, td, getIntlLocale } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("entrenador");

/**
 * `useSearchParams()` obliga a Next a renderizar en cliente la rama que lo llama, y sin un
 * `<Suspense>` que marque esa frontera el prerender de `next build` ABORTA la compilación
 * entera (missing-suspense-with-csr-bailout). Es el mismo envoltorio que ya usan
 * `/entrenador/strats/revisar` y `/entrenador/plan`.
 */
export default function StratsPage() {
  useLocale();
  return (
    <Suspense fallback={<Marco><Loading label={tr("Cargando tus estrategias…")} /></Marco>}>
      <Pizarra />
    </Suspense>
  );
}

/** Lo que el servidor dijo al rechazar un guardado por versión. */
interface Conflicto { version: string | null; nombre: string | null }

function Pizarra() {
  useLocale();
  const configured = isSupabaseConfigured();
  const { user } = useAuth();
  const { toast, notify } = useToast();
  /*
   * ── ABRIR UNA JUGADA CONCRETA ──
   * El Plan Táctico ofrece «Abrir» con `/entrenador/strats?abrir=<id>`. Se abre UNA vez por
   * identificador: si luego se cambia de jugada a mano, el parámetro no vuelve a tirar.
   */
  const params = useSearchParams();
  const pedida = params.get("abrir");
  const yaAbierta = useRef<string | null>(null);

  const [rows, setRows] = useState<StratRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [savedId, setSavedId] = useState<string | null>(null);
  /** La versión (`updated_at`) de la fila tal como se abrió o se guardó por última vez. */
  const [version, setVersion] = useState<string | null>(null);
  /** El objeto exacto que está en el servidor: si el presente es este, no hay cambios sin guardar. */
  const [guardado, setGuardado] = useState<Strat | null>(null);
  const [conflicto, setConflicto] = useState<Conflicto | null>(null);

  /* La jugada vive en un historial: `strat` es siempre su presente. */
  const [hist, setHist] = useState<EditHistory<Strat>>(() => createHistory(emptyStrat("nueva", DEFAULT_MAP_ID, "attack")));
  const strat = hist.present;

  const [step, setStep] = useState(0);
  const [tool, setTool] = useState<Tool>({ kind: "select" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /* FASE 47 · el teatro: la misma jugada, a pantalla completa y sin nada alrededor. */
  const [theater, setTheater] = useState(false);
  /*
   * La habilidad ARMADA, esperando un sitio: elegir una habilidad no la coloca. La siguiente
   * pulsación sobre el mapa la deja caer, atada a su agente y a su lanzador.
   */
  const [pendiente, setPendiente] = useState<{ abilityId: string; kind: UtilityKind; ownerId: string } | null>(null);
  const [texto, setTexto] = useState("Nota");
  const [color, setColor] = useState<DrawColor>(DRAW_COLORS[0]);

  const map: TacticalMap = getTacticalMap(strat.mapId) ?? availableMaps()[0];
  const [camera, setCamera] = useState<Camera>(() => fitCamera(map));

  // Cambiar de mapa reencuadra la cámara: el encuadre del anterior no vale para el nuevo.
  useEffect(() => { setCamera(fitCamera(map)); }, [map.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Deshacer puede quitar pasos: el paso visible nunca apunta fuera de la jugada.
  const pasoVisible = Math.min(step, strat.steps.length - 1);
  useEffect(() => { if (step !== pasoVisible) setStep(pasoVisible); }, [step, pasoVisible]);

  const actual = strat.steps[pasoVisible];
  const estado: StepState = actual.state;
  const sucio = guardado !== strat;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchStrats());
    } catch (e) {
      setError(e instanceof StratError ? e.message : tr("No se pudieron cargar tus estrategias"));
    } finally {
      setLoading(false);
    }
  }, []);

  /** Recarga la lista SIN el estado de carga (que desmontaría el editor). */
  const refrescar = useCallback(async () => {
    try { const r = await fetchStrats(); setRows(r); return r; } catch { return null; }
  }, []);

  useEffect(() => {
    if (configured && user) void load();
    else setLoading(false);
  }, [configured, user, load]);

  /**
   * Toda edición pasa por aquí: una entrada del historial por gesto. `clave` agrupa las
   * mutaciones seguidas del mismo gesto (arrastrar, escribir) en una sola.
   */
  const cambiar = useCallback((fn: (s: Strat) => Strat, clave?: string) => {
    setHist((h) => commit(h, fn(h.present), { key: clave ?? null, now: Date.now() }));
  }, []);

  /** Aplica una transformación al estado del paso visible. */
  const editar = useCallback((fn: (s: StepState) => StepState, clave?: string) => {
    cambiar((s) => updateStep(s, pasoVisible, fn), clave);
  }, [cambiar, pasoVisible]);

  const deshacer = useCallback(() => { setHist(undo); setSelectedId(null); }, []);
  const rehacer = useCallback(() => { setHist(redo); setSelectedId(null); }, []);

  /* Atajos: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z y Ctrl+Y. Nunca dentro de un campo, nunca en el teatro. */
  useEffect(() => {
    if (theater) return;
    const onKey = (e: KeyboardEvent) => {
      const accion = historyShortcut({
        key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey,
        target: e.target as HTMLElement | null,
      });
      if (!accion) return;
      e.preventDefault();
      if (accion === "undo") deshacer(); else rehacer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [theater, deshacer, rehacer]);

  /** Empieza a editar otra jugada: historial nuevo (no se deshace hacia la anterior). */
  const cargar = useCallback((id: string | null, plan: Strat, v: string | null) => {
    setSavedId(id);
    setVersion(v);
    setHist(createHistory(plan));
    setGuardado(id ? plan : null);
    setConflicto(null);
    setStep(0);
    setSelectedId(null);
    setPendiente(null);
    setTool({ kind: "select" });
  }, []);

  const abrir = useCallback((row: StratRow) => cargar(row.id, row.plan, row.updatedAt), [cargar]);

  useEffect(() => {
    if (!pedida || yaAbierta.current === pedida) return;
    const fila = rows.find((r) => r.id === pedida);
    if (!fila) return;
    yaAbierta.current = pedida;
    abrir(fila);
  }, [pedida, rows, abrir]);

  const nueva = useCallback((mapId: string, side: Side) => {
    cargar(null, emptyStrat("nueva", mapId, side), null);
  }, [cargar]);

  const guardar = useCallback(async (comoCopia = false) => {
    const plan: Strat = comoCopia ? { ...strat, name: `${strat.name} (copia)`.slice(0, 60) } : strat;
    const check = validateStrat(plan);
    if (!check.ok) { notify(check.issues[0].message); return; }
    setSaving(true);
    try {
      const r = await saveStratVersioned(plan, comoCopia ? null : savedId, comoCopia ? null : version);
      setSavedId(r.id);
      setVersion(r.version);
      if (comoCopia) setHist((h) => commit(h, plan));
      setGuardado(plan);
      setConflicto(null);
      notify(comoCopia ? tr("Guardada como copia") : tr("Estrategia guardada"));
      await refrescar();
    } catch (e) {
      if (e instanceof TacticsError && e.code === "VERSION_CONFLICT") {
        const x = e.extra ?? {};
        setConflicto({
          version: typeof x.currentVersion === "string" ? x.currentVersion : null,
          nombre: typeof x.currentName === "string" ? x.currentName : null,
        });
        return;
      }
      notify(e instanceof TacticsError || e instanceof StratError ? e.message : tr("No se pudo guardar"));
    } finally {
      setSaving(false);
    }
  }, [strat, savedId, version, notify, refrescar]);

  /** Descarta lo local y trae la versión del servidor. Solo con un clic explícito. */
  const recargar = useCallback(async () => {
    const r = await refrescar();
    const fila = r?.find((x) => x.id === savedId);
    if (!fila) { notify(tr("Esa estrategia ya no existe. Puedes guardarla como copia.")); return; }
    abrir(fila);
    notify(tr("Última versión cargada"));
  }, [refrescar, savedId, abrir, notify]);

  const duplicar = useCallback(async (id: string) => {
    try {
      await duplicateStrat(id);
      notify(tr("Copia creada"));
      await refrescar();
    } catch (e) {
      notify(e instanceof StratError ? e.message : tr("No se pudo duplicar"));
    }
  }, [notify, refrescar]);

  const borrar = useCallback(async (id: string) => {
    try {
      await deleteStrat(id);
      if (savedId === id) nueva(map.id, strat.side);
      notify(tr("Estrategia eliminada"));
      await refrescar();
    } catch (e) {
      notify(e instanceof StratError ? e.message : tr("No se pudo eliminar"));
      // FULL GAME AUDIT · si ya no existía (otra pestaña), la lista se pone al día igualmente.
      await refrescar().catch(() => undefined);
    }
  }, [savedId, map.id, strat.side, notify, refrescar, nueva]);

  // ── Estados previos al editor ──────────────────────────────────────────────
  if (!configured) {
    return <Marco><ErrorState message={tr("Esta instalación no tiene servidor: las estrategias se guardan en el servidor.")} /></Marco>;
  }
  if (!user) return <Marco><NeedsAccount what={tr("Tus estrategias")} /></Marco>;
  if (loading) return <Marco><Loading label={tr("Cargando tus estrategias…")} /></Marco>;
  if (error) return <Marco><ErrorState message={td(error)} onRetry={() => void load()} /></Marco>;

  const objetos = countObjects(estado);
  const soltar = () => { setTool({ kind: "select" }); setPendiente(null); };

  return (
    <Marco
      barra={
        <>
          {/* EL HUD DE LA JUGADA: nombre, bando, historial y acciones en una sola tira. */}
          <Campo
            value={strat.name}
            onChange={(v) => cambiar((s) => ({ ...s, name: v.slice(0, 60) }), "name")}
            aria-label={tr("Nombre de la estrategia")}
            className="min-w-[9rem] flex-1 !text-[15px] !font-bold"
          />

          <div className="flex p-0.5 shadow-[inset_0_0_0_1px_rgba(47,224,255,0.16)]" role="group" aria-label={tr("Bando")}>
            {(["attack", "defense"] as Side[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => cambiar((v) => ({ ...v, side: s }))}
                aria-pressed={strat.side === s}
                className={cn(
                  "min-h-[44px] px-3.5 font-display text-[12px] font-bold uppercase tracking-wide transition duration-150",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2fe0ff]",
                  strat.side === s
                    ? s === "attack" ? "bg-[#ff2e8c] text-white" : "bg-[#2fe0ff] text-[#021420]"
                    : "text-white/55 hover:text-white",
                )}
              >
                {s === "attack" ? "▲ " : "▼ "}{td(SIDE_LABEL[s])}
              </button>
            ))}
          </div>

          <div className="flex" role="group" aria-label={tr("Historial")}>
            <button
              type="button"
              className="nx-coach-tool"
              onClick={deshacer}
              disabled={!canUndo(hist)}
              data-testid="undo"
              aria-label={tr("Deshacer")}
              title={tr("Deshacer (Ctrl+Z) · {length}/{HISTORY_LIMIT}", { length: hist.past.length, HISTORY_LIMIT })}
            >
              <CoachIcon name="undo" size={18} />
            </button>
            <button
              type="button"
              className="nx-coach-tool"
              onClick={rehacer}
              disabled={!canRedo(hist)}
              data-testid="redo"
              aria-label={tr("Rehacer")}
              title={tr("Rehacer (Ctrl+Shift+Z / Ctrl+Y)")}
            >
              <CoachIcon name="redo" size={18} />
            </button>
          </div>

          <span
            data-testid="save-state"
            className={cn("nx-label hidden shrink-0 sm:inline", sucio ? "!text-[#ffd35c]" : "!text-[rgb(63,214,150)]")}
          >
            {sucio ? tr("● Sin guardar") : tr("✓ Guardada")}
          </span>

          <button
            type="button"
            data-testid="open-theater"
            onClick={() => setTheater(true)}
            disabled={strat.steps.length === 0}
            className="nx-coach-btn"
            data-variant="ghost"
            title={tr("Presenta la jugada a pantalla completa (Game Day)")}
          >
            <CoachIcon name="present" size={16} /> {tr("Presentar")}
          </button>

          <button
            type="button"
            onClick={() => void guardar()}
            disabled={saving}
            data-testid="save-strat"
            className="nx-coach-btn"
          >
            <CoachIcon name="save" size={16} />
            {saving ? tr("Guardando…") : savedId ? tr("Guardar") : tr("Guardar nueva")}
          </button>
          {savedId && (
            <Link href={`/entrenador/strats/revisar?id=${savedId}`} className="nx-coach-btn" data-variant="ghost" data-size="sm">
              {tr("Revisar")}
            </Link>
          )}
        </>
      }
    >
      <TacticalTheater
        strat={strat}
        /* Quién juega esta jugada: los agentes que el entrenador ha puesto en las fichas de este paso. */
        agentIds={estado.players.map((p) => p.agentId).filter((x): x is string => !!x)}
        open={theater}
        onClose={() => setTheater(false)}
      />

      {/* ═══ CONFLICTO DE VERSIONES: visible y con dos salidas explícitas. Nunca se pisa en silencio. ═══ */}
      {conflicto && (
        <div role="alert" data-testid="version-conflict" className="nx-coach-conflict mb-3 flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <b className="block font-display text-[14px] font-extrabold uppercase tracking-[0.06em] text-white">
              {tr("Esta jugada ha cambiado en otra sesión.")}
            </b>
            <span className="text-[13px] text-white/70">
              {conflicto.nombre ? <>{tr("En el servidor está «")}{td(conflicto.nombre)}». </> : null}
              {tr("Tus cambios siguen aquí y no se han guardado. Elige qué hacer:")}
            </span>
          </div>
          <button type="button" className="nx-coach-btn" data-variant="ghost" data-testid="conflict-reload" onClick={() => void recargar()}>
            {tr("Recargar última versión")}
          </button>
          <button type="button" className="nx-coach-btn" data-variant="mag" data-testid="conflict-copy" onClick={() => void guardar(true)} disabled={saving}>
            {tr("Guardar como copia")}
          </button>
        </div>
      )}

      {/*
        ═══════════ LA SALA ═══════════
        Escritorio: herramientas | MAPA | equipo, y la línea de pasos debajo del mapa.
        Móvil: el mapa primero, luego los pasos, luego herramientas y equipo.
      */}
      <div className="nx-coach-warroom grid gap-3 xl:grid-cols-[92px_minmax(0,1fr)_350px] xl:items-start">
        {/* ── Tablero ── */}
        <section className="order-1 min-w-0 space-y-2 xl:order-2">
          <div className="flex flex-wrap items-center gap-2">
            <EstadoHerramienta
              tool={tool}
              pendiente={pendiente ? abilityDisplayName(pendiente.abilityId) : null}
              onSoltar={soltar}
            />
            <span className="nx-label ml-auto hidden !text-white/40 md:inline">
              {td(map.name)} · {tr("{n, plural, one {# objeto} other {# objetos}}", { n: objetos })}
            </span>
          </div>

          {/*
            LA MESA, CON LA PROPORCIÓN DEL MAPA. La caja tiene la proporción del ENCUADRE del mapa,
            así que no hay franjas negras; en estrecho manda el ancho, en escritorio el alto.
          */}
          <div className="grid place-items-center">
            <div
              className="nx-coach-board relative w-full min-w-0 max-h-[max(300px,calc(100dvh-380px))] xl:h-[min(max(440px,calc(100vh-356px)),1060px)] xl:w-auto xl:max-h-none xl:max-w-full"
              style={{ aspectRatio: `${map.frame.width} / ${map.frame.height}` }}
            >
              {(["tl", "tr", "bl", "br"] as const).map((c) => <span key={c} aria-hidden className="nx-coach-corner z-10" data-c={c} />)}
              <StrategyBoard
                map={map}
                state={estado}
                camera={camera}
                onCamera={setCamera}
                tool={tool}
                selectedId={selectedId}
                className="h-full w-full"
                actions={{
                  onSelect: setSelectedId,
                  // Arrastrar una ficha dispara decenas de movimientos: son UNA entrada del historial.
                  onMove: (id, x, y) => editar((s) => moveObject(s, id, x, y), `move:${pasoVisible}:${id}`),
                  onPlacePlayer: (role, x, y) => { editar((s) => addPlayer(s, role, x, y)); setTool({ kind: "select" }); },
                  /*
                   * Si hay una habilidad ARMADA, la marca nace atada a ella y a quien la lanza. Si
                   * no, es una marca genérica de siempre.
                   */
                  onPlaceUtility: (k, x, y) => {
                    editar((s) => {
                      const conMarca = addUtility(s, k, x, y);
                      if (!pendiente || pendiente.kind !== k) return conMarca;
                      const ultima = conMarca.utilities[conMarca.utilities.length - 1];
                      if (!ultima) return conMarca;
                      const ab = getTacticalAbility(pendiente.abilityId);
                      return {
                        ...conMarca,
                        utilities: conMarca.utilities.map((u) => (
                          u.id === ultima.id
                            ? { ...u, abilityId: pendiente.abilityId, ownerId: pendiente.ownerId,
                                label: ab?.name ?? u.label }
                            : u
                        )),
                      };
                    });
                    setPendiente(null);
                    setTool({ kind: "select" });
                  },
                  onPlaceText: (t, x, y) => { editar((s) => addAnnotation(s, t, x, y)); setTool({ kind: "select" }); },
                  onDraw: (k, c, pts) => editar((s) => addDrawing(s, k, c, pts)),
                }}
              />
            </div>
          </div>

          {/* ── LA LÍNEA DE PASOS 01–12, bajo el mapa ── */}
          <nav aria-label={tr("Secuencia")} className="min-w-0">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className="nx-coach-tool shrink-0"
                onClick={() => { setStep((i) => Math.max(0, i - 1)); setSelectedId(null); }}
                disabled={pasoVisible === 0}
                aria-label={tr("Paso anterior")}
              >
                ‹
              </button>
              <ol className="flex min-w-0 flex-1 items-stretch gap-1.5 overflow-x-auto pb-1">
                {strat.steps.map((s, i) => (
                  /* El texto empieza por «N.»: `trainer:verify` cuenta los pasos así. */
                  <li key={s.id} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => { setStep(i); setSelectedId(null); }}
                      aria-pressed={i === pasoVisible}
                      aria-current={i === pasoVisible ? "step" : undefined}
                      className="nx-coach-step"
                      title={td(s.label)}
                    >
                      <span className="nx-coach-step-num">{String(i + 1).padStart(2, "0")}.</span>
                      <span className="nx-coach-step-name">{td(s.label)}</span>
                      <span aria-hidden className="nx-coach-step-dot" data-full={s.state.players.length >= TEAM_SIZE} />
                    </button>
                  </li>
                ))}
                {strat.steps.length < MAX_STEPS && (
                  <li className="shrink-0">
                    {/* El texto «+ Paso» es EXACTO: la verificación lo busca así. */}
                    <button
                      type="button"
                      onClick={() => { cambiar((s) => addStep(s)); setStep(strat.steps.length); }}
                      title={tr("El paso nuevo empieza como una copia del actual")}
                      className="nx-coach-step !items-center !text-[#2fe0ff]"
                    >
                      {tr("+ Paso")}
                    </button>
                  </li>
                )}
                {/* La capacidad: los huecos que quedan hasta doce. Decorativo. */}
                {Array.from({ length: Math.max(0, MAX_STEPS - strat.steps.length - 1) }, (_, k) => (
                  <li key={`hueco-${k}`} aria-hidden className="hidden shrink-0 lg:block">
                    <span className="grid h-full min-h-[52px] w-[46px] place-items-center font-display text-[13px] font-bold text-white/15 shadow-[inset_0_0_0_1px_rgba(47,224,255,0.07)]">
                      {String(strat.steps.length + k + 2).padStart(2, "0")}
                    </span>
                  </li>
                ))}
              </ol>
              <button
                type="button"
                className="nx-coach-tool shrink-0"
                onClick={() => { setStep((i) => Math.min(strat.steps.length - 1, i + 1)); setSelectedId(null); }}
                disabled={pasoVisible >= strat.steps.length - 1}
                aria-label={tr("Paso siguiente")}
              >
                ›
              </button>
            </div>
          </nav>
        </section>

        {/* ── LAS HERRAMIENTAS, a la izquierda ── */}
        <nav
          aria-label={tr("Herramientas")}
          className="nx-coach-toolrail order-2 flex flex-wrap items-start gap-3 p-2.5 xl:sticky xl:top-3 xl:order-1 xl:max-h-[calc(100vh-24px)] xl:flex-col xl:flex-nowrap xl:items-stretch xl:gap-2.5 xl:overflow-y-auto"
        >
          <Grupo titulo={tr("Mover")}>
            <button
              type="button"
              className="nx-coach-tool"
              aria-pressed={tool.kind === "select"}
              onClick={soltar}
              title={tr("Seleccionar y mover")}
              aria-label={tr("Seleccionar")}
            >
              <ToolGlyph kind="select" />
            </button>
          </Grupo>

          <Grupo titulo={tr("Marcas")}>
            {UTILITY_KINDS.map((k) => {
              const on = tool.kind === "utility" && tool.utility === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => { setPendiente((p) => (p && p.kind === k ? p : null)); setTool({ kind: "utility", utility: k }); }}
                  title={td(UTILITY_LABEL[k])}
                  aria-label={td(UTILITY_LABEL[k])}
                  aria-pressed={on}
                  className="nx-coach-tool"
                >
                  <svg viewBox="-12 -12 24 24" aria-hidden style={{ width: 20, height: 20, color: UTILITY_COLOR[k] }}>
                    <UtilityGlyph kind={k} />
                  </svg>
                </button>
              );
            })}
          </Grupo>

          <Grupo titulo={tr("Dibujo")}>
            {DRAW_KINDS.map((k) => {
              const on = tool.kind === "draw" && tool.draw === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTool({ kind: "draw", draw: k, color })}
                  aria-pressed={on}
                  title={td(DRAW_LABEL[k])}
                  aria-label={td(DRAW_LABEL[k])}
                  className="nx-coach-tool"
                >
                  <ToolGlyph kind={k} color={color} />
                </button>
              );
            })}
          </Grupo>

          <Grupo titulo={tr("Color")}>
            {DRAW_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={tr("Color {c}", { c: td(c) })}
                aria-pressed={color === c}
                onClick={() => {
                  setColor(c);
                  setTool((t) => (t.kind === "draw" ? { ...t, color: c } : t));
                }}
                className="nx-coach-tool"
              >
                <span
                  aria-hidden
                  className="h-5 w-5 rounded-full"
                  style={{ background: c, boxShadow: color === c ? "0 0 0 2px #fff" : "0 0 0 1px rgba(255,255,255,0.25)" }}
                />
              </button>
            ))}
          </Grupo>

          <Grupo titulo={tr("Texto")}>
            <Campo
              value={texto}
              onChange={(v) => setTexto(v.slice(0, 120))}
              aria-label={tr("Texto de la anotación")}
              className="w-32 xl:w-full"
            />
            <button
              type="button"
              className="nx-coach-tool"
              aria-pressed={tool.kind === "text"}
              onClick={() => setTool({ kind: "text", text: texto || tr("Nota") })}
              aria-label={tr("Colocar texto")}
              title={tr("Colocar texto")}
            >
              <ToolGlyph kind="text" />
            </button>
          </Grupo>
        </nav>

        {/* ── EL EQUIPO Y LO QUE SE EDITA, a la derecha ── */}
        <aside className="order-3 flex min-w-0 flex-col gap-3 xl:sticky xl:top-3 xl:order-3 xl:max-h-[calc(100vh-24px)] xl:self-start xl:overflow-y-auto xl:pr-1">
          <Panel titulo={tr("Equipo")} valor={`${estado.players.length}/${TEAM_SIZE}`}>
            {/*
              EL FLUJO: rol → agente → habilidad → colocar. Una ficha no puesta se coloca
              pulsándola aquí y luego el mapa; una puesta se selecciona para darle agente y
              habilidades en el panel de abajo.
            */}
            <ul className="grid gap-1.5">
              {DUEL_ROLES.map((role: RoleId) => {
                const ficha = estado.players.find((p) => p.role === role);
                const colocando = tool.kind === "player" && tool.role === role;
                const on = !!ficha && selectedId === ficha.id;
                const c = ROLE_COLOR[role] ?? "#fff";
                return (
                  <li key={role}>
                    <button
                      type="button"
                      disabled={!ficha && estado.players.length >= TEAM_SIZE}
                      onClick={() => (ficha ? (setSelectedId(ficha.id), soltar()) : setTool({ kind: "player", role }))}
                      aria-pressed={colocando || on}
                      title={ficha ? tr("Seleccionar {role}", { role: td(role) }) : tr("Colocar {role}", { role: td(role) })}
                      className="nx-coach-tool w-full !justify-start gap-2.5 !px-2.5 !py-1.5 text-left"
                      style={{ boxShadow: on || colocando ? undefined : `inset 3px 0 0 ${c}, inset 0 0 0 1px rgba(47,224,255,0.12)` }}
                    >
                      {ficha?.agentId ? (
                        <AgentPortrait agentId={ficha.agentId} size={30} decorative />
                      ) : (
                        <span
                          aria-hidden
                          className={cn("grid h-[30px] w-[30px] shrink-0 place-items-center text-[10px]", ficha ? "rounded-full" : "border border-dashed")}
                          style={{ color: c, borderColor: `${c}88`, background: ficha ? `${c}22` : undefined }}
                        >
                          {td(ROLE_ABBR[role]) ?? role.slice(0, 2)}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 leading-tight">
                        <b className="block truncate text-[11.5px] text-white">
                          {ficha?.agentId ? agentDisplayName(ficha.agentId) : td(ROLE_ABBR[role]) ?? td(role)}
                        </b>
                        <span className="block truncate text-[9.5px] tracking-[0.14em] text-white/45">
                          {ficha ? (ficha.agentId ? td(role) : tr("sin agente")) : colocando ? tr("pulsa el mapa") : tr("sin colocar")}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Panel>

          {/* LA SELECCIÓN: agente → habilidad → marca → colocar. */}
          <Inspector
            estado={estado}
            selectedId={selectedId}
            pendiente={pendiente}
            onQuitar={(id) => { editar((s) => removeObject(s, id)); setSelectedId(null); }}
            onFlecha={(id, on) => editar((s) => setTarget(s, id, on ? { x: 50, y: 50 } : null))}
            onAgente={(id, agentId) => editar((s) => ({
              ...s,
              players: s.players.map((p) => (
                p.id === id
                  // Quitar el agente OMITE la clave en vez de dejarla en `undefined`.
                  ? (agentId ? { ...p, agentId } : (({ agentId: _fuera, ...resto }) => resto)(p))
                  : p
              )),
            }))}
            onHabilidad={(abilityId, kind, ownerId) => {
              // Arma la herramienta. Colocar es la siguiente pulsación sobre el mapa.
              setPendiente(abilityId && kind ? { abilityId, kind, ownerId } : null);
              setTool(abilityId && kind ? { kind: "utility", utility: kind } : { kind: "select" });
            }}
          />

          <Panel titulo={tr("Paso")} valor={`${pasoVisible + 1} / ${strat.steps.length}`}>
            <div className="grid gap-2">
              <Campo
                value={actual.label}
                onChange={(v) => cambiar((s) => renameStep(s, pasoVisible, v), `label:${pasoVisible}`)}
                aria-label={tr("Nombre del paso")}
              />
              <Campo
                multiline
                value={actual.notes}
                onChange={(v) => cambiar((s) => renameStep(s, pasoVisible, actual.label, v), `notes:${pasoVisible}`)}
                placeholder={tr("Qué pasa en este paso…")}
                aria-label={tr("Notas del paso")}
              />
              {pasoVisible > 0 && (
                <button
                  type="button"
                  className="nx-coach-btn"
                  data-variant="mag"
                  data-size="sm"
                  onClick={() => { cambiar((s) => removeStep(s, pasoVisible)); setStep((i) => Math.max(0, i - 1)); }}
                >
                  {tr("Borrar paso")}
                </button>
              )}
            </div>
          </Panel>

          {/* Mapa y estrategias, plegados: siguen montados en el DOM (el selector ofrece sus doce). */}
          <Plegable titulo={tr("Mapa")} valor={map.name}>
            <MapPicker
              compact
              value={map.id}
              onChange={(m) => cambiar((s) => ({ ...s, mapId: m.id }))}
            />
            <Link href="/entrenador/mapas" className="nx-action mt-2 inline-block">
              {tr("Estudiar los mapas →")}
            </Link>
          </Plegable>

          <Plegable titulo={tr("Mis estrategias")} valor={String(rows.length)} abierto={rows.length > 0}>
            <button type="button" className="nx-coach-btn w-full" data-variant="ghost" onClick={() => nueva(map.id, strat.side)}>
              {tr("+ Nueva estrategia")}
            </button>

            {rows.length === 0 && (
              <p className="nx-coach-muted mt-2 text-[13px] leading-relaxed">
                {tr("Todavía no has guardado ninguna. Coloca a los cinco, dibuja la jugada y pulsa Guardar.")}
              </p>
            )}

            <div className="mt-2 space-y-1.5">
              {rows.map((r) => {
                const m = getTacticalMap(r.mapId);
                const on = r.id === savedId;
                return (
                  <div
                    key={r.id}
                    className="nx-coach-panel-flat p-2"
                    style={on ? { boxShadow: "inset 0 0 0 1.5px rgba(47,224,255,0.8)" } : undefined}
                  >
                    <button type="button" onClick={() => abrir(r)} className="nx-focus block w-full text-left">
                      <span className="block truncate font-display text-[13px] font-bold uppercase tracking-wide text-white">{r.name}</span>
                      <span className="nx-label mt-0.5 block">
                        {m?.name ?? r.mapId} · {td(SIDE_LABEL[r.side])} · {tr("{n, plural, one {# paso} other {# pasos}}", { n: r.steps })}
                      </span>
                      <span className="nx-label block !text-white/35">
                        {new Date(r.updatedAt).toLocaleDateString(getIntlLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </button>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <Accion onClick={() => abrir(r)}>{tr("Abrir")}</Accion>
                      <Accion onClick={() => void duplicar(r.id)}>{tr("Duplicar")}</Accion>
                      <Link href={`/entrenador/strats/revisar?id=${r.id}`} className="nx-coach-btn" data-variant="ghost" data-size="sm">
                        {tr("Revisar")}
                      </Link>
                      <Accion danger onClick={() => void borrar(r.id)}>{tr("Borrar")}</Accion>
                    </div>
                  </div>
                );
              })}
            </div>
          </Plegable>

          <Plegable titulo={tr("Descripción")} valor={strat.description ? tr("escrita") : tr("vacía")}>
            <Campo
              multiline
              rows={3}
              id="strat-desc"
              value={strat.description}
              onChange={(v) => cambiar((s) => ({ ...s, description: v.slice(0, 600) }), "desc")}
              placeholder={tr("Para qué sirve esta jugada y cuándo llamarla.")}
              aria-label={tr("Descripción de la estrategia")}
            />
          </Plegable>
        </aside>
      </div>

      <Toast toast={toast} />
    </Marco>
  );
}

/* ─────────────────────────────── Piezas ─────────────────────────────── */

/**
 * El marco de la pizarra: el HUD en una sola tira. Sin barra (sin sesión, cargando, error) se ve
 * el titular grande de la sala.
 */
function Marco({ children, barra }: { children: React.ReactNode; barra?: React.ReactNode }) {
  useLocale();
  if (!barra) {
    return (
      <div className="space-y-3">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="min-w-0">
            <span className="nx-coach-kicker">{tr("Tactical War Room")}</span>
            <h1 className="font-display text-[clamp(22px,3vw,30px)] font-bold uppercase leading-none text-white">
              {tr("Pizarra")}
            </h1>
          </div>
          <span className="ml-auto">
            <Link href="/entrenador/mapas" className="nx-action">
              {tr("Estudiar los mapas →")}
            </Link>
          </span>
        </header>
        {children}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="nx-coach-warroom nx-coach-panel flex flex-wrap items-center gap-2 p-2">
        <span className="mr-1 hidden min-w-0 shrink-0 items-center gap-2 leading-none lg:flex">
          <span className="text-[#2fe0ff]" aria-hidden><CoachIcon name="board" size={22} /></span>
          <span>
            <span className="nx-coach-kicker !text-[9px]">{tr("War Room")}</span>
            <b className="mt-0.5 block font-display text-[15px] font-bold uppercase leading-none tracking-wide text-white">
              {tr("Pizarra")}
            </b>
          </span>
        </span>
        <span aria-hidden className="hidden h-8 w-px shrink-0 bg-[rgba(47,224,255,0.2)] lg:block" />
        {barra}
      </div>
      {children}
    </div>
  );
}

/** Un grupo de herramientas: su rótulo y sus botones. */
function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="nx-coach-toolgroup-title mb-1">{td(titulo)}</p>
      <div className="flex flex-wrap items-center gap-1 xl:grid xl:grid-cols-2">{children}</div>
    </div>
  );
}

/** Panel del lado derecho. */
function Panel({ titulo, valor, tone, children }: { titulo: string; valor?: string; tone?: "gold"; children: React.ReactNode }) {
  return (
    <section className="nx-coach-panel p-3" data-tone={tone}>
      <header className="mb-2 flex items-center gap-2">
        <h2 className="nx-coach-kicker flex-1">{td(titulo)}</h2>
        {valor && <span className="nx-label !text-white/55">{td(valor)}</span>}
      </header>
      {children}
    </section>
  );
}

/**
 * Panel plegable. `<details>` y no un estado de React a propósito: el contenido sigue en el DOM
 * cuando está cerrado, así que el selector de mapas sigue ofreciendo sus doce.
 */
function Plegable({
  titulo, valor, abierto = false, children,
}: {
  titulo: string;
  valor?: string;
  abierto?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="nx-coach-panel p-0">
      <details open={abierto} className="group">
        <summary className="nx-focus flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-3">
          <span className="nx-coach-kicker flex-1">{td(titulo)}</span>
          {valor && <span className="nx-label !text-white/55">{td(valor)}</span>}
          <span aria-hidden className="font-display text-[11px] text-white/40 transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none">
            ›
          </span>
        </summary>
        <div className="px-3 pb-3">{children}</div>
      </details>
    </section>
  );
}

/** Campo de texto de la sala: nativo, hundido, 44 px de alto en una línea. */
function Campo({
  value, onChange, multiline, rows = 2, className, ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  rows?: number;
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement> & React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "rows" | "className">) {
  const comun = cn(
    "w-full bg-black/40 px-3 text-[13px] text-white outline-none",
    "shadow-[inset_0_0_0_1px_rgba(47,224,255,0.18)] placeholder:text-white/30",
    "focus:shadow-[inset_0_0_0_1px_rgba(47,224,255,0.8)]",
    className,
  );
  return multiline ? (
    <textarea
      {...rest}
      value={value}
      rows={rows}
      onChange={(e) => onChange(e.target.value)}
      className={cn(comun, "resize-y py-2 leading-relaxed")}
    />
  ) : (
    <input
      {...rest}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(comun, "min-h-[44px]")}
    />
  );
}

/**
 * QUÉ HERRAMIENTA ESTÁ ARMADA y qué va a hacer el siguiente gesto sobre el mapa. Va pegada a la
 * mesa porque es ahí donde uno tiene la mano cuando se hace la pregunta. Si hay una habilidad
 * armada, dice cuál.
 */
function EstadoHerramienta({ tool, pendiente, onSoltar }: { tool: Tool; pendiente: string | null; onSoltar: () => void }) {
  useLocale();
  const info: { icon: React.ReactNode; nombre: string; pista: string; color?: string } =
    tool.kind === "player"
      ? { icon: <span aria-hidden className="h-2.5 w-2.5 shrink-0" style={{ background: ROLE_COLOR[tool.role] ?? "#fff" }} />,
          nombre: tool.role, pista: tr("Pulsa el mapa para colocar la ficha"), color: ROLE_COLOR[tool.role] }
      : tool.kind === "utility"
        ? { icon: <svg viewBox="-12 -12 24 24" aria-hidden style={{ width: 14, height: 14, color: UTILITY_COLOR[tool.utility] }}><UtilityGlyph kind={tool.utility} /></svg>,
            nombre: pendiente ? `${pendiente} · ${UTILITY_LABEL[tool.utility]}` : UTILITY_LABEL[tool.utility],
            pista: tr("Pulsa el mapa para dejar la marca"), color: UTILITY_COLOR[tool.utility] }
        : tool.kind === "draw"
          ? { icon: <ToolGlyph kind={tool.draw} color={tool.color} />,
              nombre: DRAW_LABEL[tool.draw], pista: tr("Pulsa y arrastra sobre el mapa"), color: tool.color }
          : tool.kind === "text"
            ? { icon: <ToolGlyph kind="text" />, nombre: tr("Nota"), pista: tr("Pulsa el mapa para dejar el texto") }
            : { icon: <ToolGlyph kind="select" />, nombre: tr("Seleccionar"), pista: tr("Arrastra para mover · rueda con Ctrl para acercar") };

  const armada = tool.kind !== "select";

  return (
    <span
      data-testid="tool-status"
      className={cn(
        "inline-flex min-h-[40px] min-w-0 items-center gap-2 px-3",
        armada ? "bg-[rgba(47,224,255,0.08)]" : "bg-[rgba(4,8,16,0.6)]",
      )}
      style={{ boxShadow: `inset 0 0 0 1px ${armada && info.color ? `${info.color}88` : "rgba(47,224,255,0.16)"}` }}
    >
      {info.icon}
      <b
        className="min-w-0 truncate font-display text-[12px] font-bold uppercase tracking-wide"
        style={{ color: armada ? info.color ?? "#fff" : "rgba(255,255,255,0.8)" }}
      >
        {td(info.nombre)}
      </b>
      <span className="hidden truncate text-[12px] text-white/45 sm:block">{td(info.pista)}</span>
      {armada && (
        <button
          type="button"
          onClick={onSoltar}
          className="nx-focus ml-1 shrink-0 font-display text-[11px] uppercase tracking-wide text-white/55 hover:text-white"
          title={tr("Volver a seleccionar")}
        >
          {tr("Soltar")}
        </button>
      )}
    </span>
  );
}

/** Acción de una estrategia guardada (objetivo táctil de 40 px). */
function Accion({
  onClick, children, danger = false,
}: { onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="nx-coach-btn" data-variant={danger ? "mag" : "ghost"} data-size="sm">
      {children}
    </button>
  );
}

/** Qué hay seleccionado y qué se puede hacer con ello: el flujo agente → habilidad → marca → colocar. */
function Inspector({
  estado, selectedId, pendiente, onQuitar, onFlecha, onAgente, onHabilidad,
}: {
  estado: StepState;
  selectedId: string | null;
  pendiente: { abilityId: string; kind: UtilityKind; ownerId: string } | null;
  onQuitar: (id: string) => void;
  onFlecha: (id: string, on: boolean) => void;
  /** Asigna (o quita) el agente de una ficha de jugador. */
  onAgente: (id: string, agentId: string | null) => void;
  /** Prepara la herramienta para colocar una habilidad: la siguiente pulsación decide DÓNDE. */
  onHabilidad: (abilityId: string | null, kind: UtilityKind | null, ownerId: string) => void;
}) {
  useLocale();
  const jugador = estado.players.find((p) => p.id === selectedId);
  const util = estado.utilities.find((u) => u.id === selectedId);
  const dibujo = estado.drawings.find((d) => d.id === selectedId);
  const nota = estado.annotations.find((a) => a.id === selectedId);
  const algo = jugador ?? util ?? dibujo ?? nota;

  if (!algo) {
    return (
      <Panel titulo={tr("Selección")}>
        <p className="nx-coach-muted text-[13px] leading-relaxed">
          {tr("Nada seleccionado. Pulsa una ficha del mapa o del equipo para darle agente, habilidad o destino.")}
        </p>
      </Panel>
    );
  }

  const puedeFlecha = !!(jugador ?? util);
  const tieneFlecha = !!(jugador?.to ?? util?.to);
  const armadaAqui = !!jugador && pendiente?.ownerId === jugador.id;
  const pasos = jugador
    ? [
        { t: tr("Agente"), ok: !!jugador.agentId },
        { t: tr("Habilidad"), ok: armadaAqui },
        { t: tr("Marca"), ok: armadaAqui },
        { t: tr("Colocar"), ok: false },
      ]
    : [];

  return (
    <Panel titulo={tr("Selección")} tone="gold">
      <div className="flex items-center gap-2">
        <span className="nx-label shrink-0 px-1.5 py-0.5 !text-[#2fe0ff] shadow-[inset_0_0_0_1px_rgba(47,224,255,0.5)]">
          {jugador ? tr("Jugador") : util ? tr("Utilidad") : dibujo ? tr("Dibujo") : tr("Nota")}
        </span>
        <b className="min-w-0 truncate font-display text-[13px] font-bold text-white">
          {jugador ? `${jugador.label} · ${jugador.role}`
            : util ? td(UTILITY_LABEL[util.kind])
              : dibujo ? td(DRAW_LABEL[dibujo.kind])
                : td(nota?.text) ?? tr("Nota")}
        </b>
      </div>

      {pasos.length > 0 && (
        <ol className="mt-2.5 flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-[0.14em]" aria-label={tr("Flujo de la ficha")}>
          {pasos.map((p, i) => (
            <li key={p.t} className={cn("flex items-center gap-1", p.ok ? "text-[#2fe0ff]" : "text-white/35")}>
              {i > 0 && <span aria-hidden className="text-white/20">→</span>}
              {p.ok ? "✓" : `${i + 1}`} {td(p.t)}
            </li>
          ))}
        </ol>
      )}

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {puedeFlecha && (
          <button type="button" className="nx-coach-btn" data-variant="ghost" data-size="sm" onClick={() => onFlecha(algo.id, !tieneFlecha)}>
            {tieneFlecha ? tr("Quitar movimiento") : tr("Añadir movimiento")}
          </button>
        )}
        <button type="button" className="nx-coach-btn" data-variant="mag" data-size="sm" onClick={() => onQuitar(algo.id)}>
          {tr("Quitar")}
        </button>
      </div>

      {/* Agentes y habilidades salen del roster REAL; aquí no se escribe ningún nombre. */}
      {jugador && (
        <div className="mt-3 space-y-3 border-t border-[rgba(47,224,255,0.12)] pt-3">
          <AgentPicker
            value={jugador.agentId ?? null}
            para={jugador.label}
            onChange={(id) => onAgente(jugador.id, id)}
          />
          <AbilityPicker
            agentId={jugador.agentId ?? null}
            value={armadaAqui ? pendiente?.abilityId ?? null : null}
            onChange={(ab, kind) => onHabilidad(ab?.id ?? null, kind, jugador.id)}
          />
        </div>
      )}

      {/* Una marca ya colocada dice de qué habilidad es, si se ató a alguna. */}
      {util?.abilityId && (
        <p className="mt-2.5 border-t border-[rgba(47,224,255,0.12)] pt-2.5 text-[12px] text-white/60">
          {tr("Habilidad:")} <b className="text-white">{abilityDisplayName(util.abilityId)}</b>
        </p>
      )}
    </Panel>
  );
}
