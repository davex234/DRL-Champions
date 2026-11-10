"use client";

/**
 * FASE 55 · BUSCANDO RIVAL (ranked). La pantalla de cola, contada con la VERDAD del emparejador:
 *
 *   · solo personas: la cola ranked no tiene bots ni relleno (`duel_pvp_claim_pair` empareja dos entradas);
 *   · por rating: la ventana aceptable es la de la política real (`ratingWindowFor`, espejo de SQL) y se
 *     abre con la espera — ±150 → ±300 → ±600 → cualquiera;
 *   · caduca: la búsqueda vence a los `QUEUE_TTL_SECONDS` (10 min) y se dice.
 *
 * Todo lo que enseña viene de la vista de cola del servidor (`waitingSeconds` con su reloj, `position`,
 * `rating` sellado al entrar). No hace peticiones: las hace el hook de cola, un solo bucle.
 */
import { motion, useReducedMotion } from "framer-motion";
import { NxButton } from "@/components/ui/NxButton";
import { ratingWindowFor } from "@/domain/cardgame/rating";
import { QUEUE_TTL_SECONDS } from "@/domain/cardgame/matchmaking";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const t = ns("duel");

export interface RankedSearchProps {
  waitingSeconds: number;
  position: number | null;
  rating: number | null;
  deckName: string | null;
  busy: boolean;
  onCancel: () => void;
}

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

export function RankedSearch({ waitingSeconds, position, rating, deckName, busy, onCancel }: RankedSearchProps) {
  useLocale();
  const reduced = useReducedMotion();
  const win = ratingWindowFor(waitingSeconds);
  const open = win >= 100_000;
  const left = Math.max(0, QUEUE_TTL_SECONDS - waitingSeconds);
  const quiet = waitingSeconds >= 60;

  return (
    <section className="mx-auto flex w-full max-w-xl flex-col items-center px-4 py-8 text-center" data-testid="ranked-searching" aria-labelledby="ranked-searching-title">
      <p className="nx-label !text-drl">{t("Ranked · duelo PvP")}</p>
      <h1 id="ranked-searching-title" className="mt-1 font-display text-[clamp(30px,7vw,48px)] font-bold uppercase leading-none tracking-wide text-white">{t("Buscando rival")}</h1>

      {/* Radar: anillos que se abren (quietos con movimiento reducido). Decorativo. */}
      <div className="relative my-7 grid h-52 w-52 place-items-center sm:h-60 sm:w-60" aria-hidden>
        {[0, 1, 2].map((i) => (
          <motion.span key={i} className="absolute inset-0 rounded-full border border-drl/50"
            initial={{ scale: reduced ? 0.55 + i * 0.2 : 0.3, opacity: reduced ? 0.5 : 0.9 }}
            animate={reduced ? undefined : { scale: 1, opacity: 0 }}
            transition={reduced ? undefined : { duration: 2.4, repeat: Infinity, delay: i * 0.8, ease: "easeOut" }} />
        ))}
        <span className="absolute inset-8 rounded-full border border-white/10" />
        <span className="absolute inset-16 rounded-full border border-white/10" />
        {!reduced && (
          <motion.span className="absolute inset-0 rounded-full"
            style={{ background: "conic-gradient(from 0deg, rgba(255,46,99,0.35), transparent 22%)" }}
            animate={{ rotate: 360 }} transition={{ duration: 3.2, repeat: Infinity, ease: "linear" }} />
        )}
        <span className="relative text-center">
          <span className="nx-label block !text-white/55">{t("En cola")}</span>
          <span className="nx-readout block text-[40px] leading-none text-white tabular-nums" data-testid="pvp-wait">{mmss(waitingSeconds)}</span>
        </span>
      </div>

      <dl className="grid w-full grid-cols-3 gap-2" data-testid="ranked-search-facts">
        <div className="nx-clip-sm border border-white/10 bg-black/25 px-2 py-2">
          <dt className="nx-label !text-[9.5px] !text-white/45">{t("Tu rating")}</dt>
          <dd className="nx-readout text-[20px] text-white">{rating ?? "—"}</dd>
        </div>
        <div className="nx-clip-sm border border-white/10 bg-black/25 px-2 py-2">
          <dt className="nx-label !text-[9.5px] !text-white/45">{t("Rivales aceptables")}</dt>
          <dd className="nx-readout text-[20px] text-drl-cyan" data-field="window">{open ? t("Cualquiera") : `±${win}`}</dd>
        </div>
        <div className="nx-clip-sm border border-white/10 bg-black/25 px-2 py-2">
          <dt className="nx-label !text-[9.5px] !text-white/45">{t("Esperan más que tú")}</dt>
          <dd className="nx-readout text-[20px] text-white/80">{position ?? 0}</dd>
        </div>
      </dl>

      <p className="mt-4 text-[13px] leading-snug text-white/65" data-testid="ranked-search-truth">
        {fill(t("Solo jugadores reales: la cola ranked {sinbots}. El servidor empareja por rating y abre la búsqueda cuanto más esperas.", slots("sinbots")), { sinbots: <b className="text-white">{t("no tiene bots")}</b> })}
      </p>
      {deckName && <p className="mt-2 text-[12px] text-white/45">{fill(t("Con el equipo {nombre}", slots("nombre")), { nombre: <b className="text-white/75">{td(deckName)}</b> })}</p>}
      {quiet && (
        <p className="nx-clip-sm mt-4 border border-l-2 border-drl-gold/30 border-l-drl-gold bg-drl-gold/[0.06] px-3 py-2 text-left text-[12.5px] text-white/75" role="status" data-testid="ranked-search-quiet">
          {t("Ahora mismo hay poca gente buscando. Puedes seguir esperando —la búsqueda caduca en {tiempo}— o cancelar y volver más tarde.", { tiempo: mmss(left) })}
        </p>
      )}

      <div className="mt-6">
        <NxButton variant="ghost" onClick={onCancel} disabled={busy} data-testid="ranked-cancel">{t("Cancelar búsqueda")}</NxButton>
      </div>
    </section>
  );
}
