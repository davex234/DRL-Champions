"use client";

/**
 * HOOK DE LA COLA PvP (Bloque 7.5).
 *
 * Habla con `/api/game/duel/matchmaking`, que es el endpoint del bloque 7.4. No inventa
 * transporte, no calcula nada y **no decide nada**: pregunta, muestra y manda dos acciones.
 *
 * ─────────────────────── UN SOLO BUCLE, Y POR QUÉ NO ES EL DEL 7.3 ───────────────────────
 *
 * `usePvpSync` sondea UNA PARTIDA (`?matchId=…`). Aquí todavía no hay partida: lo que se sondea
 * es el estado de la BÚSQUEDA, que es otro recurso y otro endpoint. Son dos bucles porque son
 * dos cosas, pero **nunca están vivos a la vez**: en cuanto la cola devuelve `MATCHED`, este
 * hook se detiene solo (`stop()` en cuanto el estado es terminal) y la pantalla monta el del
 * 7.3. Eso es lo que impide el sondeo duplicado que el encargo prohíbe.
 *
 * El intervalo es de 2 s, el mismo orden de magnitud que el del 7.3, y se afloja a 6 s con la
 * pestaña oculta — misma regla, para no castigar a quien deja la búsqueda de fondo.
 *
 * ─────────────────────── LO QUE NO SE ENVÍA NUNCA ───────────────────────
 *
 * Ni `rating`, ni `mmr`, ni `opponentId`, ni `matchId`, ni `userId`. Lo único que viaja es el
 * `deckId` elegido, y ni eso se cree el servidor sin revalidarlo contra el inventario real.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import type { MatchmakingView } from "@/domain/cardgame/matchmaking";

const ENDPOINT = "/api/game/duel/matchmaking";

/** Ritmo de sondeo de la cola. Visible / oculta, igual que el poller de partida del 7.3. */
const POLL_VISIBLE_MS = 2_000;
const POLL_HIDDEN_MS = 6_000;

/**
 * Espera tras un 429 (Bloque 7.6). Mismos escalones que el backoff del poller de partida.
 *
 * Un límite de frecuencia solo sirve si el cliente AFLOJA cuando lo recibe. Antes de este bloque
 * cualquier respuesta no-OK paraba la búsqueda en seco: seguro para el servidor, pero cortaba la
 * partida a un jugador legítimo que hubiera abierto dos pestañas. Ahora un 429 no es un error de
 * la búsqueda: es «más despacio», y se obedece.
 */
const BACKOFF_MS = [2_000, 4_000, 8_000, 15_000] as const;

export type QueuePhase = "idle" | "loading" | "queued" | "matched" | "closed" | "error";

export interface PvpQueueState {
  phase: QueuePhase;
  view: MatchmakingView | null;
  /** Id de la partida cuando la cola ya emparejó. Es la puerta a la arena. */
  matchId: string | null;
  error: string | null;
  /** Segundos esperando, calculados con el reloj del SERVIDOR (`serverNow`), no con el del navegador. */
  waitingSeconds: number;
}

const inicial: PvpQueueState = {
  phase: "idle", view: null, matchId: null, error: null, waitingSeconds: 0,
};

