"use client";

/**
 * FINAL DE UN DUELO PRIVADO (Fase 29). Sustituye, en el resultado PvP, a las placas de rating y
 * escalera —que aquí no existen porque un duelo privado NO liquida nada— por el cara a cara
 * actualizado (RANKED · PRIVADOS · TOTAL, tres lecturas del servidor) y las salidas sociales:
 * REVANCHA (un reto nuevo que el rival debe aceptar), VOLVER A SOCIAL, VER PERFIL y OTRO RETO.
 * Presentación pura: no calcula el cara a cara ni decide quién ganó.
 */
import { NxButton } from "@/components/ui/NxButton";
import { Plate } from "@/components/ui/Surface";
import { h2hText, type H2HSplit } from "@/domain/social/social";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("duel");

export interface PrivateDuelPanelProps {
  rival: { userId: string; username: string; avatar: string } | null;
  h2h: H2HSplit | null;
  busy?: boolean;
  onRematch: () => void;
  onSocial: () => void;
  onProfile: () => void;
  onOtherChallenge: () => void;
}

export function PrivateDuelPanel({ rival, h2h, busy, onRematch, onSocial, onProfile, onOtherChallenge }: PrivateDuelPanelProps) {
  useLocale();
  return (
    <div data-testid="private-duel-panel">
      <Plate className="mt-3 px-4 py-4" data-testid="private-h2h">
        <p className="nx-label text-center">{t("Cara a cara")}{rival ? t(" con {username}", { username: rival.username }) : ""}</p>
        {h2h ? (
          <div className="mt-2 grid grid-cols-3 gap-3">
            <Cell id="ranked" label={t("Ranked")} h={h2h.ranked} />
            <Cell id="privados" label={t("Privados")} h={h2h.private} />
            <Cell id="total" label={t("Total")} h={h2h.total} strong />
          </div>
        ) : (
          <p className="mt-2 text-center text-sm text-white/45" data-field="h2h-pending">{t("Leyendo el cara a cara…")}</p>
        )}
        <p className="mt-2 text-center text-[11px] text-white/35">{t("Duelo privado: sin rating, sin escalera, sin recompensas competitivas. Tus victorias – las suyas.")}</p>
      </Plate>

      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <NxButton variant="primary" onClick={onRematch} disabled={busy || !rival} data-action="rematch">{t("Revancha")}</NxButton>
        <NxButton variant="secondary" onClick={onSocial} data-action="social">{t("Volver a Social")}</NxButton>
        <NxButton variant="ghost" onClick={onProfile} disabled={!rival} data-action="profile">{t("Ver perfil")}</NxButton>
        <NxButton variant="ghost" onClick={onOtherChallenge} data-action="other">{t("Otro reto")}</NxButton>
      </div>
      <p className="mt-2 text-center text-[11px] text-white/35">{t("La revancha es un reto nuevo: tu rival tiene que aceptarlo.")}</p>
    </div>
  );
}

function Cell({ id, label, h, strong }: { id: "ranked" | "privados" | "total"; label: string; h: { wins: number; losses: number; draws: number; matches: number }; strong?: boolean }) {
  useLocale();
  return (
    <div className="text-center">
      <span className="nx-label">{td(label)}</span>
      <span className={`nx-readout mt-1 block text-[22px] ${strong ? "text-white" : "text-white/75"}`} data-h2h={id}>{h.matches === 0 ? "—" : h2hText(h)}</span>
      <span className="text-[11px] text-white/35">{h.matches} {h.matches === 1 ? t("partida") : t("partidas")}</span>
    </div>
  );
}
