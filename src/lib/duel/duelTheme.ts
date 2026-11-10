"use client";

/**
 * F71 · tema de duelo vigente, en el cliente. Una sola lectura de `/api/content/duel-theme` (pública, caché de 5 s
 * en servidor) y memoria de módulo 60 s: entrar y salir de partidas no repite la petición. Solo se descarga el
 * fondo del tema elegido (nunca todos). Si la lectura falla: `null` ⇒ la arena usa su fondo por defecto.
 */
import { useEffect, useState } from "react";
import type { ActiveDuelTheme } from "@/domain/duelThemes";

const TTL_MS = 60_000;
let memo: { at: number; theme: ActiveDuelTheme | null } | null = null;
let inflight: Promise<ActiveDuelTheme | null> | null = null;

export function fetchDuelTheme(): Promise<ActiveDuelTheme | null> {
  if (memo && Date.now() - memo.at < TTL_MS) return Promise.resolve(memo.theme);
  inflight ??= fetch("/api/content/duel-theme", { cache: "no-store" })
    .then(async (r) => (r.ok ? (((await r.json()) as { theme?: ActiveDuelTheme }).theme ?? null) : null))
    .catch(() => null)
    .then((theme) => { memo = { at: Date.now(), theme }; return theme; })
    .finally(() => { inflight = null; });
  return inflight;
}

export function useDuelTheme(): ActiveDuelTheme | null {
  const [theme, setTheme] = useState<ActiveDuelTheme | null>(memo?.theme ?? null);
  useEffect(() => {
    let alive = true;
    void fetchDuelTheme().then((t) => { if (alive) setTheme(t); });
    return () => { alive = false; };
  }, []);
  return theme;
}

/** `url("…")` seguro para una variable CSS (sin comillas ni saltos que rompan la declaración). */
export const cssUrl = (u: string) => `url("${u.replace(/["\\\n\r]/g, "")}")`;

/**
 * Capas del fondo: tema encima, fondo por defecto debajo. Si la imagen del tema no carga (404, borrada), el
 * navegador pinta la capa de abajo: nunca un duelo sin fondo.
 */
export function arenaBackgroundLayers(theme: ActiveDuelTheme | null, fallback: { wide: string; narrow: string }): { wide: string; narrow: string } {
  const base = { wide: cssUrl(fallback.wide), narrow: cssUrl(fallback.narrow) };
  if (!theme || theme.source === "code-default" || !theme.wide) return base;
  return { wide: `${cssUrl(theme.wide)}, ${base.wide}`, narrow: `${cssUrl(theme.narrow || theme.wide)}, ${base.narrow}` };
}