async function authHeaders(): Promise<Record<string, string>> {
  const sb = getSupabase();
  if (!sb) throw new Error("El PvP necesita una cuenta online");
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Inicia sesión para jugar");
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

/** Lo que se le dice a una persona cuando el servidor pide calma. Sin números ni jerga. */
const TOO_MANY_HUMANO = "Vas demasiado rápido. Espera unos segundos y vuelve a intentarlo.";

/** Traduce el código del servidor a algo que una persona pueda leer. Los códigos son la autoridad. */
function humanize(code: string | undefined, fallback: string): string {
  switch (code) {
    case "ACTIVE_MATCH": return "Ya tienes un duelo PvP en curso. Termínalo o abandónalo antes de buscar otro.";
    case "DECK_NOT_OWNED": return "Ese equipo no es tuyo o ya no es válido. Revísalo en Mis equipos.";
    case "RETRY": return "Vuelve a intentarlo.";
    default: return fallback;
  }
}

export interface UsePvpQueue extends PvpQueueState {
  enqueue: (deckId: string) => Promise<void>;
  cancel: () => Promise<void>;
  refresh: () => void;
}

export function usePvpQueue(enabled: boolean): UsePvpQueue {
  const [state, setState] = useState<PvpQueueState>(inicial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vivo = useRef(true);
  // El sondeo se detiene solo en cuanto hay partida: nunca coexiste con el poller del 7.3.
  const sondeando = useRef(false);
  /** Cuántos 429 seguidos llevamos. Decide cuánto se espera antes del siguiente intento. */
  const frenados = useRef(0);
  /** Espera adicional impuesta por un 429, en ms. Cero cuando el servidor no se queja. */
  const esperaExtra = useRef(0);
  /**
   * F76 · ÉPOCA DE ESCRITURA. Cada `enqueue`/`cancel` la incrementa; un sondeo recuerda la época con la que SALIÓ y, si
   * al volver ya hay otra, su respuesta se descarta. Sin esto, un sondeo lanzado ANTES de encolar podía volver DESPUÉS
   * con el estado viejo, pisar la entrada QUEUED recién creada y parar el sondeo: la búsqueda quedaba viva en el
   * servidor sin que la pantalla la viera ni la moviera.
   */
  const epoca = useRef(0);

  const aplicar = useCallback((view: MatchmakingView) => {
    const entry = view.entry;
    const estado = entry?.state ?? null;
    const matchId = estado === "MATCHED" ? entry?.matchId ?? null : null;
    const phase: QueuePhase =
      matchId !== null ? "matched"
      : estado === "QUEUED" || estado === "PAIRING" ? "queued"
      : "idle";
    // La espera se mide con el reloj del SERVIDOR: el del navegador puede ir desfasado.
    const waitingSeconds = entry && phase === "queued"
      ? Math.max(0, Math.round((view.serverNow - entry.createdAt) / 1000))
      : 0;
    setState({ phase, view, matchId, error: null, waitingSeconds });
    if (matchId !== null) sondeando.current = false;
  }, []);

  const pedir = useCallback(async (): Promise<void> => {
    const mia = epoca.current;
    try {
      const res = await fetch(ENDPOINT, { headers: await authHeaders(), cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!vivo.current || mia !== epoca.current) return;
      /*
       * 429: el servidor pide calma. NO se para la búsqueda —el jugador sigue en cola, su entrada
       * no se ha tocado— solo se espera más antes de volver a preguntar. Se respeta `Retry-After`
       * si viene, y si no, el escalón que toque.
       */
      if (res.status === 429) {
        const cabecera = Number(res.headers.get("retry-after"));
        frenados.current = Math.min(frenados.current + 1, BACKOFF_MS.length);
        esperaExtra.current = Number.isFinite(cabecera) && cabecera > 0
          ? cabecera * 1000
          : BACKOFF_MS[frenados.current - 1];
        return;
      }
      frenados.current = 0;
      esperaExtra.current = 0;

      if (res.status >= 500) {
        // F66 · caída del servidor o de la BD: la entrada de cola sigue viva ALLÍ. Se afloja y se sigue preguntando.
        frenados.current = Math.min(frenados.current + 1, BACKOFF_MS.length);
        esperaExtra.current = BACKOFF_MS[frenados.current - 1];
        setState((s) => ({ ...s, error: "Sincronizando… seguimos buscando rival" }));
        return;
      }
      if (!res.ok) {
        setState((s) => ({ ...s, phase: "error", error: humanize(body.code, body.error ?? "No se pudo consultar la cola") }));
        sondeando.current = false;
        return;
      }
      aplicar(body as MatchmakingView);
    } catch {
      if (!vivo.current) return;
      /*
       * F66 · sin red NO es «fuera de la cola»: la búsqueda vive en el servidor y un emparejamiento puede llegar mientras
       * tanto. Antes esto paraba el sondeo para siempre (había que recargar). Ahora se afloja y se reintenta; al volver
       * la conexión, el primer sondeo trae lo que haya (incluido MATCHED).
       */
      frenados.current = Math.min(frenados.current + 1, BACKOFF_MS.length);
      esperaExtra.current = BACKOFF_MS[frenados.current - 1];
      setState((s) => ({ ...s, error: "Sin conexión: seguimos buscando en el servidor…" }));
    }
  }, [aplicar]);

  // EL ÚNICO BUCLE. Se reprograma tras cada respuesta (no `setInterval`), así que una respuesta
  // lenta no acumula peticiones encima de la anterior.
  const programar = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    if (!sondeando.current) return;
    const oculto = typeof document !== "undefined" && document.visibilityState === "hidden";
    const base = oculto ? POLL_HIDDEN_MS : POLL_VISIBLE_MS;
    timer.current = setTimeout(async () => {
      await pedir();
      programar();
    }, Math.max(base, esperaExtra.current));
  }, [pedir]);

  useEffect(() => {
    vivo.current = true;
    if (!enabled) return;
    sondeando.current = true;
    setState((s) => ({ ...s, phase: s.phase === "idle" ? "loading" : s.phase }));
    void pedir().then(programar);

    const onVis = (): void => programar();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      vivo.current = false;
      sondeando.current = false;
      document.removeEventListener("visibilitychange", onVis);
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [enabled, pedir, programar]);

  const enqueue = useCallback(async (deckId: string): Promise<void> => {
    const mia = ++epoca.current;
    setState((s) => ({ ...s, phase: "loading", error: null }));
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST", headers: await authHeaders(),
        // Lo ÚNICO que viaja. Ni rating, ni rival, ni matchId.
        body: JSON.stringify({ action: "enqueue", deckId }),
      });
      const body = await res.json().catch(() => ({}));
      if (mia !== epoca.current) return;
      if (res.status === 429) {
        // Aquí sí se le dice al jugador, porque fue un gesto suyo: pulsó «buscar» y no ha entrado.
        setState((s) => ({ ...s, phase: "error", error: TOO_MANY_HUMANO }));
        return;
      }
      // F76 · ya estabas emparejado por la cola y la partida SIGUE: el servidor la adjunta y se retoma (no es un error).
      if (res.status === 409 && body.code === "ACTIVE_MATCH" && body.entry?.state === "MATCHED" && body.entry?.matchId) {
        aplicar(body as MatchmakingView);
        return;
      }
      if (!res.ok) {
        setState((s) => ({ ...s, phase: "error", error: humanize(body.code, body.error ?? "No se pudo entrar en la cola") }));
        return;
      }
      sondeando.current = true;
      aplicar(body as MatchmakingView);
      programar();
    } catch (e) {
      setState((s) => ({ ...s, phase: "error", error: e instanceof Error ? e.message : "Error de red" }));
    }
  }, [aplicar, programar]);

  const cancel = useCallback(async (): Promise<void> => {
    ++epoca.current;
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST", headers: await authHeaders(),
        // Sin parámetros A PROPÓSITO: se cancela LA TUYA, la que dice el token.
        body: JSON.stringify({ action: "cancel" }),
      });
      const body = await res.json().catch(() => ({}));
      sondeando.current = false;
      if (timer.current !== null) clearTimeout(timer.current);
      if (res.ok) aplicar({ ...(body as MatchmakingView), entry: null });
      setState((s) => ({ ...s, phase: "idle", matchId: null, error: null }));
    } catch (e) {
      setState((s) => ({ ...s, error: e instanceof Error ? e.message : "Error de red" }));
    }
  }, [aplicar]);

  const refresh = useCallback(() => { void pedir(); }, [pedir]);

  return { ...state, enqueue, cancel, refresh };
}
