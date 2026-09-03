/**
 * `npm run tournament:notify` — Notification Hub (Watcher F4): transforma PipelineRequests
 * en notificaciones por canal. Demo offline con el ejemplo oficial. SIN enviar realmente:
 * los canales son adaptadores con buffer.
 */
import type { WatchEvent } from "@/tournament-watcher";
import { CoordinatorEngine } from "@/tournament-autopipeline";
import {
  NotificationHub, ConsoleChannel, TelegramChannelAdapter, DiscordChannelAdapter,
} from "@/tournament-notifications";

async function main(): Promise<void> {
  const now = Date.now();
  const T = "valorant-masters-london-2026";
  const events: WatchEvent[] = [
    { seq: 1, at: now, tournamentId: T, kind: "team-eliminated", subject: "Team Heretics" },
    { seq: 2, at: now, tournamentId: T, kind: "statistics-changed", subject: "zekken" },
  ];

  const coordinator = new CoordinatorEngine(() => now);
  coordinator.ingest(events);
  const requests = coordinator.plan();

  const consoleCh = new ConsoleChannel();
  const telegram = new TelegramChannelAdapter(() => 5001);
  const hub = new NotificationHub(() => now, [consoleCh, telegram, new DiscordChannelAdapter()]);

  const t0 = Date.now();
  const plan = hub.plan(requests, { tournamentName: "Valorant Masters London 2026", events });
  const queued = hub.pending().length;
  const { sent, failed } = hub.dispatch();
  const ms = Date.now() - t0;
  const m = hub.metrics();

  console.log("# Tournament Notify — Notification Hub (sin enviar realmente)\n");
  console.log(`  solicitudes:  ${requests.length}`);
  console.log(`  mensajes:     ${plan.messages.length} planificados (dedupe ${plan.deduped} · canales saltados: ${plan.skippedChannels.join(", ") || "—"})`);
  console.log(`  en cola:      ${queued} → entregados al adaptador ${sent} · fallidos ${failed}`);
  console.log(`  destinos:     ${Object.entries(m.byChannel).map(([c, n]) => `${c}(${n})`).join(" · ")}`);
  console.log(`  tiempo:       ${ms} ms\n`);
  for (const msg of Object.values(hub.registry.messages)) {
    console.log(`  → [${msg.channelId} · ${msg.target} · ${msg.state}]`);
    console.log(`${msg.body.split("\n").map((l) => `      ${l}`).join("\n")}\n`);
  }
  console.log(`  buffer telegram (Effects sin transporte): ${telegram.outbox.length} · buffer consola: ${consoleCh.lines.length}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
