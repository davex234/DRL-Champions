"use client";

/**
 * CONSTRUCTOR DE COMPOSICIONES — los cinco que juegan este mapa.
 *
 * ────────────────────────── POR QUÉ NO ES UN FORMULARIO ──────────────────────────
 *
 * Una composición son cinco agentes. Un formulario con cinco `<select>` es la forma más rápida de
 * escribirlo y la peor de usarlo: obliga a leer diez nombres para saber qué tienes montado. Aquí
 * hay CINCO HUECOS y un roster con los emblemas, que es la misma imagen que se verá luego sobre el
 * mapa: elegir y reconocer usan el mismo dibujo.
 *
 * El roster es el REAL del juego (`domain/tactics/roster.ts`), con sus cuatro roles. Una composición
 * antigua puede traer agentes del modelo anterior: se enseñan como tales y se pueden sustituir.
 *
 * ────────────────────────── LO QUE DECIDE EL SERVIDOR ──────────────────────────
 *
 * Nada de lo que hay aquí es la regla. La regla vive en `domain/tactics/composition.ts` y la aplica
 * la API: agentes reales, sin repetidos, mapa real, cinco como mucho. Esta pantalla usa las MISMAS
 * funciones para avisar antes de enviar —por eso el aviso coincide siempre con el del servidor—,
 * pero si alguien saltara la interfaz, el servidor seguiría diciendo que no.
 */
import { useCallback, useMemo, useState } from "react";
import {
  validateComposition, validateCompositionPayload, isComplete, classBreakdown, legacyAgentIds, COMPOSITION_SIZE, type Composition,
} from "@/domain/tactics/composition";
import { searchAgents, TACTICAL_ROLES, type TacticalRole } from "@/domain/tactics/roster";
import { AGENT_CLASS_COLOR, AGENT_CLASS_LABEL, agentById, agentColor, agentRoleLabel, LEGACY_COLOR } from "./AgentEmblem";
import { AgentFullBody, AgentPortrait } from "@/components/agents/AgentArt";
import { useRosterVersion } from "@/lib/tactics/useRosterVersion";
import { cn } from "@/lib/format";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("tactics");

