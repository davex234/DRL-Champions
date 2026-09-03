/**
 * NOTIFICATION HUB — fachada: PipelineRequests → plan de notificaciones (plantilla + canal
 * + destino, deduplicado) → despacho A ADAPTADORES. Jamás ejecuta peticiones, ni aprueba,
 * ni publica, ni toca APIs reales: la salida son mensajes en buffers de adaptador.
 */
import { renderForChannel } from "./formatter";
import { hubMetrics } from "./metrics";
import { channelsFor, kindOfRequest, DEFAULT_ROUTING } from "./routing";
import { cancelMessage, createHubRegistry, dispatch, enqueue, pendingMessages } from "./queue";
import { renderTemplate } from "./templates";
import type {
  HubClock, HubMetrics, HubRegistry, HubRequest, NotificationChannel, NotificationContext,
  NotificationMessage, NotificationPlan, RoutingPolicy,
} from "./types";

export class NotificationHub {
  private dedupedTotal = 0;

  constructor(
    private clock: HubClock,
    private channels: NotificationChannel[],
    public registry: HubRegistry = createHubRegistry(),
    private policy: RoutingPolicy = DEFAULT_ROUTING,
  ) {}

  /** Planifica las notificaciones de un lote de peticiones (SIN enviar nada). */
  plan(requests: HubRequest[], ctx: NotificationContext = {}): NotificationPlan {
    const at = this.clock();
    const messages: NotificationMessage[] = [];
    const skipped = new Set<string>();
    let deduped = 0;
    const healthy = new Set(this.channels.filter((c) => c.health()).map((c) => c.id));

    for (const request of requests) {
      const kind = kindOfRequest(request);
      const template = renderTemplate(kind, request, ctx);
      for (const channelId of channelsFor(kind, this.policy)) {
        if (!healthy.has(channelId)) { skipped.add(channelId); continue; }
        const out = enqueue(this.registry, {
          kind,
          channelId,
          target: this.policy.targetByChannel[channelId] ?? channelId,
          title: template.title,
          body: template.body,
          rendered: renderForChannel(channelId, template),
          tournamentId: request.tournamentId,
          requestId: request.id,
          state: "pending",
          attempts: 0,
          dedupeKey: `${request.id}|${kind}|${channelId}`,
          createdAt: at,
          updatedAt: at,
        }, at);
        this.registry = out.registry;
        if (out.deduped) deduped++;
        else if (out.message) messages.push(out.message);
      }
    }
    this.dedupedTotal += deduped;
    return { messages, deduped, skippedChannels: [...skipped].sort() };
  }

  /** Despacha lo pendiente a los ADAPTADORES (cero envíos reales). */
  dispatch(): { sent: number; failed: number } {
    const { registry, sent, failed } = dispatch(this.registry, this.channels, this.policy, this.clock);
    this.registry = registry;
    return { sent, failed };
  }

  pending(): NotificationMessage[] { return pendingMessages(this.registry); }
  cancel(messageId: string, reason?: string): void { this.registry = cancelMessage(this.registry, messageId, this.clock, reason); }
  metrics(): HubMetrics { return hubMetrics(this.registry, this.dedupedTotal); }
}
