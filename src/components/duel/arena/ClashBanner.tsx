"use client";

/**
 * EL RÓTULO DEL ENFRENTAMIENTO — con qué pelea cada uno este turno, y con qué números.
 *
 * ────────────────────────── POR QUÉ EXISTE ──────────────────────────
 *
 * En la arena anterior la estadística declarada era un texto de once píxeles al lado de la
 * carta del rival: «GAMESENSE 99», en gris, perdido entre el resto de la interfaz. Y es EL
 * DATO del turno: lo único que decide quién gana. Aquí ocupa el centro de la mesa.
 *
 * ────────────────────────── CADA BANDO TIENE SU EJE ──────────────────────────
 *
 * Esto es lo que la primera versión de este componente se comió, y se vio en la primera
 * captura: enseñaba **un solo** nombre de estadística sobre las dos cifras, cuando el que
 * ataca declara la suya y el que defiende responde con la que le impone la tabla del
 * dominio. Salía «ENTRYFRAG 97 vs —» mientras el aviso de abajo decía «responde con
 * Stronghold». Dos ejes distintos bajo un solo título es, sencillamente, mentira.
 *
 *     ┌──────────────────────────────────┐
 *     │  ENTRYFRAG          STRONGHOLD   │
 *     │      97       VS         84      │
 *     └──────────────────────────────────┘
 *
 * Cuando los dos ejes coinciden se enseña un único título, porque entonces sí es una
 * comparación directa.
 *
 * ────────────────────────── QUÉ NO HACE ──────────────────────────
 *
 * No compara. Recibe los ejes y los valores ya resueltos por el servidor —el del defensor
 * sale de `requiredStat`, que calcula el dominio— y los pinta. El realce del ganador solo
 * aparece cuando el turno ESTÁ resuelto y el veredicto llega de fuera en `winner`.
 */
import { motion } from "framer-motion";
import { cn } from "@/lib/format";
import { STAT_INFO, type CombatStatKey } from "@/lib/duel/types";
import { EASE } from "@/design/motion";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("duel");

