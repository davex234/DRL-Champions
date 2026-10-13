/**
 * CHROME DEVTOOLS PROTOCOL — utilidades compartidas (Fase 9).
 *
 * La Fase 8.5 dejó tres cosas aprendidas que aquí quedan encapsuladas para no volver a
 * tropezar con ellas en cada script:
 *
 *  1. **Siempre headless.** Una pestaña en segundo plano estrangula `requestAnimationFrame`
 *     y `setTimeout`: las capturas salen a medio pintar y los tiempos no son reales.
 *  2. **Perfil propio por ejecución.** Compartir `--user-data-dir` con el Chrome del
 *     usuario impide arrancar. Se crea uno temporal y se borra al terminar.
 *  3. **`Page.printToPDF` solo funciona en modo flujo** (`ReturnAsStream` + `IO.read`).
 *
 * No depende de puppeteer: usa el `WebSocket` global de Node.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const CHROME_PATH = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((p) => existsSync(p));

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Conn {
  ready: Promise<void>;
  send: (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<any>;
  on: (method: string, fn: (p: any) => void) => void;
  close: () => void;
}

function connect(url: string): Conn {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
  const events = new Map<string, ((p: any) => void)[]>();
  ws.addEventListener("message", (ev: MessageEvent) => {
    const m = JSON.parse(ev.data as string);
    if (m.id && pending.has(m.id)) {
      const e = pending.get(m.id)!;
      pending.delete(m.id);
      if (m.error) e.rej(new Error(m.error.message));
      else e.res(m.result);
    } else if (m.method) for (const fn of events.get(m.method) ?? []) fn(m.params);
  });
  return {
    ready: new Promise<void>((res, rej) => {
      ws.addEventListener("open", () => res());
      ws.addEventListener("error", () => rej(new Error("no se pudo abrir el WebSocket de CDP")));
    }),
    send: (method, params = {}, sessionId) =>
      new Promise((res, rej) => {
        const n = ++id;
        pending.set(n, { res, rej });
        ws.send(JSON.stringify({ id: n, method, params, sessionId }));
      }),
    on: (method, fn) => events.set(method, [...(events.get(method) ?? []), fn]),
    close: () => ws.close(),
  };
}

/** Una pestaña headless con lo que hace falta para inspeccionarla y fotografiarla. */
export interface Tab {
  /** Errores de consola acumulados desde la última llamada a `takeErrors()`. */
  takeErrors: () => string[];
  /** Cuántas veces se ha cargado la página. Delata bucles de recarga. */
  loadCount: () => number;
  /** Navega y espera a que la página se asiente. */
  goto: (url: string, settleMs?: number) => Promise<void>;
  /** Evalúa una expresión en la página y devuelve su valor. */
  js: <T = any>(expression: string) => Promise<T>;
  /** Guarda un PNG del viewport. */
  shot: (file: string) => Promise<void>;
  /** Cambia el tamaño del viewport (con su device pixel ratio). */
  resize: (width: number, height: number, dpr?: number) => Promise<void>;
  /** Escribe una clave en `localStorage` del origen actual (sesión de Supabase, etc.). */
  setStorage: (key: string, value: string) => Promise<void>;
  /**
   * Emula una preferencia de medios.
   *
   * Existe por un motivo concreto: **Chrome sin cabeza declara
   * `prefers-reduced-motion: reduce`**. Es lo correcto para las verificaciones —comprueban
   * justo que el producto siga siendo legible sin movimiento— pero convierte cualquier
   * captura de una ceremonia en una foto de su estado en reposo. Para enseñar una
   * animación hay que pedir explícitamente `no-preference`.
   */
  setMedia: (features: { name: string; value: string }[]) => Promise<void>;
  send: (method: string, params?: Record<string, unknown>) => Promise<any>;
  /** F73 · suscripción a eventos CDP de la sesión (p. ej. `Fetch.requestPaused` para arneses de interceptación). */
  on: (method: string, fn: (p: any) => void) => void;
}

export interface Browser {
  tab: Tab;
  close: () => Promise<void>;
}

/**
 * Arranca Chrome en headless y devuelve una pestaña lista.
 * Lanza si no encuentra el ejecutable: es mejor un fallo claro que un test que "pasa".
 */
