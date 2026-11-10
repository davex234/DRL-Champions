/**
 * `/progresion` — REDIRECCIÓN (IA 2026-10-07). La progresión vive en MI CUENTA → PROGRESIÓN (mismo componente,
 * `ProgressionScreen`, mismos reclamos). La ruta no da 404: marcadores, enlaces antiguos y avisos siguen llegando.
 */
import { redirect } from "next/navigation";
import { ROUTES } from "@/design/nav";

export default function ProgresionRedirect() {
  redirect(ROUTES.accountProgress);
}