export function ClashBanner({
  youStat, youValue, rivalStat, rivalValue, winner, hint, className,
}: {
  /** Tu eje. Atacando lo eliges; defendiendo lo impone el servidor. `null` si aún no hay. */
  youStat: CombatStatKey | null;
  youValue: number | null;
  /** El eje del rival. Solo se conoce cuando ya ha declarado. */
  rivalStat: CombatStatKey | null;
  rivalValue: number | null;
  /** Veredicto YA RESUELTO por el servidor. `null` mientras el turno sigue abierto. */
  winner?: "A" | "B" | "TIE" | null;
  hint?: string;
  className?: string;
}) {
  useLocale();
  const mismoEje = youStat != null && youStat === rivalStat;
  /*
   * FASE 45 · EL ENFRENTAMIENTO RESUELTO ES OTRO MOMENTO, NO EL MISMO MAS PEQUENO.
   *
   * Hasta aqui la placa se veia igual esperando una declaracion que con el turno ya decidido:
   * la misma caja de 420 px, las mismas cifras de 31 px, y el veredicto en un rotulo de DIEZ
   * pixeles debajo. El instante que decide el turno era el elemento mas pequeno de la pantalla.
   *
   * `resuelto` parte el componente en dos presentaciones del MISMO dato: en espera sigue siendo
   * una placa discreta que no roba atencion a la mano; resuelto, las cifras se van a ~3 veces su
   * tamano, el ganador se enciende, el perdedor se apaga y el veredicto pasa a ser una frase.
   * No cambia ni un numero: `winner`, `youValue` y `rivalValue` llegan decididos del servidor.
   */
  const resuelto = winner != null;
  /* El color del rótulo lo pone el eje que ya se conozca; si no hay ninguno, va apagado. */
  const eje = rivalStat ?? youStat;
  const color = eje ? STAT_INFO[eje].color : "rgba(255,255,255,0.35)";
  const sinNada = youValue == null && rivalValue == null;

  return (
    <div className={cn("relative flex flex-col items-center", className)}>
      {/* Halo del eje: tiñe el centro de la mesa con el color de la estadística en juego. */}
      {eje && (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute left-1/2 top-1/2 -z-10 -translate-x-1/2 -translate-y-1/2 transition-all duration-normal",
            resuelto ? "h-[min(52vh,420px)] w-[min(96vw,760px)]" : "h-40 w-[min(88vw,460px)]",
          )}
          style={{
            background: `radial-gradient(50% 60% at 50% 50%, ${color}${resuelto ? "3d" : "22"}, transparent 72%)`,
          }}
        />
      )}

      <motion.div
        key={`${youStat ?? "-"}|${rivalStat ?? "-"}`}
        initial={{ opacity: 0, y: 6, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.3, ease: EASE.out }}
        data-resolved={resuelto ? "true" : "false"}
        className={cn(
          "nx-clip-sm relative w-full border text-center transition-[max-width,padding] duration-normal",
          resuelto
            ? "max-w-[min(94vw,680px)] px-5 py-[clamp(8px,1.6vh,18px)]"
            : "max-w-[420px] px-4 py-[clamp(4px,0.9vh,9px)]",
        )}
        /*
         * LA PLACA DEL CENTRO. En espera era un rectángulo gris plano —el elemento más liso
         * de una mesa hecha de superficies hundidas y filos—, justo en el sitio que tiene que
         * leerse como el corazón del duelo. Ahora, con o sin eje declarado, es una PLACA:
         * hundida en el tapete, con su filo superior oscuro y su filo inferior iluminado,
         * igual que las posiciones de carta. Cuando hay eje se enciende con su color.
         */
        /*
         * FASE 50 · SIN CAJA. En la arena el rótulo ya no es una placa gris: es la lectura del duelo
         * flotando bajo el VS, sobre un velo oscuro que se funde con el estadio y con los filos de
         * arriba y abajo encendidos del color del eje cuando lo hay.
         */
        style={{
          borderColor: "transparent",
          background: eje
            ? `radial-gradient(70% 120% at 50% 50%, ${color}2a, rgba(3,4,10,0.72) 62%, rgba(3,4,10,0) 100%)`
            : "radial-gradient(70% 120% at 50% 50%, rgba(3,4,10,0.7), rgba(3,4,10,0) 100%)",
          boxShadow: eje ? `inset 0 1px 0 ${color}66, inset 0 -1px 0 ${color}44` : "none",
        }}
      >
        {/* Un solo título cuando los dos pelean en el mismo eje: ahí sí es comparación directa. */}
        {mismoEje && (
          <span
            className="block font-display text-[13px] font-extrabold uppercase tracking-[0.3em] sm:text-[15px]"
            style={{ color }}
          >
            {td(STAT_INFO[youStat!].label)}
          </span>
        )}

        {sinNada ? (
          <>
            {!mismoEje && (
              <span className="block font-display text-[13px] font-extrabold uppercase tracking-[0.3em] text-white/30 sm:text-[15px]">
                {t("Sin declarar")}
              </span>
            )}
            {/* La pista solo si quien la usa la pide: en móvil la da la línea de controles. */}
            {hint && <span className="mt-0.5 block text-[11px] text-white/35">{td(hint)}</span>}
          </>
        ) : (
          <div
            className={cn(
              "flex items-end justify-center",
              resuelto ? "gap-4 sm:gap-8" : "gap-3 sm:gap-5",
              mismoEje && "mt-0.5",
            )}
          >
            <Columna
              lado="Tú"
              stat={mismoEje ? null : youStat}
              valor={youValue}
              destacada={winner === "A"}
              apagada={winner === "B"}
              resuelto={resuelto}
            />
            <Sello resuelto={resuelto} color={color} />
            <Columna
              lado={t("Rival")}
              stat={mismoEje ? null : rivalStat}
              valor={rivalValue}
              destacada={winner === "B"}
              apagada={winner === "A"}
              resuelto={resuelto}
            />
          </div>
        )}
      </motion.div>

      {/*
        EL VEREDICTO. Era un rotulo de 10 px: la conclusion del turno escrita mas pequena que la
        etiqueta de un eje. Ahora es una FRASE, con el color del que gano y el peso que le
        corresponde a lo unico que el jugador necesita leer cuando el turno se cierra. El empate
        tiene su propio tratamiento -ambar y «0 puntos» explicito- porque un empate que se lee
        como una derrota es un empate mal contado.
      */}
      {winner && (
        <motion.span
          initial={{ opacity: 0, y: -6, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.26, ease: EASE.out, delay: 0.1 }}
          data-testid="clash-verdict"
          className="mt-2 font-display text-[clamp(15px,2.6vh,26px)] font-extrabold uppercase tracking-[0.18em]"
          style={{
            color: winner === "TIE" ? "#ffd35c" : winner === "A" ? "#2fe0ff" : "#ff2e63",
            textShadow: `0 0 26px ${winner === "TIE" ? "#ffd35c" : winner === "A" ? "#2fe0ff" : "#ff2e63"}55`,
          }}
        >
          {winner === "TIE" ? t("Empate") : winner === "A" ? t("Ganas el turno") : t("Pierdes el turno")}
        </motion.span>
      )}
      {winner === "TIE" && (
        <span className="nx-label mt-0.5 !text-[10px] text-white/45">{t("0 puntos")}</span>
      )}
    </div>
  );
}

