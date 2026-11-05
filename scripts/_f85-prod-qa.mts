/**
 * F85 · QA EN PRODUCCIÓN DE SOCIAL 2.0 (instrumento, fuera de CI). SOLO cuentas QA (A = f45, B = qa352, C = f64, K = f69).
 *
 *   BASE_URL=https://valorosters.com npx tsx C:/NEXUS-CENTRAL/DRLCards/scripts/_f85-prod-qa.mts [--ttl]   (cwd = prodqa)
 *
 * Recorre lo social REAL por API: búsqueda (sin correo/UUID/comodines), solicitudes exactamente-una-vez (×10), cruzadas,
 * aceptar ×5, IDOR de un tercero, presencia (dos sesiones, solo amigos, EN PARTIDA del servidor, TTL con --ttl), retos
 * (×10, rechazar, cancelar, caducar, aceptar ×5 → UNA partida privada), cola ranked, partida amistosa JUGADA entera,
 * aislamiento (0 rating, 0 colocación/temporada competitiva, 0 XP de temporada, 0 misiones, 0 créditos), revancha,
 * recientes, comparar, bloqueo neutro + perfil público, desbloqueo → NINGUNA, límites (429). Limpia al final lo social
 * creado (amistades/bloqueos); las partidas quedan como historial. Nada toca usuarios reales ni la cuenta personal.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const qa = await import("file:///C:/NEXUS-CENTRAL/DRLCards/scripts/multiplayer/_qa.ts");
const lib = await import("file:///C:/NEXUS-CENTRAL/DRLCards/scripts/_fase68-lib.ts");
const { mkdirSync, writeFileSync } = await import("node:fs");
const { execFileSync } = await import("node:child_process");
const { login, api, mm, pvpGet, validDeck, legalMove, uuid, sleep } = qa;
const BASE = process.env.BASE_URL ?? "";
if (BASE !== "https://valorosters.com") throw new Error("BASE_URL=https://valorosters.com");
const OUT = "C:/NEXUS-CENTRAL/DRLCards/docs/product/qa/f85-social/prod";
mkdirSync(OUT, { recursive: true });
const rows: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail: unknown = "") => { const d = typeof detail === "string" ? detail : JSON.stringify(detail); rows.push({ id, ok, detail: (d ?? "").slice(0, 700) }); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${(d ?? "").slice(0, 220)}`); };
const sql = (q: string): string => execFileSync("ssh", ["-i", `${process.env.USERPROFILE}/.ssh/id_ed25519`, "nexusadmin@212.95.40.144", "docker exec -i supabase_db_DRLCards psql -U postgres -d postgres -At -v ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();
const S = "/api/game/social";
// El limitador social (30 escrituras/min por usuario) es correcto; el instrumento hace ráfagas de prueba, así que espera
// la ventana en vez de rendirse (las ráfagas concurrentes de las pruebas ×N se lanzan con la cubeta descansada).
// F86.1 · un 429 de límite ANTI-SPAM (CHALLENGE_LIMIT: 10 retos a la misma persona por hora, 0066) no es transitorio:
// reintentarlo 90 s no sirve. Se distingue y se para con un mensaje claro (el enfriamiento se respeta ANTES, abajo).
const post = async (w: any, body: any) => { for (let i = 0; i < 40; i++) { const r = await api(w, S, body, { noRetry: true }); if (r.status !== 429) return r; if (r.json?.code === "CHALLENGE_LIMIT") throw new Error("CHALLENGE_LIMIT: límite anti-spam real alcanzado (10 retos/h por pareja). No se debilita: espera el enfriamiento y repite."); if (i === 0 || i === 39) console.log(`[429] ${body.action} intento ${i} cuerpo=${JSON.stringify(r.json).slice(0, 160)}`); await sleep(Math.max(2, Number(r.json?.retryAfter ?? 5)) * 1000); } throw new Error("429 persistente (90 s)"); };
const noPII = (j: unknown) => !/@[a-z0-9-]+\.[a-z]{2,}|"email"|"is_admin"|"balance"|"password"|"phone"|"last_seen_at"|"lastSeenAt":\s*\d/i.test(JSON.stringify(j));
const QA_IDS = new Set<string>();

// F85_SWAP=1 intercambia los papeles de las dos cuentas (el tope de 10 retos/pareja/HORA es por sentido: una segunda
// pasada dentro de la hora usa el sentido contrario en vez de esperar).
const SWAP = process.env.F85_SWAP === "1";
const A = await login(SWAP ? "B" : "A"), B = await login(SWAP ? "A" : "B"), C = await login("C");
const K = { name: "K", userId: lib.creds("K").userId, email: "", password: "", token: await lib.token("K") } as any;
for (const w of [A, B, C, K]) QA_IDS.add(w.userId);
const A2 = await login(SWAP ? "B" : "A"); // segunda sesión de A (otra pestaña / otro dispositivo)
const pair = (x: string, y: string) => `least('${x}'::uuid,'${y}'::uuid), greatest('${x}'::uuid,'${y}'::uuid)`;
const relDb = (x: string, y: string) => sql(`select coalesce((select status||':'||count(*) over () from public.duel_friendships where (user_lo,user_hi)=(${pair(x, y)})),'NONE');`);

/* ── 0 · cabeza, anónimo, estado inicial limpio ── */
const ready = await api(null, "/api/ready");
// F86 · se exige que 0066 esté APLICADA (cabeza ≥ 0066 por estado real y su capacidad «social» en verde), no que sea la
// última: cada migración posterior compatible (0067…) rompía aquí sin que F85 hubiera cambiado.
const headN = Number(String(ready.json?.migrationHead ?? "").slice(0, 4));
check("ready + 0066 aplicada (cabeza ≥ 0066) + check «social»", ready.status === 200 && headN >= 66 && (ready.json?.checks ?? []).some((c: any) => c.id === "social" && c.ok), { head: ready.json?.migrationHead });
check("health 200", (await api(null, "/api/health")).status === 200);
check("anónimo GET → 401", (await api(null, S)).status === 401);
check("anónimo POST → 401", (await post(null, { action: "friend_request", targetUserId: B.userId })).status === 401);
const pre = sql(`select count(*) from public.duel_friendships where user_lo in ('${A.userId}','${B.userId}','${C.userId}') or user_hi in ('${A.userId}','${B.userId}','${C.userId}');`);
check("A, B, C sin relaciones previas", pre === "0", pre);
// F87.1 · la fila de rating nace con su valor por defecto al primer acceso PvP (1000, 0 partidas): «sin fila» y «fila
// por defecto» son el MISMO estado. Se compara la vista canónica por cuenta (sin fila → 1000:0:0:0), no la presencia.
const ratingsOf = () => [A.userId, B.userId].sort().map((u) => `${u}:${sql(`select coalesce((select rating||':'||games_played||':'||wins||':'||losses from public.duel_pvp_ratings where user_id='${u}'), '1000:0:0:0');`)}`).join(",");
const ratingsBefore = ratingsOf();
const cspBefore = sql(`select count(*)||':'||coalesce(sum(matches),0) from public.competitive_season_players where user_id in ('${A.userId}','${B.userId}');`);
const stateBefore = await Promise.all([A, B].map(async (w) => (await api(w, "/api/game/state")).json));

