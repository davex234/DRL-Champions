/**
 * F86.1 · interfaz de la espera y piezas puras: panel «mi partida» en cada estado (antes de listo, rival listo, esperando,
 * partida lista, plazo vencido, revisión, avance, siguiente jugable), aviso global, ritmo del sondeo, sondeo compartido
 * adaptativo (con temporizadores simulados), clasificación de partidas y semántica de la carrera.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { CupDetailView } from "@/components/cups/CupDetailScreen";
import { CupLiveNoticeView, liveNoticeFor } from "@/components/cups/CupLiveNotice";
import { cupPollInterval, CUP_POLL_MS, perMinute } from "@/lib/cups/poll";
import { createSharedPoll } from "@/lib/net/sharedPoll";
import { duelKind } from "@/domain/cups/matchKind";
import { careerModeOf, MODE_LABEL, PUBLIC_MODES, SELF_MODES, historyItem } from "@/domain/profile/career";
import { cupPollTier, type CupStatusMatch } from "@/server/services/cups";
import {
  DETAIL_BEFORE_READY, DETAIL_LIVE_8, DETAIL_WAITING, DETAIL_ACTIVE_8, DETAIL_DEADLINE, DETAIL_REVIEW, DETAIL_ADVANCED, DETAIL_NEXT_PLAYABLE, NOTICE_READY,
} from "@/app/design-system/cups/fixtures";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const DECKS = [{ id: "d1", name: "Equipo", valid: true } as never];
const view = (d: typeof DETAIL_LIVE_8) => html(<CupDetailView detail={d} signedIn decks={DECKS} activeDeckId="d1" harness viewerId="qa" />);
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

test("F861-U1 · antes de listo: JUGAR; con el rival listo: «Tu rival ya está listo» + «Jugar ya»; nunca «esperando»", () => {
  const b = view(DETAIL_BEFORE_READY);
  assert.ok(b.includes('data-waiting="0"') && b.includes('data-testid="cup-play"') && b.includes(">Jugar<") && !b.includes('data-testid="cup-waiting"'));
  const o = view(DETAIL_LIVE_8);
  assert.ok(o.includes(">Tu rival ya está listo<") && o.includes(">Jugar ya<") && o.includes('data-opponent-ready="1"'));
  assert.ok(o.includes('role="status" aria-live="polite"'), "anuncio para lector de pantalla");
});

test("F861-U2 · ESPERANDO AL RIVAL: sale del servidor (F5), sin botón JUGAR, texto claro, anuncio accesible y salida", () => {
  const w = view(DETAIL_WAITING);
  // En el render estático aún no corrió el efecto que fija la espera: se comprueba el contrato del componente.
  const src = read("src", "components", "cups", "CupMyMatchPanel.tsx");
  assert.ok(src.includes("if (key && state === \"READY\" && youReadyServer) setWaitingKey(key);"), "F5: la espera la restaura el servidor (youReady), no un estado local");
  assert.ok(src.includes("✓ Listo · esperando a") && src.includes("Entrarás en la partida automáticamente en cuanto tu rival esté preparado"));
  assert.ok(src.includes("Estás listo. Esperando a"), "anuncio «waiting opponent» para lector de pantalla");
  assert.ok(w.includes('data-state="READY"'));
});

test("F861-U3 · partida lista (EN JUEGO): «Tu partida está lista» + «Entrar a la partida»; plazo vencido y revisión: sin «esperando», explicación y sin sorteo", () => {
  const a = view(DETAIL_ACTIVE_8);
  assert.ok(a.includes('data-state="ACTIVE"') && a.includes(">Tu partida está lista<") && a.includes('data-testid="cup-enter"'));
  const d = view(DETAIL_DEADLINE);
  assert.ok(d.includes(">Plazo vencido · en revisión<") && d.includes('data-testid="cup-review"') && !d.includes('data-testid="cup-play"') && !d.includes('data-testid="cup-waiting"'));
  assert.ok(d.includes("no hay sorteo"));
  const r = view(DETAIL_REVIEW);
  assert.ok(r.includes(">Cruce en revisión<") && r.includes("empate exacto"));
});

test("F861-U4 · avance: «✓ Has ganado…» y «esperando rival» que se juega ahora; siguiente cruce jugable con JUGAR", () => {
  const a = view(DETAIL_ADVANCED);
  assert.ok(a.includes("✓ Has ganado Semifinal · avanzas a Final") && a.includes(">Esperando rival<") && a.includes("se está jugando ahora"));
  const n = view(DETAIL_NEXT_PLAYABLE);
  assert.ok(n.includes("✓ Has ganado Cuartos de final") && n.includes('data-testid="cup-play"'));
});

test("F861-U5 · entrada automática GUARDADA: solo desde la espera explícita, en ESA ficha, ese cruce y la misma sesión; nunca tras salir", () => {
  const src = read("src", "components", "cups", "CupMyMatchPanel.tsx");
  assert.ok(src.includes("if (harness || !key || waitingKey !== key || state !== \"ACTIVE\" || !gameMatchId) return;"));
  assert.ok(src.includes("window.location.pathname !== `/copas/${slug}` || viewerId === null"));
  assert.ok(src.includes("useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);"), "desmontar (salir de la ficha, cerrar sesión) corta la entrada");
  assert.ok(src.includes("if (err?.status === 401) { setWaitingKey(null); setBlocker(\"SESSION\"); return; }"), "sesión caducada: deja de esperar, sin bucle");
  assert.ok(src.includes("const onOnline = () => { setBlocker(null); void ready(true); };"), "red recuperada: renovación inmediata");
  const notice = read("src", "components", "cups", "CupLiveNotice.tsx");
  assert.ok(!/router\.push|location\.assign|location\.href\s*=/.test(notice), "el aviso global nunca navega solo");
});

test("F861-U6 · aviso global: callado en la ficha y en la arena; EN JUEGO → Entrar (arena); rival listo → Jugar (ficha)", () => {
  const base: CupStatusMatch = { slug: "s", name: "Copa", round: 2, slot: 0, roundName: "Final", state: "READY", youReady: false, opponentReady: true, gameMatchId: null, availableAt: "", deadlineAt: "", opponent: { username: "Kairo", avatar: "🐺", tag: "KZEU9P4" }, rivalSource: null };
  assert.equal(liveNoticeFor(base, "/copas/s"), null);
  assert.equal(liveNoticeFor(base, "/duelos/pvp"), null);
  assert.equal(liveNoticeFor(base, "/coleccion")!.title, "Tu rival te espera");
  assert.match(liveNoticeFor(base, "/coleccion")!.text, /Kairo #KZEU9P4/);
  const act = liveNoticeFor({ ...base, state: "ACTIVE", gameMatchId: "g-1" }, "/tienda")!;
  assert.equal(act.cta, "Entrar"); assert.equal(act.href, "/duelos/pvp?match=g-1");
  assert.equal(liveNoticeFor({ ...base, state: "PENDING", opponent: null }, "/"), null, "sin cruce jugable, sin aviso");
  const h = html(<CupLiveNoticeView notice={NOTICE_READY} onDismiss={() => {}} />);
  assert.ok(h.includes('role="status"') && h.includes(">Jugar<") && h.includes("Ahora no"));
});

test("F861-P1 · ritmo: 3 s esperando · 5 s relevante · 20 s · 60 s; retroceso ante fallos con techo; carga por pestaña", () => {
  assert.deepEqual(CUP_POLL_MS, { hot: 3000, warm: 5000, idle: 20000, cold: 60000 });
  assert.equal(cupPollInterval("hot", 0), 3000);
  assert.equal(cupPollInterval("hot", 1), 10_000); assert.equal(cupPollInterval("hot", 3), 40_000);
  assert.equal(cupPollInterval("cold", 9), 120_000, "techo de 2 min");
  assert.deepEqual([perMinute("hot"), perMinute("warm"), perMinute("idle"), perMinute("cold")], [20, 12, 3, 1]);
  const m = (o: Partial<CupStatusMatch>): CupStatusMatch => ({ slug: "s", name: "", round: 1, slot: 0, roundName: "", state: "READY", youReady: false, opponentReady: false, gameMatchId: null, availableAt: "", deadlineAt: "", opponent: null, rivalSource: null, ...o });
  assert.equal(cupPollTier(m({ youReady: true })), "hot"); assert.equal(cupPollTier(m({ opponentReady: true })), "hot");
  assert.equal(cupPollTier(m({})), "warm");
  assert.equal(cupPollTier(m({ state: "PENDING", rivalSource: "ACTIVE" })), "warm");
  assert.equal(cupPollTier(m({ state: "PENDING", rivalSource: "WAITING" })), "idle");
  for (const s of ["ACTIVE", "WAITING_WINDOW", "NO_SHOW_PENDING", "ACTION_REQUIRED"] as const) assert.equal(cupPollTier(m({ state: s })), "idle", s);
});

test("F861-P2 · sondeo compartido ADAPTATIVO: reprograma con el intervalo del último valor, retrocede ante fallos y vuelve; sin la opción, igual que F64", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  try {
    let n = 0; let fail = false;
    const poll = createSharedPoll<{ tier: "hot" | "cold" }>({
      fetch: async () => { n++; if (fail) throw new Error("x"); return { tier: n >= 2 ? "hot" : "cold" }; },
      initial: { tier: "cold" }, intervalMs: 60_000, minGapMs: 0, intervalFor: (v, f) => cupPollInterval(v.tier, f),
    });
    const off = poll.subscribe("u1", () => {});
    await Promise.resolve(); await Promise.resolve(); await new Promise((r) => setImmediate(r));
    assert.equal(n, 1, "lectura inicial");
    mock.timers.tick(60_000); await new Promise((r) => setImmediate(r));
    assert.equal(n, 2, "frío: siguiente a los 60 s");
    mock.timers.tick(3_000); await new Promise((r) => setImmediate(r));
    assert.equal(n, 3, "caliente: cada 3 s");
    fail = true;
    mock.timers.tick(3_000); await new Promise((r) => setImmediate(r));
    assert.equal(n, 4);
    mock.timers.tick(3_000); await new Promise((r) => setImmediate(r));
    assert.equal(n, 4, "tras un fallo NO se insiste a 3 s");
    mock.timers.tick(7_000); await new Promise((r) => setImmediate(r));
    assert.equal(n, 5, "retroceso: 10 s");
    fail = false;
    mock.timers.tick(20_000); await new Promise((r) => setImmediate(r));
    assert.equal(n, 6, "recupera");
    mock.timers.tick(3_000); await new Promise((r) => setImmediate(r));
    assert.equal(n, 7, "vuelve a 3 s");
    off();
    mock.timers.tick(120_000); await new Promise((r) => setImmediate(r));
    assert.equal(n, 7, "sin suscriptores, ni una petición");
  } finally { mock.timers.reset(); }
  const src = read("src", "lib", "net", "sharedPoll.ts");
  assert.ok(src.includes("if (o.intervalFor) schedule(); else timer = setInterval(() => read(), o.intervalMs);"), "los sondeos existentes (social, directo) siguen con su intervalo fijo");
});

test("F861-K1 · clasificación inequívoca y carrera: TOURNAMENT es su propia categoría; perfil principal sin carrera", () => {
  assert.equal(duelKind("PVP", false), "RANKED");
  assert.equal(duelKind("PVP_PRIVATE", true), "TOURNAMENT");
  assert.equal(duelKind("PVP_PRIVATE", false), "PRIVATE");
  assert.equal(duelKind("PVE", false), "PVE"); assert.equal(duelKind("DRAFT_GAUNTLET", false), "DRAFT"); assert.equal(duelKind("X", true), null);
  assert.equal(careerModeOf("PVP_PRIVATE", true), "TOURNAMENT"); assert.equal(careerModeOf("PVP_PRIVATE"), "PRIVATE");
  assert.equal(MODE_LABEL.TOURNAMENT, "Torneo");
  assert.ok(SELF_MODES.includes("TOURNAMENT") && !PUBLIC_MODES.includes("TOURNAMENT"));
  const item = historyItem({ matchId: "m", mode: "TOURNAMENT", at: 0, status: "COMPLETED", winner: "A", closedReason: null, closedBy: null, playerAId: "u", playerBId: "v", scoreA: 6, scoreB: 4, difficulty: null }, "u", { userId: "v", username: "rival", avatar: "🎮" }, true);
  assert.equal(item.modeLabel, "Torneo"); assert.equal(item.opponent.kind, "PLAYER");
  const card = read("src", "components", "player", "ProfileIdentityCard.tsx").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/career|carrera|cup|torneo|tournament/i.test(card), "la tarjeta de identidad sigue sin carrera ni torneos");
  const id = read("src", "server", "services", "playerIdentity.ts");
  assert.ok(id.includes("privateDuels: isSelf ? Math.max(0, ((privateRes as { count: number | null }).count ?? 0) - ownCupGames) : null,"), "el contador de duelos privados no cuenta torneos");
  assert.ok(id.includes("h2hRows.filter((m) => !h2hCup.has(m.id))"), "el cara a cara del perfil no cuenta torneos");
});
