/**
 * EL CONTRATO DE TELEMETRÍA — pruebas puras (Fase 14, bloque 4).
 *
 * Aquí no hay red ni base de datos: se prueba la parte del contrato que decide **qué se
 * puede mandar y qué se descarta**, que es la que protege de verdad. La barrera final
 * sigue siendo la base de datos (`telemetry-verify.ts`), y estas pruebas no la sustituyen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ZONES, EVENT_NAMES, FLOWS, zoneFromPath, sanitizeMetadata, sanitizeString,
  shapeError, isZone, isEventName, LIMITS, METADATA_WHITELIST, SESSION_IDLE_MS,
} from "./contract";

// ═══════════════════════ RUTA → ZONA ═══════════════════════

test("cada ruta de jugador cae en su zona, y todas las zonas son válidas", () => {
  const esperado: [string, string][] = [
    ["/", "home"],
    ["/inventario", "inventory"],
    ["/tienda", "store"],
    ["/tienda/creditos", "store"],
    ["/abrir/inicial", "pack_ceremony"],
    ["/coleccion", "collection"],
    ["/colecciones", "collections"],
    ["/colecciones/champions-paris", "collections"],
    ["/mercado", "market"],
    ["/duelos", "duel_hub"],
    ["/duelos/jugar", "duel_play"],
    ["/duelos/mazos", "deck_list"],
    ["/duelos/replay/abc-123", "duel_replay"],
    ["/torneos", "tournaments"],
    ["/torneos/vlr-2976-emea-stage-2", "tournament_detail"],
    ["/pickems", "pickems"],
    ["/logros", "pass"],
    ["/recompensas", "rewards"],
    ["/ranking", "ranking"],
    ["/cuenta", "account"],
    ["/eventos", "events"],
    ["/entrenador", "trainer"],
    ["/entrenador/mapas", "trainer_maps"],
    ["/entrenador/strats", "trainer_strats"],
    ["/entrenador/strats/revisar", "trainer_strats"],
    ["/entrenador/partido", "trainer_match"],
    ["/entrenador/equipos", "trainer_teams"],
    ["/carrera", "career"],
    ["/noticias", "news"],
    ["/mundo", "world"],
    ["/manager", "manager"],
    ["/launcher", "launcher"],
  ];
  for (const [ruta, zona] of esperado) {
    assert.equal(zoneFromPath(ruta), zona, `${ruta} debería ser ${zona}`);
    assert.ok(isZone(zoneFromPath(ruta)), `${zona} no está en el enum`);
  }
});

test("las rutas dinámicas se normalizan: el identificador nunca llega a viajar", () => {
  // Dos torneos distintos son la MISMA zona. Ese es todo el punto de usar zonas.
  assert.equal(zoneFromPath("/torneos/aaa"), zoneFromPath("/torneos/bbb"));
  assert.equal(zoneFromPath("/colecciones/x"), zoneFromPath("/colecciones/y"));
  assert.equal(zoneFromPath("/abrir/inicial"), zoneFromPath("/abrir/premium"));
});

test("la consulta, el ancla y la barra final se descartan antes de mirar la ruta", () => {
  assert.equal(zoneFromPath("/coleccion?token=ey.secreto&x=1"), "collection");
  assert.equal(zoneFromPath("/coleccion#seccion"), "collection");
  assert.equal(zoneFromPath("/coleccion/"), "collection");
  assert.equal(zoneFromPath("/"), "home");
  assert.equal(zoneFromPath(""), "home");
});

test("una ruta desconocida cae en `other`, no se pierde ni revienta", () => {
  assert.equal(zoneFromPath("/una-ruta-que-no-existe"), "other");
  assert.equal(zoneFromPath("/design-system"), "other");
});

test("zoneFromPath nunca devuelve algo fuera del enum, ni con basura", () => {
  for (const entrada of ["", "/", "///", "/../..", "/%00", "/a/b/c/d/e/f"]) {
    assert.ok(isZone(zoneFromPath(entrada)), `${JSON.stringify(entrada)} salió del enum`);
  }
});

// ═══════════════════════ LISTA BLANCA ═══════════════════════

test("una clave fuera de la lista blanca se descarta en silencio", () => {
  const out = sanitizeMetadata("zone_entered", {
    from_zone: "home",
    is_first_of_session: true,
    // Nada de esto está en la lista blanca de `zone_entered`.
    user_id: "00000000-0000-4000-8000-000000000000",
    access_token: "ey.secreto",
    email: "alguien@ejemplo.com",
  });
  assert.deepEqual(Object.keys(out).sort(), ["from_zone", "is_first_of_session"]);
});

test("la lista blanca es por evento: la clave válida de uno no vale en otro", () => {
  // `code` es de `error_captured`, no de `session_started`.
  assert.deepEqual(sanitizeMetadata("session_started", { code: "X" }), {});
  assert.deepEqual(sanitizeMetadata("error_captured", { code: "X" }), { code: "X" });
});

test("cada evento declara su lista blanca y ninguna está vacía", () => {
  for (const e of EVENT_NAMES) {
    assert.ok(METADATA_WHITELIST[e], `${e} sin lista blanca`);
    assert.ok(METADATA_WHITELIST[e].length > 0, `${e} con lista blanca vacía`);
  }
});

test("los valores anidados se descartan enteros: profundidad uno, sin excepciones", () => {
  const out = sanitizeMetadata("error_captured", {
    code: "BOOM",
    // Un objeto anidado es justo por donde entraría un volcado de estado.
    message: { nested: "secreto" },
    fingerprint: ["a", "b"],
  });
  assert.deepEqual(out, { code: "BOOM" });
});

test("solo pasan cadenas, números finitos y booleanos", () => {
  const out = sanitizeMetadata("session_started", {
    entry_zone: "home",
    referrer_kind: "direct",
    viewport: Number.NaN,          // no finito: fuera
  });
  assert.deepEqual(out, { entry_zone: "home", referrer_kind: "direct" });
});

test("una metadata que no es un objeto devuelve un objeto vacío, no revienta", () => {
  for (const basura of [null, undefined, 42, "hola", [1, 2, 3], true]) {
    assert.deepEqual(sanitizeMetadata("zone_entered", basura), {});
  }
});

// ═══════════════════════ SANEADO DE SECRETOS ═══════════════════════

test("un JWT se redacta esté donde esté dentro del mensaje", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcdefghijk";
  const out = sanitizeString(`fallo al validar ${jwt} en la petición`);
  assert.ok(!out.includes(jwt), "el JWT sobrevivió");
  assert.ok(out.includes("[REDACTED_JWT]"));
});

test("un JWT con firma CORTA también se redacta (lo encontró el QA del bloque 4)", () => {
  // La primera versión de la expresión exigía cuatro caracteres por bloque y dejaba pasar
  // este. Un token corto sigue siendo un token.
  const corto = "eyJhbGciOiJIUzI1NiJ9.eyJzIjoxfQ.zzz";
  const out = sanitizeString(`fallo con token ${corto} dentro`);
  assert.ok(!out.includes("eyJhbGciOiJIUzI1NiJ9"), `sobrevivió: ${out}`);
  assert.ok(out.includes("[REDACTED_JWT]"));
});

test("Bearer, claves de API, correos y UUID se redactan", () => {
  assert.ok(sanitizeString("Authorization: Bearer abc123def456ghi").includes("[REDACTED"));
  assert.ok(sanitizeString("usa sk_live_abcd1234efgh").includes("[REDACTED_KEY]"));
  assert.ok(sanitizeString("de alguien@ejemplo.com").includes("[REDACTED_EMAIL]"));
  assert.ok(sanitizeString("id 3f2504e0-4f89-41d3-9a0c-0305e82c3301").includes("[REDACTED_UUID]"));
});

test("una consulta se descarta y el camino se conserva", () => {
  const out = sanitizeString("falló https://api.ejemplo.com/v1/cosa?token=abc&u=1");
  assert.ok(!out.includes("token=abc"), "la consulta sobrevivió");
  assert.ok(out.includes("https://api.ejemplo.com/v1/cosa"));
});

test("las rutas absolutas del sistema de ficheros y las IP se redactan", () => {
  assert.ok(sanitizeString("en C:\\Users\\david\\secreto\\app.js").includes("[REDACTED_PATH]"));
  assert.ok(sanitizeString("en /home/david/app/x.js").includes("[REDACTED_PATH]"));
  assert.ok(sanitizeString("desde 192.168.1.44").includes("[REDACTED_IP]"));
});

test("se redacta ANTES de truncar: truncar primero partiría el patrón", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcdefghijk";
  // El token va más allá del corte, así que si se truncara antes quedaría a medias.
  const out = sanitizeString(`${"x".repeat(LIMITS.maxStringLength - 10)} ${jwt}`);
  assert.ok(!out.includes("eyJhbGciOiJIUzI1NiJ9"), "quedó un trozo de token");
});

test("las cadenas se truncan al límite del contrato", () => {
  const out = sanitizeString("a".repeat(5000));
  assert.ok(out.length <= LIMITS.maxStringLength + 1, `longitud ${out.length}`);
});

test("una metadata enorme se recorta hasta caber, en vez de perderse entera", () => {
  const out = sanitizeMetadata("error_captured", {
    code: "BOOM",
    message: "y".repeat(4000),
    fingerprint: "abc",
  });
  const bytes = new TextEncoder().encode(JSON.stringify(out)).length;
  assert.ok(bytes <= LIMITS.maxBytes, `${bytes} bytes supera el techo`);
});

test("el techo del contrato es más estricto que el CHECK de la base de datos", () => {
  // 2048 es el `pg_column_size` de la migración 0029. El contrato deja margen.
  assert.ok(LIMITS.maxBytes < 2048);
});

// ═══════════════════════ COHERENCIA ENTRE CAMPOS ═══════════════════════

test("cada evento exige exactamente sus campos", () => {
  assert.equal(shapeError({ event_name: "session_started" }), null);
  assert.equal(shapeError({ event_name: "zone_entered", zone: "home" }), null);
  assert.equal(shapeError({ event_name: "flow_started", flow: "deck_builder" }), null);
  assert.equal(
    shapeError({ event_name: "error_captured", source: "client", severity: "error" }),
    null,
  );
});

test("una fila incoherente se rechaza con un motivo legible", () => {
  assert.ok(shapeError({ event_name: "zone_entered" }));                       // sin zona
  assert.ok(shapeError({ event_name: "flow_started" }));                       // sin flujo
  assert.ok(shapeError({ event_name: "error_captured", source: "client" }));   // sin severidad
  assert.ok(shapeError({ event_name: "error_captured", severity: "error" }));  // sin origen
  // Un cambio de zona con severidad no significa nada: se rechaza.
  assert.ok(shapeError({ event_name: "zone_entered", zone: "home", severity: "critical" }));
  assert.ok(shapeError({ event_name: "session_started", flow: "deck_builder" }));
});

// ═══════════════════════ CONJUNTOS CERRADOS ═══════════════════════

test("los conjuntos cerrados no aceptan nada inventado", () => {
  assert.ok(isEventName("session_started"));
  assert.ok(!isEventName("pack_opened"));      // es DERIVED: no se almacena
  assert.ok(!isEventName("session_ended"));    // rechazado en la taxonomía
  assert.ok(isZone("home"));
  assert.ok(!isZone("/coleccion"));            // una ruta no es una zona
  assert.ok(!isZone("HOME"));
});

test("la taxonomía sigue siendo exactamente cuatro eventos y cuatro flujos", () => {
  // Si alguien añade uno sin pasar por una migración, esto se rompe a propósito.
  assert.equal(EVENT_NAMES.length, 4);
  assert.equal(FLOWS.length, 4);
  assert.equal(ZONES.length, 30);
});

test("la ventana de sesión es de 30 minutos, como se aprobó", () => {
  assert.equal(SESSION_IDLE_MS, 30 * 60 * 1000);
});