/* ── 1 · búsqueda ── */
const nameB = sql(`select username from public.profiles where id='${B.userId}';`);
const s1 = await api(A, `${S}?q=${encodeURIComponent(nameB.slice(0, 10).toUpperCase())}`);
const hitB = (s1.json?.players ?? []).find((p: any) => p.userId === B.userId);
check("búsqueda por prefijo SIN distinguir mayúsculas encuentra a B (relación NINGUNA, sin presencia)", s1.status === 200 && !!hitB && hitB.relation === "NONE" && hitB.presence === null, { n: s1.json?.players?.length, rel: hitB?.relation });
check("búsqueda: sin correo, sin latido, sin metadatos", noPII(s1.json) && !JSON.stringify(s1.json).includes("example.invalid"));
check("búsqueda: el propio buscador no sale", !(s1.json?.players ?? []).some((p: any) => p.userId === A.userId));
const emailQ = sql(`select split_part(email,'@',1) from auth.users where id='${B.userId}';`);
const s2 = await api(A, `${S}?q=${encodeURIComponent(emailQ.slice(0, 12) + "@example")}`);
check("buscar por correo («@») → 400 (no hay enumeración por email)", s2.status === 400, s2.status);
check("consulta de 1 carácter → 400", (await api(A, `${S}?q=q`)).status === 400);
const sw = await api(A, `${S}?q=${encodeURIComponent("%_%")}`);
check("comodines del cliente neutralizados (%_ → consulta corta → 400)", sw.status === 400, sw.status);
const sl = await api(A, `${S}?q=${encodeURIComponent("q".repeat(300))}`);
check("consulta larga (300) → recortada, 200 sin resultados", sl.status === 200 && (sl.json?.players ?? []).length === 0, sl.status);
const sp = await api(A, `${S}?q=qa&offset=0`), sp2 = await api(A, `${S}?q=qa&offset=10`), spx = await api(A, `${S}?q=qa&offset=9999`);
check("paginación: 10 por página, desplazamiento acotado a 40", sp.status === 200 && (sp.json?.players ?? []).length <= 10 && sp.json?.limit === 10 && spx.json?.offset === 40, { p1: sp.json?.players?.length, p2: sp2.json?.players?.length, maxOff: spx.json?.offset });
check("UUID como consulta → no devuelve a nadie por id", (await api(A, `${S}?q=${B.userId.slice(0, 8)}`)).json?.players?.every((p: any) => !p.username.includes(B.userId.slice(0, 8))) !== false);

