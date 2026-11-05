"""FASE 68 · compila la evidencia de la beta cerrada (docs/product/qa/fase68-beta/*.json) desde raw/*.json.
Instrumento `_`, fuera de CI. Solo lee raw/ y escribe los JSON de evidencia (UTF-8, LF)."""
import json, os, glob, re

ROOT = os.path.join(os.path.dirname(__file__), "..", "docs", "product", "qa", "fase68-beta")
RAW = os.path.join(ROOT, "raw")

def load(name):
    p = os.path.join(RAW, name + ".json")
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else None

def write(name, data):
    with open(os.path.join(ROOT, name + ".json"), "wb") as f:
        f.write(json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8") + b"\n")

def checks(d):
    if not d: return None
    c = d.get("checks") or {}
    return {"pass": c.get("pass"), "fail": c.get("fail", [])}

def summary(d, extra=()):
    if not d: return None
    net = d.get("network") or {}
    out = {
        "id": d.get("id"), "persona": d.get("persona"), "session": d.get("session"), "tag": d.get("tag"),
        "width": d.get("width"), "reduced": d.get("reduced"), "durationSec": d.get("durationSec"),
        "actions": d.get("actions"), "screens": d.get("screens"), "checks": checks(d),
        "consoleErrors": len(d.get("consoleErrors") or []),
        "api": net.get("api"), "statuses": net.get("status"), "bad": (net.get("bad") or [])[:20],
        "notes": [n for n in (d.get("notes") or []) if n.get("kind") in ("bug", "friction")],
    }
    for k in extra: out[k] = d.get(k)
    return out

SESSIONS = sorted(os.path.basename(p)[:-5] for p in glob.glob(os.path.join(RAW, "*.json")) if not re.search(r"^(probe|reconcile|security)", os.path.basename(p)))
ALL = {s: load(s) for s in SESSIONS}

# ─────────── bugs ───────────
BUGS = [
 {"id": "F68-001", "severity": "MAJOR", "journey": "Primera sesión (F63) · sobres de bienvenida",
  "reproduction": "Cuenta nueva → guía → abrir el primer Sobre Inicial → en el resumen pulsar «Abrir el siguiente sobre».",
  "expected": "Se abre la ceremonia del siguiente Sobre Inicial.", "actual": "No pasa nada: el botón era un enlace a /abrir/inicial, la misma URL; Next no vuelve a montar la página y el resumen se queda. La guía quedaba atascada (salida: volver a la portada).",
  "evidence": ["raw/A-r1-new.json (FRICTION «la guía no avanza en /abrir/inicial»)", "raw/B-r1-new.json, raw/C-r1-new.json (BUG F68-001 + rodeo por la portada)", "screenshots/B-r1-new-guide-dead-cta-*"],
  "rootCause": "OnboardingPackNext/FirstCardLesson pintaban siempre <Link href=next.href>; cuando el paso siguiente es otro sobre DEL MISMO TIPO, next.href = ruta actual. El instrumento de F63 lo tapaba navegando por URL (goto) en vez de pulsar el botón.",
  "fix": "OnboardingCta acepta `here` (ruta actual + acción local). Si next.href es la ruta actual, pinta un botón que ejecuta `openAnother` (el bucle «abrir otro» que ya tenía la ceremonia). PackOpeningExperience pasa su bucle a las dos piezas de la guía.",
  "files": ["src/components/onboarding/OnboardingKit.tsx", "src/components/onboarding/FirstCardLesson.tsx", "src/components/packs/PackOpeningExperience.tsx"],
  "regressionTest": "src/components/onboarding/f68.beta.render.test.tsx (5 tests)", "status": "FIXED", "verifiedLive": ["raw/F-r2-new.json", "raw/G-r2-new.json", "raw/H-final-new.json", "raw/I-final-new.json", "raw/J-definitive-new.json"]},
 {"id": "F68-002", "severity": "MINOR", "journey": "Tienda · compra",
  "reproduction": "Tienda → Comprar → dos clics en la MISMA tarea sobre «Confirmar · 1.000».",
  "expected": "Una compra.", "actual": "Dos compras: −2.000 créditos y 2 sobres (libro coherente: dos cargos con dos claves). Con doble clic humano (60 ms) ya salía una sola.",
  "evidence": ["raw/B-r1-store.json", "raw/C-r1-store.json", "SQL: dos buy_pack a las 10:14:50.164 con claves distintas"],
  "rootCause": "La guardia era `busy` (estado de React: el segundo clic lee el mismo false) y cada llamada generaba una clave de idempotencia nueva (newGesture()), así que el servidor no podía reconocer el segundo envío.",
  "fix": "Guardia síncrona (useRef) + UNA clave por gesto de compra (al abrir el diálogo), la misma en el reintento; buyPackOnline/usePackPurchase aceptan `ref`. Misma guardia en /packs/[id].",
  "files": ["src/app/tienda/page.tsx", "src/app/packs/[packId]/page.tsx", "src/lib/game/sync.ts", "src/lib/game/usePackPurchase.ts"],
  "regressionTest": "src/app/tienda/f68.purchase.contract.test.ts (5 tests)", "status": "FIXED", "verifiedLive": ["raw/B-fix-store.json (5.580 → 4.580, +1 sobre)"]},
 {"id": "F68-003", "severity": "MINOR", "journey": "Equipos · crear",
  "reproduction": "Mis equipos → Nuevo equipo → Autocompletar → dos clics en la MISMA tarea sobre «Guardar equipo».",
  "expected": "Un equipo.", "actual": "Dos equipos iguales («Equipo 1» ×2). Con doble clic humano (60 ms) ya salía uno.",
  "evidence": ["raw/D-r1-teams.json"], "rootCause": "Guardia `saving` = estado de React; un equipo nuevo no tiene versión que el servidor compare.",
  "fix": "savingRef (useRef) levantado antes de la primera await y liberado en finally.", "files": ["src/components/duel/DeckBuilder.tsx"],
  "regressionTest": "src/components/duel/f68.deckSave.contract.test.ts (2 tests)", "status": "FIXED", "verifiedLive": ["scripts/_fase68-diag8.ts: 3 → 4 equipos (uno)"]},
 {"id": "F68-004", "severity": "MINOR", "journey": "Auth · errores",
  "reproduction": "/cuenta → contraseña incorrecta (o registro con correo existente).",
  "expected": "Mensaje útil en español, sin fugas.", "actual": "Texto crudo de GoTrue en inglés: «Invalid login credentials», «User already registered».",
  "evidence": ["raw/A-r1-auth.json", "screenshots/A-r1-auth-01-password-mal-1440.png"], "rootCause": "auth.tsx devolvía error.message tal cual en entrar, registro, recuperar y cambiar contraseña.",
  "fix": "authErrorMessage(): traducción por code/mensaje; lo desconocido sale como mensaje neutro (nunca crudo). Mismo texto exista o no la cuenta.",
  "files": ["src/lib/supabase/authErrors.ts", "src/lib/supabase/auth.tsx"], "regressionTest": "src/lib/supabase/authErrors.test.ts", "status": "FIXED", "verifiedLive": ["raw/A-fix-auth.json", "raw/A-final2-auth.json"]},
 {"id": "F68-005", "severity": "MINOR", "journey": "Tactical Coach · partido",
  "reproduction": "Entrenador → Quick Play → partido completo.",
  "expected": "0 recursos internos perdidos.", "actual": "212 respuestas 404 a /players/<id>.png en un partido (~11 por jugador): public/players no tiene retratos.",
  "evidence": ["raw/D-coach-play.json (ronda 1)", "raw/D-r1-explorer.json"], "rootCause": "playerMapper.resolveImage y PlayerPhoto pedían SIEMPRE /players/<id>.png; PlayerStatusCard/MatchCeremony lo ocultaban con onError y lo volvían a pedir en cada montaje.",
  "fix": "PLAYER_PHOTOS_AVAILABLE (patrón F64 TEAM_LOGOS_AVAILABLE, test contra la carpeta): sin retrato publicado no se pide; resolveImage devuelve '' (los consumidores ya lo comprueban). SimPlayerMeta (motor) intacto.",
  "files": ["src/data/playerPhotos.ts", "src/components/cards/layers/PlayerPhoto.tsx", "src/lib/match/playerMapper.ts"], "regressionTest": "src/components/cards/layers/f68.playerPhoto.test.tsx (5 tests)", "status": "FIXED", "verifiedLive": ["raw/D-coach-play.json (verificación: 0 × 404, 0 errores)", "raw/D-r2-explorer.json"]},
 {"id": "F68-006", "severity": "POLISH", "journey": "Tactical Coach · ceremonia",
  "reproduction": "Perder un partido del Coach con pocas rondas ganadas y poco control.", "expected": "Narrativa coherente con la derrota.",
  "actual": "«Ganasteis a pesar de ceder el control» en una derrota 1–13.", "evidence": ["screenshots/D-coach-final (ronda 1)"],
  "rootCause": "utilityStory() narra las RONDAS ganadas pero conjugaba «Ganasteis» sin mirar el resultado del partido.",
  "fix": "Con el partido perdido, la frase habla de «las rondas que ganasteis».", "files": ["src/lib/match/moments.ts"], "regressionTest": "src/lib/match/f68.moments.test.ts", "status": "FIXED", "verifiedLive": ["test"]},
 {"id": "F68-007", "severity": "MINOR", "journey": "Varias pestañas",
  "reproduction": "Pestaña 1 y 2 del mismo navegador → comprar en la 1 → volver a la 2 (foco) y navegar dentro de la app.",
  "expected": "La 2 se pone al día razonablemente.", "actual": "La 2 seguía con 5.310 créditos (servidor 2.810) hasta recargar.",
  "evidence": ["raw/C-r1-multitab-same.json"], "rootCause": "CloudSync solo sincronizaba al iniciar sesión/cargar; volver a la pestaña no releía el servidor.",
  "fix": "CloudSync relee el estado (una lectura idempotente) al recuperar foco / volver a ser visible, con freno de 5 s.",
  "files": ["src/components/sync/CloudSync.tsx"], "regressionTest": "src/components/sync/f68.cloudSync.test.ts", "status": "FIXED", "verifiedLive": ["raw/E-fix-multitab-same.json", "raw/G-r2-multitab-same.json"]},
 {"id": "F68-008", "severity": "MINOR", "journey": "Progresión · reclamar",
  "reproduction": "Progreso → Reclamar todo (+3.430 créditos).", "expected": "El HUD enseña el saldo nuevo.",
  "actual": "El HUD seguía en 6.000 hasta recargar (el servidor ya tenía 9.430).", "evidence": ["raw/D-r2-progress.json", "screenshots/D-r2-progress-02b-hud-tras-reclamar-1024.png"],
  "rootCause": "useClaims y /logros releían la foto de progresión; el saldo del HUD vive en el store de juego y nadie lo actualizaba.",
  "fix": "Tras un reclamo cobrado, syncFromServer() (una lectura) en useClaims (hub + post-partida) y en /logros.",
  "files": ["src/lib/progression/claims.ts", "src/app/logros/page.tsx"], "regressionTest": "src/lib/progression/f68.claimsSync.test.ts", "status": "FIXED", "verifiedLive": ["raw/H-final-new.json", "raw/I-final-new.json", "raw/J-definitive-new.json"]},
 {"id": "F68-009", "severity": "MINOR", "journey": "Auth · recuperar contraseña",
  "reproduction": "Abrir /cuenta#error=access_denied&error_code=otp_expired (enlace de correo caducado o usado).",
  "expected": "Explicar qué pasó y cómo seguir.", "actual": "Formulario normal de entrar, sin ningún aviso.", "evidence": ["raw/A-final-auth.json"],
  "rootCause": "Nadie leía el error que GoTrue deja en la URL (auth-js lo detecta pero no lo expone ni lo borra).",
  "fix": "authLinkError() + AuthForms: abre «Recuperar» con «El enlace ha caducado o ya se usó…» y limpia el #.", "files": ["src/lib/supabase/authErrors.ts", "src/components/auth/AuthForms.tsx"],
  "regressionTest": "src/lib/supabase/authErrors.test.ts (B009)", "status": "FIXED", "verifiedLive": ["raw/A-final2-auth.json"]},
 {"id": "F68-010", "severity": "MAJOR", "journey": "Tactical Coach · recompensa",
  "reproduction": "Jugar un partido del Coach con sesión.", "expected": "Recompensa real o ninguna promesa.",
  "actual": "El HUD suma créditos/nivel del partido (6.000 → 6.800 y 6.650; 9.430 → 10.080) que NO existen en el servidor (libro sin apunte) y desaparecen al sincronizar.",
  "evidence": ["raw/D-coach-play.json", "raw/D-r2-explorer.json", "SQL de solo lectura: libro de D sin apuntes del Coach"],
  "rootCause": "Preexistente (P1 de 2026-09-11): grantMatchOutcomeReward aplica la recompensa solo en el store local; el simulador corre en el navegador y el servidor no puede verificar el marcador.",
  "fix": None, "status": "OPEN — BLOQUEADO POR DECISIÓN DE ECONOMÍA", "blockedBy": "F57.6 congelada y regla F68 «no retune»; las tres opciones (simular en servidor, premio acotado server-side, dejar de prometer recompensa con sesión) son decisión del usuario. La memoria del proyecto prohíbe ocultarlo con un cambio de texto sin esa decisión.",
  "regressionTest": None},
 {"id": "F68-011", "severity": "POLISH", "journey": "Tactical Coach · sala táctica", "reproduction": "Ronda 1 (pistola).",
  "expected": "Recomendación coherente con la ronda pistola.", "actual": "La IA recomienda SAVE/ECO («tu economía está tocada») con 800/jug. en la ronda pistola.",
  "evidence": ["screenshots/coach (ronda 1)"], "rootCause": "Lógica del recomendador del simulador del Coach (economía BROKEN a 800).", "fix": None, "status": "OPEN (fuera de alcance: lógica del simulador; F68 no cambia reglas)", "regressionTest": None},
 {"id": "F68-012", "severity": "POLISH", "journey": "Tactical Coach · compra", "reproduction": "Fase de compra de cualquier ronda.",
  "expected": "Una acción principal.", "actual": "Dos CTA para lo mismo: «Comprar y empezar ronda» y «Jugar la ronda».", "evidence": ["captura de la fase de compra"], "fix": None, "status": "OPEN (rediseño menor, no trivial)", "regressionTest": None},
 {"id": "F68-013", "severity": "POLISH", "journey": "Perfil / cuenta", "reproduction": "/cuenta de una cuenta con puntos.",
  "expected": "Un solo concepto de «rango».", "actual": "«BRONCE I» (rango por puntos de F11, que suman duelos y Pick'ems) convive con la escalera Elo sin tiers de /competitivo (F55). Dos «rangos» distintos para el jugador.",
  "evidence": ["raw/AB-r1-switch.json", "raw/CF-r2-switch.json"], "fix": None, "status": "OPEN (decisión de producto; sistemas preexistentes)", "regressionTest": None},
 {"id": "F68-014", "severity": "POLISH", "journey": "Navegación · URL inválida", "reproduction": "/duelos/competitivo/partida/nope",
  "expected": "Estado «no encontrada» con salida.", "actual": "«Algo ha fallado · Reintentar» (400): reintentar no arregla un enlace roto.",
  "evidence": ["raw/D-r1-explorer.json"], "rootCause": "La página solo trataba 404 como «no encontrada».", "fix": "400 = 404 para el jugador: «Partida no encontrada» con «Volver al competitivo».",
  "files": ["src/app/duelos/competitivo/partida/[matchId]/page.tsx"], "regressionTest": "src/app/duelos/competitivo/f68.matchDetail.test.ts", "status": "FIXED", "verifiedLive": ["test"]},
]
write("bugs", {"phase": "F68", "total": len(BUGS), "bySeverity": {s: {"total": sum(1 for b in BUGS if b["severity"] == s), "fixed": sum(1 for b in BUGS if b["severity"] == s and b["status"] == "FIXED"), "open": sum(1 for b in BUGS if b["severity"] == s and b["status"] != "FIXED")} for s in ["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "POLISH"]}, "bugs": BUGS,
       "harnessFalsePositives": [
         "Delta ranked «FAIL» en ronda 1: el arnés juntaba las cifras de «ANTES 1000 → DESPUÉS 1021 +21»; la interfaz era correcta (parser corregido).",
         "Reclamar todo «8 → 2 botones»: el arnés miró a los 3,5 s y la tanda cobra en serie (~5 s); a los pocos segundos quedaban 0.",
         "Letras «s» que faltaban en textos del Coach/Social: regex del propio arnés escrito sin barra (\\\\s → s); la interfaz se lee bien.",
         "Resto de la capa «DERROTA» sobre el resultado a 390: animación de salida; a +2 s no queda nada (medido).",
         "«De vuelta en A: HUD» FAIL: el token de API del arnés quedó revocado por el logout global; con token nuevo, HUD = servidor.",
         "Draft/Coach «atascados» en ronda 1: el arnés no confirmaba elección / no contestaba las decisiones del entrenador.",
       ]})

# ─────────── personas ───────────
write("personas", {"note": "Cuentas QA propias de la beta (dominio @example.invalid). Credenciales SOLO en el scratchpad de la sesión; aquí únicamente el prefijo del id.", "personas": [
 {"persona": "A", "role": "NUEVO", "account": (ALL.get("A-r1-new") or {}).get("account"), "width": 1440, "reduced": False, "sessions": [s for s in SESSIONS if s.startswith("A-") or s.startswith("AB-")]},
 {"persona": "B", "role": "CASUAL (móvil 390)", "account": (ALL.get("B-r1-new") or {}).get("account"), "width": 390, "reduced": False, "sessions": [s for s in SESSIONS if s.startswith("B-")]},
 {"persona": "C", "role": "COMPETITIVO", "account": (ALL.get("C-r1-new") or {}).get("account"), "width": 1440, "reduced": False, "sessions": [s for s in SESSIONS if s.startswith("C") ]},
 {"persona": "D", "role": "EXPLORADOR (tablet 1024, movimiento reducido; saltó la guía)", "account": (ALL.get("D-r1-skip") or {}).get("account"), "width": 1024, "reduced": True, "sessions": [s for s in SESSIONS if s.startswith("D")]},
 {"persona": "E", "role": "RETURNING (cuenta QA F63 a9a86124 con historial)", "account": "a9a86124", "width": 1440, "reduced": False, "sessions": [s for s in SESSIONS if s.startswith("E-") or s.startswith("CE-")]},
 {"persona": "F", "role": "NUEVO Ronda 2 (1440)", "account": (ALL.get("F-r2-new") or {}).get("account"), "sessions": [s for s in SESSIONS if s.startswith("F-") or s.startswith("CF-")]},
 {"persona": "G", "role": "NUEVO Ronda 2 (390, movimiento reducido)", "account": (ALL.get("G-r2-new") or {}).get("account"), "sessions": [s for s in SESSIONS if s.startswith("G-")]},
 {"persona": "H", "role": "CUENTA NUEVA FINAL (tras F68-001..008)", "account": (ALL.get("H-final-new") or {}).get("account"), "sessions": ["H-final-new"]},
 {"persona": "I", "role": "CUENTA NUEVA FINAL (tras todos los arreglos)", "account": (ALL.get("I-final-new") or {}).get("account"), "sessions": ["I-final-new"]},
 {"persona": "J", "role": "CUENTA NUEVA sobre la BUILD DEFINITIVA", "account": (ALL.get("J-definitive-new") or {}).get("account"), "sessions": ["J-definitive-new"]},
]})

# ─────────── sesiones + totales ───────────
rows = []
for s in SESSIONS:
    d = ALL[s]
    if s.endswith("-ranked"):
        rows.append({"id": s, "session": "ranked", "durationSec": d.get("durationSec"), "matches": len(d.get("matches", [])), "checks": d.get("checks"), "consoleErrors": sum(len(v) for v in (d.get("consoleErrors") or {}).values())})
    elif s == "D-coach-play":
        rows.append({"id": s, "session": "coach-play", "durationSec": round((d.get("ms") or 0) / 1000), "clicks": d.get("clicks"), "historyGrew": d.get("historyGrew"), "consoleErrors": len(d.get("errors") or [])})
    else:
        rows.append(summary(d))
def n_matches(d, s):
    if s.endswith("-ranked"): return len(d.get("matches", []))
    m = 0
    if d.get("guide"): m += d["guide"].get("matches", 0)
    if s.endswith("-new"): m += 1  # 2.ª partida sin guía
    if d.get("matches") and isinstance(d["matches"], list): m += len(d["matches"])
    if d.get("match"): m += 1
    for r in d.get("runs", []) or []:
        if r.get("match"): m += 1
    if d.get("coach", {}).get("final") if isinstance(d.get("coach"), dict) else False: m += 1
    if d.get("draft", {}).get("match") if isinstance(d.get("draft"), dict) else False: m += 1
    if s == "D-coach-play" and d.get("historyGrew"): m += 1
    return m
tot = {"sessions": len(rows), "actions": sum((r or {}).get("actions") or 0 for r in rows), "durationSec": sum((r or {}).get("durationSec") or 0 for r in rows),
       "matches": sum(n_matches(ALL[s], s) for s in SESSIONS), "consoleErrors": sum((r or {}).get("consoleErrors") or 0 for r in rows)}
rec = load("reconcile-final") or {}
tot["packsOpened"] = sum(r["inventory"]["openedOps"] for r in rec.get("rows", []))
tot["storePurchases"] = sum(sum(v["bought"] for v in r["inventory"]["packs"].values()) for r in rec.get("rows", []))
tot["betaAccounts"] = {"new": 9, "reused": 1, "total": len(rec.get("rows", []))}
pve_paid = sum(v["n"] for row in rec.get("rows", []) for k, v in row["ledger"]["byReason"].items() if k in ("duel_win", "duel_loss"))
ranked_n = sum(len(ALL[s].get("matches", [])) for s in SESSIONS if s.endswith("-ranked"))
draft_n = sum(1 for r in ((ALL.get("D-r1-draft") or {}).get("runs") or []) if r.get("match")) + (1 if ((ALL.get("D-r2-explorer") or {}).get("draft") or {}).get("match") else 0)
tot["matches"] = {"pve": pve_paid, "ranked": ranked_n, "draft": draft_n, "coach": 3, "total": pve_paid + ranked_n + draft_n + 3,
                  "note": "PvE = partidas terminadas pagadas en el libro (victoria/derrota); coach = filas en coach_matches (SQL de solo lectura)."}
tot["consoleErrorsExplained"] = "Todos provocados por las pruebas: 400/422 de GoTrue en las sondas de auth, ERR_INTERNET_DISCONNECTED en el corte de red, 404/400 de URL inválidas y de la ruta inexistente, y 5×404 de retratos del Coach antes de F68-005. Journeys normales: 0."
write("sessions", {"totals": tot, "note": "Duración = tiempo del instrumento automatizado (no tiempo humano). Acciones = clics/teclas/navegaciones del arnés.", "sessions": rows})

# ─────────── rondas ───────────
def group(prefixes): return [summary(ALL[s]) if not s.endswith("-ranked") else {"id": s, "checks": ALL[s].get("checks")} for s in SESSIONS if any(re.search(p, s) for p in prefixes)]
write("round1", {"what": "Ronda 1: journeys completos sobre la build de partida (drl-0.1.1-1-abdcaffc) y la primera build con arreglos.", "sessions": group([r"-r1-", r"-fix-"])})
write("round2", {"what": "Ronda 2 tras los arreglos + pasada final (cuenta nueva, vuelta, ranked) sobre la build final y la definitiva (drl-0.1.1-1-9792433c).", "sessions": group([r"-r2-", r"-final", r"-definitive"])})

# ─────────── journeys ───────────
pick = lambda *names: [summary(ALL[n], ("guide", "guideSeconds", "start", "end")) for n in names if ALL.get(n)]
write("new-player", {"sessions": pick("A-r1-new", "A-r1-resume", "B-r1-new", "C-r1-new", "F-r2-new", "G-r2-new", "H-final-new", "I-final-new", "J-definitive-new"), "skip": summary(ALL.get("D-r1-skip"), ("quickWithoutTeam", "afterSelfGuided"))})
write("returning-player", {"sessions": pick("E-r1-return", "E-r2-return", "E-final-return", "E-final2-return")})
write("casual", {"sessions": pick("B-r1-new", "B-r1-pve", "B-r2-pve", "B-r1-store", "B-fix-store", "B-r1-collection", "B-r1-progress", "B-fix-teams")})
write("competitive", {"ranked": [{"id": s, "checks": ALL[s].get("checks"), "matches": ALL[s].get("matches"), "history": ALL[s].get("history"), "competitive": ALL[s].get("competitive"), "start": ALL[s].get("start"), "end": ALL[s].get("end")} for s in SESSIONS if s.endswith("-ranked")], "teams": pick("C-r1-teams")})
write("explorer", {"sessions": [summary(ALL[s], ("nav", "invalid", "notFound", "history", "profile", "social")) for s in ["D-r1-explorer", "D-r2-explorer"] if ALL.get(s)], "social": summary(ALL.get("DC-r1-social"), ("results", "inbox", "friendsOther"))})
write("packs", {"sessions": pick("B-r1-store", "B-fix-store", "C-r1-store"), "guidePacks": [{"id": s, "packs": (ALL[s].get("guide") or {}).get("packs")} for s in SESSIONS if s.endswith("-new")]})
write("store", {"sessions": [summary(ALL[s], ("buys", "insufficient", "openNow")) for s in ["B-r1-store", "C-r1-store", "B-fix-store"] if ALL.get(s)]})
write("collection", {"sessions": [summary(ALL[s], ("loadMs", "sort", "cardHref", "detail", "album")) for s in ["B-r1-collection"] if ALL.get(s)], "multitabCollection": (ALL.get("C-r1-multitab") or {}).get("collection")})
write("teams", {"sessions": [summary(ALL[s], ("partial", "invalid", "auto", "afterAutoSave", "activate", "end")) for s in ["C-r1-teams", "D-r1-teams", "B-fix-teams"] if ALL.get(s)], "autoTeamNote": "Autocompletar: válido, guardado y activable; su calidad (F65: no óptimo) no se tocó."})
write("pve", {"sessions": [summary(ALL[s], ("matches", "outcomes")) for s in ["B-r1-pve", "B-r2-pve"] if ALL.get(s)]})
write("ranked", {"runs": [{"id": s, "checks": ALL[s].get("checks"), "durationSec": ALL[s].get("durationSec"), "matches": [{k: m.get(k) for k in ("i", "queueMs", "result", "deltas", "rating", "ui")} for m in ALL[s].get("matches", [])], "network": ALL[s].get("network")} for s in SESSIONS if s.endswith("-ranked")]})
write("progression", {"sessions": [summary(ALL[s], ("before", "claim", "afterClaim", "hudAfterClaim", "revisit", "reclaimApi", "season", "achievements", "profile")) for s in ["B-r1-progress", "E-r1-progress", "E-r2-progress", "D-r2-progress"] if ALL.get(s)], "pickemsMission": {k: (ALL.get("D-r1-pickems") or {}).get(k) for k in ("missionBefore", "missionAfter")}})
write("draft", {"sessions": [summary(ALL[s], ("runs", "serverAfter", "start", "end")) for s in ["D-r1-draft"] if ALL.get(s)], "explorerR2": (ALL.get("D-r2-explorer") or {}).get("draft")})
cp = ALL.get("D-coach-play") or {}
write("coach", {"playVerification": {k: cp.get(k) for k in ("clicks", "historyGrew", "agentFaces", "ms", "final")}, "network": cp.get("network"), "errors": cp.get("errors"), "explorerR2": (ALL.get("D-r2-explorer") or {}).get("coach"), "openIssues": ["F68-010", "F68-011", "F68-012"]})
write("pickems", {"session": summary(ALL.get("D-r1-pickems"), ("label", "clicked", "pressedNow", "pressedAfterF5", "missionBefore", "missionAfter")), "explorer": (ALL.get("D-r1-explorer") or {}).get("pickems")})
write("mobile", {"width": 390, "sessions": [summary(ALL[s]) for s in SESSIONS if ALL[s] and ALL[s].get("width") == 390]})
write("tablet", {"width": 1024, "sessions": [summary(ALL[s]) for s in SESSIONS if ALL[s] and ALL[s].get("width") == 1024]})
write("desktop", {"width": 1440, "sessions": [summary(ALL[s]) for s in SESSIONS if ALL[s] and ALL[s].get("width") == 1440]})
write("slow-network", {"sessions": [summary(ALL[s], ("timings", "match", "recovered", "offline")) for s in ["C-r1-slownet", "G-r2-slownet"] if ALL.get(s)], "note": "Latencia 400 ms + 1,5 Mbps de bajada (no caos de F66) y un corte breve en /progresion→/colección."})
write("multitab", {"separateWindow": summary(ALL.get("C-r1-multitab"), ("hud", "collection")), "sameBrowser": [summary(ALL[s], ("tab2Before", "server", "tab1Hud", "tab2AfterFocus", "tab2AfterNav")) for s in ["C-r1-multitab-same", "E-fix-multitab-same", "G-r2-multitab-same"] if ALL.get(s)]})
write("account-switch", {"sessions": [summary(ALL[s], ("A", "B", "A2", "afterLogout", "afterLogoutHud", "sa", "sb")) for s in ["AB-r1-switch", "CF-r2-switch"] if ALL.get(s)]})
write("ledger-reconciliation", {"at": rec.get("at"), "readOnly": True, "allOk": all(r["ledger"]["ok"] for r in rec.get("rows", [])), "rows": [{"persona": r["persona"], "account": r["account"], **r["ledger"]} for r in rec.get("rows", [])]})
write("inventory-reconciliation", {"at": rec.get("at"), "readOnly": True, "rule": "alta (3 Iniciales + 1 Bronce) + compras (1 por buy_pack) + recompensas reclamadas (pase/misiones con sobre) − aperturas (open_pack) = user_packs", "allOk": all(r["inventory"]["ok"] and r["cards"]["ok"] and r["progression"]["ok"] for r in rec.get("rows", [])), "rows": [{"persona": r["persona"], "account": r["account"], "inventory": r["inventory"], "cards": r["cards"], "progression": r["progression"]} for r in rec.get("rows", [])]})
write("security-smoke", load("security-smoke") or {})
perf = ALL.get("E-r2-perf") or {}
write("performance", {"requestBudget": {"avgApiPerScreen": perf.get("avgApi"), "home": perf.get("home"), "f64": 9.3, "f67": 9.5, "routes": perf.get("routes"), "totals": perf.get("totals")},
  "journeyTimings": {"packOpenMs": [o.get("ms") for s in ("B-r1-store", "C-r1-store", "B-fix-store") for o in ((ALL.get(s) or {}).get("opens") or [])], "collectionLoadMs": (ALL.get("B-r1-collection") or {}).get("loadMs"),
    "slowNetTimings": {s: (ALL.get(s) or {}).get("timings") for s in ("C-r1-slownet", "G-r2-slownet")}, "rankedQueueMs": [m.get("queueMs") for s in SESSIONS if s.endswith("-ranked") for m in ALL[s].get("matches", [])],
    "pveMatchMs": [m.get("ms") for s in ("B-r1-pve", "B-r2-pve") for m in ((ALL.get(s) or {}).get("matches") or [])], "guideSeconds": {s: ALL[s].get("guideSeconds") for s in SESSIONS if s.endswith("-new")}},
  "longSession": {k: (ALL.get("A-r1-long") or {}).get(k) for k in ("samples", "growth", "toasts0", "toasts1", "audio", "sessionAlive")}})
print("evidencia compilada:", len(SESSIONS), "sesiones")

# ─────────── gates y estado ───────────
def txt(name):
    p = os.path.join(os.environ.get("F68_SCRATCH", ""), name)
    return open(p, encoding="utf-8", errors="replace").read() if os.path.exists(p) else ""
integ = txt("integrity-final.txt")
kv = dict(l.split("=", 1) for l in integ.splitlines() if "=" in l and not l.startswith("bucket") and " " not in l.split("=", 1)[0])
write("integrity", {"source": "scripts/ops/audit-readonly.sql (F67) en sesión read-only, tras la beta", "checks": {k: kv.get(k) for k in ["negative_credits", "admins", "user_cards_unknown_card", "duplicate_serials", "users_in_two_live_pvp", "live_pvp_overdue_5min", "self_matches", "finished_without_result", "pvp_settled_twice", "ledger_dup_ref", "queue_matched_orphan", "queue_active_per_user_gt1", "active_deck_missing", "pve_in_progress_older_7d"]},
  "schema": {"public_tables": kv.get("public_tables"), "migrations_registered": kv.get("migrations_registered")}, "users": {"auth_users": kv.get("auth_users"), "qa_like_users": kv.get("qa_like_users"), "delta_vs_f67": "18 → 27 (+9 cuentas QA nuevas de F68)"},
  "anomalies": 0, "qaResidue": {"pve_in_progress": 0, "pvp_live": 0, "queue_active": 0, "draft_runs_open": {"READY": 1, "note": "run de D a mitad de gauntlet (estado normal de jugador)"}, "coach_matches": 3, "friendships": "1 (D–C aceptada)"},
  "userAccountToday": {"credit_transactions": 0, "user_cards": 0, "duel_matches": 0, "duel_decks": 0, "economy_ops": 0, "note": "prefijo 2f86cbe8, recuentos desde 2026-09-27T09:40Z"}})
pc = txt("prodcheck-final.txt")
write("production-check", {"command": "npm run production:check -- --app --vps", "build": "drl-0.1.1-1-9792433c",
  "result": [l for l in pc.splitlines() if re.match(r"^(PASS|FAIL|WARN) ", l)], "summary": next((l for l in pc.splitlines() if "PASS ·" in l), None),
  "onlyFail": "backup-offsite (BLOCKED externo, igual que F67)"})
sm = txt("smoke-final.txt")
write("smoke", {"command": "npm run smoke:production", "result": next((l for l in sm.splitlines() if "OK" in l and "/" in l and l.strip()[0].isdigit()), None), "lines": [l for l in sm.splitlines() if l.startswith("OK ") or l.startswith("FAIL")]})
write("baseline", {"at": "2026-09-27T09:47Z", "tests": 5334, "cards": 331, "agents": 29, "migrationHead": "0057_admin_cms", "next": "16.3.6", "marketplace": "OFF", "payments": "OFF", "listen": "127.0.0.1:3005",
  "build": "drl-0.1.1-1-abdcaffc (F67)", "productionCheck": "24 PASS · 0 WARN · 1 FAIL (backup-offsite)", "smoke": "67/67 (F67)", "proposal0058": "PROPUESTA, no aplicada",
  "publicBlockers": ["off-site backup", "dominio + HTTPS", "SMTP real", "commit/estado reproducible"], "environment": "Docker local desinstalado; BD real en el VPS por túnel SSH 54521/54522; app local next start"})
write("known-issues", {
  "betaLimitations": [
    "Correo: GoTrue con SMTP Inbucket y autoconfirmación: los enlaces de recuperación/confirmación no llegan a un buzón real (la pantalla dice «Te enviamos un enlace»).",
    "Registro con un correo ya usado dice «Ya hay una cuenta con ese correo» (GoTrue con autoconfirmación revela existencia en el registro; el login no enumera).",
    "Una sola instancia de la app en un PC con Windows, sin gestor de procesos; depende del túnel SSH.",
    "Carga limitada por el túnel (~60 RPS medidos en F67).",
    "Marketplace y pagos desactivados por diseño (flags de código).",
    "Pick'ems depende del worker esports del VPS (cron); predicciones solo en eventos abiertos.",
  ],
  "publicReleaseBlockers": ["Copia de backups fuera del VPS (production:check FAIL backup-offsite)", "Dominio + HTTPS", "SMTP real + callbacks/SITE_URL de GoTrue", "Consolidar el trabajo en commits/etiqueta (árbol con >1.300 cambios sin commit)", "Decisión sobre la propuesta 0058 (profiles legible por anon con todas sus columnas)"],
  "balanceProposals": ["F65 P-1…P-4 sin aplicar (F68 no cambia balance). Evidencia beta: Coach Normal con decisiones al azar → 0–13 y 1–13; PvE Difícil gana con claridad al jugador casual (2–8, 3–7); autocompletar sigue siendo válido pero no óptimo (F65)."],
  "economyObservations": ["Un sobre de bienvenida puede traer una carta legendaria y el logro «Consigue una leyenda» paga 10.000 (cuenta I: 6.160 → 19.790 en la primera sesión). Es diseño F57.6, no una fuente nueva; se anota para la próxima revisión de economía."],
  "bugsOpen": [b for b in BUGS if b["status"] != "FIXED"],
})
print("gates y estado escritos")