export async function launch(
  opts: { width?: number; height?: number; userDataDir?: string; /** Flags extra de Chrome (p. ej. modo de poca memoria). */ args?: string[] } = {},
): Promise<Browser> {
  if (!CHROME_PATH) throw new Error("No se encontró Chrome instalado.");
  /*
   * Perfil temporal por defecto: aísla cada ejecución. Pero se puede pasar uno PERSISTENTE
   * (`userDataDir`), y hace falta para todo lo que dependa de estado que sobrevive entre
   * visitas —service workers, `caches`, IndexedDB—. Sin esa opción, un arnés nunca ve los
   * fallos que solo le pasan a quien ya ha entrado antes.
   */
  const ephemeral = !opts.userDataDir;
  const profile = opts.userDataDir ?? mkdtempSync(join(tmpdir(), "nexus-cdp-"));
  const port = 9800 + Math.floor(Math.random() * 180);
  const proc: ChildProcess = spawn(
    CHROME_PATH,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      ...(opts.args ?? []),
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  let wsUrl: string | undefined;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) wsUrl = (await r.json()).webSocketDebuggerUrl;
    } catch {
      /* todavía arrancando */
    }
    if (!wsUrl) await sleep(250);
  }
  if (!wsUrl) throw new Error("Chrome no expuso el puerto de depuración.");

  const root = connect(wsUrl);
  await root.ready;
  const { targetId } = await root.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await root.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (m: string, p: Record<string, unknown> = {}) => root.send(m, p, sessionId);

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");

  /*
   * Errores de consola. Se acumulan por sesión y se VACÍAN al leerlos, para que cada
   * comprobación pueda preguntar «¿ha fallado algo en ESTA pantalla?» sin arrastrar lo
   * anterior. Se escuchan las dos vías porque no coinciden: `Log` recoge los errores de
   * red y del navegador, `Runtime` las excepciones de JavaScript sin capturar.
   */
  const errors: string[] = [];
  root.on("Log.entryAdded", (p: any) => {
    if (p?.entry?.level === "error") errors.push(String(p.entry.text).slice(0, 600));
  });
  root.on("Runtime.exceptionThrown", (p: any) => {
    const d = p?.exceptionDetails;
    errors.push(String(d?.exception?.description ?? d?.text ?? "excepción").slice(0, 600));
  });
  /*
   * `console.error` NO llega por `Log.entryAdded`: viaja por `Runtime.consoleAPICalled`.
   * Y es justo la vía por la que React informa de los errores que captura un error
   * boundary y de los avisos de hidratación. Sin esto, un arnés puede recorrer la
   * aplicación entera y declararla limpia mientras la pantalla enseña un Runtime Error.
   */
  root.on("Runtime.consoleAPICalled", (p: any) => {
    if (p?.type !== "error" && p?.type !== "assert") return;
    const text = (p.args ?? [])
      .map((a: any) => a?.description ?? a?.value ?? (a?.preview?.description ?? ""))
      .filter(Boolean)
      .join(" ");
    if (text.trim().length > 0) errors.push(text.slice(0, 600));
  });
  await send("Emulation.setDeviceMetricsOverride", {
    width: opts.width ?? 1440,
    height: opts.height ?? 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  /*
   * Contador de cargas. Un bucle de recargas no produce ningún error: la página
   * simplemente se recarga para siempre, y desde fuera parece que funciona. Contarlas es
   * la única forma barata de detectarlo.
   */
  let loads = 0;
  root.on("Page.loadEventFired", () => { loads++; });

  const tab: Tab = {
    send,
    on: (method, fn) => root.on(method, fn),
    takeErrors: () => errors.splice(0, errors.length),
    loadCount: () => loads,
    goto: async (url, settleMs = 2200) => {
      const loaded = new Promise<void>((res) => root.on("Page.loadEventFired", () => res()));
      await send("Page.navigate", { url });
      await Promise.race([loaded, sleep(12_000)]);
      await sleep(settleMs);
    },
    js: async <T,>(expression: string): Promise<T> =>
      (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result
        ?.value as T,
    shot: async (file) => {
      const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      writeFileSync(file, Buffer.from(r.data, "base64"));
    },
    resize: async (width, height, dpr = 1) => {
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: dpr,
        mobile: width < 768,
      });
    },
    setStorage: async (key, value) => {
      await send("Runtime.evaluate", {
        expression: `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)})`,
      });
    },
    setMedia: async (features) => {
      await send("Emulation.setEmulatedMedia", { features });
    },
  };

  return {
    tab,
    close: async () => {
      root.close();
      proc.kill();
      try {
        // Un perfil persistente lo gestiona quien lo pidió: aquí no se borra.
        if (ephemeral) rmSync(profile, { recursive: true, force: true });
      } catch {
        /* Windows a veces mantiene el bloqueo un instante; no es un fallo del test. */
      }
    },
  };
}
