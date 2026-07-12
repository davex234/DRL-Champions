/**
 * FORMATTER — proyección de las vistas del Tournament Control Center a texto MarkdownV2.
 * Solo formateo puro y determinista: nada se calcula aquí (los números vienen de las
 * proyecciones oficiales del panel: dashboard/detalle/métricas/historial/runtime).
 */
import type {
  ControlMetrics, DashboardRow, GenerationDetail, HistoryEntry, RuntimeInfo,
} from "@/tournament-control";
import type { ControlReviewRow } from "@/tournament-control";
import type { EditorialState } from "@/editorial";
import type { BotConfig, ChatSession } from "./types";

/** Escapado OBLIGATORIO de MarkdownV2 (todos los mensajes pasan por aquí). */
export function esc(text: string): string {
  return text.replace(/[\\_*[\]()~`>#+\-=|{}.!]/g, (c) => `\\${c}`);
}

export const b = (text: string): string => `*${esc(text)}*`;
export const code = (text: string): string => `\`${text.replace(/[\\`]/g, (c) => `\\${c}`)}\``;

const fdate = (at: number): string => esc(new Date(at).toISOString().slice(0, 10));

const STATUS_EMOJI: Record<string, string> = {
  generated: "🃏", "in-review": "🕵️", approved: "✅", published: "🚀", "rolled-back": "⟲", archived: "🗄",
};
export const fmtStatus = (status: string): string => `${STATUS_EMOJI[status] ?? "•"} ${esc(status)}`;

/* ── Pantallas ────────────────────────────────────────────────────────────── */

export const fmtWelcome = (cfg: BotConfig): string =>
  `🏆 ${b(cfg.botName)} — Tournament Control Center\n\n` +
  esc("Interfaz remota del panel: torneos, generaciones, revisión editorial, publicaciones, runtime y estadísticas.") +
  `\n\n${esc("Usa el menú o /help para ver los comandos.")}`;

export const fmtHelp = (): string =>
  `${b("Comandos")}\n` +
  [
    ["/start", "menú principal"], ["/help", "esta ayuda"], ["/status", "estado general"],
    ["/tournaments", "torneos registrados"], ["/generations", "generaciones"], ["/runtime", "runtime vigente"],
    ["/review", "revisión editorial"], ["/publish", "publicación"], ["/rollback", "rollback"],
    ["/history", "historial"], ["/settings", "configuración"],
  ].map(([c, d]) => `${code(c)} — ${esc(d)}`).join("\n");

export function fmtStatusScreen(m: ControlMetrics, rt: RuntimeInfo): string {
  return `📊 ${b("Estado del panel")}\n\n` +
    `📂 Torneos: ${b(String(m.tournaments))} · 🃏 Generaciones: ${b(String(m.records))}\n` +
    `🚀 Publicaciones: ${b(String(m.publications))} · ⟲ Rollbacks: ${b(String(m.rollbacks))}\n` +
    `🖥 Runtime ${code(`v${rt.runtimeVersion}`)}` +
    (rt.generationId ? ` · vigente: ${code(rt.generationId)}` : ` · ${esc("sin generación activa")}`);
}

export function fmtTournamentRow(r: DashboardRow, teams: number): string {
  return `${fmtStatus(r.status)} ${b(r.tournamentName)}${r.live ? " 🔴 live" : ""}\n` +
    `   ${code(r.generationId)}\n` +
    `   ${esc(`equipos ${teams} · cartas ${r.cards} · `)}${fdate(r.date)} · runtime ${code(`v${r.runtimeVersion}`)}`;
}

export const fmtTournamentList = (rows: { row: DashboardRow; teams: number }[]): string =>
  `📂 ${b("Torneos")}\n\n` +
  (rows.length === 0
    ? esc("Sin torneos registrados. Envía una URL de vlr.gg o genera desde el panel/CLI.")
    : rows.map((r, i) => `${i + 1}\\. ${fmtTournamentRow(r.row, r.teams)}`).join("\n\n"));

export function fmtGenerationView(r: DashboardRow, d: GenerationDetail, totalMs: number): string {
  return `🃏 ${b(r.tournamentName)}\n\n` +
    `${code(r.generationId)}\n` +
    `Estado: ${fmtStatus(r.status)}${r.live ? " 🔴" : ""}\n` +
    `Cartas: ${b(String(r.cards))} · Jugadores: ${b(String(d.players.resolved + d.players.created))} ` +
    esc(`(${d.players.created} nuevos)`) + `\n` +
    `Aprobadas ${b(String(r.approved))} · Pendientes ${b(String(r.pending))} · Rechazadas ${b(String(r.rejected))} · Bloqueadas ${b(String(r.blocked))} · Publicadas ${b(String(r.published))}\n` +
    `Tiempo del pipeline: ${esc(`${totalMs} ms`)}\n` +
    `Catálogo: ${r.catalogVersion ? code(r.catalogVersion) : esc("—")} · Runtime ${code(`v${r.runtimeVersion}`)}`;
}

