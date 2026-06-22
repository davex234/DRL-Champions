import type { Match, SchedulerJob } from "./types";

let seq = 0;
const jid = () => `job_${++seq}_${Math.floor(Math.random() * 1e4).toString(36)}`;

/**
 * Planifica los trabajos de monitorización de un partido alrededor de su inicio:
 * T-30 activar monitor · T seguir · T+30/+60/+90 actualizar, hasta finalizar.
 */
export function planMatchJobs(m: Match): SchedulerJob[] {
  if (m.status === "finished") return [];
  const out: SchedulerJob[] = [];
  const label = `${m.teamA} vs ${m.teamB}`;
  const add = (offsetMin: number, what: string) =>
    out.push({
      id: jid(),
      kind: "monitor_match",
      runAt: m.startTime + offsetMin * 60_000,
      payload: { matchId: m.id },
      status: "scheduled",
      label: `${what} · ${label}`,
    });
  add(-30, "Activar monitor");
  add(0, "Seguir partido");
  add(30, "Actualizar");
  add(60, "Actualizar");
  add(90, "Actualizar");
  return out;
}

export function dueJobs(jobs: SchedulerJob[], now: number): SchedulerJob[] {
  return jobs.filter((j) => j.status === "scheduled" && j.runAt <= now);
}
