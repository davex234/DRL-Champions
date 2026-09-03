"use client";

/**
 * ENTRENADOR — el centro de mando (Fase 9H).
 *
 * Antes, `/entrenador` ERA el simulador: al entrar te caía encima un partido en marcha con
 * su HUD de retransmisión y su deck de control. Todo lo demás del rol de entrenador —los
 * equipos, las alineaciones, la pizarra— estaba repartido por rutas que no se enlazaban
 * entre sí. Si no sabías que existían, no existían.
 *
 * Ahora la raíz es el vestíbulo del rol y el partido vive en `/entrenador/partido`.
 *
 * HONESTIDAD SOBRE LO QUE HAY
 *   Las secciones que aún no tienen pantalla NO se enseñan como si la tuvieran. Se marcan
 *   como pendientes, con lo que ya se sabe de ellas. Un botón que lleva a una pantalla que
 *   no existe es peor que un hueco declarado.
 *
 * FASE 9.6 — LA RUTA.
 *   Lo que faltaba no era ninguna pantalla: estaban las cuatro (plantilla, mapas, pizarra
 *   y partido) y funcionan. Faltaba decir que son UN RECORRIDO. Presentadas como seis
 *   tarjetas sueltas, el centro táctico se leía como un índice y no como un método, y por
 *   eso parecía que faltaba algo que en realidad ya está.
 *
 *   La tira de arriba lo dice en cuatro pasos —montar equipo → estudiar mapa → dibujar la
 *   jugada → dirigirla— con el ESTADO REAL de cada uno: los titulares salen del store de
 *   equipos y las estrategias guardadas de `/api/game/strats`, que es donde viven. Ningún
 *   paso se marca como pendiente si su pantalla existe.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { useTeamStore } from "@/store/useTeamStore";
import { TACTICAL_MAPS } from "@/domain/tactics";
import { MapThumb } from "@/components/tactics/MapThumb";
import { fetchStrats } from "@/lib/tactics/client";
import { cn } from "@/lib/format";

export default function EntrenadorPage() {
  return (
    <HydrationGate>
      <CoachHub />
    </HydrationGate>
  );
}

function CoachHub() {
  const teams = useTeamStore((s) => s.teams);
  const activeTeamId = useTeamStore((s) => s.activeTeamId);
  const active = teams.find((t) => t.id === activeTeamId) ?? teams[0] ?? null;
  const ready = active ? active.starters.length : 0;

  /*
   * Cuántas estrategias tienes guardadas. Es la misma lectura que hace `/entrenador/strats`
   * y falla en silencio: sin sesión o sin red, la ruta se enseña igual con el paso de la
   * pizarra sin contador. Un vestíbulo no puede quedarse en blanco porque una cifra de
   * apoyo no haya llegado.
   */
  const [strats, setStrats] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    fetchStrats()
      .then((rows) => { if (alive) setStrats(rows.length); })
      .catch(() => { if (alive) setStrats(null); });
    return () => { alive = false; };
  }, []);

  const steps = [
    {
      n: 1,
      label: "Monta el equipo",
      href: "/entrenador/equipos",
      done: ready === 5,
      state: active ? `${ready} de 5 titulares` : "Sin equipo",
    },
    {
      n: 2,
      label: "Estudia el mapa",
      href: "/entrenador/mapas",
      done: true,
      state: `${TACTICAL_MAPS.length} trazados propios`,
    },
    {
      n: 3,
      label: "Dibuja la jugada",
      href: "/entrenador/strats",
      done: (strats ?? 0) > 0,
      state: strats === null
        ? "Pizarra táctica"
        : strats === 0
          ? "Ninguna guardada todavía"
          : `${strats} ${strats === 1 ? "estrategia guardada" : "estrategias guardadas"}`,
    },
    {
      n: 4,
      label: "Dirige el partido",
      href: "/entrenador/partido",
      done: false,
      state: ready === 5 ? "Listo para dirigir" : "Necesita cinco titulares",
    },
  ];

  return (
    <div className="space-y-7">
      <header>
        <span className="nx-label">Jugar</span>
        <h1 className="mt-1 font-display text-[clamp(30px,5vw,48px)] font-bold uppercase leading-none text-white">
          Entrenador
        </h1>
        <p className="mt-2 max-w-2xl text-[15px] text-white/55">
          Tú no disparas: decides. Monta el equipo, estudia el mapa, dibuja la jugada y
          dirige el partido ronda a ronda.
        </p>
      </header>

      {/*
        ═══ LA RUTA TÁCTICA ═══
        Cuatro pasos, con su estado real. Es la respuesta a «creo una estrategia, la guardo
        y la ejecuto»: hasta ahora ese recorrido existía en el producto pero en ninguna
        pantalla, así que había que deducirlo de una rejilla de herramientas.
      */}
      <section className="nx-stage nx-clip relative overflow-hidden px-4 py-5 sm:px-6" aria-label="La ruta táctica">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{ background: "radial-gradient(620px 260px at 8% 120%, rgba(63,192,122,0.20), transparent 68%)" }}
        />
        <h2 className="nx-label mb-4">Cómo se dirige un partido en NEXUS</h2>
        <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {steps.map((st, i) => (
            <li key={st.n} className="relative">
              {/* La línea que une un paso con el siguiente: es lo que lo hace recorrido. */}
              {i < steps.length - 1 && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute right-[-14px] top-[22px] hidden h-px w-[14px] bg-white/15 xl:block"
                />
              )}
              <Link
                href={st.href}
                className="group flex items-start gap-3 rounded-card border border-white/[0.09] bg-white/[0.025] p-3 transition duration-fast hover:border-white/25 hover:bg-white/[0.05]"
              >
                <span
                  className={cn(
                    "nx-clip-sm grid h-9 w-9 shrink-0 place-items-center border font-display text-[15px] font-bold",
                    st.done
                      ? "border-ok/60 bg-ok/15 text-ok"
                      : "border-white/15 bg-white/[0.04] text-white/55",
                  )}
                  style={{ ["--nx-chamfer-sm" as string]: "7px" }}
                >
                  {st.done ? "✓" : st.n}
                </span>
                <span className="min-w-0">
                  <b className="block font-display text-[14px] font-bold uppercase tracking-[0.06em] text-white">
                    {st.label}
                  </b>
                  <span className={cn("mt-0.5 block text-[12px]", st.done ? "text-ok/80" : "text-white/45")}>
                    {st.state}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Lo primero: ¿tienes equipo? ── */}
      <section
        className={cn(
          "flex flex-wrap items-center justify-between gap-4 rounded-panel border px-5 py-4",
          ready === 5 ? "border-ok/35 bg-ok/[0.06]" : "border-drl/35 bg-drl/[0.06]",
        )}
      >
        <div>
          <span className="nx-label block">Equipo activo</span>
          <b className="font-display text-2xl font-bold text-white">
            {active ? active.name : "Sin equipo"}
          </b>
          <p className="text-[13px] text-white/50">
            {active
              ? ready === 5
                ? "Alineación completa: cinco titulares."
                : `${ready} de 5 titulares. Completa la alineación para dirigir un partido.`
              : "Crea un equipo con tus cartas para empezar."}
          </p>
        </div>
        <Link
          href="/entrenador/equipos"
          className="rounded-control bg-drl px-5 py-2.5 font-display text-sm font-bold uppercase tracking-[0.12em] shadow-glow transition duration-fast hover:brightness-110"
        >
          {active ? "Gestionar equipo" : "Crear equipo"}
        </Link>
      </section>

      {/*
        ── Los mapas, primero ──
        Estaban debajo de seis tarjetas de texto, es decir, fuera de la pantalla. En un
        centro táctico los mapas SON el contenido y las herramientas son la navegación
        para llegar a ellos; poner el índice por delante del material dejaba la pantalla
        pareciendo una tabla de contenidos.
      */}
      <section aria-label="Mapas">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="nx-label">Mapas</h2>
          <Link href="/entrenador/mapas" className="nx-action">
            Verlos en detalle →
          </Link>
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          {TACTICAL_MAPS.map((m) => (
            <Link
              key={m.id}
              href={`/entrenador/mapas#${m.id}`}
              className="nx-card group overflow-hidden"
            >
              {/*
                El TRAZADO, no un párrafo. Cuatro mapas dibujados y el vestíbulo no enseñaba
                ninguno: en una herramienta táctica eso es una tienda sin escaparate. La
                silueta se reconoce antes de leer el nombre, que es como funciona la memoria
                de un mapa.
              */}
              <div className="relative aspect-square w-full overflow-hidden border-b border-white/8 bg-black/40">
                <MapThumb map={m} className="transition-transform duration-normal ease-out group-hover:scale-[1.06]" />
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0"
                  style={{ boxShadow: "inset 0 -28px 32px -18px rgba(6,7,13,0.95)" }}
                />
              </div>
              <div className="p-4">
                <span className="nx-label">{m.sites === 1 ? "Un sitio" : `${m.sites} sitios`}</span>
                <b className="mt-0.5 block font-display text-xl font-bold uppercase text-white">{m.name}</b>
                <p className="mt-1 text-[12.5px] leading-snug text-white/50">{m.identity}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
      {/* ── Las herramientas ── */}
      <section aria-label="Herramientas del entrenador">
        <h2 className="nx-label mb-3">Herramientas</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Tool
            href="/entrenador/equipos"
            tag="Equipos y alineaciones"
            title="Plantilla"
            line="Monta equipos con tus cartas y elige los cinco titulares. Los equipos y las alineaciones son la misma pantalla: una alineación es un equipo con sus titulares marcados."
            tint="255,46,99"
          />
          <Tool
            href="/entrenador/mapas"
            tag="Mapas"
            title="Los cuatro trazados"
            line={`${TACTICAL_MAPS.length} mapas propios de NEXUS, cada uno con un problema táctico distinto. Estúdialos antes de dibujar nada.`}
            tint="25,227,255"
          />
          <Tool
            href="/entrenador/strats"
            tag="Strats"
            title="Pizarra"
            line="Coloca a los cinco, marca los movimientos y ordena los pasos. Se guardan en tu cuenta."
            tint="255,211,92"
          />
          <Tool
            href="/entrenador/partido"
            tag="Preparación y simulador"
            title="Dirigir un partido"
            line="Sala táctica, ronda a ronda con HUD de retransmisión, tiempos muertos y ceremonia final."
            tint="63,192,122"
            disabled={ready !== 5}
            disabledHint="Necesitas una alineación de cinco titulares."
          />
          <Tool
            href="/carrera"
            tag="Desarrollo"
            title="Carrera"
            line="Entrenamiento, fichas de desarrollo, scouting y cierre de temporada."
            tint="123,92,255"
          />
          <Pending
            tag="Historial"
            title="Partidos jugados"
            line="El registro de los partidos dirigidos —resultado, mapa, rondas y decisiones— todavía no se guarda en ningún sitio. Hasta que exista esa persistencia, esta sección no se enseña como si funcionara."
          />
        </div>
      </section>

    </div>
  );
}

function Tool({
  href, tag, title, line, tint, disabled, disabledHint,
}: {
  href: string;
  tag: string;
  title: string;
  line: string;
  tint: string;
  disabled?: boolean;
  disabledHint?: string;
}) {
  const body = (
    <>
      <span className="nx-label" style={{ color: disabled ? undefined : `rgb(${tint})` }}>{tag}</span>
      <span className="mt-1 block font-display text-2xl font-bold uppercase tracking-wide text-white">
        {title}
      </span>
      <span className="mt-1.5 block text-[13px] leading-snug text-white/50">{line}</span>
      {disabled && disabledHint && (
        <span className="mt-2 block font-display text-[11px] uppercase tracking-wide text-drl-glow">
          {disabledHint}
        </span>
      )}
    </>
  );

  // Deshabilitado no es «invisible»: se ve, se entiende y dice qué falta para poder entrar.
  if (disabled) {
    return (
      <div className="rounded-panel border border-white/8 p-5 opacity-60" aria-disabled>
        {body}
      </div>
    );
  }

  return (
    <Link
      href={href}
      className="nx-sweep group relative overflow-hidden rounded-panel border border-white/10 p-5 transition duration-fast hover:border-white/30"
      style={{ background: `linear-gradient(160deg, rgba(${tint},0.14), rgba(255,255,255,0.02) 62%)` }}
    >
      {body}
      <span
        aria-hidden
        className="mt-4 block h-[2px] w-9 rounded-full transition-[width] duration-normal ease-out group-hover:w-16"
        style={{ background: `rgb(${tint})` }}
      />
    </Link>
  );
}

/** Una sección que todavía no existe. Se declara, no se disimula. */
function Pending({ tag, title, line }: { tag: string; title: string; line: string }) {
  return (
    <div className="rounded-panel border border-dashed border-white/12 p-5">
      <span className="nx-label">{tag}</span>
      <span className="mt-1 block font-display text-2xl font-bold uppercase tracking-wide text-white/45">
        {title}
      </span>
      <span className="mt-1.5 block text-[13px] leading-snug text-white/40">{line}</span>
      <span className="mt-3 inline-block rounded-chip border border-white/12 px-2 py-1 font-display text-[10px] font-bold uppercase tracking-label text-white/35">
        Por definir
      </span>
    </div>
  );
}
