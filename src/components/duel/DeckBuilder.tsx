"use client";

/**
 * CONSTRUCTOR DE MAZOS DE DUELO (Fases 8 y 9G).
 *
 * Trabaja SIEMPRE sobre el inventario real: las cartas llegan de `/api/game/duels`, resueltas en
 * servidor contra `user_cards`. Aquí no se inventa ninguna carta ni ninguna estadística.
 *
 * LA VALIDACIÓN NO SE DUPLICA. Este componente muestra los huecos por rol para guiar al jugador
 * —una ayuda de interfaz, no una regla— y la respuesta autorizada es la que devuelve el servidor al
 * guardar, que ejecuta `validateDuelDeck` del dominio. Si las dos discrepasen, manda el servidor:
 * es lo único que se pinta en el estado del mazo y en la lista de errores.
 *
 * FASE 9G — EL MAZO ARRIBA, GRANDE Y SIEMPRE VISIBLE. Antes vivía en una columna lateral
 * de 320 px con las diez cartas a tamaño `xs`: la pieza que estás construyendo era la más
 * pequeña de la pantalla, y en móvil había que hacer scroll para verla. Ahora ocupa la
 * franja superior a lo ancho, con diez huecos que se llenan a la vista —la forma que usan
 * los juegos de mazos, y la que hace que se entienda de un vistazo cuánto te falta—. La
 * colección queda debajo, que es donde se busca. La lógica no cambia ni una línea:
 * mismos filtros, mismos bloqueos, misma validación y mismo guardado.
 *
 * FASE 9.6 — EL MAZO COMO PIEZA, NO COMO PANEL.
 *
 * Era ya la mejor pantalla del producto y por eso aquí se toca poco. Tres cosas:
 *
 *   1. **El mazo tiene luz propia.** Pasa de `nx-panel` —el contenedor genérico, el mismo
 *      que usa cualquier sección— a escenario. Si la cosa que estás construyendo se dibuja
 *      con la misma pieza que la caja de filtros, no es la protagonista.
 *   2. **Los huecos dicen QUÉ les falta.** Un hueco con un «+» solo dice que está vacío;
 *      uno que pone «Centinela» dice qué hay que buscar. Es la composición que ya se
 *      calculaba para los contadores, puesta donde se necesita. Sigue siendo una AYUDA:
 *      la composición legal la impone el dominio en el servidor al guardar.
 *   3. **El estado del mazo se ve antes de leerlo.** Una banda que dice si está listo o
 *      qué falta, en vez de una línea de texto entre otras.
 *
 * Ni la validación, ni el guardado, ni los `aria-label`/`aria-pressed` de las cartas
 * cambian: son el contrato con el dominio y con el recorrido automatizado.
 */
import { useMemo, useState } from "react";
import { cn } from "@/lib/format";
import { DUEL_COMPOSITION, DUEL_DECK_SIZE, DUEL_ROLES } from "@/domain/cardgame";
import type { RoleId } from "@/domain/cards/types";
import { DuelCard } from "./DuelCard";
import type { DuelDeckCardDTO, DuelDeckDTO } from "@/lib/duel/types";

type SortKey = "ovr" | "name" | "sh" | "gs" | "ef";

const SORTS: { id: SortKey; label: string }[] = [
  { id: "ovr", label: "OVR" },
  { id: "sh", label: "SH" },
  { id: "gs", label: "GS" },
  { id: "ef", label: "EF" },
  { id: "name", label: "A-Z" },
];

