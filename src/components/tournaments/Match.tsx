"use client";

/**
 * EL ENFRENTAMIENTO — la unidad competitiva del circuito (Fase 9).
 *
 * ────────────────────────── POR QUÉ EXISTE ──────────────────────────
 *
 * La auditoría de la Fase 9 midió la ficha de torneo y encontró un **listado
 * administrativo**: cuatro columnas —nombre, marcador, nombre, estado— repetidas cuarenta
 * veces, todas con el mismo peso. El partido que se está jugando AHORA (NRG 1–1 Sentinels,
 * en vivo) era la tercera fila de una tabla y no se distinguía de uno que terminó en julio.
 *
 * Un partido no es una fila: es **A contra B**. Aquí se lee así —los dos bandos enfrentados,
 * el marcador en medio y el estado dicho con texto, punto e insignia, no solo con color— y
 * el que está vivo pesa más que los demás.
 *
 * ────────────────────────── QUÉ NO HACE ──────────────────────────
 *
 * **Nada.** No decide quién gana, no compara marcadores y no deduce ningún estado: recibe
 * `MatchRow` tal y como la sirve `fetchMatches` y pinta `status`, `score_a`, `score_b` y
 * `winner_team_id` como llegan. El ganador lo dice el servidor en `winner_team_id`;
 * comparar aquí `score_a > score_b` sería reimplementar la regla en la interfaz.
 *
 * Tampoco inventa equipos: si `team_a` viene vacío —un hueco del cuadro todavía sin
 * resolver— se dice «Por decidir», que es lo que es.
 */
import { Plate, Piece, Recessed, Rail } from "@/components/ui/Surface";
import { Badge, StatusDot } from "@/components/ui/Badge";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { cn } from "@/lib/format";
import type { MatchRow } from "@/lib/game/client";
import { ns, td, getIntlLocale } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("tournaments");

/** Estado del partido, en el vocabulario del producto. No se traduce nada nuevo. */
const ESTADO: Record<string, { label: string; tone: "key" | "info" | "ok" | "muted" }> = {
  live: { label: "En vivo", tone: "key" },
  finished: { label: "Final", tone: "muted" },
  upcoming: { label: "Programado", tone: "info" },
};

/** El estado, traducido AQUÍ (catálogo de este módulo): «Final» de partido terminado no es la ronda «Final». */
const estadoText = (status: string, fallback: string): string =>
  status === "live" ? t("En vivo") : status === "finished" ? t("Final") : status === "upcoming" ? t("Programado") : td(fallback);

