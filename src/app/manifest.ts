import type { MetadataRoute } from "next";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, matchLocale, type Locale } from "@/i18n/config";

/**
 * MANIFIESTO DE LA APP INSTALABLE — en el idioma del jugador.
 *
 * El servidor pinta en español canónico, pero el manifiesto lo lee el sistema operativo al instalar (nombre de los
 * accesos directos, descripción): ahí no hay cliente que lo corrija después. Lo único que el servidor ve de la
 * preferencia es la cookie `vr_locale` (validada contra la lista de idiomas). Sin cookie, español.
 * Los textos fuente están en `src/i18n/extra-sources.json` (módulo `app`); el catálogo se carga solo para esta respuesta
 * y NO se registra en el runtime: el resto del servidor sigue respondiendo en español.
 */
const CATALOGS: Record<Exclude<Locale, "es">, () => Promise<{ default: Record<string, string> }>> = {
  en: () => import("@/i18n/messages/en/app.json"),
  de: () => import("@/i18n/messages/de/app.json"),
  it: () => import("@/i18n/messages/it/app.json"),
  fr: () => import("@/i18n/messages/fr/app.json"),
  "pt-PT": () => import("@/i18n/messages/pt-PT/app.json"),
  "pt-BR": () => import("@/i18n/messages/pt-BR/app.json"),
  ja: () => import("@/i18n/messages/ja/app.json"),
};

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const locale: Locale = matchLocale((await cookies()).get(LOCALE_COOKIE)?.value) ?? DEFAULT_LOCALE;
  const dict: Record<string, string> = locale === "es" ? {} : (await CATALOGS[locale]()).default;
  const t = (source: string) => dict[source] || source;
  return {
    name: "DRL Champions",
    short_name: "DRL",
    description: t("Manager y simulador de esports de Valorant. No disparas: piensas."),
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#06070d",
    theme_color: "#06070d",
    lang: locale,
    categories: ["games", "entertainment"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: t("El Entrenador"), short_name: t("Partido"), url: "/entrenador" },
      { name: t("Mi colección"), short_name: t("Colección"), url: "/coleccion" },
      { name: t("Eventos"), short_name: t("Eventos"), url: "/eventos" },
    ],
  };
}