/* ── 2 · solicitudes exactamente-una-vez, aceptar ×5, cruzadas ── */
const r10 = await Promise.all(Array.from({ length: 10 }, () => post(A, { action: "friend_request", targetUserId: B.userId })));
check("A→B ×10 a la vez → todas 200 y UNA fila PENDING", r10.every((r) => r.status === 200) && relDb(A.userId, B.userId) === "PENDING:1", { codes: [...new Set(r10.map((r) => r.json?.code))], db: relDb(A.userId, B.userId) });
const pB = (await post(B, { action: "pulse" })).json;
check("B · contador del servidor = 1 (la solicitud)", pB?.badge === 1, pB?.badge);
const snapB = (await api(B, S)).json;
check("B · solicitud recibida de A en la foto (con rango F84)", (snapB?.incoming ?? []).some((r: any) => r.player.userId === A.userId && "rank" in r), snapB?.counts);
check("foto social sin datos privados", noPII(snapB));
check("aceptar mi PROPIA solicitud → 409", (await post(A, { action: "friend_accept", targetUserId: B.userId })).status === 409);
check("K acepta una solicitud A→B que no es suya → 409 (sin efecto)", (await post(K, { action: "friend_accept", targetUserId: A.userId })).status === 409 && relDb(A.userId, B.userId) === "PENDING:1");
const acc = await Promise.all(Array.from({ length: 5 }, () => post(B, { action: "friend_accept", targetUserId: A.userId })));
check("B acepta ×5 a la vez → 1 ACCEPTED, resto 409, UNA amistad", acc.filter((r) => r.status === 200).length >= 1 && relDb(A.userId, B.userId) === "ACCEPTED:1", { ok: acc.filter((r) => r.status === 200).length, db: relDb(A.userId, B.userId) });
const [x1, x2] = await Promise.all([post(A, { action: "friend_request", targetUserId: C.userId }), post(C, { action: "friend_request", targetUserId: A.userId })]);
check("A→C y C→A a la vez → UNA amistad ACCEPTED (cruzada converge)", relDb(A.userId, C.userId) === "ACCEPTED:1", { a: x1.json?.code, c: x2.json?.code, db: relDb(A.userId, C.userId) });
check("añadirse a uno mismo → 400", (await post(A, { action: "friend_request", targetUserId: A.userId })).status === 400);
check("id inventado → 404/400", [400, 404].includes((await post(A, { action: "friend_request", targetUserId: uuid() })).status));
check("K elimina la amistad A↔B en su nombre → 409 NOT_FRIENDS (sin efecto)", (await post(K, { action: "unfriend", targetUserId: A.userId })).status === 409 && relDb(A.userId, B.userId) === "ACCEPTED:1");
check("cuerpo con userId/bando falsos se ignora (el sujeto es el token)", (await post(K, { action: "unfriend", targetUserId: B.userId, userId: A.userId, side: "A" })).status === 409 && relDb(A.userId, B.userId) === "ACCEPTED:1");

/* ── 3 · presencia ── */
await Promise.all([post(A, { action: "pulse" }), post(A2, { action: "pulse" })]);
const fB = ((await api(B, S)).json?.friends ?? []).find((f: any) => f.userId === A.userId);
check("B ve a A «En línea» (latido reciente) y sin hora exacta", fB?.presence === "ONLINE" && fB?.lastSeenAt === null, fB?.presence);
const kSees = await api(K, `${S}?player=${A.userId}`);
check("K (no amigo) NO ve la presencia de A", kSees.status === 200 && kSees.json?.presence === null, kSees.json?.presence);
const kSearch = ((await api(K, `${S}?q=${encodeURIComponent(sql(`select username from public.profiles where id='${A.userId}';`).slice(0, 10))}`)).json?.players ?? []).find((p: any) => p.userId === A.userId);
check("K busca a A: presencia null", !kSearch || kSearch.presence === null, kSearch?.presence);
const ls1 = sql(`select extract(epoch from last_seen_at)::bigint from public.profiles where id='${A.userId}';`);
await Promise.all([post(A, { action: "pulse" }), post(A2, { action: "pulse" }), post(A, { action: "pulse" })]);
const ls2 = sql(`select extract(epoch from last_seen_at)::bigint from public.profiles where id='${A.userId}';`);
check("dos sesiones latiendo seguidas: UNA escritura (umbral de 20 s)", ls1 === ls2, { ls1, ls2 });
check("el cliente no puede declararse «en partida» (pulse con presence=IN_MATCH se ignora)", ((await post(A, { action: "pulse", presence: "IN_MATCH", inMatch: true })).json?.activeMatchId ?? null) === null);

