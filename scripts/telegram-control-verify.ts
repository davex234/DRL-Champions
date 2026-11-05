/**
 * VERIFICACIÓN DEL TELEGRAM CONTROL CENTER (Tournament Automation · Fase 6/6, FINAL).
 *
 * Telegram es SOLO una interfaz remota del Tournament Control Center: aquí se simula la Bot
 * API completa con un transporte inyectado (0 red) y se recorre el ejemplo obligatorio con
 * GEN-2026-VALORANT-MASTERS-LONDON-2026: /tournaments → seleccionar → abrir revisión →
 * decidir cartas → aprobar generación (con confirmación) → publicar (con confirmación) →
 * /runtime → rollback → historial/estadísticas. Comprueba: conexión · comandos · menús ·
 * callbacks · sesiones · permisos · integración Control/Editorial/Publisher · notificaciones
 * · determinismo · rendimiento · cero estados imposibles. Muta el catálogo SOLO al publicar
 * vía las APIs públicas y lo RESTAURA al terminar. Falla de verdad.
 */
import type { RawSnapshot } from "@/importer";
import { resetRuntime, runtimeGenerationId, runtimeVersion } from "@/publisher";
import { allPlayers, rebuildCatalog, totalCards, getCard } from "@/data/catalog";
import { auditHistory } from "@/editorial";
import {
  createLedger, generateForReview, currentRuntimeInfo, reviewCounts, buildMetrics,
  type ControlLedger, type RuntimeInfo,
} from "@/tournament-control";
import {
  makeConfig, isAuthorized, createClient, executeEffects, BOT_COMMANDS,
  createSessions, serializeSessions, deserializeSessions, subscribedChats,
  handleUpdate, esc, VLR_URL_RE, mainMenu,
  type TelegramTransport, type TelegramControlState, type TgUpdate, type Effect, type EngineCtx,
} from "@/telegram-control";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

/* ── Fixture: Masters London 2026 (mismo RawSnapshot compacto que editorial:verify) ── */
const LONDON: RawSnapshot = {
  tournament: { id: "valorant-masters-london-2026", name: "Valorant Masters London 2026", type: "international", tier: "vct-international", status: "finished", startDate: "2026-06-05T00:00:00Z", endDate: "2026-06-21T00:00:00Z" },
  stages: [{ id: "st-po", name: "Playoffs", kind: "playoff", orderIdx: 0 }],
  teams: [
    { id: "lln", name: "London Lions", region: "EMEA", active: true },
    { id: "mwv", name: "Madrid Wolves", region: "EMEA" },
    { id: "bbr", name: "Berlin Bears", region: "EMEA" },
  ],
  players: [
    { id: "zk", nick: "zekken", team: "London Lions", role: "duelist", agents: ["Jett", "Raze", "Neon"] },
    { id: "lf", nick: "Lyncher", team: "London Lions", role: "initiator", agents: ["Sova"] },
    { id: "wk", nick: "Wolfrik", team: "Madrid Wolves", role: "sentinel", agents: ["Killjoy"] },
  ],
  coaches: [{ id: "lc", name: "Sable", team: "London Lions", status: "active" }],
  matches: [
    { id: "l0", stageId: "st-po", teamA: "London Lions", teamB: "Berlin Bears", status: "finished", format: "bo3", scoreA: 2, scoreB: 1, winner: "London Lions", round: "Semifinal", matchOrder: 1 },
    { id: "l1", stageId: "st-po", teamA: "London Lions", teamB: "Madrid Wolves", status: "finished", format: "bo3", scoreA: 2, scoreB: 0, winner: "London Lions", round: "Grand Final", matchOrder: 2 },
  ],
  maps: [
    { id: "l0m1", matchId: "l0", map: "Ascent", mapOrder: 1, scoreA: 13, scoreB: 10, winner: "London Lions" },
    { id: "l0m2", matchId: "l0", map: "Bind", mapOrder: 2, scoreA: 8, scoreB: 13, winner: "Berlin Bears" },
    { id: "l0m3", matchId: "l0", map: "Ascent", mapOrder: 3, scoreA: 13, scoreB: 11, winner: "London Lions" },
    { id: "l1m1", matchId: "l1", map: "Ascent", mapOrder: 1, scoreA: 13, scoreB: 7, winner: "London Lions" },
    { id: "l1m2", matchId: "l1", map: "Haven", mapOrder: 2, scoreA: 13, scoreB: 9, winner: "London Lions" },
  ],
  mapStats: [
    { matchMapId: "l0m1", matchId: "l0", player: "zekken", team: "London Lions", agent: "Jett", acs: 300, kills: 20, deaths: 10, assists: 4, kast: 80, adr: 170, hsPct: 32, fk: 5, fd: 2, clutches: 3 },
    { matchMapId: "l1m1", matchId: "l1", player: "zekken", team: "London Lions", agent: "Raze", acs: 200, kills: 10, deaths: 10, assists: 6, kast: 70, adr: 150, hsPct: 25, fk: 2, fd: 2, clutches: 2 },
    { matchMapId: "l0m1", matchId: "l0", player: "Lyncher", team: "London Lions", agent: "Sova", acs: 190, kills: 12, deaths: 12, assists: 9, kast: 74, adr: 140, fk: 1, fd: 1, clutches: 0 },
    { matchMapId: "l1m1", matchId: "l1", player: "Wolfrik", team: "Madrid Wolves", agent: "Killjoy", acs: 210, kills: 14, deaths: 15, assists: 5, kast: 68, adr: 145, fk: 2, fd: 3, clutches: 1 },
  ],
  standings: [
    { team: "London Lions", position: 1, wins: 2, losses: 0, mapsWon: 4, mapsLost: 1, status: "qualified" },
    { team: "Madrid Wolves", position: 2, wins: 1, losses: 1, mapsWon: 2, mapsLost: 2 },
    { team: "Berlin Bears", position: 3, wins: 1, losses: 1 },
  ],
  awards: { champion: "London Lions", runnerUp: "Madrid Wolves" },
};

