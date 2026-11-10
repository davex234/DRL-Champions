/**
 * COMMANDS — pantallas del bot y enrutado de comandos (/start … /settings). Cada pantalla es
 * una PROYECCIÓN de las vistas públicas del Tournament Control Center (dashboard, detalle,
 * revisión, historial, métricas, runtime) formateada a MarkdownV2 + teclado inline. Aquí no
 * se decide ni se calcula nada del dominio.
 */
import {
  buildDashboard, buildHistory, buildMetrics, generationDetail, reviewCounts, reviewRows,
} from "@/tournament-control";
import type { ChatSession, EngineCtx, Screen, TelegramControlState } from "./types";
import {
  esc, fmtGenerationView, fmtHelp, fmtHistoryScreen, fmtPublicationScreen, fmtReviewScreen,
  fmtRuntimeScreen, fmtSettingsScreen, fmtStatsScreen, fmtStatusScreen, fmtTournamentList,
  fmtTournamentRow, fmtWelcome, b,
} from "./formatter";
import {
  generationListMenu, generationMenu, homeMenu, mainMenu, publishMenu, reviewClosedMenu,
  reviewMenu, settingsMenu, tournamentListMenu, tournamentMenu,
} from "./menus";

/** Cartas mostradas por página en la pantalla de revisión (límite de botones de Telegram). */
export const REVIEW_PAGE_SIZE = 4;

export const recordByIndex = (state: TelegramControlState, i: number) =>
  state.ledger.records[state.ledger.order[i]];

export const indexOfRecord = (state: TelegramControlState, recordId: string | undefined): number => {
  const i = recordId ? state.ledger.order.indexOf(recordId) : -1;
  return i >= 0 ? i : state.ledger.order.length ? 0 : -1;
};

/* ── Pantallas ────────────────────────────────────────────────────────────── */

export const screenMain = (ctx: EngineCtx): Screen => ({ text: fmtWelcome(ctx.config), keyboard: mainMenu() });
export const screenHelp = (): Screen => ({ text: fmtHelp(), keyboard: homeMenu() });

export const screenStatus = (state: TelegramControlState, ctx: EngineCtx): Screen => ({
  text: fmtStatusScreen(buildMetrics(state.ledger), ctx.rt()),
  keyboard: mainMenu(),
});

export function screenTournaments(state: TelegramControlState, ctx: EngineCtx): Screen {
  const rows = buildDashboard(state.ledger, ctx.rt());
  return {
    text: fmtTournamentList(rows.map((row) => ({ row, teams: state.ledger.records[row.recordId].metrics.teams }))),
    keyboard: tournamentListMenu(rows.length),
  };
}

export function screenTournament(state: TelegramControlState, i: number, ctx: EngineCtx): Screen {
  const row = buildDashboard(state.ledger, ctx.rt())[i];
  if (!row) return screenTournaments(state, ctx);
  const rec = recordByIndex(state, i);
  return {
    text: `📂 ${b("Torneo")}\n\n${fmtTournamentRow(row, rec.metrics.teams)}`,
    keyboard: tournamentMenu(i),
  };
}

export function screenGenerations(state: TelegramControlState, ctx: EngineCtx): Screen {
  const rows = buildDashboard(state.ledger, ctx.rt());
  const text = `🃏 ${b("Generaciones")}\n\n` +
    (rows.length === 0 ? esc("Sin generaciones registradas.") :
      rows.map((r, i) => `${i + 1}\\. ${fmtTournamentRow(r, state.ledger.records[r.recordId].metrics.teams)}`).join("\n\n"));
  return { text, keyboard: generationListMenu(rows.length) };
}

export function screenGeneration(state: TelegramControlState, i: number, ctx: EngineCtx): Screen {
  const row = buildDashboard(state.ledger, ctx.rt())[i];
  if (!row) return screenGenerations(state, ctx);
  const rec = recordByIndex(state, i);
  return {
    text: fmtGenerationView(row, generationDetail(rec), rec.metrics.totalMs),
    keyboard: generationMenu(i),
  };
}

