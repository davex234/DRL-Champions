"use client";

/**
 * TRAYECTORIA DEL ENTRENADOR — lo que ata los partidos a la carrera.
 *
 * ────────────────────────── QUÉ FALTABA ──────────────────────────
 *
 * `/carrera` es —y sigue siendo— el centro de DESARROLLO de los jugadores: entrenamiento,
 * scouting, fichas de evolución y cierre de temporada. Lo que no tenía era la otra mitad de la
 * frase: qué ha hecho el ENTRENADOR. Se podía cerrar una temporada entera sin que la pantalla
 * dijera nunca cuántos partidos se habían dirigido ni cómo habían acabado.
 *
 * Esto es esa mitad, y es lo que cierra el recorrido que pedía el encargo:
 *
 *     PARTIDOS → RESULTADOS → PROGRESIÓN → CARRERA
 *
 * ────────────────────────── NI UNA CIFRA NUEVA ──────────────────────────
 *
 * Esto es importante, porque es donde se duplica la progresión sin querer.
 *
 *   · **Balance, diferencial y racha** salen de `coach_matches`, calculados en el servidor con
 *     `trayectoria` sobre las mismas filas que pinta el historial. No hay una columna
 *     «victorias» que alguien deba acordarse de incrementar.
 *   · **Nivel y XP** son los GLOBALES de la cuenta —`profiles.xp` vía `levelFromXp`—, los
 *     mismos que ya enseña la barra superior del juego. No hay un «nivel de entrenador»
 *     aparte: sería una segunda escalera para la misma persona.
 *   · **Temporada** viene del mundo (`useWorldStore`), que es el único reloj que existe.
 *
 * Cada número de esta pieza tiene exactamente un dueño en otra parte del producto. Aquí solo
 * se reúnen.
 *
 * ────────────────────────── SIN SESIÓN ──────────────────────────
 *
 * El historial vive en el servidor, así que sin cuenta no hay trayectoria que enseñar. La
 * pieza no se pinta a medias con ceros —un balance 0–0 falso es peor que ninguno—: se enseña
 * la invitación a entrar, y el resto de `/carrera` sigue funcionando igual.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchPartidosJugados, type CoachMatchRow, type CoachRecord } from "@/lib/match/history";
import { levelFromXp } from "@/domain/progression/levels";
import { useGameStore } from "@/store/useGameStore";
import { Stage, Plate, Rail, Medallion } from "@/components/ui/Surface";
import { Readout } from "@/components/ui/Readout";
import { NxButton } from "@/components/ui/NxButton";
import { cn } from "@/lib/format";

type Estado =
  | { fase: "cargando" }
  | { fase: "sin-sesion" }
  | { fase: "error" }
  | { fase: "listo"; matches: CoachMatchRow[]; record: CoachRecord };

export function CoachTrajectory({ season }: { season: number }) {
  const [estado, setEstado] = useState<Estado>({ fase: "cargando" });
  // El XP GLOBAL de la cuenta. El mismo que la barra superior; no se recalcula aquí.
  const xp = useGameStore((s) => s.xp);
  const nivel = levelFromXp(xp);

  useEffect(() => {
    let vivo = true;
    /*
     * Ocho filas para la tira de «Últimos»; el balance llega aparte y es de TODOS los partidos.
     * Antes se pedían veinte y el balance se calculaba sobre esas veinte, así que «Dirigidos»
     * no podía pasar nunca de 20.
     */
    void fetchPartidosJugados(8).then((r) => {
      if (!vivo) return;
      setEstado(r.estado === "ok" ? { fase: "listo", matches: r.matches, record: r.record } : { fase: r.estado });
    });
    return () => { vivo = false; };
  }, []);

  if (estado.fase === "cargando") return null;

  /* Un fallo no se pinta como ceros: un balance 0–0 inventado es peor que decir que no llegó. */
  if (estado.fase === "error") {
    return (
      <Plate className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <span className="nx-label">Trayectoria</span>
          <p className="mt-0.5 text-caption text-ink-muted">No se pudo leer tu trayectoria ahora mismo.</p>
        </div>
        <NxButton variant="secondary" size="md" href="/entrenador/partidos">Ver el expediente</NxButton>
      </Plate>
    );
  }

  if (estado.fase === "sin-sesion") {
    return (
      <Plate className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <span className="nx-label">Trayectoria</span>
          <p className="mt-0.5 text-caption text-ink-muted">
            Los partidos dirigidos se guardan en tu cuenta. Entra para llevar la cuenta de los tuyos.
          </p>
        </div>
        <NxButton variant="secondary" size="md" href="/cuenta">Entrar</NxButton>
      </Plate>
    );
  }

  const { record, matches } = estado;

  /* Sin partidos, la pieza es una puerta al modo, no un marcador a cero. */
  if (record.jugados === 0) {
    return (
      <Stage tone="primary" grid className="px-5 py-8 text-center">
        <span className="nx-label">Trayectoria</span>
        <h2 className="mt-1 font-display text-[clamp(19px,3vw,26px)] font-bold uppercase text-white">
          Tu carrera empieza en el banquillo
        </h2>
        <p className="mx-auto mt-1.5 max-w-md text-body text-ink-muted">
          Entrena a tus jugadores aquí y dirige partidos para que esto se llene.
        </p>
        <div className="mt-4">
          <NxButton variant="primary" size="lg" href="/entrenador/partido">Dirigir mi primer partido</NxButton>
        </div>
      </Stage>
    );
  }

  const dif = record.diferencialRondas;

  return (
    <section aria-label="Trayectoria del entrenador" className="space-y-2.5">
      <Rail label="Trayectoria" />

      <Stage tone={record.racha > 0 ? "success" : "neutral"} className="px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-3">
            <Medallion size={44} tone={record.racha > 0 ? "success" : "neutral"}>
              <span className="nx-readout text-[15px]">{nivel.level}</span>
            </Medallion>
            <div className="min-w-0">
              <span className="nx-label">Nivel de cuenta · Temporada {season}</span>
              <p className="mt-0.5 text-caption text-ink-muted">
                {nivel.xpIntoLevel} / {nivel.xpForNext} XP hacia el siguiente
              </p>
              {/* La MISMA progresión que la barra superior —`levelFromXp`—, no una escalera paralela. */}
              <span aria-hidden className="mt-1.5 block h-1 w-44 max-w-full overflow-hidden bg-white/10">
                <span
                  className="block h-full bg-drl"
                  style={{ width: `${Math.round(Math.min(1, Math.max(0, nivel.progress)) * 100)}%` }}
                />
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-stretch gap-2.5 sm:ml-auto">
            <Plate className="flex items-center px-4 py-2.5">
              <Readout size="sm" label="Dirigidos" value={record.jugados} />
            </Plate>
            <Plate className="flex items-center px-4 py-2.5">
              {/*
                El color dice la verdad del dato, no lo adorna. Un balance perdedor pintado de
                verde —porque «balance» suene a bueno— es una mentira pequeña que el jugador
                detecta antes que nadie: se tiñe según gane o pierda, y en tablas queda neutro.
              */}
              <Readout
                size="sm"
                label="Balance"
                value={`${record.ganados}–${record.perdidos}`}
                tone={record.ganados === record.perdidos ? undefined
                  : record.ganados > record.perdidos ? "var(--nx-ok)" : "var(--nx-key)"}
              />
            </Plate>
            <Plate className="flex items-center px-4 py-2.5">
              <Readout
                size="sm"
                label="Rondas"
                value={dif > 0 ? `+${dif}` : String(dif)}
                tone={dif >= 0 ? "var(--nx-ok)" : undefined}
              />
            </Plate>
            {record.racha !== 0 && (
              <Plate className="flex items-center px-4 py-2.5">
                <Readout
                  size="sm"
                  label="Racha"
                  value={`${Math.abs(record.racha)} ${record.racha > 0 ? "V" : "D"}`}
                  tone={record.racha > 0 ? "var(--nx-ok)" : "var(--nx-key)"}
                />
              </Plate>
            )}
          </div>
        </div>

        {/*
          Los últimos resultados, como una tira de fichas. Es la lectura rápida de la forma:
          cinco cuadros dicen «vengo ganando» más rápido que cualquier número.
        */}
        <div className="mt-3.5 flex flex-wrap items-center gap-1.5 border-t border-white/8 pt-3">
          <span className="nx-label mr-1">Últimos</span>
          {matches.slice(0, 8).map((m) => (
            <span
              key={m.id}
              title={`${m.won ? "Victoria" : "Derrota"} ${m.scoreHome}–${m.scoreAway} vs ${m.rivalName}`}
              className={cn(
                "nx-clip-sm grid h-6 w-6 place-items-center font-display text-[10px] font-bold",
                m.won ? "bg-ok/20 text-ok" : "bg-drl/20 text-drl-glow",
              )}
            >
              {m.won ? "V" : "D"}
            </span>
          ))}
          <Link href="/entrenador/partidos" className="nx-action ml-auto">
            Ver el expediente →
          </Link>
        </div>
      </Stage>
    </section>
  );
}