/* ── 4 · retos ── */
/*
 * F86.1 · ENFRIAMIENTO RESPETADO. Esta pasada crea 6 retos A→B (×10 a la vez = 1, rechazado, cancelado, caducado, el de
 * la partida y la revancha). El límite real es 10 por hora y pareja (0066, `social_challenge_create`): con los de una
 * pasada anterior reciente se agotaría a mitad. En vez de debilitarlo o chocar, se ESPERA a que caduquen los más viejos
 * (lo dice la BD) hasta que caben los 6. Reproducible: dos pasadas seguidas = la segunda espera, no falla.
 */
const NEED_AB = 6;
for (;;) {
  const [n, wait] = sql(`select count(*)||'|'||coalesce(extract(epoch from (min(created_at) + interval '1 hour' - now()))::int, 0) from public.duel_challenges where challenger_id = '${A.userId}' and challenged_id = '${B.userId}' and created_at > now() - interval '1 hour';`).split("|").map(Number);
  if (n + NEED_AB <= 10) { console.log(`enfriamiento: ${n} retos A→B en la última hora, caben los ${NEED_AB} de esta pasada`); break; }
  console.log(`enfriamiento: ${n} retos A→B en la última hora (límite 10): esperando ${wait + 2} s a que caduque el más antiguo…`);
  await sleep((Math.max(1, wait) + 2) * 1000);
}
const [dA, dB, dC] = await Promise.all([validDeck(A), validDeck(B), validDeck(C)]);
check("A, B y C con equipo legal", !!dA && !!dB && !!dC, { a: !!dA, b: !!dB, c: !!dC });
check("retar a un NO amigo (A→K) → 403", (await post(A, { action: "challenge_create", targetUserId: K.userId, deckId: dA!.id })).status === 403);
check("retarse a uno mismo → 400", (await post(A, { action: "challenge_create", targetUserId: A.userId, deckId: dA!.id })).status === 400);
check("retar con un mazo AJENO → rechazado", [400, 403, 404, 409].includes((await post(A, { action: "challenge_create", targetUserId: B.userId, deckId: dB!.id })).status));
const c10 = await Promise.all(Array.from({ length: 10 }, () => post(A, { action: "challenge_create", targetUserId: B.userId, deckId: dA!.id })));
const ids = [...new Set(c10.map((r) => r.json?.challengeId).filter(Boolean))];
check("A→B ×10 a la vez → UN reto (mismo challengeId)", ids.length === 1 && sql(`select count(*) from public.duel_challenges where status='PENDING' and challenger_id='${A.userId}' and challenged_id='${B.userId}';`) === "1", { ids: ids.length });
const ch1 = ids[0];
check("TTL 5 min por reloj de la BD", sql(`select round(extract(epoch from expires_at-created_at)) from public.duel_challenges where id='${ch1}';`) === "300");
const pulseB = (await post(B, { action: "pulse" })).json;
check("B recibe el reto en el pulso (avatar, nombre, rango del retador)", pulseB?.incoming?.id === ch1 && pulseB?.incoming?.challenger?.userId === A.userId && "rivalRank" in (pulseB?.incoming ?? {}), { id: pulseB?.incoming?.id, badge: pulseB?.badge });
check("B → A con uno pendiente de A → 409 «acepta su reto» (un reto por pareja)", (await post(B, { action: "challenge_create", targetUserId: A.userId, deckId: dB!.id })).json?.code === "INCOMING_PENDING");
check("K acepta el reto A→B → 404 (no revela que existe)", (await post(K, { action: "challenge_accept", challengeId: ch1, deckId: dB!.id })).status === 404);
check("K cancela el reto A→B → 409 (sin efecto)", (await post(K, { action: "challenge_cancel", challengeId: ch1 })).status === 409);
check("A (retador) no puede aceptar su propio reto → 404", (await post(A, { action: "challenge_accept", challengeId: ch1, deckId: dA!.id })).status === 404);
check("B rechaza → DECLINED", (await post(B, { action: "challenge_decline", challengeId: ch1 })).json?.status === "DECLINED");
const outA = (await post(A, { action: "pulse" })).json?.outgoing;
check("A ve su reto RECHAZADO (estado persistido en servidor)", outA?.id === ch1 && outA?.status === "DECLINED", outA?.status);
const ch2 = (await post(A, { action: "challenge_create", targetUserId: B.userId, deckId: dA!.id })).json?.challengeId;
check("A cancela mientras PENDING → CANCELLED", (await post(A, { action: "challenge_cancel", challengeId: ch2 })).json?.code === "CANCELLED" && sql(`select status from public.duel_challenges where id='${ch2}';`) === "CANCELLED");
check("aceptar un reto cancelado → 409", (await post(B, { action: "challenge_accept", challengeId: ch2, deckId: dB!.id })).status === 409);
// caducidad (reto QA; se adelanta su expires_at por SQL para no esperar 5 min)
const ch3 = (await post(A, { action: "challenge_create", targetUserId: B.userId, deckId: dA!.id })).json?.challengeId;
sql(`update public.duel_challenges set expires_at = now() + interval '2 seconds' where id='${ch3}' and challenger_id='${A.userId}';`);
check("antes de caducar: sigue pendiente para B", (await api(B, S)).json?.challenges?.find((c: any) => c.id === ch3)?.status === "PENDING");
await sleep(3000);
const exp = await post(B, { action: "challenge_accept", challengeId: ch3, deckId: dB!.id });
check("tras caducar (hora del servidor): aceptar → 409 EXPIRED, sin partida", exp.status === 409 && exp.json?.code === "EXPIRED" && sql(`select status||':'||coalesce(match_id::text,'-') from public.duel_challenges where id='${ch3}';`) === "EXPIRED:-", exp.json?.code);
// cola ranked: aceptar con la cola abierta → IN_QUEUE (sin cancelarla en silencio)
const liveQ = Number(sql("select count(*) from public.duel_pvp_queue where state in ('QUEUED','PAIRING');"));
if (liveQ === 0) {
  const ch4 = (await post(A, { action: "challenge_create", targetUserId: B.userId, deckId: dA!.id })).json?.challengeId;
  const j = await mm(B, { action: "enqueue", deckId: dB!.id });
  const q = await post(B, { action: "challenge_accept", challengeId: ch4, deckId: dB!.id });
  const st = sql(`select state from public.duel_pvp_queue where user_id='${B.userId}' order by created_at desc limit 1;`);
  await mm(B, { action: "cancel" });
  check("B en cola ranked acepta → 409 IN_QUEUE; la cola NO se cancela en silencio", j.status === 200 && q.status === 409 && q.json?.code === "IN_QUEUE" && ["QUEUED", "PAIRING"].includes(st), { join: j.status, code: q.json?.code, st });
  await post(A, { action: "challenge_cancel", challengeId: ch4 });
} else check("cola ranked (omitido: hay jugadores reales en cola)", true, liveQ);