export function CompositionBuilder({
  mapId, mapName, value, onSave, onCancel, saving = false, error = null,
}: {
  mapId: string;
  mapName: string;
  /** Composición que se edita. `null` = una nueva. */
  value: Composition | null;
  onSave: (c: { id?: string; name: string; mapId: string; agentIds: string[]; notes: string }) => void;
  onCancel: () => void;
  saving?: boolean;
  error?: string | null;
}) {
  useLocale();
  const [name, setName] = useState(value?.name ?? "");
  const [agentIds, setAgentIds] = useState<string[]>(value?.agentIds ?? []);
  const [filtro, setFiltro] = useState<TacticalRole | "todas">("todas");
  const [busca, setBusca] = useState("");
  /** Hueco al que irá el próximo agente elegido. `null` = al primero libre. */
  const [slot, setSlot] = useState<number | null>(null);

  /*
   * FASE 51 · los MISMOS avisos que el servidor, incluido el nuevo: un agente del modelo anterior
   * ya no se puede volver a guardar. Primero lo que rechaza la puerta del servidor
   * (`validateCompositionPayload`), después el resto de reglas de siempre.
   */
  const problemas = useMemo(() => {
    const entrada = { name, mapId, agentIds, notes: value?.notes ?? "" };
    const puerta = validateCompositionPayload(entrada);
    const resto = validateComposition(entrada).filter((p) => !puerta.some((q) => q.code === p.code && q.agentId === p.agentId));
    return [...puerta, ...resto];
  }, [name, mapId, agentIds, value?.notes]);
  const completa = isComplete({ agentIds });
  const reparto = useMemo(() => classBreakdown(agentIds), [agentIds]);

  const rosterV = useRosterVersion();
  // `rosterV` invalida: el roster se actualiza EN SITIO al llegar el catálogo real (agentes del panel).
  const roster = useMemo(() => { void rosterV; return searchAgents(busca, filtro === "todas" ? "all" : filtro); }, [filtro, rosterV, busca]);
  const antiguos = useMemo(() => legacyAgentIds(agentIds), [agentIds]);

  /** Pone (o quita) un agente. Un agente ya puesto se retira al volver a pulsarlo. */
  const alternar = useCallback((id: string) => {
    setAgentIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= COMPOSITION_SIZE && slot === null) return prev;
      if (slot != null && slot < COMPOSITION_SIZE) {
        const next = [...prev];
        next[slot] = id;
        return next.filter(Boolean).slice(0, COMPOSITION_SIZE);
      }
      return [...prev, id];
    });
    setSlot(null);
  }, [slot]);

  const quitarSlot = useCallback((i: number) => {
    setAgentIds((prev) => prev.filter((_, j) => j !== i));
    setSlot(null);
  }, []);

  return (
    <section data-testid="composition-builder" className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="nx-label text-white/40">{td(mapName)} {t("· composición")}</p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("Nombre de la composición")}
            data-testid="composition-name"
            maxLength={60}
            className="mt-1 w-[min(88vw,460px)] border-b border-[rgba(47,224,255,0.25)] bg-transparent pb-1 font-display text-[clamp(20px,3.4vh,34px)] font-extrabold uppercase tracking-[0.04em] text-white outline-none placeholder:text-white/25 focus-visible:border-[#2fe0ff]"
          />
        </div>
        <span
          data-testid="composition-count"
          className={cn(
            "font-display text-[13px] font-bold uppercase tracking-[0.2em]",
            completa ? "text-[rgb(63,214,150)]" : "text-[#2fe0ff]",
          )}
        >
          {agentIds.length} / {COMPOSITION_SIZE}
        </span>
      </header>

      {/*
        ═══ LOS CINCO ═══

        ────────────────────────── LO QUE ESTABA MAL ──────────────────────────

        La idea —cinco huecos y no cinco desplegables— era la correcta. La MEDIDA no: cada
        hueco era un `aspect-[3/4]`, o sea **225 × 300 px a 1440**, con un emblema de 44 px
        flotando en el centro. Cinco rectángulos vacíos gigantes ocupaban media pantalla para
        decir cinco nombres, y el agente —lo único que importa— era la parte más pequeña del
        dibujo. Es justo el «panel lleno de rectángulos iguales» que no queremos.

        Ahora el hueco tiene la altura de lo que contiene y el AGENTE manda dentro de él.

        ── Agentes reales, sin artwork de Riot ──

        El hueco reserva una caja 3:4 y dentro va la ficha del agente real —anillo del color de su
        ROL y su código— sobre un velo de ese color. No hay retratos: el proyecto no tiene
        licencia para el artwork de Riot. El hueco vacío reserva la misma caja, por lo que llenar
        el cinco no mueve nada de sitio. Un agente del modelo anterior va en gris y lo dice.
      */}
      <ol className="grid grid-cols-5 gap-1.5 sm:gap-2 lg:max-w-[820px]" data-testid="composition-slots">
        {Array.from({ length: COMPOSITION_SIZE }, (_, i) => {
          const id = agentIds[i];
          const agente = agentById(id);
          const activo = slot === i;
          const c = agente ? agentColor(agente) : null;
          return (
            <li key={i}>
              <button
                type="button"
                data-testid={`slot-${i}`}
                data-filled={agente ? "true" : "false"}
                data-legacy={agente?.legacy ? "true" : undefined}
                onClick={() => (agente ? quitarSlot(i) : setSlot(activo ? null : i))}
                aria-label={agente ? t("{name}. Pulsa para quitarlo del hueco {v}", { name: agente.name, v: i + 1 }) : t("Hueco {v} vacío", { v: i + 1 })}
                title={agente ? t("Quitar del cinco") : t("Elegir agente para este hueco")}
                /* FASE 51 · una POSICIÓN de la plantilla, no una caja: filo del rol, número grabado y luz desde abajo. */
                className={cn(
                  "group relative flex w-full flex-col items-center gap-1.5 px-1 pb-2.5 pt-2 transition duration-150",
                  agente ? "hover:brightness-110" : "hover:bg-[rgba(47,224,255,0.06)]",
                )}
                style={{
                  clipPath: "polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px)",
                  background: agente
                    ? `linear-gradient(180deg, ${c}14 0%, rgba(4,8,16,0.7) 60%, ${c}26 100%)`
                    : activo ? "rgba(47,224,255,0.1)" : "linear-gradient(180deg, rgba(47,224,255,0.05), rgba(4,8,16,0.5))",
                  boxShadow: agente
                    ? `inset 0 0 0 1px ${c}88, inset 0 -3px 0 ${c}`
                    : activo
                      ? "inset 0 0 0 1.5px rgba(47,224,255,0.95), 0 0 18px -6px rgba(47,224,255,0.9)"
                      : "inset 0 0 0 1px rgba(47,224,255,0.18)",
                }}
              >
                {/* El número del hueco: cinco posiciones, no cinco cajas iguales. */}
                <span className="nx-readout absolute left-2 top-1.5 text-[11px] text-[#2fe0ff]/60">{String(i + 1).padStart(2, "0")}</span>
                {agente ? (
                  <>
                    {/* F59 · cuerpo entero real en el hueco (≥ sm); en móvil, cinco columnas estrechas → la cara. */}
                    <span
                      aria-hidden
                      data-testid="slot-token"
                      className="nx-clip-sm mx-auto block w-full max-w-[128px] overflow-hidden"
                      style={{ aspectRatio: "3 / 4" }}
                    >
                      <span className="hidden h-full sm:block"><AgentFullBody agentId={agente.id} decorative /></span>
                      <span className="grid h-full place-items-center sm:hidden"><AgentPortrait agentId={agente.id} size="fill" decorative /></span>
                    </span>
                    <span className="min-w-0 text-center leading-tight">
                      <b className="block truncate font-display text-[12px] font-bold uppercase tracking-[0.08em] text-white">
                        {agente.name}
                      </b>
                      <span
                        className="block truncate font-display text-[8px] font-bold uppercase tracking-[0.16em]"
                        style={{ color: c ?? undefined }}
                      >
                        {agentRoleLabel(agente)}
                      </span>
                    </span>
                  </>
                ) : (
                  <>
                    {/* Reserva la MISMA caja 3:4 que el retrato: sin salto al llenar el hueco. */}
                    <span
                      aria-hidden
                      className="mx-auto grid w-full max-w-[128px] place-items-center"
                      style={{ aspectRatio: "3 / 4" }}
                    >
                      <span
                        className={cn(
                          "grid h-11 w-11 place-items-center rounded-full border border-dashed text-[18px]",
                          activo ? "border-[#2fe0ff] text-[#2fe0ff]" : "border-[rgba(47,224,255,0.3)] text-[#2fe0ff]/50",
                        )}
                      >
                        +
                      </span>
                    </span>
                    <span className={cn("nx-label !text-[9px]", activo ? "!text-[#2fe0ff]" : "text-white/40")}>
                      {activo ? t("Elige agente") : t("Vacío")}
                    </span>
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ol>

      {/* Reparto por rol: se informa, no se impone (el entrenador monta lo que quiera). */}
      <div className="flex flex-wrap items-center gap-2" data-testid="composition-breakdown">
        {TACTICAL_ROLES.filter((c) => reparto[c] > 0).map((c) => (
          <span key={c} className="nx-label rounded-full px-2.5 py-1" style={{ color: AGENT_CLASS_COLOR[c], background: `${AGENT_CLASS_COLOR[c]}1a` }}>
            {td(AGENT_CLASS_LABEL[c])} {reparto[c]}
          </span>
        ))}
        {reparto.legacy > 0 && (
          <span className="nx-label rounded-full px-2.5 py-1" style={{ color: LEGACY_COLOR, background: `${LEGACY_COLOR}1a` }}>
            {t("Modelo anterior")} {reparto.legacy}
          </span>
        )}
      </div>
      {antiguos.length > 0 && (
        <p data-testid="composition-legacy-note" className="text-[12px] text-white/55">
          {t("Esta composición es del modelo anterior de NEXUS (")}{antiguos.map((x) => agentById(x)?.name ?? x).join(", ")}{t("). Se conserva tal cual; pulsa cada hueco gris para quitarlo y elige un agente real.")}
        </p>
      )}

      {/* ═══ EL ROSTER ═══ */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder={t("Buscar agente")}
            data-testid="roster-search"
            aria-label={t("Buscar agente")}
            className="nx-focus min-h-[40px] w-44 bg-black/40 px-3 text-[12.5px] text-white outline-none shadow-[inset_0_0_0_1px_rgba(47,224,255,0.22)] placeholder:text-white/35 focus:shadow-[inset_0_0_0_1px_rgba(47,224,255,0.8)]"
          />
          <div role="group" aria-label={t("Filtrar por rol")} className="flex flex-wrap gap-1">
            <button type="button" onClick={() => setFiltro("todas")} aria-pressed={filtro === "todas"}
              className={cn("nx-focus min-h-[40px] px-3 font-display text-[10.5px] font-bold uppercase tracking-[0.16em]", filtro === "todas" ? "bg-[rgba(47,224,255,0.16)] text-white shadow-[inset_0_0_0_1px_rgba(47,224,255,0.9)]" : "text-white/55 shadow-[inset_0_0_0_1px_rgba(47,224,255,0.14)] hover:text-white")}>
              {t("Todos ·")} {searchAgents("").length}
            </button>
            {TACTICAL_ROLES.map((c) => (
              <button key={c} type="button" onClick={() => setFiltro(c)} aria-pressed={filtro === c}
                className={cn("nx-focus min-h-[40px] px-3 font-display text-[10.5px] font-bold uppercase tracking-[0.16em]", filtro === c ? "text-white" : "text-white/55 hover:text-white")}
                style={filtro === c
                  ? { background: `${AGENT_CLASS_COLOR[c]}26`, color: AGENT_CLASS_COLOR[c], boxShadow: `inset 0 0 0 1px ${AGENT_CLASS_COLOR[c]}` }
                  : { boxShadow: "inset 0 0 0 1px rgba(47,224,255,0.14)" }}>
                {td(AGENT_CLASS_LABEL[c])} · {searchAgents("", c).length}
              </button>
            ))}
          </div>
        </div>

        <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5" data-testid="agent-roster">
          {roster.map((a) => {
            const puesto = agentIds.includes(a.id);
            const lleno = agentIds.length >= COMPOSITION_SIZE && !puesto && slot === null;
            return (
              <li key={a.id}>
                <button
                  type="button"
                  data-testid={`roster-${a.id}`}
                  aria-pressed={puesto}
                  disabled={lleno}
                  onClick={() => alternar(a.id)}
                  title={lleno ? t("La composición ya tiene cinco agentes") : `${a.name} · ${AGENT_CLASS_LABEL[a.role]}`}
                  className={cn(
                    "nx-focus flex min-h-[54px] w-full items-center gap-2.5 px-2.5 py-2 text-left transition duration-150",
                    puesto ? "bg-[rgba(47,224,255,0.12)]" : "bg-[rgba(4,8,16,0.55)] hover:bg-[rgba(47,224,255,0.07)]",
                    lleno && "opacity-45",
                  )}
                  /* El agente que YA está en el cinco lleva el filo de su clase; el resto, el canto neutro. */
                  style={{
                    boxShadow: puesto
                      ? `inset 0 0 0 1px ${AGENT_CLASS_COLOR[a.role]}, inset 3px 0 0 ${AGENT_CLASS_COLOR[a.role]}`
                      : "inset 0 0 0 1px rgba(47,224,255,0.12)",
                  }}
                >
                  <AgentPortrait agentId={a.id} size={38} decorative state={puesto ? "selected" : "normal"} />
                  <span className="min-w-0 flex-1 leading-tight">
                    <b className="block truncate font-display text-[12.5px] font-bold uppercase tracking-[0.08em] text-white">{a.name}</b>
                    <span className="block font-display text-[8px] font-bold uppercase tracking-[0.16em]" style={{ color: AGENT_CLASS_COLOR[a.role] }}>
                      {td(AGENT_CLASS_LABEL[a.role])}
                    </span>
                  </span>
                  {/* Dentro del cinco: se dice, además de con el color, con una marca. */}
                  {puesto && (
                    <svg viewBox="0 0 14 14" aria-hidden className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" style={{ color: AGENT_CLASS_COLOR[a.role] }}>
                      <path d="M2.5 7.4 5.6 10.5 11.5 3.8" />
                    </svg>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/*
        Avisos: los MISMOS que aplicará el servidor, para que no haya sorpresas al guardar.

        Pero una composición recién abierta no está MAL, está VACÍA: enseñar «la composición
        necesita un nombre» en rojo antes de que el entrenador haya escrito una letra es
        regañar por no haber empezado. Mientras el nombre siga en blanco y no haya ningún otro
        problema, el mismo texto se dice en tono de instrucción. En cuanto se escribe algo —o
        el que habla es el servidor— vuelve a ser un aviso.
      */}
      {(problemas.length > 0 || error) && (() => {
        const soloFaltaNombre = !error && name.trim().length === 0 && problemas.length === 1;
        return (
          <p data-testid="composition-issue" className={cn("text-[12.5px]", soloFaltaNombre ? "text-white/45" : "text-[#ff5aa8]")}>
            {td(error) ?? td(problemas[0].message)}
          </p>
        );
      })()}
      {!completa && problemas.length === 0 && !error && (
        <p className="text-[12px] text-white/40">
          {t("Faltan")} {COMPOSITION_SIZE - agentIds.length}{t(". Se puede guardar a medias: sólo hace falta estar completa para llevarla a una partida.")}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          data-testid="composition-save"
          disabled={saving || problemas.length > 0}
          onClick={() => onSave({ id: value?.id, name, mapId, agentIds, notes: value?.notes ?? "" })}
          className="nx-coach-btn"
        >
          {saving ? t("Guardando…") : value ? t("Guardar cambios") : t("Crear composición")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="nx-coach-btn"
          data-variant="ghost"
        >
          {t("Cancelar")}
        </button>
      </div>
    </section>
  );
}

/**
 * Vista compacta de una composición: los cinco en fila. Se usa en listas y selectores.
 * F59 · las CARAS reales (el legado sigue con su emblema gris, vía el respaldo de `AgentPortrait`).
 */
export function CompositionStrip({ agentIds, size = 26 }: { agentIds: string[]; size?: number }) {
  useLocale();
  return (
    <span className="flex items-center gap-1" data-testid="composition-strip">
      {agentIds.map((id) => <AgentPortrait key={id} agentId={id} size={size} title={agentById(id)?.name} />)}
      {agentIds.length === 0 && <span className="nx-label text-white/30">{t("Sin agentes")}</span>}
    </span>
  );
}
