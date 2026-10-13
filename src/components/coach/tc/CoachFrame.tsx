"use client";

/**
 * FASE 51 · EL MARCO DE LA SALA TÁCTICA. Envuelve TODAS las pantallas de `/entrenador` (lo monta
 * `app/entrenador/layout.tsx`): el fondo de la sala y la navegación interna del Tactical Coach.
 *
 * Antes cada pantalla del entrenador era una isla —el hub enlazaba a las demás, pero desde la
 * pizarra no se llegaba al plan y desde el plan solo se volvía con el botón atrás—. Ahora las ocho
 * salas están siempre a un toque, con la actual marcada. Las rutas son las que ya existían: esto no
 * crea ninguna, solo las conecta.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CoachIcon, type CoachIconName } from "./CoachIcons";

/*
 * FASE 51.1 · JUGAR es la entrada rápida y la única sala destacada (`primary`). Cubre el asistente
 * (`/entrenador/jugar`) y el pre-partido/partido (`/entrenador/partido`), que ya no es una pestaña
 * aparte: se llega a él desde JUGAR, con equipo y mapa elegidos. El resto son herramientas.
 */
export const COACH_ROOMS: { href: string; label: string; icon: CoachIconName; exact?: boolean; primary?: boolean; also?: string[]; hint: string }[] = [
  { href: "/entrenador", label: "Centro", icon: "hub", exact: true, hint: "Resumen del Tactical Coach." },
  { href: "/entrenador/jugar", label: "Jugar", icon: "match", primary: true, also: ["/entrenador/partido"], hint: "Inicia una partida con tu equipo." },
  { href: "/entrenador/composiciones", label: "Composiciones", icon: "comp", hint: "Elige los cinco agentes para cada mapa." },
  { href: "/entrenador/strats", label: "Pizarra", icon: "board", hint: "Diseña jugadas." },
  { href: "/entrenador/plan", label: "Plan", icon: "plan", hint: "Prepara estrategias para un partido." },
  { href: "/entrenador/mapas", label: "Mapas", icon: "maps", hint: "Estudia los doce mapas." },
  { href: "/entrenador/partidos", label: "Partidos", icon: "history", hint: "Tu historial de partidas." },
  { href: "/entrenador/equipos", label: "Plantilla", icon: "team", hint: "Gestiona tus cinco jugadores/cartas." },
];

export function isRoomActive(pathname: string, room: { href: string; exact?: boolean; also?: string[] }): boolean {
  if ((room.also ?? []).some((a) => pathname === a || pathname.startsWith(`${a}/`))) return true;
  if (room.exact) return pathname === room.href;
  return pathname === room.href || pathname.startsWith(`${room.href}/`);
}

export function CoachFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/entrenador";
  return (
    <div className="nx-coach" data-coach="4">
      <span aria-hidden className="nx-coach-bg" />
      <nav aria-label="Tactical Coach" className="mb-4 flex items-center gap-3 border-b border-[rgba(47,224,255,0.14)]">
        <Link href="/entrenador" className="hidden shrink-0 items-center gap-2 pr-2 lg:flex" aria-label="Tactical Coach · centro">
          <span className="grid h-8 w-8 place-items-center text-[#2fe0ff]" style={{ filter: "drop-shadow(0 0 6px rgba(47,224,255,0.7))" }}>
            <CoachIcon name="hub" size={22} />
          </span>
          <span className="leading-none">
            <b className="block font-display text-[13px] font-extrabold uppercase tracking-[0.18em] text-white">Tactical</b>
            <span className="block font-display text-[9.5px] font-bold uppercase tracking-[0.34em] text-[#2fe0ff]">Coach</span>
          </span>
        </Link>
        <div className="nx-coach-tabs min-w-0 flex-1">
          {COACH_ROOMS.map((r) => {
            const on = isRoomActive(pathname, r);
            return (
              <Link key={r.href} href={r.href} aria-current={on ? "page" : undefined} className="nx-coach-tab" data-primary={r.primary ? "true" : undefined} title={r.hint}>
                <CoachIcon name={r.icon} size={15} />
                {r.label}
              </Link>
            );
          })}
        </div>
      </nav>
      {children}
    </div>
  );
}

/** Cabecera de sala: kicker, título, línea y acciones. Misma en todas las pantallas del entrenador. */
export function CoachHeader({
  kicker, title, line, actions, className,
}: {
  kicker: string;
  title: React.ReactNode;
  line?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={`nx-coach-rise mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 ${className ?? ""}`}>
      <div className="min-w-0">
        <p className="nx-coach-kicker">{kicker}</p>
        <h1 className="mt-1.5 font-display text-[clamp(28px,3.6vw,46px)] font-extrabold uppercase leading-[0.92] tracking-[0.01em] text-white">{title}</h1>
        {line && <p className="nx-coach-muted mt-2 max-w-2xl text-[14px] leading-relaxed">{line}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
