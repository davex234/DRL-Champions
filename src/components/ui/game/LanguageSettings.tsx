"use client";

/**
 * I18N · AJUSTE «IDIOMA» — Español · English · Deutsch · Italiano.
 *
 * Cada idioma se muestra en su propio idioma (no se traduce: quien busca «Deutsch» no lo encuentra como «Alemán»).
 * Botones nativos con `aria-pressed` y `lang` (teclado y lector de pantalla), 44 px. El cambio es inmediato y no
 * recarga ni navega; se guarda en este dispositivo y, con sesión, en la cuenta (`useI18n`). Si hay una operación
 * crítica en curso (apertura de sobre, compra) se aplica al terminar y aquí se dice.
 *
 * `compact`: la variante de la pantalla de acceso (sin sesión), sin título ni explicación.
 */
import { useState } from "react";
import { LOCALES, LOCALE_INFO, type Locale } from "@/i18n/config";
import { useI18n } from "@/i18n/react";
import { ns, td } from "@/i18n/runtime";
import { useAuth } from "@/lib/supabase/auth";
import { cn } from "@/lib/format";

const t = ns("ui");

export function LanguageSettings({ className, compact = false }: { className?: string; compact?: boolean }) {
  const { locale, pending, setLocale } = useI18n();
  const { user } = useAuth();
  const [busy, setBusy] = useState<Locale | null>(null);
  const [failed, setFailed] = useState(false);

  async function choose(next: Locale) {
    // Pulsar el idioma ya activo TAMBIÉN es una elección: si solo estaba detectado, se guarda (dispositivo y cuenta).
    if (busy) return;
    setBusy(next); setFailed(false);
    const ok = await setLocale(next);
    setBusy(null); setFailed(!ok);
  }

  return (
    <div className={cn("space-y-3", className)} data-testid="language-settings" data-locale={locale} data-pending={pending ?? undefined}>
      {!compact && (
        <div>
          <span className="font-display text-[15px] font-bold uppercase tracking-[0.08em] text-white">{t("Idioma")}</span>
          <span className="mt-0.5 block text-[12px] text-white/50">{t("El idioma de los textos del juego")}</span>
        </div>
      )}
      <div role="group" aria-label={t("Idioma")} className={cn("grid gap-2", compact ? "grid-cols-4" : "grid-cols-2")}>
        {LOCALES.map((l) => {
          const on = locale === l;
          const info = LOCALE_INFO[l];
          return (
            <button key={l} type="button" lang={l} aria-pressed={on} aria-busy={busy === l || undefined} disabled={busy !== null && busy !== l}
              onClick={() => void choose(l)} data-testid={`language-${l}`} title={info.name}
              className={cn("nx-clip-sm nx-focus flex min-h-[44px] min-w-0 items-center justify-center gap-2 px-2 font-display text-[12px] font-bold uppercase tracking-[0.08em] transition-colors duration-fast",
                on ? "bg-drl-cyan/15 text-drl-cyan shadow-[inset_0_0_0_1px_rgba(25,227,255,0.5)]" : "bg-white/[0.05] text-white/60 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16)]")}>
              {/* Bandera local (SVG): Windows no pinta los emojis de bandera (🇪🇸 sale «ES»). */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={info.flagFile} alt="" aria-hidden width={20} height={15} className="h-[15px] w-5 shrink-0 rounded-[2px] object-cover" />
              <span className={cn("min-w-0 truncate", compact && "sr-only sm:not-sr-only")}>{info.name}</span>
            </button>
          );
        })}
      </div>
      {pending && pending !== locale && (
        <p role="status" className="text-[12px] text-drl-gold" data-testid="language-pending">
          {t("Se cambiará a {name} en cuanto termine la operación en curso.", { name: td(LOCALE_INFO[pending].name) })}
        </p>
      )}
      {failed && <p role="alert" className="text-[12px] text-red-300" data-testid="language-error">{t("No se pudo cargar ese idioma. Comprueba tu conexión e inténtalo de nuevo.")}</p>}
      {!compact && (
        <p className="text-[12px] text-white/45" data-testid="language-scope">
          {user ? t("Se guarda en tu cuenta y en este dispositivo.") : t("Se guarda en este dispositivo.")}
        </p>
      )}
    </div>
  );
}