export function fmtReviewScreen(
  r: DashboardRow, counts: Record<EditorialState, number> | null, shown: ControlReviewRow[],
): string {
  if (!counts) {
    return `✅ ${b("Revisión")} — ${code(r.generationId)}\n\n` +
      esc("La revisión aún no está abierta. Ábrela para someter la generación al circuito editorial.");
  }
  const head =
    `✅ ${b("Revisión")} — ${code(r.generationId)}\n\n` +
    `⏳ Pendientes: ${b(String(counts.review + counts.draft))} · ✅ Aprobadas: ${b(String(counts.approved))}\n` +
    `❌ Rechazadas: ${b(String(counts.rejected))} · ⛔ Bloqueadas: ${b(String(counts.blocked))} · ` +
    `◌ Ocultas: ${b(String(counts.hidden))} · 🗄 Archivadas: ${b(String(counts.archived))}\n` +
    `🚀 Publicadas: ${b(String(counts.published))}`;
  if (!shown.length) return head;
  return head + `\n\n${b("En review")}\n` +
    shown.map((c) => `• ${code(c.cardId)} ${esc(`OVR ${c.ovr} · ${c.rarity}`)}`).join("\n");
}

export function fmtPublicationScreen(r: DashboardRow, rt: RuntimeInfo): string {
  return `🚀 ${b("Publicación")} — ${code(r.generationId)}\n\n` +
    `Estado: ${fmtStatus(r.status)}${r.live ? " 🔴 live" : ""}\n` +
    `CatalogVersion: ${r.catalogVersion ? code(r.catalogVersion) : esc("—")}\n` +
    `RuntimeVersion: ${code(`v${rt.runtimeVersion}`)}\n` +
    `Aprobadas listas: ${b(String(r.approved))} · Publicadas: ${b(String(r.published))}`;
}

export function fmtRuntimeScreen(rt: RuntimeInfo, catalogVersion: string, totalCards: number, uptimeMs: number): string {
  const mins = Math.floor(uptimeMs / 60_000);
  return `🖥 ${b("Runtime")}\n\n` +
    `Versión: ${code(`v${rt.runtimeVersion}`)}\n` +
    `Catálogo: ${catalogVersion ? code(catalogVersion) : esc("—")} ${esc(`(${totalCards} cartas)`)}\n` +
    `Generación activa: ${rt.generationId ? code(rt.generationId) : esc("ninguna")}\n` +
    `Tiempo activo: ${esc(`${mins} min`)}\n` +
    `Estado: ${rt.generationId ? "🟢 " + esc("publicado") : "⚪ " + esc("semilla")}`;
}

export function fmtStatsScreen(m: ControlMetrics): string {
  const avg = m.records ? Math.round(m.totalMs / m.records) : 0;
  return `📊 ${b("Estadísticas")}\n\n` +
    `📂 Torneos: ${b(String(m.tournaments))}\n` +
    `🃏 Generaciones: ${b(String(m.records))} · Cartas: ${b(String(m.cardsGenerated))}\n` +
    `🚀 Publicaciones: ${b(String(m.publications))} · ⟲ Rollbacks: ${b(String(m.rollbacks))}\n` +
    `⏱ Tiempo medio de pipeline: ${esc(`${avg} ms`)}\n` +
    esc(`Equipos ${m.teams} · Jugadores ${m.players} · Mapas ${m.maps}`);
}

export function fmtHistoryScreen(entries: HistoryEntry[], limit = 12): string {
  const last = entries.slice(-limit);
  return `🕘 ${b("Historial")} ${esc(`(últimas ${last.length} de ${entries.length})`)}\n\n` +
    (last.length === 0 ? esc("Sin actividad.") : last.map((e) =>
      `${fdate(e.at)} ${esc(e.source === "control" ? "🎛" : "✍️")} ${b(e.kind)} ${esc(e.actor)}` +
      (e.cardId ? ` ${code(e.cardId)}` : "") +
      (e.detail ? `\n   ${esc(e.detail)}` : "")).join("\n"));
}

export function fmtSettingsScreen(s: ChatSession, cfg: BotConfig): string {
  return `⚙ ${b("Configuración")}\n\n` +
    `Usuario: ${code(String(s.userId))} · Chat: ${code(String(s.chatId))}\n` +
    `Notificaciones: ${s.preferences.notifications ? "🔔 " + esc("activadas") : "🔕 " + esc("desactivadas")}\n` +
    `Autorizados: ${b(String(cfg.allowedUsers.length))} ${esc("usuario(s) en lista blanca")}`;
}

export const fmtUnauthorized = (): string => `⛔ ${esc("No autorizado. Pide acceso al administrador del panel.")}`;

export const fmtConfirm = (question: string): string => `❓ ${b(question)}\n\n${esc("Esta acción es sensible y requiere confirmación.")}`;