/* ── 5 · aceptar ×5 → UNA partida privada ── */
const ch5 = (await post(A, { action: "challenge_create", targetUserId: B.userId, deckId: dA!.id })).json?.challengeId;
const a5 = await Promise.all(Array.from({ length: 5 }, () => post(B, { action: "challenge_accept", challengeId: ch5, deckId: dB!.id })));
const mids = [...new Set(a5.map((r) => r.json?.matchId).filter(Boolean))];
const mid = mids[0];
const mrow = sql(`select mode||'|'||user_id||'|'||player_b_id||'|'||status from public.duel_matches where id='${mid}';`);
check("B acepta ×5 → UNA partida (mismo matchId) PVP_PRIVATE con A=retador, B=retado", mids.length === 1 && mrow === `PVP_PRIVATE|${A.userId}|${B.userId}|IN_PROGRESS` && sql(`select count(*) from public.duel_matches where id in (select match_id from public.duel_challenges where id='${ch5}');`) === "1", { mids: mids.length, mrow });
check("reto MATCHED con ese match_id", sql(`select status||':'||match_id from public.duel_challenges where id='${ch5}';`) === `MATCHED:${mid}`);
const pA = (await post(A, { action: "pulse" })).json;
check("A (reconectando) detecta la partida activa en el pulso", pA?.activeMatchId === mid && pA?.outgoing?.matchLive !== false, pA?.activeMatchId);
const fBm = ((await api(B, S)).json?.friends ?? []).find((f: any) => f.userId === A.userId);
check("presencia EN PARTIDA derivada del servidor", fBm?.presence === "IN_MATCH", fBm?.presence);
check("C (amigo de A) reta a A en partida → 409 BUSY", (await post(C, { action: "challenge_create", targetUserId: A.userId, deckId: dC!.id })).json?.code === "BUSY");
check("A en partida privada no entra en cola ranked (409)", (await mm(A, { action: "enqueue", deckId: dA!.id })).status === 409);
await mm(A, { action: "cancel" });
const info = await api(B, `${S}?match=${mid}`);
check("?match= solo para sus dos jugadores; K → 404", info.status === 200 && info.json?.mode === "PVP_PRIVATE" && (await api(K, `${S}?match=${mid}`)).status === 404);
// jugar la partida entera por API (vista redactada propia + jugadas legales)
for (let i = 0; i < 80; i++) {
  const [x, y] = await Promise.all([pvpGet(A, mid), pvpGet(B, mid)]).then((r) => r.map((z) => z.json?.snapshot));
  if (["FINISHED", "ABANDONED", "EXPIRED"].includes(x?.lifecycle)) break;
  const w = x?.isYourTurn ? A : y?.isYourTurn ? B : null;
  if (!w) { await sleep(400); continue; }
  const s = w === A ? x : y;
  await api(w, "/api/game/duel/pvp", { action: "play", matchId: mid, actionId: uuid(), expectedVersion: s.stateVersion, ...legalMove(s)! });
}
const fin = sql(`select status||'|'||coalesce(winner,'-') from public.duel_matches where id='${mid}';`);
check("duelo amistoso JUGADO hasta el final", /^(COMPLETED|DRAW)\|/.test(fin), fin);
const out = await pvpGet(A, mid, "&outcome=1");
check("resultado: sin rating ni rango (duelo amistoso)", out.status === 200 && out.json?.outcome === null && out.json?.rank === null, { outcome: out.json?.outcome, rank: out.json?.rank });
await sleep(1500);
check("AISLAMIENTO F84 · 0 asientos de rating para la partida", sql(`select count(*) from public.duel_pvp_rating_events where match_id='${mid}';`) === "0");
check("AISLAMIENTO F84 · ratings de A y B intactos", ratingsOf() === ratingsBefore, { before: ratingsBefore.replace(/[0-9a-f-]{36}/g, (x) => x.slice(0, 8)), after: ratingsOf().replace(/[0-9a-f-]{36}/g, (x) => x.slice(0, 8)) });
check("AISLAMIENTO F84 · colocación/récord de temporada competitiva intactos (Top 500 no cambia)", sql(`select count(*)||':'||coalesce(sum(matches),0) from public.competitive_season_players where user_id in ('${A.userId}','${B.userId}');`) === cspBefore, cspBefore);
check("AISLAMIENTO F83 · 0 XP de temporada por la partida", sql(`select count(*) from public.season_xp_ledger where event_key like '%${mid}%';`) === "0");
check("AISLAMIENTO F73 · 0 eventos de misión por la partida", sql(`select count(*) from public.mission_events where event_key like '%${mid}%';`) === "0");
const stateAfter = await Promise.all([A, B].map(async (w) => (await api(w, "/api/game/state")).json));
check("ECONOMÍA · créditos y XP de cuenta de A y B intactos", stateAfter.every((s, i) => s?.credits === stateBefore[i]?.credits && s?.xp === stateBefore[i]?.xp), stateAfter.map((s, i) => [stateBefore[i]?.credits, s?.credits, stateBefore[i]?.xp, s?.xp]));
const pA2 = (await post(A, { action: "pulse" })).json;
check("partida terminada: ya no hay partida activa ni «en partida»", pA2?.activeMatchId === null);

