"use client";

/**
 * PARTIDOS JUGADOS — el expediente del entrenador.
 *
 * ────────────────────────── POR QUÉ NO EXISTÍA HASTA AHORA ──────────────────────────
 *
 * Porque no había nada que enseñar. El bloque anterior lo dejó declarado como pendiente en la
 * home —«el historial todavía no se guarda en ningún sitio»— en vez de pintar una tabla con
 * partidos inventados. Ahora `coach_matches` los guarda de verdad y esta pantalla los lee.
 *
 * ────────────────────────── NO ES UNA TABLA ──────────────────────────
 *
 * Un historial competitivo no se lee columna a columna: se recorre buscando cómo fue. Así que
 * cada partido es una PIEZA con su jerarquía —resultado, marcador, rival, mapa, fecha— y no
 * una fila con seis celdas del mismo peso. El resultado manda: es lo primero que se ve, tiñe
 * la pieza entera y no comparte tamaño con nada.
 *
 * ────────────────────────── EL BALANCE NO ES UN CONTADOR ──────────────────────────
 *
 * Jugados, ganados, diferencial y racha salen de las MISMAS filas, calculados en el servidor
 * con `trayectoria`. No hay una columna «victorias» que alguien tenga que acordarse de sumar:
 * un contador paralelo es una segunda verdad esperando a desincronizarse con la primera.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { fetchPartidosJugados, type CoachMatchRow, type CoachRecord } from "@/lib/match/history";
import { getTacticalMap } from "@/domain/tactics";
import { Plate, Piece, Rail } from "@/components/ui/Surface";
import { MapThumb } from "@/components/tactics/MapThumb";
import { NxButton } from "@/components/ui/NxButton";
import { Readout } from "@/components/ui/Readout";
import { cn } from "@/lib/format";
import { CoachHeader } from "@/components/coach/tc/CoachFrame";
import { CoachIcon } from "@/components/coach/tc/CoachIcons";
import { TacticalHeroArt } from "@/components/coach/tc/TacticalHeroArt";
import { ns, td, lazyDateTimeFormat } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("entrenador");

export default function PartidosJugadosPage() {
  return (
    <HydrationGate>
      <Historial />
    </HydrationGate>
  );
}

type Estado =
  | { fase: "cargando" }
  | { fase: "sin-sesion" }
  | { fase: "error" }
  | { fase: "listo"; matches: CoachMatchRow[]; record: CoachRecord; total: number };

/** Partidos por página. Un historial se recorre desde arriba: lo reciente es lo que se busca. */
const PAGINA = 30;

