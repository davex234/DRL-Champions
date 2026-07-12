/**
 * CALLBACKS — resolución de los botones inline. Cada acción SENSIBLE (publicar · rollback ·
 * aprobar generación · generar desde URL) exige confirmación explícita (Confirmar/Cancelar).
 * Toda mutación delega en las acciones públicas del Tournament Control Center; un error del
 * panel se muestra como toast y NUNCA cambia el estado (los motores ya lo garantizan).
 */
import {
  approveGenerationRecord, buildReport, decideRecordCards, ingestRun, openReview,
  publishRecord, rollbackRecord, reviewRows,
} from "@/tournament-control";
import type { EditorialAction } from "@/editorial";
import type { ChatSession, EngineCtx, NotificationEvent, Screen, TelegramControlState } from "./types";
import {
  indexOfRecord, recordByIndex, screenGeneration, screenGenerations, screenHistory, screenMain,
  screenPublish, screenReview, screenRuntime, screenSettings, screenStats, screenStatus,
  screenTournament, screenTournaments, REVIEW_PAGE_SIZE,
} from "./commands";
import { esc, code, b } from "./formatter";
import { homeMenu } from "./menus";
import { toggleNotifications } from "./sessions";

/* ── Acciones sensibles (requieren Confirmar/Cancelar) ────────────────────── */

export const isSensitive = (data: string): boolean =>
  data.startsWith("g:pub:") || data.startsWith("g:rb:") || data.startsWith("r:all:") || data.startsWith("run:");

export function confirmQuestion(state: TelegramControlState, data: string): string {
  const genOf = (i: string): string => recordByIndex(state, Number(i))?.generationId ?? "?";
  const [ns, action, arg] = data.split(":");
  if (ns === "g" && action === "pub") return `¿Publicar las cartas aprobadas de ${genOf(arg)}?`;
  if (ns === "g" && action === "rb") return `¿Rollback a la publicación de ${genOf(arg)}?`;
  if (ns === "r" && action === "all") return `¿Aprobar la generación ${genOf(arg)} completa?`;
  if (ns === "run") return `¿Generar cartas desde ${data.slice(4)}?`;
  return "¿Confirmar la acción?";
}

/* ── Resultado del dispatch ───────────────────────────────────────────────── */

export interface CallbackOutcome {
  state: TelegramControlState;
  session: ChatSession;
  screen: Screen;
  menu: string;
  /** Texto corto para answerCallbackQuery (toast). */
  toast?: string;
  /** Notificaciones a emitir (publicación/rollback/generación/errores). */
  notifications?: NotificationEvent[];
}

const cardAction: Record<string, EditorialAction> = { a: "approve", x: "reject", b: "block", h: "hide" };

const meta = (session: ChatSession, ctx: EngineCtx) => ({ actor: `tg:${session.userId}`, at: ctx.now });

/**
 * Ejecuta un callback YA CONFIRMADO (o no sensible). Determinista: mismo estado + mismo
 * callback + mismo reloj ⇒ mismo resultado.
 */
