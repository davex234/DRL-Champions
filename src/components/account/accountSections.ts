/**
 * IA 2026-10-07 · LAS SECCIONES DE MI CUENTA (puro, sin React): pestañas en su orden y la lectura de `?seccion=`.
 */
import { ROUTES } from "@/design/nav";

/** Las pestañas de Mi cuenta, en su orden. El contrato (`iaConsolidation.test`) las fija. */
export const ACCOUNT_TABS = [
  { id: "perfil", label: "Perfil", href: ROUTES.accountProfile },
  { id: "progresion", label: "Progresión", href: ROUTES.accountProgress },
  { id: "cuenta", label: "Cuenta", href: ROUTES.accountSettings },
] as const;

export type AccountSection = (typeof ACCOUNT_TABS)[number]["id"] | "feedback";

/** `?seccion=` → sección conocida (por defecto, PERFIL). Un valor raro no rompe nada: abre el perfil. */
export function accountSectionOf(raw: string | null | undefined): AccountSection {
  if (raw === "feedback") return "feedback";
  return ACCOUNT_TABS.some((t) => t.id === raw) ? (raw as AccountSection) : "perfil";
}
