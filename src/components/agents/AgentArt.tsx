"use client";

/**
 * F59 · ARTE DE AGENTE — los dos únicos componentes que pintan a un agente real de Valorant.
 *
 *   <AgentPortrait>  la CARA: tablas, chips, filas, selectores, fichas del mapa, historial.
 *   <AgentFullBody>  el CUERPO ENTERO: huecos grandes de la composición, preparación, presentación.
 *
 * Qué imagen existe lo dice `agentArtwork()` (manifiesto generado desde `personajes/`); ninguna
 * pantalla escribe rutas. Sin arte —legado Veil/Haze…, id desconocido, o fichero que falla— se
 * pinta el EMBLEMA de siempre (anillo del rol + código, o el sigilo del legado): nunca un icono de
 * imagen rota, y nunca una cara estirada para fingir un cuerpo.
 *
 * El original no se altera: estados (seleccionado, desactivado, eliminado, aliado/rival) son marco,
 * filtro y superposición por CSS. Jugador ≠ agente: esto no recibe cartas ni jugadores.
 */
import { useEffect, useId, useState, type CSSProperties } from "react";
import { agentArtTuning, agentIdFromName, getAgentArtwork, type AgentArtAsset } from "@/domain/tactics/agentArt";
import { AgentEmblem, agentById, agentColor, agentRoleLabel, AGENT_CLASS_COLOR, AGENT_CLASS_LABEL } from "@/components/tactics/AgentEmblem";
import { cn } from "@/lib/format";
import { useRosterVersion } from "@/lib/tactics/useRosterVersion";
import { td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

export type AgentArtState = "normal" | "selected" | "disabled" | "dead" | "ally" | "enemy";

/**
 * F60 · VISTA PREVIA DEL PANEL: un agente en BORRADOR no está en el registro del juego, así que su nombre, rol y arte
 * llegan por aquí. Es el MISMO componente que ve el jugador (no hay un segundo renderizador para el panel).
 */
export interface AgentArtPreview { name: string; role: string; face?: AgentArtAsset | null; full?: AgentArtAsset | null }
const previewColor = (p: AgentArtPreview) => (AGENT_CLASS_COLOR as Record<string, string>)[p.role] ?? "#9aa4bf";
const previewLabel = (p: AgentArtPreview) => `${p.name} · ${td((AGENT_CLASS_LABEL as Record<string, string>)[p.role]) ?? p.role}`;

/** Ficheros declarados que fallaron en esta sesión: una petición, no veinte. */
const fallidos = new Set<string>();

function useArtSrc(src: string | null): [boolean, () => void] {
  const [falla, setFalla] = useState(() => (src ? fallidos.has(src) : false));
  useEffect(() => { setFalla(src ? fallidos.has(src) : false); }, [src]);
  return [!!src && !falla, () => { if (src) fallidos.add(src); setFalla(true); }];
}

const STATE_RING: Partial<Record<AgentArtState, string>> = { ally: "#19e3ff", enemy: "#ff3b5c" };

function label(agentId: string): string {
  const a = agentById(agentId);
  return a ? `${a.name} · ${agentRoleLabel(a)}` : agentId;
}

/**
 * CARA del agente. Por defecto circular con el anillo del color de su rol (el mismo vocabulario
 * que el resto del entrenador). `size` en px o `"fill"` (ocupa su contenedor, cuadrado).
 */
export function AgentPortrait({
  agentId, size = 40, shape = "circle", ring = true, state = "normal", decorative = false, eager = false, className, title, preview,
}: {
  agentId: string;
  size?: number | "fill";
  shape?: "circle" | "rounded" | "square";
  /** Anillo del color del rol (o del bando con `ally`/`enemy`). */
  ring?: boolean;
  state?: AgentArtState;
  /** El nombre ya está escrito al lado: la imagen no se anuncia dos veces. */
  decorative?: boolean;
  /** Primera pantalla visible (encima del pliegue): sin `loading="lazy"`. */
  eager?: boolean;
  className?: string;
  title?: string;
  preview?: AgentArtPreview;
}) {
  useLocale();
  useRosterVersion(); // F60: re-pinta al llegar el catálogo real (arte subido desde el panel)
  const art = preview ? preview.face ?? null : getAgentArtwork(agentId, "face");
  const [show, fail] = useArtSrc(art?.src ?? null);
  const agent = agentById(agentId);
  const color = STATE_RING[state] ?? (preview ? previewColor(preview) : agentColor(agent));
  const tuning = agentArtTuning(agentId, "face");
  const px = size === "fill" ? undefined : size;
  const box: CSSProperties = size === "fill" ? { width: "100%", aspectRatio: "1 / 1" } : { width: px, height: px };
  const radius = shape === "circle" ? "9999px" : shape === "rounded" ? "22%" : "0";

  return (
    <span
      data-testid="agent-face"
      data-agent={agentId}
      data-art={show ? "image" : "emblem"}
      data-state={state}
      title={td(title)}
      className={cn("relative inline-block shrink-0 align-middle", className)}
      style={box}
    >
      {show && art ? (
        <span
          className="absolute inset-0 overflow-hidden"
          style={{
            borderRadius: radius,
            /* Detrás de una cara recortada: un velo del color del rol, no un cuadrado blanco. */
            background: `radial-gradient(120% 95% at 50% 18%, ${color}40 0%, #0b1020 72%)`,
          }}
        >
          <img
            src={art.src}
            /* A 16–48 px basta la cara de 96 px (~5 KB); el navegador elige según tamaño y densidad. */
            srcSet={art.small ? `${art.small.src} ${art.small.width}w, ${art.src} ${art.width}w` : undefined}
            sizes={art.small ? `${px ?? 96}px` : undefined}
            alt={decorative ? "" : preview ? previewLabel(preview) : label(agentId)}
            width={art.width}
            height={art.height}
            loading={eager ? undefined : "lazy"}
            decoding="async"
            draggable={false}
            onError={fail}
            className={cn("h-full w-full object-cover", (state === "disabled" || state === "dead") && "grayscale")}
            style={{ objectPosition: tuning.objectPosition ?? "50% 20%", transform: tuning.scale ? `scale(${tuning.scale})` : undefined, opacity: state === "disabled" ? 0.45 : state === "dead" ? 0.55 : 1 }}
          />
          {ring && <span aria-hidden className="pointer-events-none absolute inset-0" style={{ borderRadius: radius, boxShadow: `inset 0 0 0 ${state === "selected" ? 2 : 1.5}px ${color}${state === "selected" ? "" : "cc"}` }} />}
        </span>
      ) : (
        <span aria-hidden={decorative || undefined} className={cn("absolute inset-0 grid place-items-center", state === "disabled" && "opacity-45")}>
          <AgentEmblem agentId={agentId} size="100%" />
        </span>
      )}
      {state === "selected" && <span aria-hidden className="pointer-events-none absolute -inset-[3px]" style={{ borderRadius: radius, boxShadow: `0 0 0 1.5px ${color}, 0 0 14px ${color}66` }} />}
      {state === "dead" && (
        <span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center text-[0.9em] font-black text-white/85" style={{ fontSize: px ? Math.max(10, px * 0.5) : undefined }}>✕</span>
      )}
    </span>
  );
}

/**
 * CARA + NOMBRE para filas de datos (estadísticas de esports). Recibe el dato TAL COMO VIENE (id
 * o nombre, «kayo» o «KAY/O») y lo resuelve con la normalización canónica; si no es un agente del
 * roster, se enseña el texto original sin imagen (nunca se adivina).
 */
export function AgentChip({ value, size = 20, hideName = false, className }: { value: string | null | undefined; size?: number; hideName?: boolean; className?: string }) {
  if (!value) return <span className={className}>—</span>;
  const id = agentIdFromName(value);
  if (!id) return <span className={className}>{td(value)}</span>;
  const name = agentById(id)?.name ?? value;
  return (
    <span className={cn("inline-flex items-center gap-1.5 align-middle", className)} data-testid="agent-chip" data-agent={id}>
      <AgentPortrait agentId={id} size={size} decorative={!hideName} title={hideName ? name : undefined} />
      {!hideName && <span className="truncate">{name}</span>}
    </span>
  );
}

/**
 * LOS CINCO en presentación: cuerpo entero con nombre y rol desde `sm`; en móvil, caras (cinco
 * cuerpos de 60 px no se leen). Para la composición confirmada / preparación de partida.
 */
export function AgentLineup({ agentIds, className }: { agentIds: string[]; className?: string }) {
  return (
    <ol className={cn("grid w-full grid-cols-5 gap-1.5 sm:gap-2", className)} data-testid="agent-lineup">
      {agentIds.map((id) => {
        const a = agentById(id);
        return (
          <li key={id} className="min-w-0 text-center">
            <span className="hidden sm:block"><AgentFullBody agentId={id} decorative /></span>
            <span className="mx-auto block w-full max-w-[64px] sm:hidden"><AgentPortrait agentId={id} size="fill" decorative /></span>
            <b className="mt-1 block truncate font-display text-[11px] font-bold uppercase tracking-[0.08em] text-white sm:text-[12.5px]">{a?.name ?? id}</b>
            <span className="block truncate font-display text-[8px] font-bold uppercase tracking-[0.16em]" style={{ color: agentColor(a) }}>{agentRoleLabel(a)}</span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * La CARA dentro de un `<svg>` que ya existe (fichas del mapa): recortada en círculo de radio `r`,
 * centrada en el origen del grupo. Sin arte, o si falla, pinta `fallback` (el emblema de siempre).
 * El marco —anillo, halo, selección— lo pone la ficha: aquí sólo va la cara.
 */
export function AgentFaceSvg({ agentId, r, fallback, dim = false }: { agentId: string; r: number; fallback: React.ReactNode; dim?: boolean }) {
  useRosterVersion();
  const art = getAgentArtwork(agentId, "face");
  const href = art?.small?.src ?? art?.src ?? null;
  const [show, fail] = useArtSrc(href);
  const clip = `agf-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  if (!show || !art || !href) return <>{fallback}</>;
  const tuning = agentArtTuning(agentId, "face");
  const s = r * 2 * (tuning.scale ?? 1);
  return (
    <g data-agent-face={agentId} style={{ pointerEvents: "none" }}>
      <clipPath id={clip}><circle r={r} /></clipPath>
      <image
        href={href}
        x={-s / 2} y={-s / 2 + r * 0.08} width={s} height={s}
        clipPath={`url(#${clip})`}
        preserveAspectRatio="xMidYMin slice"
        onError={fail}
        opacity={dim ? 0.5 : 1}
        style={dim ? { filter: "grayscale(1)" } : undefined}
      />
    </g>
  );
}

/**
 * CUERPO ENTERO del agente, en un marco 3:4 anclado arriba (cabeza siempre dentro; si el original
 * es más alto, lo que se recorta son los pies). Los originales opacos traen fondo de estudio: el
 * marco usa ese mismo tono y el borde inferior se funde con máscara, así opacos y transparentes se
 * ven iguales. Sin cuerpo entero → emblema grande + nombre (la cara NO se estira).
 */
export function AgentFullBody({
  agentId, state = "normal", decorative = false, eager = false, showName = false, className, preview,
}: {
  agentId: string;
  state?: AgentArtState;
  decorative?: boolean;
  eager?: boolean;
  /** Rótulo con el nombre sobre la base del marco. */
  showName?: boolean;
  className?: string;
  preview?: AgentArtPreview;
}) {
  useRosterVersion();
  const art = preview ? preview.full ?? null : getAgentArtwork(agentId, "full");
  const [show, fail] = useArtSrc(art?.src ?? null);
  const agent = agentById(agentId);
  const color = STATE_RING[state] ?? (preview ? previewColor(preview) : agentColor(agent));
  const tuning = agentArtTuning(agentId, "full");
  const fade = "linear-gradient(to bottom, #000 0%, #000 68%, transparent 100%)";

  return (
    <span
      data-testid="agent-full"
      data-agent={agentId}
      data-art={show ? "image" : "emblem"}
      data-state={state}
      className={cn("relative block w-full overflow-hidden", className)}
      style={{
        aspectRatio: "3 / 4",
        background: `radial-gradient(90% 60% at 50% 30%, ${color}33 0%, transparent 70%), linear-gradient(180deg, #1a222d 0%, #121822 70%, #0b1020 100%)`,
        boxShadow: state === "selected" ? `inset 0 0 0 2px ${color}, 0 0 18px ${color}55` : `inset 0 0 0 1px ${color}40`,
      }}
    >
      {show && art ? (
        <img
          src={art.src}
          alt={decorative ? "" : preview ? previewLabel(preview) : label(agentId)}
          width={art.width}
          height={art.height}
          loading={eager ? undefined : "lazy"}
          decoding="async"
          draggable={false}
          onError={fail}
          className={cn("absolute inset-0 h-full w-full object-cover", (state === "disabled" || state === "dead") && "grayscale")}
          style={{
            objectPosition: tuning.objectPosition ?? "50% 0%",
            transform: tuning.scale ? `scale(${tuning.scale})` : undefined,
            transformOrigin: "50% 0%",
            WebkitMaskImage: fade,
            maskImage: fade,
            opacity: state === "disabled" ? 0.45 : state === "dead" ? 0.55 : 1,
          }}
        />
      ) : (
        <span aria-hidden={decorative || undefined} className="absolute inset-0 grid place-items-center">
          <AgentEmblem agentId={agentId} size="46%" />
        </span>
      )}
      {/* La base se oscurece hacia el color del rol: lo que haya debajo (nombre) se lee siempre. */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3" style={{ background: `linear-gradient(to top, #070a12f0, ${color}14 70%, transparent)` }} />
      {showName && (preview || agent) && (
        <span className="absolute inset-x-0 bottom-1.5 truncate px-1 text-center font-display text-[13px] font-bold uppercase tracking-[0.06em] text-white drop-shadow">
          {preview?.name ?? td(agent?.name)}
        </span>
      )}
      {state === "dead" && <span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center text-4xl font-black text-white/80">✕</span>}
    </span>
  );
}
