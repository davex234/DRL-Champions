import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./game-experience.css";
import { GameShell } from "@/components/layout/GameShell";
import { AuthProvider } from "@/lib/supabase/auth";
import { I18nProvider } from "@/i18n/react";

const TITLE = "DRL Champions — Manager de esports de Valorant";
const DESC = "No disparas. Piensas. Dirige a tu equipo profesional de Valorant: estrategia, economía, scouting, composición y lectura del rival.";

/**
 * WALKOUT 0.6 · origen de las URL relativas de la metadata (og:image, twitter:image). Sin él, Next las resolvía contra
 * `http://localhost:3000` también en producción (la vista previa al compartir apuntaba a un servidor inexistente).
 */
function siteOrigin(): URL | undefined {
  try { return process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL) : undefined; } catch { return undefined; }
}

export const metadata: Metadata = {
  metadataBase: siteOrigin(),
  applicationName: "DRL Champions",
  // F67 · beta cerrada: no indexar salvo `NEXUS_PUBLIC_INDEXING=1` en el build (ver src/app/robots.ts).
  robots: process.env.NEXUS_PUBLIC_INDEXING === "1" ? undefined : { index: false, follow: false },
  title: TITLE,
  description: DESC,
  appleWebApp: {
    capable: true,
    title: "DRL Champions",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    shortcut: ["/favicon.ico"],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    locale: "es_ES",
    siteName: "DRL Champions",
    title: TITLE,
    description: DESC,
    images: [{ url: "/branding/assets/og.png", width: 1200, height: 630, alt: "DRL Champions" }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESC,
    images: ["/branding/assets/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#06070d",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        {/* Legacy iOS: lanzar en modo standalone (Next solo emite el meta moderno) */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Inter:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <AuthProvider>
          <I18nProvider>
            <GameShell>{children}</GameShell>
          </I18nProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
