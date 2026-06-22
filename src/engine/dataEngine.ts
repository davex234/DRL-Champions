import type {
  DataSource,
  Tournament,
  Match,
  GeneratedCard,
  EngineLog,
  EngineNotification,
  SchedulerJob,
  LogLevel,
} from "./types";
import type { EventDef } from "@/domain/events/types";
import { normalizeTournament, normalizeMatches } from "./sources/normalize";
import { generateCards } from "./cardGenerator";
import { generateEvent } from "./eventGenerator";
import { planMatchJobs } from "./scheduler";
import { makeNotification } from "./notifications";

export interface RunReport {
  tournaments: Tournament[];
  matches: Match[];
  cards: GeneratedCard[];
  events: EventDef[];
  jobs: SchedulerJob[];
  logs: EngineLog[];
  notifications: EngineNotification[];
}

let logSeq = 0;
function log(logs: EngineLog[], module: string, level: LogLevel, message: string) {
  logSeq += 1;
  logs.push({ id: `log_${logSeq}_${Math.floor(Math.random() * 1e4).toString(36)}`, at: Date.now(), level, module, message });
}

/**
 * Pipeline autónomo: detecta torneos → detecta partidos → programa monitores →
 * en torneos finalizados (no procesados) obtiene resultados, identifica ganador
 * y MVP, genera cartas (SERIES/WINNER/MVP/ICON/PRIME) con seriales y confianza,
 * genera el evento, y emite notificaciones de incidencias.
 */
export async function runEngine(source: DataSource, alreadyProcessed: string[] = []): Promise<RunReport> {
  const report: RunReport = { tournaments: [], matches: [], cards: [], events: [], jobs: [], logs: [], notifications: [] };
  const processed = new Set(alreadyProcessed);

  try {
    const rawTournaments = await source.getTournaments();
    log(report.logs, "DataEngine", "info", `Detectados ${rawTournaments.length} torneos (fuente: ${source.label}).`);

    for (const raw of rawTournaments) {
      const t = normalizeTournament(raw);
      report.tournaments.push(t);
      log(report.logs, "TournamentEngine", "info", `Torneo "${t.name}" [${t.type}] · estado ${t.status}.`);

      let teams;
      let rawMatches;
      try {
        teams = await source.getTeams(t.id);
        rawMatches = await source.getMatches(t.id);
      } catch (e) {
        report.notifications.push(makeNotification("scraping_error", "error", `Error obteniendo datos de ${t.name}: ${(e as Error).message}`));
        log(report.logs, "DataEngine", "error", `Scraping ${t.name}: ${(e as Error).message}`);
        continue;
      }

      const matches = normalizeMatches(rawMatches, teams);
      report.matches.push(...matches);

      // Programar monitores para partidos próximos/en vivo.
      for (const m of matches) {
        if (m.status !== "finished") {
          report.jobs.push(...planMatchJobs(m));
        }
      }
      log(report.logs, "Scheduler", "info", `${report.jobs.length} trabajos de monitorización planificados.`);

      // Generar cartas de torneos finalizados aún no procesados.
      if (t.status === "finished" && !processed.has(t.id)) {
        let result;
        try {
          result = await source.getResult(t.id);
        } catch (e) {
          report.notifications.push(makeNotification("scraping_error", "error", `Sin resultados de ${t.name}: ${(e as Error).message}`));
          continue;
        }
        if (!result) {
          report.notifications.push(makeNotification("inconsistent_data", "warn", `${t.name} marcado finalizado pero sin resultados.`));
          continue;
        }

        try {
          const cards = generateCards(t, teams, result);
          report.cards.push(...cards);
          log(report.logs, "CardGenerator", "info", `Generadas ${cards.length} cartas para ${t.name}.`);

          // Incidencias y aprobaciones.
          for (const c of cards) {
            for (const issue of c.issues) {
              if (issue.startsWith("Logo")) report.notifications.push(makeNotification("logo_not_found", "warn", issue));
              else if (issue.startsWith("Foto")) report.notifications.push(makeNotification("image_not_found", "warn", issue));
              else if (issue.startsWith("MVP")) report.notifications.push(makeNotification("mvp_not_identified", "warn", issue));
              else if (issue.startsWith("País")) report.notifications.push(makeNotification("inconsistent_data", "warn", issue));
            }
            if (c.status === "pending") {
              report.notifications.push(
                makeNotification("approval_required", "warn", `Aprobación requerida (${Math.round(c.confidence * 100)}%): ${c.playerNick} ${c.kind.toUpperCase()} · ${t.name}`),
              );
            }
          }

          report.events.push(generateEvent(t));
          log(report.logs, "EventEngine", "info", `Evento generado para ${t.name}.`);
        } catch (e) {
          report.notifications.push(makeNotification("generation_error", "error", `Error generando cartas de ${t.name}: ${(e as Error).message}`));
          log(report.logs, "CardGenerator", "error", `${t.name}: ${(e as Error).message}`);
        }
      }
    }
  } catch (e) {
    report.notifications.push(makeNotification("scraping_error", "error", `Fallo del engine: ${(e as Error).message}`));
    log(report.logs, "DataEngine", "error", (e as Error).message);
  }

  return report;
}