export function screenReview(state: TelegramControlState, i: number, ctx: EngineCtx): Screen {
  const row = buildDashboard(state.ledger, ctx.rt())[i];
  if (!row) return screenGenerations(state, ctx);
  const rec = recordByIndex(state, i);
  const counts = reviewCounts(rec);
  if (!counts) return { text: fmtReviewScreen(row, null, []), keyboard: reviewClosedMenu(i) };
  const rows = reviewRows(rec);
  const shownIdx: number[] = [];
  for (let ci = 0; ci < rows.length && shownIdx.length < REVIEW_PAGE_SIZE; ci++) {
    if (rows[ci].state === "review") shownIdx.push(ci);
  }
  return {
    text: fmtReviewScreen(row, counts, shownIdx.map((ci) => rows[ci])),
    keyboard: reviewMenu(i, shownIdx),
  };
}

export function screenPublish(state: TelegramControlState, i: number, ctx: EngineCtx): Screen {
  const row = buildDashboard(state.ledger, ctx.rt())[i];
  if (!row) return screenGenerations(state, ctx);
  return { text: fmtPublicationScreen(row, ctx.rt()), keyboard: publishMenu(i) };
}

export function screenRuntime(state: TelegramControlState, ctx: EngineCtx): Screen {
  const rt = ctx.rt();
  const live = buildDashboard(state.ledger, rt).find((r) => r.live);
  return {
    text: fmtRuntimeScreen(rt, live?.catalogVersion ?? "", ctx.totalCards(), Math.max(0, ctx.now - ctx.startedAt)),
    keyboard: homeMenu(),
  };
}

export const screenStats = (state: TelegramControlState): Screen => ({
  text: fmtStatsScreen(buildMetrics(state.ledger)),
  keyboard: homeMenu(),
});

export function screenHistory(state: TelegramControlState, recordId?: string): Screen {
  return { text: fmtHistoryScreen(buildHistory(state.ledger, recordId)), keyboard: homeMenu() };
}

export const screenSettings = (s: ChatSession, ctx: EngineCtx): Screen => ({
  text: fmtSettingsScreen(s, ctx.config),
  keyboard: settingsMenu(s.preferences.notifications),
});

/* ── Enrutado de comandos ─────────────────────────────────────────────────── */

export interface CommandResult {
  screen: Screen;
  /** Etiqueta de menú para la sesión (persistir "último menú"). */
  menu: string;
}

/** Resuelve un comando /xxx a su pantalla. Comando desconocido → ayuda. */
export function routeCommand(
  cmd: string, state: TelegramControlState, session: ChatSession, ctx: EngineCtx,
): CommandResult {
  const sel = indexOfRecord(state, session.selected);
  switch (cmd) {
    case "/start": return { screen: screenMain(ctx), menu: "main" };
    case "/help": return { screen: screenHelp(), menu: "help" };
    case "/status": return { screen: screenStatus(state, ctx), menu: "status" };
    case "/tournaments": return { screen: screenTournaments(state, ctx), menu: "tournaments" };
    case "/generations": return { screen: screenGenerations(state, ctx), menu: "generations" };
    case "/runtime": return { screen: screenRuntime(state, ctx), menu: "runtime" };
    case "/review":
      return sel < 0
        ? { screen: { text: esc("Sin generaciones que revisar."), keyboard: homeMenu() }, menu: "review" }
        : { screen: screenReview(state, sel, ctx), menu: `review:${sel}` };
    case "/publish":
    case "/rollback":
      return sel < 0
        ? { screen: { text: esc("Sin generaciones registradas."), keyboard: homeMenu() }, menu: "publish" }
        : { screen: screenPublish(state, sel, ctx), menu: `publish:${sel}` };
    case "/history": return { screen: screenHistory(state), menu: "history" };
    case "/settings": return { screen: screenSettings(session, ctx), menu: "settings" };
    default: return { screen: screenHelp(), menu: "help" };
  }
}