export async function executeCallback(
  state: TelegramControlState, session: ChatSession, data: string, ctx: EngineCtx,
): Promise<CallbackOutcome> {
  const [ns, action, argA, argB] = data.split(":");
  const i = Number(argA);
  const rec = Number.isInteger(i) ? recordByIndex(state, i) : undefined;
  const done = (screen: Screen, menu: string, toast?: string, notifications?: NotificationEvent[]): CallbackOutcome =>
    ({ state, session, screen, menu, toast, notifications });

  /* Navegación (menú principal). */
  if (ns === "m") {
    const sel = indexOfRecord(state, session.selected);
    switch (action) {
      case "main": return done(screenMain(ctx), "main");
      case "tournaments": return done(screenTournaments(state, ctx), "tournaments");
      case "generations": return done(screenGenerations(state, ctx), "generations");
      case "review": return sel < 0
        ? done({ text: esc("Sin generaciones que revisar."), keyboard: homeMenu() }, "review")
        : done(screenReview(state, sel, ctx), `review:${sel}`);
      case "publish": return sel < 0
        ? done({ text: esc("Sin generaciones registradas."), keyboard: homeMenu() }, "publish")
        : done(screenPublish(state, sel, ctx), `publish:${sel}`);
      case "runtime": return done(screenRuntime(state, ctx), "runtime");
      case "stats": return done(screenStats(state), "stats");
      case "history": return done(screenHistory(state), "history");
      case "settings": return done(screenSettings(session, ctx), "settings");
    }
  }

  /* Torneos. */
  if (ns === "t" && rec) {
    if (action === "view") {
      return { ...done(screenTournament(state, i, ctx), `tournament:${i}`), session: { ...session, selected: rec.recordId } };
    }
    if (action === "gen") {
      return done(screenTournament(state, i, ctx), `tournament:${i}`,
        "Ya generada (idempotente). Envía una URL de vlr.gg para un torneo nuevo.");
    }
    if (action === "hist") return done(screenHistory(state, rec.recordId), `history:${i}`);
  }

  /* Generaciones. */
  if (ns === "g" && rec) {
    if (action === "view") {
      return { ...done(screenGeneration(state, i, ctx), `generation:${i}`), session: { ...session, selected: rec.recordId } };
    }
    if (action === "report") {
      const report = buildReport(state.ledger, rec.recordId, ctx.rt(), ctx.now);
      const json = JSON.stringify({ ...report, history: report?.history.length }, null, 1).slice(0, 3400);
      return done({ text: `📄 ${b("Informe")} ${code(rec.generationId)}\n\`\`\`json\n${json}\n\`\`\``, keyboard: homeMenu() }, `report:${i}`, "Informe exportado");
    }
    if (action === "pub") {
      const r = await publishRecord(state.ledger, rec.recordId, { ...meta(session, ctx), roster: ctx.roster() });
      if (r.error) {
        return done(screenPublish(state, i, ctx), `publish:${i}`, `⚠ ${r.error}`,
          [{ kind: "publish-error", generationId: rec.generationId, at: ctx.now, error: r.error }]);
      }
      const next = { ...state, ledger: r.ledger };
      return {
        ...done(screenPublish(next, i, ctx), `publish:${i}`, `🚀 Publicadas ${r.value!.published.length} carta(s)`),
        state: next,
        notifications: [{
          kind: "publish-completed", generationId: rec.generationId, at: ctx.now,
          detail: `${r.value!.published.length} aprobada(s) · runtime v${r.value!.publish!.runtimeVersion}`,
        }],
      };
    }
    if (action === "rb") {
      const r = rollbackRecord(state.ledger, rec.recordId, meta(session, ctx));
      if (r.error) {
        return done(screenPublish(state, i, ctx), `publish:${i}`, `⚠ ${r.error}`,
          [{ kind: "publish-error", generationId: rec.generationId, at: ctx.now, error: r.error }]);
      }
      const next = { ...state, ledger: r.ledger };
      return {
        ...done(screenPublish(next, i, ctx), `publish:${i}`, "⟲ Runtime restaurado"),
        state: next,
        notifications: [{
          kind: "rollback-completed", generationId: rec.generationId, at: ctx.now,
          detail: `runtime v${r.value!.runtimeVersion}`,
        }],
      };
    }
  }

  /* Revisión editorial. */
  if (ns === "r" && rec) {
    if (action === "open") {
      const r = openReview(state.ledger, rec.recordId, meta(session, ctx));
      const next = r.error ? state : { ...state, ledger: r.ledger };
      return {
        ...done(screenReview(next, i, ctx), `review:${i}`, r.error ? `⚠ ${r.error}` : "Revisión abierta"),
        state: next,
        session: { ...session, selected: rec.recordId },
      };
    }
    if (action === "all") {
      const r = approveGenerationRecord(state.ledger, rec.recordId, meta(session, ctx));
      const next = r.error ? state : { ...state, ledger: r.ledger };
      return {
        ...done(screenReview(next, i, ctx), `review:${i}`,
          r.error ? `⚠ ${r.error}` : `✅ ${r.value!.applied.length} carta(s) aprobadas`),
        state: next,
      };
    }
    if (action === "sel") {
      const rows = reviewRows(rec);
      const page: string[] = [];
      for (let ci = 0; ci < rows.length && page.length < REVIEW_PAGE_SIZE; ci++) {
        if (rows[ci].state === "review") page.push(rows[ci].cardId);
      }
      const r = page.length
        ? decideRecordCards(state.ledger, rec.recordId, page, "approve", meta(session, ctx))
        : { ledger: state.ledger, error: "sin cartas en la selección" as const };
      const next = "error" in r && r.error ? state : { ...state, ledger: r.ledger };
      return { ...done(screenReview(next, i, ctx), `review:${i}`, r.error ? `⚠ ${r.error}` : `✅ Selección aprobada (${page.length})`), state: next };
    }
    if (cardAction[action]) {
      const ci = Number(argB);
      const card = rec.generation.cards[ci];
      const r = card
        ? decideRecordCards(state.ledger, rec.recordId, [card.cardId], cardAction[action], meta(session, ctx))
        : { ledger: state.ledger, error: "carta desconocida" as const };
      const next = "error" in r && r.error ? state : { ...state, ledger: r.ledger };
      return {
        ...done(screenReview(next, i, ctx), `review:${i}`,
          r.error ? `⚠ ${r.error}` : `${cardAction[action]} · ${card!.cardId}`),
        state: next,
      };
    }
  }

  /* Generar desde URL (run del Orchestrator + ingestRun del panel). */
  if (ns === "run") {
    const url = data.slice(4);
    if (!ctx.runPipeline) return done(screenTournaments(state, ctx), "tournaments", "⚠ Pipeline no disponible en este despliegue");
    try {
      const run = await ctx.runPipeline(url);
      const r = ingestRun(state.ledger, run, meta(session, ctx));
      if (r.error) {
        return done(screenTournaments(state, ctx), "tournaments", `⚠ ${r.error}`,
          [{ kind: "generation-error", generationId: run.metrics.generationId, at: ctx.now, error: r.error }]);
      }
      const next = { ...state, ledger: r.ledger };
      return {
        ...done(screenTournaments(next, ctx), "tournaments", `🃏 ${r.value!.generation.cards.length} carta(s) generadas`),
        state: next,
        notifications: [{
          kind: "generation-completed", generationId: r.value!.generationId, at: ctx.now,
          detail: `${r.value!.generation.cards.length} cartas · ${r.value!.tournamentName}`,
        }],
      };
    } catch (e) {
      return done(screenTournaments(state, ctx), "tournaments", "⚠ Error de generación",
        [{ kind: "generation-error", generationId: "", at: ctx.now, error: e instanceof Error ? e.message : String(e) }]);
    }
  }

  /* Ajustes. */
  if (ns === "s" && action === "notif") {
    const nextSession = toggleNotifications(session);
    return { ...done(screenSettings(nextSession, ctx), "settings", nextSession.preferences.notifications ? "🔔 Activadas" : "🔕 Desactivadas"), session: nextSession };
  }

  return done(screenStatus(state, ctx), "status", "Acción desconocida");
}
