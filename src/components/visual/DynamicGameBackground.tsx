"use client";

/**
 * FONDO DINÁMICO (Fase 9B) — desde la Fase 44.1 es un alias de compatibilidad de `GameEnvironment`.
 *
 * El fondo dejó de ser «degradado + partículas» y pasó a ser un mundo por capas (`src/design/environment.ts`). Este
 * módulo conserva los nombres antiguos para no tener dos sistemas: traduce la variante vieja al ambiente nuevo.
 */
import { GameEnvironment } from "./GameEnvironment";
import type { EnvironmentVariant } from "@/design/environment";

export type BackgroundVariant = "home" | "collection" | "packs" | "ranking" | "profile" | "duels" | "tournaments" | "world";

const TO_ENV: Record<BackgroundVariant, EnvironmentVariant> = {
  home: "lobby", collection: "collection", packs: "packs", ranking: "ranked", profile: "profile", duels: "match", tournaments: "events", world: "world",
};

export function DynamicGameBackground({ variant = "home", className }: { variant?: BackgroundVariant; intensity?: number; className?: string }) {
  return <GameEnvironment variant={TO_ENV[variant] ?? "lobby"} className={className} />;
}

/** Sección de navegación → variante antigua (se conserva por compatibilidad; el armazón usa `environmentForPath`). */
export function variantForSection(sectionId: string | null | undefined, pathname: string): BackgroundVariant {
  if (pathname === "/") return "home";
  if (pathname.startsWith("/duelos")) return "duels";
  if (pathname.startsWith("/torneos")) return "tournaments";
  if (pathname.startsWith("/tienda") || pathname.startsWith("/abrir") || pathname.startsWith("/eventos")) return "packs";
  if (pathname.startsWith("/ranking")) return "ranking";
  if (pathname.startsWith("/cuenta")) return "profile";
  switch (sectionId) {
    case "coleccion": return "collection";
    case "progreso": return "profile";
    case "mundo": return "world";
    case "tienda": return "packs";
    case "jugar": return "duels";
    default: return "home";
  }
}
