import { spawn, type ChildProcess } from "node:child_process";

/**
 * Arranca un proceso de servidor y devuelve un apagado que MATA EL ÁRBOL.
 *
 * Con `shell: true` —imprescindible en Windows para `npx`— `child.kill()` mata el shell y
 * deja al servidor escuchando. Eso dejaba servidores huérfanos de ejecuciones anteriores,
 * y las pruebas siguientes acababan hablando con un servidor viejo que servía código
 * antiguo. Un falso resultado de esos cuesta muchísimo más que esta función.
 */
export function spawnServer(cmd: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv }) {
  const child: ChildProcess = spawn(cmd, args, {
    cwd: opts.cwd,
    stdio: "ignore",
    shell: true,
    env: opts.env ?? process.env,
  });

  const stop = () => {
    if (child.pid === undefined) return;
    try {
      if (process.platform === "win32") {
        // `/T` incluye los hijos; `/F` no pide permiso.
        spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", shell: true });
      } else {
        process.kill(-child.pid, "SIGKILL");
      }
    } catch {
      /* si ya no está, mejor */
    }
    child.kill();
  };

  return { child, stop };
}

/** Espera a que un servidor responda, o se rinde. */
export async function waitForServer(url: string, timeoutMs: number): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return true;
    } catch {
      /* todavía arrancando */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