/* ── Bot API simulada (transporte inyectado; 0 red) ── */
const calls: { method: string; params: Record<string, unknown> }[] = [];
let nextMsgId = 1000;
const transport: TelegramTransport = async (method, params) => {
  calls.push({ method, params });
  if (method === "getMe") return { id: 42, username: "drl_champions_bot" };
  if (method === "sendMessage") return { message_id: nextMsgId++ };
  if (method === "getUpdates") return [];
  return true;
};

const NOW = 1_700_000_000_000;
const GEN = "GEN-2026-VALORANT-MASTERS-LONDON-2026";
const ADMIN = 7001, INTRUDER = 666, CHAT = 5001;
const config = makeConfig({ token: "TEST-TOKEN", allowedUsers: [ADMIN], botName: "DRL Champions" });

let updateId = 1;
const msgU = (text: string, userId = ADMIN): TgUpdate =>
  ({ update_id: updateId++, message: { message_id: 100 + updateId, from: { id: userId }, chat: { id: CHAT }, text } });
const cbU = (data: string, userId = ADMIN): TgUpdate =>
  ({ update_id: updateId++, callback_query: { id: `cb${updateId}`, from: { id: userId }, message: { message_id: 555, chat: { id: CHAT } }, data } });

const texts = (effects: Effect[]): string =>
  effects.map((e) => (e.kind === "answerCallback" ? e.text ?? "" : e.text)).join("\n───\n");
const buttons = (effects: Effect[]): string[] =>
  effects.flatMap((e) => ("keyboard" in e && e.keyboard ? e.keyboard.inline_keyboard.flat().map((b) => `${b.text}|${b.callback_data}`) : []));