const fmtHora = (s: string | null): string =>
  s ? new Date(s).toLocaleString(getIntlLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : t("Sin fecha");

/**
 * UN ENFRENTAMIENTO.
 *
 * `size="hero"` es para el partido que está vivo: mismo contenido, más presencia. No es un
 * componente aparte porque no es otra cosa — es el mismo partido, mirado de cerca.
 */
export function MatchCard({
  m, size = "row", pick, className,
}: {
  m: MatchRow;
  size?: "row" | "hero";
  /**
   * TU PREDICCIÓN SOBRE ESTE PARTIDO, si la hay.
   *
   * El enlace NO se adivina cruzando nombres de equipo: lo trae el propio dominio en
   * `pickem_questions.match_id`, que ya viaja en el DTO. Esta pieza solo recibe la etiqueta
   * ya resuelta y la pinta; no sabe qué es un Pick'em ni consulta nada.
   */
  pick?: { label: string; tone: "info" | "ok" | "bad" | "muted" } | null;
  className?: string;
}) {
  useLocale();
  const estado = ESTADO[m.status] ?? { label: m.status, tone: "muted" as const };
  const vivo = m.status === "live";
  const jugado = m.status === "finished";
  // El ganador lo dice el SERVIDOR. Aquí solo se lee.
  const ganaA = m.winner_team_id != null && m.winner_team_id === m.team_a_id;
  const ganaB = m.winner_team_id != null && m.winner_team_id === m.team_b_id;

  const Envoltorio = vivo || size === "hero" ? Piece : Plate;
  const hero = size === "hero";

  return (
    <Envoltorio
      tone={vivo ? "primary" : "neutral"}
      className={cn(
        "relative w-full transition-colors duration-fast",
        hero ? "px-4 py-4 sm:px-6 sm:py-5" : "px-3 py-2.5 sm:px-4 sm:py-3",
        className,
      )}
      aria-label={t("{v} contra {v2}, {label}", { v: td(m.team_a) ?? t("Por decidir"), v2: td(m.team_b) ?? t("Por decidir"), label: estadoText(m.status, estado.label) })}
    >
      {/*
        LA CABECERA DEL PARTIDO: ronda y estado. El estado se dice CON PALABRAS y con su
        punto; el color es el tercer refuerzo, nunca el único (§«no depender exclusivamente
        del color»).
      */}
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="nx-label truncate">{td(m.round) ?? t("Partido")}</span>
          {/*
            LA COSTURA ENTRE LOS DOS MODOS. Un partido sobre el que tienes algo en juego lo
            dice aquí, en el partido — que es donde el jugador lo busca. Antes había que
            adivinar que la pregunta «Semifinal: ¿quién gana A vs B?» y el partido «A vs B»
            de la tabla de abajo eran la misma cosa.
          */}
          {pick && <Badge tone={pick.tone} dot>{td(pick.label)}</Badge>}
        </span>
        {vivo ? (
          <Badge tone="key" dot pulse>{estadoText(m.status, estado.label)}</Badge>
        ) : (
          <span className="flex shrink-0 items-center gap-1.5">
            <StatusDot tone={estado.tone} size={5} />
            <span className="nx-label">{jugado ? estadoText(m.status, estado.label) : fmtHora(m.start_time)}</span>
          </span>
        )}
      </div>

      {/*
        A · marcador · B. Las dos mitades son iguales; lo que cambia es quién ganó.

        En `hero` la fila se ACOTA y se centra: a 1.440 px los dos nombres acababan a 1.380 px
        uno de otro, con el marcador solo en medio, y eso ya no es un enfrentamiento sino dos
        etiquetas lejanas.
      */}
      <div className={cn("flex items-center gap-2 sm:gap-3", hero && "mx-auto max-w-[820px]")}>
        <Bando nombre={m.team_a} gana={ganaA} pierde={jugado && ganaB} hero={hero} />
        <Marcador m={m} hero={hero} vivo={vivo} />
        <Bando nombre={m.team_b} gana={ganaB} pierde={jugado && ganaA} hero={hero} align="right" />
      </div>
    </Envoltorio>
  );
}

/** Un bando del enfrentamiento. El que gana se afirma; el que pierde pierde presencia. */
function Bando({
  nombre, gana, pierde, hero, align = "left",
}: {
  nombre: string | null;
  gana: boolean;
  pierde: boolean;
  hero: boolean;
  align?: "left" | "right";
}) {
  useLocale();
  return (
    <span className={cn("flex min-w-0 flex-1 items-center gap-2", align === "right" && "justify-end")}>
      {/* El filo del bando: dice quién ganó sin depender del color del texto. */}
      {align === "left" && gana && <span aria-hidden className="h-4 w-[3px] shrink-0 bg-ok" />}
      <b
        className={cn(
          "min-w-0 truncate font-display font-bold uppercase tracking-[0.03em]",
          hero ? "text-[clamp(15px,2.4vw,22px)]" : "text-[13px] sm:text-[14px]",
          gana ? "text-white" : pierde ? "text-ink-faint" : "text-ink-secondary",
          align === "right" && "text-right",
        )}
      >
        {td(nombre) ?? t("Por decidir")}
      </b>
      {align === "right" && gana && <span aria-hidden className="h-4 w-[3px] shrink-0 bg-ok" />}
    </span>
  );
}

/**
 * EL MARCADOR, HUNDIDO EN EL CENTRO.
 *
 * Es una placa excavada, no un texto suelto: separa los dos bandos y da el punto de fuga de
 * la fila. Antes del partido dice «VS», que es exactamente lo que hay.
 */
function Marcador({ m, hero, vivo }: { m: MatchRow; hero: boolean; vivo: boolean }) {
  useLocale();
  const sinJugar = m.status === "upcoming";
  return (
    <Recessed
      depth="sm"
      className={cn(
        "shrink-0 px-2.5 py-1 text-center sm:px-3",
        hero ? "min-w-[86px]" : "min-w-[62px]",
      )}
    >
      <span
        className={cn(
          "nx-readout tabular-nums",
          hero ? "text-[clamp(18px,3vw,30px)]" : "text-[15px]",
          sinJugar ? "text-ink-faint" : vivo ? "text-drl" : "text-white",
        )}
      >
        {sinJugar ? t("VS") : `${m.score_a ?? 0}–${m.score_b ?? 0}`}
      </span>
    </Recessed>
  );
}

/**
 * EL CAMINO HACIA LA FINAL.
 *
 * ────────────────────────── CÓMO DECIDE SU FORMA ──────────────────────────
 *
 * Los partidos llegan agrupados por `round`, que es un TEXTO del servidor: en el torneo de
 * playoffs son «Cuartos», «Semifinal», «Final»; en una liga regular son «Week 1»…«Week 8».
 * Un cuadro de eliminatoria dibujado sobre ocho jornadas de liga no significa nada.
 *
 * Así que la forma la decide la FORMA DE LOS DATOS, no una lista de nombres:
 *
 *   · pocas rondas (≤ 4) y cada una con menos partidos que la anterior  →  ESCALERA
 *   · cualquier otra cosa                                              →  RONDAS APILADAS
 *
 * Es una decisión de presentación —qué reparto usar— y nada más: los mismos partidos, en el
 * mismo orden, con los mismos datos. Aquí no se calcula ningún emparejamiento ni se deduce
 * quién avanza; eso lo trae ya resuelto cada `MatchRow`.
 *
 * En escritorio la escalera usa el ancho, y **en móvil se desplaza dentro de su carril**, con
 * el desbordamiento declarado en el contenedor y nunca en la página.
 */
export function RoundLadder({
  rounds, picks, className,
}: {
  /** Partidos agrupados por ronda, en el orden en que los sirve el servidor. */
  rounds: [string, MatchRow[]][];
  /** Marca de predicción por `match_id`, ya resuelta por quien conoce los Pick'ems. */
  picks?: Record<string, { label: string; tone: "info" | "ok" | "bad" | "muted" }>;
  className?: string;
}) {
  useLocale();
  const escalera =
    rounds.length > 1 &&
    rounds.length <= 4 &&
    rounds.every(([, l], i) => i === 0 || l.length < rounds[i - 1][1].length);

  if (!escalera) {
    return (
      <div className={cn("space-y-5", className)}>
        {rounds.map(([ronda, lista]) => (
          <section key={ronda} aria-label={td(ronda)}>
            <Rail label={td(ronda)} className="mb-2.5" />
            <div className="grid gap-2">
              {lista.map((m) => <MatchCard key={m.id} m={m} pick={picks?.[m.id]} />)}
            </div>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn(
        // El carril se desplaza; la PÁGINA no. Sin barra a la vista.
        "-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
      role="group"
      aria-label={t("Camino hacia la final")}
    >
      <div className="flex min-w-max items-stretch gap-3">
        {rounds.map(([ronda, lista], i) => (
          <div key={ronda} className="flex w-[min(78vw,300px)] shrink-0 flex-col gap-2">
            <SectionTitle as="h3" className="!mb-1">
              {td(ronda)}
            </SectionTitle>
            {/*
              Cada ronda se centra respecto a la anterior: es lo que hace que la escalera se
              lea como un embudo hacia la final en vez de como tres columnas sueltas.
            */}
            <div className={cn("flex flex-1 flex-col gap-2", i > 0 && "justify-around")}>
              {lista.map((m) => <MatchCard key={m.id} m={m} pick={picks?.[m.id]} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
