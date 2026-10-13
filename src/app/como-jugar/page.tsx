"use client";

/**
 * `/como-jugar` — GUÍA (Fase 63). Lo esencial de NEXUS en una página: el mismo contenido que enseña la primera sesión,
 * SIN estado y SIN concesiones. Leerla no completa nada ni da nada. Si el jugador saltó la guía y todavía no la ha
 * completado por otra vía, puede retomarla desde aquí (orden `resume`, el servidor decide).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { NxButton } from "@/components/ui/NxButton";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { postOnboarding, useOnboarding } from "@/lib/onboarding/client";
import { FIRST_MATCH_RULES } from "@/domain/journey";
import { DUEL_ROLES } from "@/domain/cardgame/types";
import { COMBAT_STAT_META, COMBAT_STAT_ORDER } from "@/domain/cards/combat";
import { PRINTED_STAT_META, PRINTED_STAT_ORDER } from "@/domain/cards/ovr";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const t = ns("comojugar");

const LOOP = [
  { title: "Abre sobres", text: "Los sobres añaden cartas a tu colección. Cada carta es un jugador real." },
  { title: "Forma tu equipo", text: "10 cartas: 2 de cada rol y sin repetir jugador." },
  { title: "Juega", text: "Partidas de diez turnos contra bots (PvE) o contra personas (PvP)." },
  { title: "Progresa", text: "Tus partidas suman XP de cuenta y avanzan tus objetivos. Reclamando objetivos ganas XP de temporada." },
] as const;

export default function ComoJugarPage() {
  useLocale();
  const { user } = useAuth();
  const router = useRouter();
  const { view } = useOnboarding(user?.id ?? null, isSupabaseConfigured());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resume = async () => {
    setBusy(true); setError(null);
    try { await postOnboarding("resume"); router.push("/"); }
    catch { setError(t("No se pudo retomar. Inténtalo de nuevo.")); }
    finally { setBusy(false); }
  };
  return (
    <div className="mx-auto w-full max-w-4xl py-4" data-scene="how-to-play">
      <span className="font-display text-label uppercase tracking-wide2 text-drl">{t("Guía")}</span>
      <h1 className="mt-1 font-display text-[clamp(30px,4.4vw,48px)] font-extrabold uppercase leading-none text-white">{t("Cómo jugar")}</h1>
      <p className="mt-2 max-w-xl text-[15px] text-white/70">{t("Lo esencial de NEXUS en un minuto.")}</p>

      {view?.canResume && (
        <div className="nx-f63-coach mt-5 flex flex-wrap items-center justify-between gap-3 px-4 py-3" data-testid="guide-resume">
          <p className="text-[14px] text-white/80">{t("Saltaste el tutorial. Puedes retomarlo donde lo dejaste.")}</p>
          <NxButton variant="primary" size="md" onClick={resume} disabled={busy} aria-busy={busy} data-testid="guide-resume-cta">{busy ? t("Un momento…") : t("Retomar el tutorial")}</NxButton>
          {error && <p role="alert" className="w-full text-[13px] text-warn">{td(error)}</p>}
        </div>
      )}

      <ol className="mt-6 grid gap-3 sm:grid-cols-2" data-testid="guide-loop">
        {LOOP.map((s, i) => (
          <li key={s.title} className="nx-f62-panel p-4">
            <span className="nx-readout text-[13px] text-drl-glow">{i + 1}</span>
            <h2 className="mt-0.5 font-display text-[18px] font-bold uppercase text-white">{td(s.title)}</h2>
            <p className="mt-1 text-[14px] leading-relaxed text-white/70">{td(s.text)}</p>
          </li>
        ))}
      </ol>

      <section className="mt-8" aria-labelledby="g-card">
        <h2 id="g-card" className="font-display text-[20px] font-bold uppercase text-white">{t("Una carta")}</h2>
        <ul className="mt-2 grid gap-2 text-[14px] text-white/75">
          <li>{fill(t("{titulo} · su valoración general, de 1 a 99.", slots("titulo")), { titulo: <b className="text-white">{t("OVR")}</b> })}</li>
          <li>{fill(t("{titulo} · {lista}. Tu equipo lleva dos de cada uno.", { ...slots("titulo"), lista: DUEL_ROLES.map((r) => td(r)).join(", ") }), { titulo: <b className="text-white">{t("Rol de la carta")}</b> })}</li>
          <li>{fill(t("{titulo} · {lista}: con ellas compite en la partida.", { ...slots("titulo"), lista: COMBAT_STAT_ORDER.map((k) => `${COMBAT_STAT_META[k].label} (${COMBAT_STAT_META[k].full})`).join(", ") }), { titulo: <b className="text-white">{t("Estadísticas de combate")}</b> })}</li>
          <li>{fill(t("{titulo} · {lista}: el rendimiento real del jugador.", { ...slots("titulo"), lista: PRINTED_STAT_ORDER.map((k) => `${PRINTED_STAT_META[k].label} (${td(PRINTED_STAT_META[k].full)})`).join(", ") }), { titulo: <b className="text-white">{t("Las seis cifras impresas")}</b> })}</li>
        </ul>
      </section>

      <section className="mt-8" aria-labelledby="g-match">
        <h2 id="g-match" className="font-display text-[20px] font-bold uppercase text-white">{t("Una partida")}</h2>
        <ol className="mt-2 grid gap-2 sm:grid-cols-2">
          {FIRST_MATCH_RULES.map((r, i) => (
            <li key={r.title} className="nx-f63-stat px-3 py-2 text-[14px] text-white/75"><b className="font-display uppercase tracking-wide text-white">{i + 1}. {td(r.title)}.</b> {td(r.text)}</li>
          ))}
        </ol>
      </section>

      <div className="mt-8 flex flex-wrap gap-2">
        <NxButton variant="primary" size="lg" href="/jugar">{t("Jugar")}</NxButton>
        <NxButton variant="secondary" size="lg" href="/">{t("Volver al menú")}</NxButton>
      </div>
    </div>
  );
}
