/**
 * TEMPLATES — plantillas DETERMINISTAS de los mensajes del contrato (nuevo torneo · equipo
 * eliminado · nueva revisión · revisión completa · estadísticas · pipeline pendiente ·
 * error). Texto neutro (el formato por canal vive en formatter.ts).
 */
import type { HubRequest, NotificationContext, NotificationKind } from "./types";

export interface RenderedTemplate {
  title: string;
  body: string;
}

/** Sujeto del evento dominante (p.ej. el equipo eliminado), si el contexto lo trae. */
export function subjectOf(request: HubRequest, ctx: NotificationContext): string | undefined {
  const wanted = request.reason === "TeamEliminated" ? "team-eliminated"
    : request.reason === "TournamentFinished" ? "tournament-finished"
    : request.reason === "StatisticsChanged" ? "statistics-changed"
    : undefined;
  if (!wanted || !ctx.events) return undefined;
  return ctx.events.find((e) => e.kind === wanted && request.sourceEventSeqs.includes(e.seq))?.subject;
}

export function renderTemplate(
  kind: NotificationKind, request: HubRequest, ctx: NotificationContext,
): RenderedTemplate {
  const name = ctx.tournamentName ?? request.tournamentId;
  const subject = subjectOf(request, ctx);

  switch (kind) {
    case "new-tournament":
      return { title: name, body: `${name}\nNuevo torneo detectado.\nObservación en marcha.` };
    case "team-eliminated":
      return { title: name, body: `${name}\n${subject ?? "Un equipo"} eliminado.\nHay una nueva revisión pendiente.` };
    case "new-review":
      return { title: name, body: `${name}\nHay una nueva revisión pendiente.\nMotivo: ${request.reason}.` };
    case "full-review":
      return { title: name, body: `${name}\nTorneo terminado.\nHay una revisión COMPLETA pendiente.` };
    case "stats-updated":
      return { title: name, body: `${name}\nEstadísticas actualizadas${subject ? ` (${subject})` : ""}.\nHay una nueva revisión pendiente.` };
    case "pipeline-pending":
      return { title: name, body: `${name}\nPipeline pendiente de decisión del operador.\nPetición: ${request.id}.` };
    case "error":
      return { title: name, body: `${name}\nError en la vigilancia del torneo.\n${ctx.error ?? "Sin detalle."}` };
  }
}