/** Una mitad del rótulo: su eje encima y su cifra debajo, con el color de esa estadística. */
function Columna({
  lado, stat, valor, destacada, apagada, resuelto,
}: {
  lado: string;
  /** `null` cuando el título ya está arriba porque los dos ejes coinciden. */
  stat: CombatStatKey | null;
  valor: number | null;
  destacada: boolean;
  apagada: boolean;
  /** El turno ya tiene veredicto: la cifra pasa a ser el objeto mas grande de la pantalla. */
  resuelto?: boolean;
}) {
  useLocale();
  const info = stat ? STAT_INFO[stat] : null;
  const color = info?.color ?? "rgba(255,255,255,0.55)";

  return (
    <span className="flex min-w-0 flex-col items-center">
      {/*
        DE QUIEN ES ESTA CIFRA.
        La cifra se tine con el color del EJE (Stronghold rojo, Gamesense azul, Entryfrag verde),
        que es el vocabulario del juego en todas las demas pantallas. Pero los bandos tambien
        tienen color -tu verde, el rival rojo-, y eso abre una ambiguedad real en el unico sitio
        donde no puede haberla: un 87 en Stronghold es rojo aunque sea TUYO. El rotulo del bando
        va siempre encima, asi que quien gana el turno se lee sin depender de ningun color.
      */}
      <span className="nx-label !text-[8px] opacity-70">{td(lado)}</span>
      {info ? (
        <span
          className="block max-w-[9rem] truncate font-display text-[10px] font-extrabold uppercase tracking-[0.2em] sm:text-[11px]"
          style={{ color }}
        >
          {td(info.label)}
        </span>
      ) : null}
      {/*
        LA CIFRA. Resuelta, es el objeto mas grande de la pantalla -hasta 96 px-: es el numero
        que decide el turno y tiene que poder leerse desde el otro lado de la habitacion. El
        ganador se enciende con su color y su halo; el perdedor NO desaparece (hay que poder
        comparar) pero baja a la mitad de opacidad y pierde el brillo. La diferencia entre los
        dos nunca es solo el color: es tamano, peso y luz, para que se lea tambien sin distinguir
        el verde del rojo.
      */}
      <b
        className={cn(
          "nx-readout leading-[0.95] tabular-nums transition-all duration-normal",
          resuelto
            ? destacada
              ? "text-[clamp(44px,9vh,96px)]"
              : "text-[clamp(34px,6.6vh,70px)]"
            : destacada
              ? "text-[clamp(24px,4vh,38px)]"
              : "text-[clamp(20px,3.3vh,31px)]",
          apagada && (resuelto ? "opacity-50" : "opacity-40"),
        )}
        style={{
          color: valor == null ? "rgba(255,255,255,0.25)" : color,
          textShadow: destacada ? `0 0 ${resuelto ? "48px" : "26px"} ${color}` : undefined,
        }}
      >
        {valor ?? "—"}
      </b>
    </span>
  );
}

/**
 * EL SELLO «VS».
 *
 * Era la palabra «vs» en once pixeles grises entre dos cifras. En un enfrentamiento resuelto
 * -el instante que da nombre a la pantalla- eso es exactamente lo que no puede ser: el punto
 * de encuentro de las dos cartas tiene que ser una MARCA. Aqui es un disco con el eje tenido
 * y su filo; en espera se queda como estaba, discreto.
 *
 * No dice nada que no este ya dicho: es tipografia y dos gradientes.
 */
function Sello({ resuelto, color }: { resuelto: boolean; color: string }) {
  useLocale();
  if (!resuelto) {
    return (
      <span className="pb-2 font-display text-[11px] font-bold uppercase tracking-[0.2em] text-white/30">
        {t("vs")}
      </span>
    );
  }
  return (
    <span className="relative flex shrink-0 flex-col items-center justify-center self-center px-1">
      <span
        aria-hidden
        className="absolute left-1/2 top-1/2 h-[clamp(40px,7vh,74px)] w-[clamp(40px,7vh,74px)] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background: `radial-gradient(50% 50% at 50% 50%, ${color}2e, transparent 70%)`,
          boxShadow: `inset 0 0 0 1px ${color}33`,
        }}
      />
      <span
        className="relative font-display text-[clamp(12px,1.9vh,18px)] font-extrabold uppercase tracking-[0.14em]"
        style={{ color: `${color}cc` }}
      >
        {t("vs")}
      </span>
    </span>
  );
}