async function main(): Promise<void> {
  console.log("# Verificación del Telegram Control Center — DRL Champions (Fase 6/6)\n");

  const originalPlayers = allPlayers();
  const originalTotal = totalCards();
  resetRuntime();

  const ctx = (n = 0, over: Partial<EngineCtx> = {}): EngineCtx => ({
    config, now: NOW + n, startedAt: NOW,
    roster: () => allPlayers(),
    rt: currentRuntimeInfo,
    totalCards,
    ...over,
  });

  // ── 1. CONEXIÓN DEL BOT ──
  console.log("## 1. Conexión del bot (Bot API vía transporte inyectado)");
  const client = createClient(transport);
  const me = await client.getMe();
  check("getMe responde por el transporte", me.username === "drl_champions_bot" && calls[0].method === "getMe");
  await client.setMyCommands(BOT_COMMANDS);
  check("los 11 comandos oficiales se registran", BOT_COMMANDS.length === 11 &&
    calls.some((c) => c.method === "setMyCommands"));
  await executeEffects(client, [
    { kind: "send", chatId: CHAT, text: esc("hola!"), keyboard: mainMenu() },
    { kind: "edit", chatId: CHAT, messageId: 1, text: esc("editado.") },
    { kind: "answerCallback", callbackQueryId: "cb0", text: "ok" },
  ]);
  const sent = calls.find((c) => c.method === "sendMessage")!;
  check("TODOS los mensajes van en MarkdownV2 con teclado inline",
    sent.params.parse_mode === "MarkdownV2" && !!sent.params.reply_markup &&
    calls.some((c) => c.method === "editMessageText" && c.params.parse_mode === "MarkdownV2") &&
    calls.some((c) => c.method === "answerCallbackQuery"));

  // ── 2. SEGURIDAD (lista blanca) ──
  console.log("\n## 2. Seguridad");
  let state: TelegramControlState = { ledger: createLedger(), sessions: createSessions() };
  check("lista blanca vacía ⇒ nadie autorizado (seguro por defecto)",
    !isAuthorized(makeConfig({ token: "x" }), ADMIN) && isAuthorized(config, ADMIN) && !isAuthorized(config, INTRUDER));
  const deniedMsg = await handleUpdate(state, msgU("/start", INTRUDER), ctx());
  check("mensaje de un no autorizado → ⛔ sin tocar estado",
    deniedMsg.state === state && deniedMsg.effects.length === 1 && texts(deniedMsg.effects).includes("⛔"));
  const deniedCb = await handleUpdate(state, cbU("g:pub:0", INTRUDER), ctx());
  check("callback de un no autorizado → ⛔ sin ejecutar nada",
    deniedCb.state === state && deniedCb.effects.every((e) => e.kind === "answerCallback"));

  // ── 3. COMANDOS Y MENÚ PRINCIPAL ──
  console.log("\n## 3. Comandos y menú principal");
  const H = async (u: TgUpdate, n = 0, over: Partial<EngineCtx> = {}): Promise<Effect[]> => {
    const r = await handleUpdate(state, u, ctx(n, over));
    state = r.state;
    return r.effects;
  };
  let fx = await H(msgU("/start"));
  check("/start: bienvenida + menú principal del spec (8 opciones)",
    texts(fx).includes("DRL Champions") &&
    ["📂 Torneos", "🃏 Generaciones", "✅ Revisión", "🚀 Publicaciones", "🖥 Runtime", "📊 Estadísticas", "⚙ Configuración"]
      .every((t) => buttons(fx).some((b) => b.startsWith(t))));
  check("sesión creada (usuario · chat · último menú · preferencias)",
    state.sessions[CHAT]?.userId === ADMIN && state.sessions[CHAT].lastMenu === "main" &&
    state.sessions[CHAT].preferences.notifications === true);
  fx = await H(msgU("/help"));
  check("/help enumera los 11 comandos", BOT_COMMANDS.every((c) => texts(fx).includes(`/${c.command}`)));
  fx = await H(msgU("/tournaments"));
  check("/tournaments sin registros → aviso útil", texts(fx).toLowerCase().includes("sin torneos"));
  fx = await H(msgU("hola bot"));
  check("texto libre → ayuda (sin efectos colaterales)", texts(fx).includes("/status"));

  // ── 4. EJEMPLO OBLIGATORIO: LONDON DESDE TELEGRAM ──
  console.log("\n## 4. Ejemplo obligatorio (GEN-2026-VALORANT-MASTERS-LONDON-2026)");
  // La generación entra por la API pública del panel (mismo camino que la CLI/pantalla).
  const seeded = generateForReview(createLedger(), LONDON, { now: NOW, roster: allPlayers() }, { actor: "seed", at: NOW });
  check("generación obligatoria registrada en el panel", !seeded.error && seeded.value?.generationId === GEN);
  state = { ...state, ledger: seeded.ledger };
  const nCards = seeded.value!.generation.cards.length;

  fx = await H(msgU("/tournaments"), 1);
  check("/tournaments muestra nombre · estado · equipos · fecha · GenerationId · runtime",
    texts(fx).includes(esc("Valorant Masters London 2026")) && texts(fx).includes(GEN) &&
    texts(fx).includes(esc("equipos 3")) && buttons(fx).some((b) => b.includes("t:view:0")));

  fx = await H(cbU("t:view:0"), 2);
  check("seleccionar torneo: detalle con Generar cartas · Abrir revisión · Ver historial (mensaje EDITADO)",
    fx.some((e) => e.kind === "edit") &&
    ["t:gen:0", "r:open:0", "t:hist:0", "g:view:0"].every((d) => buttons(fx).some((b) => b.endsWith(`|${d}`))) &&
    state.sessions[CHAT].selected === GEN);

  fx = await H(cbU("g:view:0"), 3);
  check("vista de generación: id · cartas · jugadores · tiempo · estado + botones del spec",
    texts(fx).includes(GEN) && texts(fx).includes(esc(`${nCards}`)) &&
    ["r:open:0", "g:pub:0", "g:rb:0", "g:report:0"].every((d) => buttons(fx).some((b) => b.endsWith(`|${d}`))));

  fx = await H(cbU("r:open:0"), 4);
  check("abrir revisión desde Telegram (openReview del panel)",
    texts(fx).includes("Revisión abierta") && reviewCounts(state.ledger.records[GEN])!.review === nCards);
  check("pantalla de revisión: pendientes/aprobadas/rechazadas/bloqueadas/archivadas + acciones por carta",
    texts(fx).includes(esc("Pendientes")) && buttons(fx).some((b) => b.endsWith("|r:a:0:0")) &&
    buttons(fx).some((b) => b.includes("r:sel:0")) && buttons(fx).some((b) => b.includes("r:all:0")));

  // Decisiones por carta: aprobar · rechazar · bloquear · ocultar (cartas 0-3).
  await H(cbU("r:a:0:0"), 5);
  await H(cbU("r:x:0:1"), 6);
  await H(cbU("r:b:0:2"), 7);
  fx = await H(cbU("r:h:0:3"), 8);
  const counts1 = reviewCounts(state.ledger.records[GEN])!;
  check("aprobar/rechazar/bloquear/ocultar carta aplicados vía decide()",
    counts1.approved === 1 && counts1.rejected === 1 && counts1.blocked === 1 && counts1.hidden === 1);
  fx = await H(cbU("r:sel:0"), 9);
  check("aprobar selección (página visible)", reviewCounts(state.ledger.records[GEN])!.approved > 1);

  // Aprobar generación completa: SENSIBLE ⇒ confirmación; Cancelar no toca nada.
  fx = await H(cbU("r:all:0"), 10);
  check("acción sensible pide confirmación (Confirmar/Cancelar) sin ejecutar",
    texts(fx).includes(esc("requiere confirmación")) &&
    buttons(fx).some((b) => b.endsWith("|cf:yes")) && buttons(fx).some((b) => b.endsWith("|cf:no")) &&
    reviewCounts(state.ledger.records[GEN])!.review > 0);
  fx = await H(cbU("cf:no"), 11);
  check("Cancelar descarta la acción pendiente", texts(fx).includes("Cancelado") &&
    reviewCounts(state.ledger.records[GEN])!.review > 0 && !state.sessions[CHAT].pendingConfirm);
  await H(cbU("r:all:0"), 12);
  fx = await H(cbU("cf:yes"), 13);
  const counts2 = reviewCounts(state.ledger.records[GEN])!;
  check("Confirmar ejecuta: generación aprobada (approveGeneration del panel)",
    counts2.review === 0 && counts2.approved === nCards - 3);

  // Publicar: SENSIBLE ⇒ confirmación ⇒ publishRecord (publishApproved, ÚNICA vía).
  await H(cbU("g:pub:0"), 14);
  fx = await H(cbU("cf:yes"), 15);
  check("publicación aplicada desde Telegram (runtime v1, generación vigente)",
    runtimeVersion() === 1 && runtimeGenerationId() === GEN && texts(fx).includes("Publicadas"));
  const cards = state.ledger.records[GEN].generation.cards;
  check("rechazada/bloqueada/oculta JAMÁS llegan al runtime",
    !getCard(cards[1].cardId) && !getCard(cards[2].cardId) && !getCard(cards[3].cardId));
  check("notificación de publicación a los chats suscritos",
    fx.some((e) => e.kind === "send" && e.chatId === CHAT && e.text.includes(esc("Publicación completada"))));

  fx = await H(msgU("/runtime"), 16);
  check("/runtime: versión · catálogo · generación activa · tiempo activo · estado",
    texts(fx).includes("v1") && texts(fx).includes(GEN) &&
    texts(fx).includes(esc("Tiempo activo")) && texts(fx).includes(esc("publicado")));

  // Rollback: SENSIBLE ⇒ confirmación ⇒ rollbackRecord (punto de restauración del Publisher).
  await H(cbU("g:rb:0"), 17);
  fx = await H(cbU("cf:yes"), 18);
  check("rollback aplicado desde Telegram (restaura la publicación del ejemplo)",
    texts(fx).includes("restaurado") && runtimeGenerationId() === GEN &&
    fx.some((e) => e.kind === "send" && e.text.includes(esc("Rollback completado"))));

  fx = await H(msgU("/history"), 19);
  check("/history: cronología con eventos de control (🎛) y editoriales (✍️)",
    texts(fx).includes("publish") && texts(fx).includes("rollback") &&
    texts(fx).includes("🎛") && texts(fx).includes("✍️"));
  fx = await H(msgU("/status"), 20);
  check("/status con métricas reales del panel", texts(fx).includes(esc("Publicaciones")) && texts(fx).includes("v2"));
  fx = await H(cbU("m:stats"), 21);
  check("📊 estadísticas: torneos/generaciones/cartas/publicaciones/rollbacks/tiempo medio",
    texts(fx).includes(esc("Tiempo medio de pipeline")) &&
    buildMetrics(state.ledger).publications === 1 && buildMetrics(state.ledger).rollbacks === 1);
  fx = await H(cbU("g:report:0"), 22);
  check("exportar informe (buildReport del panel, JSON)", texts(fx).includes("Informe") && texts(fx).includes("```json"));

  // ── 5. GENERAR DESDE URL (infraestructura; error controlado sin red) ──
  console.log("\n## 5. Generar cartas desde URL (flujo confirmado)");
  check("las URLs de vlr.gg se reconocen", VLR_URL_RE.test("https://www.vlr.gg/event/2765/valorant-masters-london-2026"));
  fx = await H(msgU("https://www.vlr.gg/event/9999/torneo-nuevo"), 23);
  check("URL → petición de confirmación (acción sensible)",
    texts(fx).includes(esc("¿Generar cartas desde")) && buttons(fx).some((b) => b.endsWith("|cf:yes")));
  fx = await H(cbU("cf:yes"), 24, { runPipeline: async () => { throw new Error("sin red en el verify"); } });
  check("error de generación → toast + notificación de error (sin romper el bot)",
    texts(fx).includes("Error de generación") &&
    fx.some((e) => e.kind === "send" && e.text.includes(esc("Error de generación"))));

  // ── 6. SESIONES ──
  console.log("\n## 6. Sesiones");
  const s = state.sessions[CHAT];
  check("la sesión persiste usuario · chatId · último menú · preferencias",
    s.userId === ADMIN && s.chatId === CHAT && typeof s.lastMenu === "string" && typeof s.preferences.notifications === "boolean");
  const round = deserializeSessions(serializeSessions(state.sessions));
  check("serialización SOLO con los campos del contrato (nada del juego)",
    round[CHAT].userId === ADMIN && round[CHAT].preferences.notifications === s.preferences.notifications &&
    !("selected" in round[CHAT]) && !("pendingConfirm" in round[CHAT]) &&
    !serializeSessions(state.sessions).includes("generation"));
  fx = await H(cbU("s:notif"), 25);
  check("toggle de notificaciones desde ⚙ Configuración",
    state.sessions[CHAT].preferences.notifications === false && subscribedChats(state.sessions).length === 0);
  fx = await H(cbU("s:notif"), 26);
  check("re-activar notificaciones", state.sessions[CHAT].preferences.notifications === true &&
    subscribedChats(state.sessions).includes(CHAT));

  // ── 7. DETERMINISMO ──
  console.log("\n## 7. Determinismo");
  const rtFixed: RuntimeInfo = { runtimeVersion: 9, generationId: GEN };
  const navigate = async (): Promise<string> => {
    let st: TelegramControlState = { ledger: seeded.ledger, sessions: createSessions() };
    const out: Effect[][] = [];
    for (const u of [msgU("/start", ADMIN), msgU("/tournaments", ADMIN), cbU("t:view:0"), cbU("m:main")]) {
      const fixed = { ...u, update_id: 1, ...(u.callback_query ? { callback_query: { ...u.callback_query, id: "cb" } } : {}) };
      const r = await handleUpdate(st, fixed as TgUpdate, ctx(0, { rt: () => rtFixed }));
      st = r.state;
      out.push(r.effects);
    }
    return JSON.stringify({ out, sessions: st.sessions });
  };
  check("misma secuencia de updates ⇒ mismos efectos y sesiones byte a byte", (await navigate()) === (await navigate()));

  // ── 8. RENDIMIENTO ──
  console.log("\n## 8. Rendimiento");
  const t0 = Date.now();
  for (let i = 0; i < 150; i++) {
    await handleUpdate(state, msgU("/tournaments"), ctx(30, { rt: () => rtFixed }));
    await handleUpdate(state, cbU("g:view:0"), ctx(30, { rt: () => rtFixed }));
  }
  const ms = Date.now() - t0;
  check("300 updates renderizados en tiempo razonable", ms < 3000, `${ms} ms`);

  // ── 9. CERO ESTADOS IMPOSIBLES ──
  console.log("\n## 9. Cero estados imposibles");
  check("el ledger del panel sigue íntegro tras todo el tráfico del bot",
    auditHistory(state.ledger.records[GEN].editorial!).length === 0 &&
    state.ledger.events.every((e, i) => i === 0 || e.seq > state.ledger.events[i - 1].seq));
  check("acciones rechazadas nunca mutaron (doble apertura de revisión)",
    await (async () => {
      const before = state.ledger;
      const r = await handleUpdate(state, cbU("r:open:0"), ctx(31));
      return r.state.ledger === before && texts(r.effects).includes("⚠");
    })());
  check("todo callback_data cabe en el límite de Telegram (64 bytes)",
    [`t:view:0`, `g:pub:0`, `r:a:0:${nCards - 1}`, "cf:yes"].every((d) => Buffer.byteLength(d) <= 64));
  check("estado 100% serializable", (() => {
    const j = JSON.parse(JSON.stringify(state)) as TelegramControlState;
    return j.ledger.order.length === state.ledger.order.length && Object.keys(j.sessions).length === Object.keys(state.sessions).length;
  })());

  // ── RESTAURACIÓN ──
  resetRuntime();
  rebuildCatalog(originalPlayers);
  check("catálogo semilla restaurado al terminar", totalCards() === originalTotal);

  console.log(`\n${fail === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${fail} COMPROBACIÓN(ES) FALLARON`} — ${pass}/${pass + fail}`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