function Historial() {
  useLocale();
  const [estado, setEstado] = useState<Estado>({ fase: "cargando" });
  const [intento, setIntento] = useState(0);
  const [mas, setMas] = useState<"quieto" | "cargando" | "error">("quieto");

  useEffect(() => {
    let vivo = true;
    setEstado({ fase: "cargando" });
    void fetchPartidosJugados(PAGINA, 0).then((r) => {
      if (!vivo) return;
      setEstado(r.estado === "ok"
        ? { fase: "listo", matches: r.matches, record: r.record, total: r.total }
        : { fase: r.estado });
    });
    return () => { vivo = false; };
  }, [intento]);

  /*
   * La página siguiente se pide desde lo que ya hay pintado. Si entretanto se ha registrado un
   * partido nuevo, el desplazamiento corre uno y podría repetirse una ficha: se filtran por id
   * para que ninguna salga dos veces.
   */
  const verMas = async () => {
    if (estado.fase !== "listo" || mas === "cargando") return;
    setMas("cargando");
    const r = await fetchPartidosJugados(PAGINA, estado.matches.length);
    if (r.estado !== "ok") { setMas("error"); return; }
    setMas("quieto");
    setEstado((e) => {
      if (e.fase !== "listo") return e;
      const vistos = new Set(e.matches.map((m) => m.id));
      return {
        fase: "listo",
        matches: [...e.matches, ...r.matches.filter((m) => !vistos.has(m.id))],
        record: r.record,
        total: r.total,
      };
    });
  };

  return (
    <div className="space-y-5">
      {/* FASE 51 · la cabecera de sala del Tactical Coach: el expediente es una sala más. */}
      <CoachHeader
        className="!mb-0"
        kicker={tr("Match Archive · expediente")}
        title={tr("Partidos jugados")}
        line={estado.fase === "listo" && estado.total > 0 ? (
          // El recorrido sigue: de aquí se vuelve a jugar o se sube a la carrera.
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            <Link href="/entrenador/partido" className="nx-action">{tr("Dirigir otro partido →")}</Link>
            <Link href="/carrera" className="nx-action">{tr("Ver tu carrera →")}</Link>
          </span>
        ) : undefined}
        actions={estado.fase === "listo" && estado.record.jugados > 0 ? <Balance record={estado.record} /> : undefined}
      />

      {estado.fase === "cargando" && (
        <Plate className="px-5 py-10 text-center">
          <p className="text-body text-ink-faint">{tr("Cargando tu expediente…")}</p>
        </Plate>
      )}

      {/*
        Un fallo de lectura se dice como fallo. Antes caía en «inicia sesión», que a un jugador
        con sesión le contaba algo falso sobre por qué no veía sus partidos.
      */}
      {estado.fase === "error" && (
        <Plate className="px-5 py-10 text-center">
          <p className="text-body text-ink-muted">{tr("No se pudo leer tu expediente.")}</p>
          <div className="mt-4">
            <NxButton variant="secondary" size="md" onClick={() => setIntento((n) => n + 1)}>
              {tr("Reintentar")}
            </NxButton>
          </div>
        </Plate>
      )}

      {estado.fase === "sin-sesion" && (
        <Vacio
          titulo={tr("El historial vive en tu cuenta")}
          linea={tr("Los partidos dirigidos se guardan en el servidor. Inicia sesión para que los tuyos consten.")}
          cta={{ label: tr("Entrar o registrarse"), href: "/cuenta" }}
        />
      )}

      {estado.fase === "listo" && estado.matches.length === 0 && (
        <Vacio
          titulo={tr("Todavía no has dirigido ningún partido")}
          linea={tr("Cuando termines uno, aparecerá aquí con su resultado, su rival y su mapa.")}
          cta={{ label: tr("Jugar partido"), href: "/entrenador/partido" }}
        />
      )}

      {estado.fase === "listo" && estado.matches.length > 0 && (
        <section aria-label={tr("Partidos dirigidos")} className="space-y-2.5">
          {/* El TOTAL, no los pintados: con paginación son dos números distintos. */}
          <Rail label={tr("{n, plural, one {{n} partido} other {{n} partidos}}", { n: estado.total })} />
          {/*
            Fichas en rejilla, no filas a todo el ancho. Como fila, a 1440 px la ficha se estiraba
            hasta dejar el centro vacío y se leía como una tabla de administración; como pieza,
            cada partido tiene su forma y la lista se recorre como un historial.
          */}
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {estado.matches.map((m) => (
              <li key={m.id} className="h-full"><FichaPartido m={m} /></li>
            ))}
          </ul>
          {estado.matches.length < estado.total && (
            <div className="flex flex-col items-center gap-1.5 pt-1">
              <NxButton variant="secondary" size="md" onClick={verMas} disabled={mas === "cargando"}>
                {mas === "cargando" ? tr("Cargando…") : tr("Ver más · quedan {v}", { v: estado.total - estado.matches.length })}
              </NxButton>
              {mas === "error" && (
                <span className="text-caption text-drl-glow">{tr("No se pudieron cargar. Vuelve a intentarlo.")}</span>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/** El balance del entrenador. Cuatro cifras, todas derivadas de los mismos partidos. */
function Balance({ record }: { record: CoachRecord }) {
  useLocale();
  const dif = record.diferencialRondas;
  return (
    <div className="flex flex-wrap items-stretch gap-2.5">
      <Plate className="flex items-center px-4 py-2.5">
        {/*
          El color dice la verdad del dato, no lo adorna. Un balance perdedor pintado de
          verde —porque «balance» suene a bueno— es una mentira pequeña que el jugador
          detecta antes que nadie: se tiñe según gane o pierda, y en tablas queda neutro.
        */}
        <Readout
          size="sm"
          label={tr("Balance")}
          value={`${record.ganados}–${record.perdidos}`}
          tone={record.ganados === record.perdidos ? undefined
            : record.ganados > record.perdidos ? "var(--nx-ok)" : "var(--nx-key)"}
        />
      </Plate>
      <Plate className="flex items-center px-4 py-2.5">
        <Readout
          size="sm"
          label={tr("Rondas")}
          value={dif > 0 ? `+${dif}` : String(dif)}
          tone={dif >= 0 ? "var(--nx-ok)" : undefined}
        />
      </Plate>
      {record.racha !== 0 && (
        <Plate className="flex items-center px-4 py-2.5">
          <Readout
            size="sm"
            label={tr("Racha")}
            value={`${Math.abs(record.racha)} ${record.racha > 0 ? "V" : "D"}`}
            tone={record.racha > 0 ? "var(--nx-ok)" : "var(--nx-key)"}
          />
        </Plate>
      )}
    </div>
  );
}

const FECHA = lazyDateTimeFormat({ day: "2-digit", month: "short", year: "numeric" });
const LADO = { ATK: "Ataque", DEF: "Defensa" } as const;

function FichaPartido({ m }: { m: CoachMatchRow }) {
  useLocale();
  const mapa = getTacticalMap(m.mapId);
  const fecha = m.finishedAt ? FECHA.format(new Date(m.finishedAt)) : "";

  return (
    <Piece tone={m.won ? "success" : "primary"} className="relative h-full overflow-hidden">
      {/*
        El MAPA de fondo, muy atenuado. Es el asset real de donde se jugó —hoy siempre Ascent,
        porque es lo que el simulador juega— y no decoración elegida para rellenar. Si algún día
        un partido se jugara en un mapa sin asset, la ficha simplemente no tendría fondo.
      */}
      {mapa && (
        <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-3/5">
          <MapThumb map={mapa} className="h-full w-full opacity-[0.14]" />
          <span
            className="absolute inset-0"
            style={{ background: "linear-gradient(90deg, rgba(6,7,13,1), rgba(6,7,13,0.3) 60%, rgba(6,7,13,0.75))" }}
          />
        </div>
      )}
      {/* El filo del resultado: se lee de reojo al recorrer la lista, antes que ninguna palabra. */}
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", m.won ? "bg-ok" : "bg-drl")} />

      <div className="relative px-4 pb-3 pt-3.5 sm:px-5">
        {/* ── 1 · EL RESULTADO, y en la otra esquina DÓNDE ── */}
        <div className="flex items-start justify-between gap-3">
          <b
            className={cn(
              "font-display text-[20px] font-bold uppercase leading-none tracking-[0.08em]",
              m.won ? "text-ok" : "text-drl-glow",
            )}
          >
            {m.won ? tr("Victoria") : tr("Derrota")}
          </b>
          <span className="min-w-0 text-right">
            <b className="block truncate font-display text-[13px] font-bold uppercase tracking-[0.14em] text-white/85">
              {mapa?.name ?? m.mapId}
            </b>
            {/* El sitio va dicho: el simulador juega UN sitio, no el mapa entero. */}
            {m.mapSite && <span className="block text-caption text-ink-faint">{tr("sitio")} {td(m.mapSite)}</span>}
          </span>
        </div>

        {/* ── 2 · EL MARCADOR — el único número a tamaño de titular ── */}
        <p className="nx-readout mt-3 text-[40px] leading-none text-white sm:text-[44px]">
          {m.scoreHome}
          <span className="mx-2 text-ink-faint">—</span>
          {m.scoreAway}
        </p>

        {/* ── 3 · CONTRA QUIÉN · 4 · CUÁNDO ── */}
        <p className="mt-2.5 truncate font-display text-[14px] font-bold uppercase tracking-wide text-white">
          <span className="text-ink-faint">{tr("vs")}</span> {m.rivalName}
        </p>
        <p className="mt-0.5 truncate text-caption text-ink-muted">
          {td(fecha)} · {td(LADO[m.startSide])} {tr("de salida ·")} {m.teamName}
        </p>

        {/*
          ── 5 · DETALLE: solo lo que el partido dejó de verdad ──
          La duración (`durationSeconds`) se guarda pero NO se enseña. Es el reloj interno del
          motor: un 13-7 de veinte rondas marca unos tres minutos, que no corresponden a nada que
          el jugador haya vivido —ni a lo que dura una ronda de verdad, ni al rato que pasó en la
          sala táctica—. Un número exacto que no significa nada es peor que no ponerlo.
        */}
        <p className="mt-3 border-t border-white/8 pt-2 text-caption text-ink-faint">
          {tr("{n, plural, one {{n} ronda} other {{n} rondas}}", { n: m.rounds })}
          {m.mvp && <> {tr("· Destacado")} <b className="text-white/75">{m.mvp}</b></>}
        </p>

        {/*
          ── 6 · EL PLAN TÁCTICO ──

          `/entrenador/plan?match=<id>` existe desde la Fase 47 y **no se llegaba a ella desde
          ningún sitio**: sólo escribiendo la URL a mano. La propia pantalla del plan dice «abre
          un plan desde Partidos» — una promesa que esta lista no cumplía. Aquí está la puerta.

          No inventa nada: es el mismo partido de esta ficha, con su identificador real.
        */}
        <p className="mt-2.5">
          <Link href={`/entrenador/plan?match=${m.id}`} className="nx-coach-btn" data-variant="ghost" data-size="sm">
            <CoachIcon name="plan" size={14} /> {tr("Plan táctico")}
          </Link>
        </p>
      </div>
    </Piece>
  );
}

/**
 * El estado vacío es una PUERTA, no un aviso.
 *
 * Una tabla vacía dice «aquí no hay nada» y deja al jugador donde estaba. Esto dice qué falta
 * y lleva directamente al sitio donde se arregla, que en un modo de juego es siempre jugar.
 */
function Vacio({
  titulo, linea, cta,
}: {
  titulo: string;
  linea: string;
  cta: { label: string; href: string };
}) {
  useLocale();
  return (
    /*
     * FASE 51 · VACÍO PREMIUM. La sala táctica al fondo (arte original, sin assets externos), qué
     * falta en una frase y el recorrido que lo llena en tres pasos. Nada inventado: ni partidos de
     * ejemplo ni cifras de relleno.
     */
    <section data-testid="matches-empty" className="nx-coach-panel relative isolate overflow-hidden px-5 py-12 text-center sm:px-8">
      <TacticalHeroArt className="pointer-events-none absolute inset-0 -z-10 h-full w-full opacity-35" />
      <span aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(60%_70%_at_50%_50%,rgba(5,10,22,0.35),rgba(5,10,22,0.92))]" />
      <span aria-hidden className="nx-coach-pulse mx-auto mb-3 grid h-14 w-14 place-items-center text-[#2fe0ff]" style={{ filter: "drop-shadow(0 0 10px rgba(47,224,255,0.7))" }}>
        <CoachIcon name="history" size={40} />
      </span>
      <p className="nx-coach-kicker">{tr("Expediente vacío")}</p>
      <h2 className="mt-1.5 font-display text-[clamp(22px,3.5vw,34px)] font-extrabold uppercase leading-tight text-white">
        {td(titulo)}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-[14.5px] leading-relaxed text-white/65">{td(linea)}</p>
      <ol className="mx-auto mt-6 grid max-w-2xl gap-2 text-left sm:grid-cols-3">
        {[
          ["01", tr("Elige plantilla"), tr("Tu equipo y el rival")],
          ["02", tr("Dirige el partido"), tr("Tácticas ronda a ronda")],
          ["03", tr("Prepara el plan"), tr("Jugadas para la revancha")],
        ].map(([n, t, d]) => (
          <li key={n} className="nx-coach-panel-flat px-3 py-2.5">
            <b className="font-display text-[18px] font-extrabold text-[#2fe0ff]">{td(n)}</b>
            <span className="ml-2 font-display text-[12px] font-bold uppercase tracking-[0.1em] text-white">{td(t)}</span>
            <span className="mt-0.5 block text-[12px] text-white/50">{td(d)}</span>
          </li>
        ))}
      </ol>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link href={cta.href} className="nx-coach-btn">{td(cta.label)}</Link>
        <Link href="/entrenador" className="nx-coach-btn" data-variant="ghost">{tr("Volver al centro táctico")}</Link>
      </div>
    </section>
  );
}
