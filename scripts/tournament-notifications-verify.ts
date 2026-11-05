/**
 * VERIFICACIÓN DEL NOTIFICATION HUB (Tournament Watcher · Fase 4/5).
 *
 * SOLO distribuye: PipelineRequest → NotificationPlan → NotificationMessage por canal.
 * Ejemplo obligatorio: GenerateReview(TeamEliminated) ⇒ mensaje "Valorant Masters London
 * 2026 / Team Heretics eliminado. / Hay una nueva revisión pendiente." → Telegram →
 * Pending — sin enviar realmente. Comprueba: routing · plantillas · cola · historial ·
 * determinismo · rendimiento · integración con Auto Pipeline y Telegram Control ·
 * adaptadores · cero envíos reales · cero publicaciones · cero aprobaciones.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resetRuntime, runtimeVersion } from "@/publisher";
import { totalCards } from "@/data/catalog";
import type { WatchEvent } from "@/tournament-watcher";
import { CoordinatorEngine } from "@/tournament-autopipeline";
import { esc } from "@/telegram-control";
import {
  NotificationHub, ConsoleChannel, TelegramChannelAdapter, DiscordChannelAdapter,
  renderTemplate, kindOfRequest, rankChannels, auditHub, historyOfMessage,
  NOTIFICATION_KINDS, DEFAULT_ROUTING,
  type HubRequest, type NotificationChannel, type RoutingPolicy,
} from "@/tournament-notifications";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

const NOW = 1_700_000_000_000;
const T = "valorant-masters-london-2026";
const NAME = "Valorant Masters London 2026";
const req = (over: Partial<HubRequest> = {}): HubRequest => ({
  id: `${T}@generate-review#1`, tournamentId: T, action: "generate-review",
  reason: "TeamEliminated", sourceEventSeqs: [1], ...over,
});
const EVENTS: WatchEvent[] = [
  { seq: 1, at: NOW, tournamentId: T, kind: "team-eliminated", subject: "Team Heretics" },
  { seq: 2, at: NOW, tournamentId: T, kind: "statistics-changed", subject: "zekken" },
];

function main(): void {
  console.log("# Verificación del Notification Hub — DRL Champions (Watcher Fase 4/5)\n");

  resetRuntime();
  const cardsBefore = totalCards();

  // ── 1. EJEMPLO OBLIGATORIO ──
  console.log("## 1. Ejemplo obligatorio");
  const telegram = new TelegramChannelAdapter(() => 5001);
  const consoleCh = new ConsoleChannel();
  const hub = new NotificationHub(() => NOW, [consoleCh, telegram, new DiscordChannelAdapter()]);
  const plan = hub.plan([req()], { tournamentName: NAME, events: EVENTS });
  const msg = plan.messages.find((m) => m.channelId === "telegram")!;
  console.log(`   → [${msg.channelId} · ${msg.state}] ${msg.body.replace(/\n/g, " / ")}`);
  check("mensaje EXACTO del contrato",
    msg.body === `${NAME}\nTeam Heretics eliminado.\nHay una nueva revisión pendiente.`);
  check("destino Telegram · estado Pending", msg.channelId === "telegram" && msg.target === "operators" && msg.state === "pending");
  check("SIN enviar realmente (el adaptador aún no tiene nada)", telegram.outbox.length === 0);
  check("runtime intacto (cero publicaciones, cero aprobaciones)",
    totalCards() === cardsBefore && runtimeVersion() === 0);

  // ── 2. PLANTILLAS (7 del contrato, deterministas) ──
  console.log("\n## 2. Plantillas");
  const tpl = (reason: string, action: HubRequest["action"] = "generate-review"): string =>
    renderTemplate(kindOfRequest(req({ reason, action })), req({ reason, action }), { tournamentName: NAME, events: EVENTS }).body;
  check("nuevo torneo / eliminado / nueva revisión / revisión completa / stats / pendiente / error",
    tpl("TournamentCreated").includes("Nuevo torneo") &&
    tpl("TeamEliminated").includes("eliminado") &&
    tpl("ResultChanged").includes("nueva revisión pendiente") &&
    tpl("TournamentFinished", "generate-full-review").includes("COMPLETA") &&
    tpl("StatisticsChanged").includes("Estadísticas actualizadas") &&
    renderTemplate("pipeline-pending", req(), { tournamentName: NAME }).body.includes("Pipeline pendiente") &&
    renderTemplate("error", req(), { tournamentName: NAME, error: "timeout" }).body.includes("timeout"));
  check("los 7 tipos del contrato existen y son deterministas",
    NOTIFICATION_KINDS.length === 7 &&
    JSON.stringify(renderTemplate("team-eliminated", req(), { tournamentName: NAME, events: EVENTS })) ===
    JSON.stringify(renderTemplate("team-eliminated", req(), { tournamentName: NAME, events: EVENTS })));
  check("sin contexto de eventos, la plantilla degrada con elegancia",
    renderTemplate("team-eliminated", req(), {}).body.includes("Un equipo eliminado"));

  // ── 3. ROUTING ──
  console.log("\n## 3. Routing");
  check("tipos derivados del motivo dominante de la petición",
    kindOfRequest(req({ reason: "TeamEliminated" })) === "team-eliminated" &&
    kindOfRequest(req({ reason: "TournamentFinished", action: "generate-full-review" })) === "full-review" &&
    kindOfRequest(req({ reason: "StatisticsChanged" })) === "stats-updated" &&
    kindOfRequest(req({ reason: "ResultChanged" })) === "new-review");
  check("política de canales por tipo (declarativa) + prioridad",
    plan.messages.map((m) => m.channelId).sort().join(",") === "console,telegram" &&
    rankChannels([consoleCh, telegram])[0].id === "telegram");
  check("canal enrutado pero SIN salud (stub discord) se salta y queda reportado", (() => {
    const viaDiscord: RoutingPolicy = { ...DEFAULT_ROUTING, byKind: { "team-eliminated": ["discord", "console"] } };
    const hd = new NotificationHub(() => NOW, [new ConsoleChannel(), new DiscordChannelAdapter()], undefined, viaDiscord);
    const pd = hd.plan([req()], { tournamentName: NAME });
    return pd.skippedChannels.includes("discord") && pd.messages.every((m) => m.channelId === "console");
  })());
  const custom: RoutingPolicy = { ...DEFAULT_ROUTING, byKind: {}, defaultChannels: ["console"] };
  const hubCustom = new NotificationHub(() => NOW, [new ConsoleChannel()], undefined, custom);
  check("política sustituible (nada hardcodeado)",
    hubCustom.plan([req()], { tournamentName: NAME }).messages.every((m) => m.channelId === "console"));

  // ── 4. COLA + ADAPTADORES ──
  console.log("\n## 4. Cola y adaptadores");
  const before = hub.pending().length;
  const { sent, failed } = hub.dispatch();
  check("pendientes → entregadas al ADAPTADOR (buffer, jamás red)",
    before === 2 && sent === 2 && failed === 0 &&
    telegram.outbox.length === 1 && consoleCh.lines.length === 1);
  check("el Effect de telegram es MarkdownV2 del Telegram Control (listo para un ejecutor futuro)",
    telegram.outbox[0].kind === "send" && (telegram.outbox[0] as { text: string }).text.includes(esc("Team Heretics eliminado.")));
  check("dedupe permanente: re-planificar la MISMA petición no reencola ni reenvía", (() => {
    const again = hub.plan([req()], { tournamentName: NAME, events: EVENTS });
    return again.messages.length === 0 && again.deduped === 2 && hub.dispatch().sent === 0 &&
      telegram.outbox.length === 1;
  })());
  check("canal fallido ⇒ reintentable ⇒ cancelado al agotar intentos", (() => {
    const flaky: NotificationChannel = { id: "telegram", priority: () => 1, health: () => true, send: () => ({ ok: false, detail: "caído" }) };
    const h2 = new NotificationHub(() => NOW, [flaky]);
    h2.plan([req()], { tournamentName: NAME });
    h2.dispatch(); // intento 1 → retryable
    h2.dispatch(); // intento 2 → retryable
    h2.dispatch(); // intento 3 → cancelled
    const m2 = Object.values(h2.registry.messages)[0];
    return m2.state === "cancelled" && m2.attempts === 3 && h2.metrics().cancelled === 1;
  })());
  check("cancelación explícita", (() => {
    const h3 = new NotificationHub(() => NOW, [new ConsoleChannel()]);
    const p3 = h3.plan([req()], { tournamentName: NAME });
    h3.cancel(p3.messages[0].id, "silenciado por el operador");
    return h3.registry.messages[p3.messages[0].id].state === "cancelled" && h3.dispatch().sent === 0;
  })());

  // ── 5. HISTORIAL ──
  console.log("\n## 5. Historial");
  const h = historyOfMessage(hub.registry, msg.id);
  check("auditoría por mensaje: encolado → enviado, con destino/estado/intentos/fecha lógica",
    h.length === 2 && h[0].state === "pending" && h[1].state === "sent" &&
    h.every((x) => x.at === NOW && x.channelId === "telegram" && x.target === "operators"));
  check("jamás se pierde: auditoría íntegra", auditHub(hub.registry).length === 0);

  // ── 6. INTEGRACIÓN REAL CON EL AUTO PIPELINE ──
  console.log("\n## 6. Integración con el Auto Pipeline");
  const coordinator = new CoordinatorEngine(() => NOW);
  coordinator.ingest(EVENTS);
  const chainHub = new NotificationHub(() => NOW, [new TelegramChannelAdapter(() => 1)]);
  const chainPlan = chainHub.plan(coordinator.plan(), { tournamentName: NAME, events: EVENTS });
  check("las peticiones REALES del coordinator producen el mensaje del contrato",
    coordinator.plan().length === 1 && chainPlan.messages.length === 1 &&
    chainPlan.messages[0].body.includes("Team Heretics eliminado"));

  // ── 7. DETERMINISMO ──
  console.log("\n## 7. Determinismo");
  const replay = (): string => {
    const e = new NotificationHub(() => NOW, [new ConsoleChannel(() => { /* sink */ }), new TelegramChannelAdapter(() => 7)]);
    e.plan([req()], { tournamentName: NAME, events: EVENTS });
    e.dispatch();
    return JSON.stringify(e.registry);
  };
  check("misma entrada + mismo reloj ⇒ registry byte a byte", replay() === replay());
  check("registry 100% serializable", JSON.parse(JSON.stringify(hub.registry)).order.length === hub.registry.order.length);

  // ── 8. RENDIMIENTO ──
  console.log("\n## 8. Rendimiento");
  const big = new NotificationHub(() => NOW, [new ConsoleChannel(() => { /* sink */ })],
    undefined, { ...DEFAULT_ROUTING, byKind: {}, defaultChannels: ["console"] });
  const bigReqs: HubRequest[] = Array.from({ length: 1000 }, (_, i) =>
    ({ id: `t${i}@generate-review#1`, tournamentId: `t${i}`, action: "generate-review", reason: "TeamEliminated", sourceEventSeqs: [i] }));
  const t0 = Date.now();
  const bigPlan = big.plan(bigReqs, {});
  const bigOut = big.dispatch();
  const ms = Date.now() - t0;
  check("1000 peticiones → 1000 mensajes entregados al adaptador en tiempo razonable",
    bigPlan.messages.length === 1000 && bigOut.sent === 1000 && ms < 3000, `${ms} ms`);

  // ── 9. CERO ENVÍOS REALES / CERO EJECUCIONES ──
  console.log("\n## 9. Cero envíos reales");
  const srcDir = join(process.cwd(), "src", "tournament-notifications");
  const sources = readdirSync(srcDir).map((f) => readFileSync(join(srcDir, f), "utf8")).join("\n");
  check("el módulo no usa red ni transportes (fetch/http/createHttpTransport)",
    !sources.includes("fetch(") && !sources.includes("http") && !sources.includes("createHttpTransport") &&
    !sources.includes("executeEffects"));
  check("no importa Orchestrator/Control/Publisher/Editorial",
    !sources.includes("tournament-orchestrator") && !sources.includes("tournament-control") &&
    !sources.includes("@/publisher") && !sources.includes("@/editorial"));
  check("cero publicaciones/aprobaciones tras TODO el tráfico",
    totalCards() === cardsBefore && runtimeVersion() === 0);

  console.log(`\n${fail === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${fail} COMPROBACIÓN(ES) FALLARON`} — ${pass}/${pass + fail}`);
  if (fail > 0) process.exitCode = 1;
}

main();
