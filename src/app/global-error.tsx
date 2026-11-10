"use client";

/**
 * FASE 44 · ERROR FATAL. Solo aparece si falla el propio armazón (layout raíz), así que no puede usar el sistema de
 * diseño ni las hojas de estilo: todo va en línea. Sin traza para el jugador; REINTENTAR y VOLVER AL LOBBY.
 */
import { useEffect } from "react";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("app");

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useLocale();
  useEffect(() => {
    console.error("[nexus] armazón", error.digest ?? "", error.message);
  }, [error]);
  const btn: React.CSSProperties = { minHeight: 52, padding: "0 28px", fontFamily: "Rajdhani, system-ui, sans-serif", fontWeight: 700, fontSize: 15, letterSpacing: "0.14em", textTransform: "uppercase", border: 0, cursor: "pointer", clipPath: "polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px))" };
  return (
    <html lang="es">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "radial-gradient(900px 500px at 50% 0%, rgba(255,46,99,0.16), transparent 60%), #06070d", color: "#eef1f8", fontFamily: "Inter, system-ui, sans-serif" }}>
        <main data-testid="global-error" style={{ textAlign: "center", padding: 24, maxWidth: 520 }}>
          <p style={{ fontFamily: "Rajdhani, system-ui, sans-serif", letterSpacing: "0.22em", fontSize: 12, textTransform: "uppercase", color: "#ff5c8a", margin: 0 }}>{t("NEXUS")}</p>
          <h1 style={{ fontFamily: "Rajdhani, system-ui, sans-serif", fontSize: 40, lineHeight: 1, textTransform: "uppercase", margin: "10px 0 0" }}>{t("No se ha podido cargar")}</h1>
          <p style={{ color: "rgba(238,241,248,0.65)", fontSize: 15, lineHeight: 1.6, marginTop: 12 }}>{t("Algo ha fallado al abrir NEXUS. Tu progreso está guardado en el servidor.")}</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: 28 }}>
            <button type="button" onClick={reset} style={{ ...btn, background: "#ff2e63", color: "#fff" }}>{t("Reintentar")}</button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" style={{ ...btn, display: "inline-flex", alignItems: "center", color: "#eef1f8", textDecoration: "none", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.2)" }}>{t("Volver al lobby")}</a>
          </div>
        </main>
      </body>
    </html>
  );
}
