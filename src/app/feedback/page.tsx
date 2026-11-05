/**
 * `/feedback` — REDIRECCIÓN (IA 2026-10-07). DAR FEEDBACK vive en MI CUENTA (botón arriba a la derecha) con el MISMO
 * formulario y la misma API (`FeedbackForm`, F86.2). Se conserva `?desde=` (de dónde se abrió) si es uno conocido.
 */
import { redirect } from "next/navigation";
import { ROUTES } from "@/design/nav";
import { FEEDBACK_SOURCES } from "@/domain/feedback/alpha";

export default async function FeedbackRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const desde = (await searchParams).desde;
  const known = typeof desde === "string" && (FEEDBACK_SOURCES as readonly string[]).includes(desde);
  redirect(known ? `${ROUTES.feedback}&desde=${desde}` : ROUTES.feedback);
}
