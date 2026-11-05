/** F67 · caída y recuperación: tráfico QA de lectura → kill -9 del proceso real de :3005 → arranque en frío → comprobaciones. */
import { execSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { api, login, mm, rating, credits, sleep } from "../multiplayer/_qa";
/* eslint-disable @typescript-eslint/no-explicit-any */
(async () => {
  const S = process.argv[2];
  const C = await login("C");
  const before = { ...(await rating(C)), ...(await credits(C)), queue: (await mm(C)).json?.entry?.state ?? null, decks: ((await api(C, "/api/game/duels")).json?.decks ?? []).length };
  // Tráfico de lectura en curso durante la caída.
  let stop = false; const results: number[] = [];
  const loop = (async () => { while (!stop) { try { results.push((await api(C, "/api/game/play-status", undefined, { noRetry: true })).status); } catch { results.push(0); } await sleep(50); } })();
  await sleep(1500);
  const pid = execSync(`powershell -NoProfile -Command "(Get-NetTCPConnection -State Listen -LocalPort 3005 | Select-Object -First 1).OwningProcess"`, { encoding: "utf8" }).trim();
  const killedAt = Date.now();
  execSync(`powershell -NoProfile -Command "Stop-Process -Id ${pid} -Force"`);
  await sleep(1500);
  const restart = spawnSync(process.execPath, ["scripts/ops/_cold-start.mjs", `${S}/app-f67b.log`, `${S}/app-f67b.err`, `${S}/startup-after-crash.json`], { encoding: "utf8" });
  const start = JSON.parse(restart.stdout);
  stop = true; await loop;
  const C2 = await login("C");
  const after = { ...(await rating(C2)), ...(await credits(C2)), queue: (await mm(C2)).json?.entry?.state ?? null, decks: ((await api(C2, "/api/game/duels")).json?.decks ?? []).length };
  const out = {
    killedPid: Number(pid), newPid: start.pid, downtimeMs: start.homeMs + 1500, readyAfterMs: start.readyMs, readyStatus: start.ready?.status,
    trafficDuringCrash: results.reduce<Record<string, number>>((m, s) => ((m[s] = (m[s] ?? 0) + 1), m), {}),
    before, after, statePreserved: JSON.stringify(before) === JSON.stringify(after), loginAfterRestart: !!C2.token,
    note: "kill -9 (Stop-Process -Force) del proceso real que escuchaba en :3005, con tráfico QA de lectura. Todo el estado de juego vive en Postgres; el único estado en memoria (cachés de catálogo/sanción/readiness) se reconstruye solo.",
    killedAt: new Date(killedAt).toISOString(),
  };
  writeFileSync("docs/product/qa/fase67-production/restart-recovery.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