/* ── 6 · revancha, recientes, comparar ── */
const matchesAB = () => sql(`select count(*) from public.duel_matches where (user_id='${A.userId}' and player_b_id='${B.userId}') or (user_id='${B.userId}' and player_b_id='${A.userId}');`);
const mBefore = matchesAB();
const rm = await Promise.all(Array.from({ length: 4 }, () => post(A, { action: "challenge_create", targetUserId: B.userId, deckId: dA!.id, previousMatchId: mid })));
const rmIds = [...new Set(rm.map((r) => r.json?.challengeId).filter(Boolean))];
const inc = (await post(B, { action: "pulse" })).json?.incoming;
check("REVANCHA = nuevo reto (consentimiento) con previousMatchId; ×4 → UNA", rmIds.length === 1 && inc?.id === rmIds[0] && inc?.previousMatchId === mid && matchesAB() === mBefore, { ids: rmIds.length, prev: inc?.previousMatchId, matches: [mBefore, matchesAB()] });
check("revancha con una partida AJENA → 404", (await post(C, { action: "challenge_create", targetUserId: A.userId, deckId: dC!.id, previousMatchId: mid })).status === 404);
await post(B, { action: "challenge_decline", challengeId: rmIds[0] });
const snapA = (await api(A, S)).json;
const recB = (snapA?.recentOpponents ?? []).find((r: any) => r.userId === B.userId);
check("JUGADORES RECIENTES: B (de la partida real) con relación AMIGOS, sin duplicados", !!recB && recB.relation === "FRIENDS" && new Set((snapA?.recentOpponents ?? []).map((r: any) => r.userId)).size === (snapA?.recentOpponents ?? []).length, recB?.relation);
check("recientes: solo partidas donde A participó", (snapA?.recentOpponents ?? []).every((r: any) => sql(`select count(*) from public.duel_matches where mode in ('PVP','PVP_PRIVATE') and ((user_id='${A.userId}' and player_b_id='${r.userId}') or (player_b_id='${A.userId}' and user_id='${r.userId}'));`) !== "0"));
const cmp = await api(A, `${S}?compare=${B.userId}`);
check("COMPARAR: lado a lado con datos públicos, sin puntuación compuesta", cmp.status === 200 && !!cmp.json?.you && !!cmp.json?.them && !/score|percentile|better|mejor/i.test(Object.keys(cmp.json?.you ?? {}).join(",")) && noPII(cmp.json), Object.keys(cmp.json?.you ?? {}));
check("comparar consigo mismo → 400", (await api(A, `${S}?compare=${A.userId}`)).status === 400);