export function DeckBuilder({
  collection, deck, name, selected, unopenedPacks = 0,
  onNameChange, onToggle, onClear, onSave, onCancel, saving, error,
}: {
  collection: DuelDeckCardDTO[];
  /**
   * Sobres sin abrir. Solo se usa para una frase, pero es la frase que decide si un
   * jugador nuevo encuentra sus cartas o se queda mirando una rejilla vacía (Fase 15).
   */
  unopenedPacks?: number;
  /** Mazo guardado que se está editando, si lo hay: aporta la validación del SERVIDOR. */
  deck: DuelDeckDTO | null;
  name: string;
  selected: string[];
  onNameChange: (v: string) => void;
  onToggle: (uid: string) => void;
  onClear: () => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}) {
  const [roleFilter, setRoleFilter] = useState<RoleId | "todos">("todos");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("ovr");

  const byUid = useMemo(() => new Map(collection.map((c) => [c.uid, c])), [collection]);
  const chosen = useMemo(
    () => selected.map((u) => byUid.get(u)).filter((c): c is DuelDeckCardDTO => Boolean(c)),
    [selected, byUid],
  );

  /** Huecos por rol. Ayuda de interfaz: la composición legal la impone el dominio en servidor. */
  const counts = useMemo(() => {
    const out = Object.fromEntries(DUEL_ROLES.map((r) => [r, 0])) as Record<RoleId, number>;
    for (const c of chosen) out[c.role]++;
    return out;
  }, [chosen]);

  /** Un jugador no puede repetirse en el mazo: se atenúan sus otras variantes. */
  const usedPlayers = useMemo(() => new Set(chosen.map((c) => c.playerId)), [chosen]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = collection.filter((c) => {
      if (roleFilter !== "todos" && c.role !== roleFilter) return false;
      if (q && !`${c.nick} ${c.team} ${c.region}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const cmp: Record<SortKey, (a: DuelDeckCardDTO, b: DuelDeckCardDTO) => number> = {
      ovr: (a, b) => b.ovr - a.ovr,
      name: (a, b) => a.nick.localeCompare(b.nick),
      sh: (a, b) => b.combat.stronghold - a.combat.stronghold,
      gs: (a, b) => b.combat.gamesense - a.combat.gamesense,
      ef: (a, b) => b.combat.entryfrag - a.combat.entryfrag,
    };
    return [...list].sort((a, b) => cmp[sort](a, b) || a.nick.localeCompare(b.nick));
  }, [collection, roleFilter, query, sort]);

  /**
   * Qué rol le falta a cada hueco vacío. Sale de los mismos contadores que ya alimentan la
   * fila de composición: no es una regla nueva, es el mismo dato puesto donde se decide.
   * Si sobran cartas de un rol, los huecos restantes quedan sin etiqueta en vez de mentir.
   */
  const pendingRoles = useMemo(() => {
    const out: RoleId[] = [];
    for (const r of DUEL_ROLES) {
      for (let i = counts[r]; i < DUEL_COMPOSITION[r]; i++) out.push(r);
    }
    return out;
  }, [counts]);

  const full = selected.length >= DUEL_DECK_SIZE;
  const sumOvr = chosen.reduce((s, c) => s + c.ovr, 0);
  const rolesOk = DUEL_ROLES.every((r) => counts[r] === DUEL_COMPOSITION[r]);
  const looksReady = full && rolesOk;

  return (
    <div className="space-y-5">
      {/* ══ El mazo: la pieza principal, arriba y a lo ancho ══ */}
      <section className="nx-stage nx-clip relative overflow-hidden p-4 sm:p-5" aria-label="Tu mazo">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{ background: "radial-gradient(680px 300px at 12% 116%, rgba(255,46,99,0.20), transparent 68%)" }}
        />
        <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
          <div className="min-w-[180px] flex-1">
            <label className="nx-label block" htmlFor="deck-name">Nombre del mazo</label>
            <input
              id="deck-name"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              maxLength={40}
              className="mt-1 w-full rounded-control border border-white/10 bg-white/[0.05] px-3 py-2 font-display text-lg outline-none transition-colors duration-fast focus:border-drl/60"
            />
          </div>

          <div className="flex gap-5">
            <div>
              <span className="nx-label block">Cartas</span>
              <b className={cn("font-display text-2xl leading-none tabular-nums", full ? "text-ok" : "text-white")}>
                {selected.length}<span className="text-base text-white/30"> / {DUEL_DECK_SIZE}</span>
              </b>
            </div>
            <div>
              <span className="nx-label block">Suma de OVR</span>
              <b className="font-display text-2xl leading-none tabular-nums text-white">{sumOvr}</b>
            </div>
          </div>
        </div>

        {/*
          Los diez huecos. Cinco por fila en móvil y diez en una sola a partir de tableta: en una
          fila se lee como un mazo; en dos columnas se leería como una lista.
        */}
        <div className="mt-4 grid grid-cols-5 gap-2 sm:grid-cols-10">
          {Array.from({ length: DUEL_DECK_SIZE }, (_, i) => {
            const c = chosen[i];
            return c ? (
              /*
                `selected` no es decoración: es lo que hace que la carta anuncie
                `aria-pressed="true"`. Sin él, una carta YA en el mazo se presentaba como no
                elegida —a un lector de pantalla y a cualquier automatismo—, y pulsarla dos
                veces (una en la colección, otra aquí) la añadía y la quitaba sin que se notara.
              */
              <DuelCard
                key={c.uid}
                card={c}
                size="sm"
                selected
                onClick={() => onToggle(c.uid)}
                className="w-full"
              />
            ) : (
              /*
                El hueco dice QUÉ le falta. Con un «+» solo se sabía que estaba vacío, y la
                pregunta del jugador delante de un mazo a medias no es «cuántas me faltan»
                —eso ya está en el contador— sino «de qué».
              */
              <div
                key={`slot-${i}`}
                className="flex aspect-[5/7] w-full flex-col items-center justify-center gap-1.5 rounded-card border border-dashed border-white/15 bg-black/25 px-1 text-center"
                aria-hidden
              >
                <span className="font-display text-xl leading-none text-white/20">+</span>
                {pendingRoles[i - chosen.length] && (
                  <span className="nx-label !text-[8px] leading-tight !tracking-[0.1em]">
                    {pendingRoles[i - chosen.length]}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Composición por rol, en línea: cinco grupos de dos. */}
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
          {DUEL_ROLES.map((r) => {
            const have = counts[r];
            const need = DUEL_COMPOSITION[r];
            return (
              <span key={r} className="flex items-center gap-1.5">
                <span className="nx-label">{r}</span>
                {Array.from({ length: need }, (_, i) => (
                  <i
                    key={i}
                    className={cn("h-1.5 w-5 rounded-full", i < have ? "bg-ok" : "bg-white/12")}
                  />
                ))}
                <b className={cn("font-display text-[11px] tabular-nums", have === need ? "text-ok" : "text-white/45")}>
                  {have}/{need}
                </b>
              </span>
            );
          })}
        </div>

        {/*
          ═══ ESTADO DEL MAZO ═══
          Una banda, no una línea de texto entre otras. Un mazo está listo o no lo está, y
          eso es lo que decide si puedes jugar: tiene que verse antes de leerse.

          La validación autorizada sigue siendo la del SERVIDOR sobre el mazo guardado
          (`deck.errors`); la composición de aquí es la ayuda de interfaz de siempre.
        */}
        <div
          className={cn(
            "nx-clip-sm mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 border px-3.5 py-2.5",
            looksReady ? "border-ok/45 bg-ok/[0.09]" : "border-white/12 bg-white/[0.03]",
          )}
        >
          <span
            className={cn(
              "font-display text-[12px] font-bold uppercase tracking-[0.12em]",
              looksReady ? "text-ok" : "text-white/55",
            )}
          >
            {looksReady ? "✓ Mazo listo" : full ? "Composición incompleta" : `Faltan ${DUEL_DECK_SIZE - selected.length} cartas`}
          </span>
          {!looksReady && pendingRoles.length > 0 && (
            <span className="text-[12px] text-white/45">
              Te falta {pendingRoles.slice(0, 4).join(", ")}
              {pendingRoles.length > 4 && "…"}
            </span>
          )}
        </div>

        {deck && deck.errors.length > 0 && (
          <ul className="mt-2.5 space-y-1">
            {deck.errors.map((e, i) => (
              <li key={`${e.code}-${i}`} className="flex gap-1.5 text-[11px] text-drl-glow">
                <span aria-hidden>✕</span>{e.message}
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p role="alert" className="mt-3 rounded-control border border-drl/40 bg-drl/10 px-3 py-2 text-[12px] text-drl-glow">
            {error}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onSave}
            /* Sin ninguna carta elegida no hay nada que guardar: el botón no debe invitar a ello. */
            disabled={saving || name.trim().length === 0 || selected.length === 0}
            className="flex-1 rounded-control bg-drl px-5 py-2.5 font-display text-sm font-bold uppercase tracking-[0.12em] shadow-glow transition duration-fast hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none sm:flex-none"
          >
            {saving ? "Guardando…" : "Guardar mazo"}
          </button>
          <button
            type="button"
            onClick={onClear}
            disabled={selected.length === 0 || saving}
            className="rounded-control border border-white/12 px-4 py-2.5 font-display text-xs uppercase tracking-wide text-white/60 transition duration-fast hover:bg-white/5 disabled:opacity-30"
          >
            Vaciar
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-control border border-white/12 px-4 py-2.5 font-display text-xs uppercase tracking-wide text-white/60 transition duration-fast hover:bg-white/5 disabled:opacity-30"
          >
            Cancelar
          </button>
        </div>
      </section>

      {/* ══ La colección: donde se busca ══ */}
      <section className="min-w-0" aria-label="Cartas disponibles">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar jugador o equipo…"
            aria-label="Buscar carta"
            className="min-w-0 flex-1 rounded-control border border-white/10 bg-white/[0.04] px-3 py-2 text-sm outline-none transition-colors duration-fast placeholder:text-white/30 focus:border-drl/60"
          />
          <div className="flex gap-1" role="group" aria-label="Ordenar por">
            {SORTS.map((sk) => (
              <button
                key={sk.id}
                type="button"
                onClick={() => setSort(sk.id)}
                className={cn(
                  "rounded-chip px-2.5 py-1.5 font-display text-[11px] font-bold tracking-wide transition duration-fast",
                  sort === sk.id ? "bg-drl text-white" : "bg-white/5 text-white/50 hover:bg-white/10",
                )}
              >
                {sk.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por rol">
          <RoleChip active={roleFilter === "todos"} onClick={() => setRoleFilter("todos")}>
            Todos <span className="opacity-60">{collection.length}</span>
          </RoleChip>
          {DUEL_ROLES.map((r) => (
            <RoleChip key={r} active={roleFilter === r} onClick={() => setRoleFilter(r)} need={counts[r] < DUEL_COMPOSITION[r]}>
              {r} <span className="opacity-60">{counts[r]}/{DUEL_COMPOSITION[r]}</span>
            </RoleChip>
          ))}
        </div>

        {visible.length === 0 ? (
          <p className="rounded-panel border border-dashed border-white/12 px-4 py-10 text-center text-sm text-white/40">
            {/*
              A DÓNDE SE LE MANDA (Fase 15). Esto decía siempre «abre un sobre en la
              Tienda», que es donde se COMPRAN. Un jugador recién registrado llega aquí con
              cuatro sobres de bienvenida sin abrir, y lo que necesita es el inventario, que
              es donde se ABREN y adonde apunta el ciclo del vestíbulo para lo mismo.

              Mandarle a comprar lo que ya tiene es la clase de indicación que obliga a que
              alguien esté al lado diciéndole «no, primero abre los tuyos».
            */}
            {collection.length === 0
              ? unopenedPacks > 0
                ? `Todavía no tienes cartas, pero tienes ${unopenedPacks} ${unopenedPacks === 1 ? "sobre" : "sobres"} sin abrir en Inventario.`
                : "Todavía no tienes cartas. Consigue un sobre en la Tienda para empezar."
              : "Ninguna carta coincide con el filtro."}
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(96px,1fr))]">
            {visible.map((c) => {
              const isIn = selected.includes(c.uid);
              /*
               * Bloqueado si añadirla dejaría el mazo fuera de la composición legal: mazo lleno,
               * jugador repetido, o rol ya completo. Es una AYUDA de interfaz —evita construir algo
               * que el servidor rechazaría— y no sustituye a la validación del dominio, que sigue
               * siendo la que decide y la que se muestra en los errores del mazo.
               */
              const roleFull = counts[c.role] >= DUEL_COMPOSITION[c.role];
              const blocked = !isIn && (full || usedPlayers.has(c.playerId) || roleFull);
              return (
                <DuelCard
                  key={c.uid}
                  card={c}
                  size="sm"
                  selected={isIn}
                  disabled={blocked}
                  onClick={blocked ? undefined : () => onToggle(c.uid)}
                  className="w-full"
                />
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function RoleChip({
  children, active, onClick, need,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  need?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1 text-[11px] font-semibold transition",
        active
          ? "border-drl bg-drl/15 text-white"
          : need
            ? "border-drl/30 bg-drl/5 text-white/60 hover:bg-drl/10"
            : "border-white/10 bg-white/[0.03] text-white/50 hover:bg-white/[0.07]",
      )}
    >
      {children}
    </button>
  );
}