/* ── 7 · bloqueo ── */
const chC = (await post(C, { action: "challenge_create", targetUserId: A.userId, deckId: dC!.id })).json?.challengeId;
const bl = await post(A, { action: "block", targetUserId: C.userId });
check("A bloquea a C → amistad fuera para los dos y reto pendiente cancelado", bl.status === 200 && relDb(A.userId, C.userId) === "NONE" && sql(`select status from public.duel_challenges where id='${chC}';`) === "CANCELLED", { db: relDb(A.userId, C.userId) });
check("el reto cancelado por el bloqueo ya no se puede aceptar", (await post(A, { action: "challenge_accept", challengeId: chC, deckId: dA!.id })).status === 409);
const cr = await post(C, { action: "friend_request", targetUserId: A.userId });
check("C pide amistad a A → 409 «Acción no disponible» (neutro: no dice quién bloqueó)", cr.status === 409 && cr.json?.code === "UNAVAILABLE" && !/bloque/i.test(cr.json?.error ?? ""), cr.json);
check("C no puede retar a A", (await post(C, { action: "challenge_create", targetUserId: A.userId, deckId: dC!.id })).status >= 400);
const cSearch = ((await api(C, `${S}?q=${encodeURIComponent(sql(`select username from public.profiles where id='${A.userId}';`).slice(0, 10))}`)).json?.players ?? []);
check("C busca a A → no aparece (sin «existe pero no»)", !cSearch.some((p: any) => p.userId === A.userId));
check("C ?player=A → 404 social (como un id inventado)", (await api(C, `${S}?player=${A.userId}`)).status === 404);
check("POLÍTICA: el perfil PÚBLICO F89 de A sigue visible para C (no es privacidad total)", (await api(C, `/api/game/player?id=${A.userId}`)).status === 200);
const cSnap = (await api(C, S)).json;
check("C no recibe en su foto ni rastro del bloqueo (sin blocked_by)", !/blocked_by|blockedBy|BLOCKED_ME/.test(JSON.stringify(cSnap)) && !(cSnap?.blocked ?? []).some((p: any) => p.userId === A.userId));
check("A ve a C en su lista de bloqueados", ((await api(A, S)).json?.blocked ?? []).some((p: any) => p.userId === C.userId));
check("bloquearse a uno mismo → 400", (await post(A, { action: "block", targetUserId: A.userId })).status === 400);
check("K desbloquea en nombre de A → 409 (solo su propio bloqueo)", (await post(K, { action: "unblock", targetUserId: C.userId })).status === 409 && sql(`select count(*) from public.social_blocks where blocker_id='${A.userId}' and blocked_id='${C.userId}';`) === "1");
const ub = await post(A, { action: "unblock", targetUserId: C.userId });
check("desbloquear → NINGUNA (no restaura la amistad)", ub.status === 200 && ub.json?.relation === "NONE" && relDb(A.userId, C.userId) === "NONE");
const rq = await post(C, { action: "friend_request", targetUserId: A.userId });
check("tras desbloquear se puede volver a pedir (re-add)", rq.status === 200 && relDb(A.userId, C.userId) === "PENDING:1", rq.json?.code);
check("A retira… (C cancela su solicitud) → NINGUNA", (await post(C, { action: "unfriend", targetUserId: A.userId })).status === 200 && relDb(A.userId, C.userId) === "NONE");

/* ── 8 · RLS directa con el token del jugador (PostgREST) ── */
const env = Object.fromEntries((await import("node:fs")).readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l: string) => /^[A-Z_]+=/.test(l)).map((l: string) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const rest = async (w: any, path: string) => { const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, authorization: `Bearer ${w.token}` } }); return { status: r.status, json: await r.json().catch(() => null) }; };
await post(A, { action: "block", targetUserId: C.userId });
const rC = await rest(C, "social_blocks?select=*");
const rA = await rest(A, "social_blocks?select=*");
check("RLS social_blocks: el bloqueado (C) lee 0 filas; el bloqueador (A) lee la suya", Array.isArray(rC.json) && rC.json.length === 0 && Array.isArray(rA.json) && rA.json.length === 1, { c: rC.json?.length ?? rC.status, a: rA.json?.length ?? rA.status });
const rf = await rest(K, `duel_friendships?select=*`);
check("RLS duel_friendships: K no lee el grafo ajeno", !Array.isArray(rf.json) || rf.json.every((x: any) => x.user_lo === K.userId || x.user_hi === K.userId), { status: rf.status, n: Array.isArray(rf.json) ? rf.json.length : null });
const rch = await rest(K, `duel_challenges?select=*`);
check("RLS duel_challenges: K no lee retos ajenos", !Array.isArray(rch.json) || rch.json.every((x: any) => x.challenger_id === K.userId || x.challenged_id === K.userId), { status: rch.status, n: Array.isArray(rch.json) ? rch.json.length : null });
const rpc = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/social_friend_request`, { method: "POST", headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, authorization: `Bearer ${K.token}`, "content-type": "application/json" }, body: JSON.stringify({ p_user: A.userId, p_target: K.userId }) });
check("RPC social_* directa con token de jugador → denegada (solo service_role)", [401, 403, 404].includes(rpc.status), rpc.status);
await post(A, { action: "unblock", targetUserId: C.userId });

/* ── 9 · límites ── */
let hit429 = false, okBefore = 0;
for (let i = 0; i < 40 && !hit429; i++) { const r = await api(K, `${S}?q=qa${String.fromCharCode(97 + (i % 26))}`, undefined, { noRetry: true }); if (r.status === 429) hit429 = true; else okBefore++; }
check("límite de búsqueda: ≥ 25 búsquedas normales pasan y luego 429 (anti-scraping)", hit429 && okBefore >= 25, { okBefore });

/* ── 10 · presencia: TTL (opcional, 2 min) ── */
if (process.argv.includes("--ttl")) {
  await post(A, { action: "pulse" });
  console.log("… esperando 125 s sin latidos de A (navegador «muerto»)");
  await sleep(125_000);
  const f = ((await api(B, S)).json?.friends ?? []).find((x: any) => x.userId === A.userId);
  check("TTL: sin latido > 2 min → Desconectado (sin cierre de sesión limpio)", f?.presence === "OFFLINE", f?.presence);
}

/* ── 11 · limpieza de lo social creado (las partidas quedan como historial) ── */
await post(A, { action: "unfriend", targetUserId: B.userId });
const left = sql(`select (select count(*) from public.duel_friendships where user_lo in ('${A.userId}','${B.userId}','${C.userId}') or user_hi in ('${A.userId}','${B.userId}','${C.userId}'))||'|'||(select count(*) from public.social_blocks where blocker_id in ('${A.userId}','${B.userId}','${C.userId}') or blocked_id in ('${A.userId}','${B.userId}','${C.userId}'))||'|'||(select count(*) from public.duel_challenges where status in ('PENDING','ACCEPTED') and (challenger_id in ('${A.userId}','${B.userId}','${C.userId}') or challenged_id in ('${A.userId}','${B.userId}','${C.userId}')));`);
check("limpieza: 0 amistades, 0 bloqueos, 0 retos vivos de A/B/C", left === "0|0|0", left);
check("la cuenta personal no aparece en NINGUNA fila social", sql(`select (select count(*) from public.duel_friendships f join auth.users u on u.id in (f.user_lo,f.user_hi) where u.id::text like '2f86cbe8%' and f.created_at > now() - interval '3 hours')||'|'||(select count(*) from public.social_blocks b where b.blocker_id::text like '2f86cbe8%' or b.blocked_id::text like '2f86cbe8%')||'|'||(select count(*) from public.duel_challenges c where (c.challenger_id::text like '2f86cbe8%' or c.challenged_id::text like '2f86cbe8%') and c.created_at > now() - interval '3 hours');`) === "0|0|0");

const failed = rows.filter((r) => !r.ok);
writeFileSync(`${OUT}/prod-qa${process.argv.includes("--ttl") ? "-ttl" : ""}${SWAP ? "-swap" : ""}.json`, JSON.stringify({ base: BASE, at: new Date().toISOString(), privateMatch: mid, total: rows.length, passed: rows.length - failed.length, failed: failed.length, rows }, null, 1));
console.log(`\nF85 PROD QA: ${rows.length - failed.length}/${rows.length}`);
process.exitCode = failed.length ? 1 : 0;
