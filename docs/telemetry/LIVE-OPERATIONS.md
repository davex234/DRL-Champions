# NEXUS Live Operations

> FASE 14, bloque 6. La consola privada de operaciones.
> Ruta: **`/admin/operations`** · API: `GET /api/admin/operations?window=24h|7d|30d`
> Verificación: `npm run operations:verify` (33/33) ·
> `npx tsx scripts/_fase14-qa-operations.ts` (28/28)

---

## 1. Propósito

**No es un panel de analítica. Es la pantalla que se abre cuando alguien pregunta «¿está
pasando algo?»**, y tiene que responder en segundos y sin desplazarse.

Por eso el orden de las secciones no es el de importancia de negocio, es el de urgencia:

| # | sección | responde |
|---|---|---|
| 1 | **Estado** | ¿hay alguien dentro y hay algo roto? |
| 2 | **Errores** | qué falla, agrupado, y en qué versión |
| 3 | **Primera experiencia** | dónde se cae el jugador nuevo |
| 4 | **Duelos** | ¿se terminan las partidas? |
| 5 | **Actividad** | DAU/WAU y sesiones |
| 6 | **Zonas** | qué se usa de verdad |
| 7-8 | **Pick'ems y Mercado** | los dos ciclos secundarios |

---

## 2. Por qué no se reutilizó `/admin/live`

`/admin/live` existe y se llama «Live», pero es el **Live Ecosystem**: el orquestador de
contenido (torneos → cartas → noticias → mercado) con proveedores simulados. No tiene nada
que ver con jugadores.

**No se ha tocado.** La consola de operaciones vive en `/admin/operations`, que es una ruta
nueva. Compartir la ruta habría mezclado dos cosas que solo comparten una palabra.

---

## 3. Autorización

```
sin sesión            → 401   "No autenticado"
con sesión, sin admin → 403   "Acceso restringido"
administrador         → 200   snapshot
```

**La seguridad real es `verifyAdmin(req)`:** Bearer de Supabase Auth → usuario →
`profiles.is_admin` comprobado con `service_role`. Esa columna está protegida por el
trigger `SEC-02` (migración 0009), así que un jugador no puede concedérsela.

**`ADMIN_ENABLED` no protege nada.** Lee `NEXT_PUBLIC_ADMIN`, una variable que llega al
navegador y se incrusta en tiempo de compilación. Sirve para ocultar la pantalla; la ruta
de datos ni la mira.

**Se distinguen 401 y 403 a propósito.** Las rutas admin anteriores del proyecto devuelven
401 en los dos casos; aquí se separan porque son cosas distintas —«no sé quién eres» y «sé
quién eres y no puedes»— y la pantalla necesita saber cuál para decir lo correcto. Ninguno
devuelve ni un dato.

**El mensaje de 403 no revela** si el token era inválido o si al usuario le falta el
permiso: distinguirlo serviría para averiguar quién es administrador.

Verificado, incluido el caso decisivo: quitando `profiles.is_admin`, **el mismo token pasa
de 200 a 403**. La autorización es el estado de la base de datos, no una constante.

---

## 4. Lo que el cliente NO puede elegir

| intento | resultado |
|---|---|
| `?window=24h\|7d\|30d` | Aceptado — son las **únicas** tres |
| `?window=' OR 1=1--` | Cae en `24h`. No llega a la consulta |
| `?from=1990-01-01` | Ignorado. **No hay rango de fechas arbitrario** |
| `?user_id=<otro>` | Ignorado, y no aparece en la respuesta |
| `?environment=production` | Ignorado |

Un rango libre desde el navegador es una consulta libre contra la base de datos. El MVP
tiene tres ventanas cerradas y ningún selector de fechas.

---

## 5. Arquitectura

```
/admin/operations  (cliente)
   │  una sola petición, con el Bearer
   ▼
GET /api/admin/operations   ← verifyAdmin
   ▼
getOperationsSnapshot()     ← services/operations.ts  (orquesta y etiqueta)
   ▼
services/analytics.ts       ← envoltorio tipado
   ▼
11 funciones SQL (migración 0030)
   ▼
tablas autoritativas + telemetry_events
```

**Aquí no se calcula ninguna métrica.** `operations.ts` orquesta y etiqueta; no suma, no
promedia, no deriva. Si un número no cuadra, hay un solo sitio donde mirar.

**No se crea ninguna fuente de verdad.** El componente no toca ninguna tabla.

---

## 6. Frescura: es una foto, no «en directo»

La consola **no dice LIVE**, porque no hay streaming. Dice:

> *Foto del producto · actualizada hace **6 s** · construida en **26 ms***

- Refresco manual con el botón **Actualizar**.
- Refresco automático cada **60 s**. No hay websocket ni infraestructura de tiempo real.
- El tiempo transcurrido corre en pantalla, así que nadie puede confundir un dato viejo con
  uno nuevo.
- El tiempo de construcción se enseña porque **también es salud**: si el snapshot empieza a
  tardar, se ve antes de que se convierta en un problema.

---

## 7. Ventanas y cobertura

Cada sección declara su ventana. **No se mezclan sin decirlo:**

| sección | ventana |
|---|---|
| Estado, FTUE, Duelos, Actividad, Zonas, Pick'ems, Mercado | la elegida (24 h / 7 d / 30 d) |
| **Errores** | **siempre 24 h**, sea cual sea la elegida |

Los errores no siguen la ventana global a propósito: la pregunta de esa sección es «¿algo
está roto **ahora**?», y con 30 días un fallo de hace tres semanas ya resuelto enterraría
el de hace diez minutos. La pantalla lo dice al lado del título.

### Cobertura de telemetría

El snapshot trae `coverage.telemetrySince`: la fecha del primer evento registrado.

**Una métrica que depende de la telemetría y cae fuera de esa cobertura no se pinta como
cero: se pinta como «SIN COBERTURA».** Sin esa distinción, una consola recién instalada
parecería un producto muerto.

En el embudo de primera experiencia, cada paso lleva su insignia —**retroactivo** o
**telemetría**— y al pie se lee: *«Los pasos de telemetría solo cubren desde 06/09/2026.
Los marcados retroactivo valen para cualquier fecha.»*

---

## 8. Las tres reglas de honestidad de la pantalla

**1. No dice «en directo».** §6.

**2. Un cero ambiguo no se enseña como cero.** §7. Los vacíos se dicen con palabras
(«SIN DATOS», «Ninguna partida empezada en esta ventana»), nunca con un `0` grande que se
leería como un dato medido.

**3. Lo inferido se dice inferido.**

| en pantalla | significa |
|---|---|
| **Abandono estimado** | Partidas `IN_PROGRESS` sin actividad desde hace 24 h. **Es una inferencia**, no un evento: no existe `duel_abandoned` y no existirá. Un jugador puede volver mañana |
| **Duración mediana · cota inferior** | `max − min` de los eventos de la sesión. **No es la duración**: `session_ended` se rechazó porque cerrar el navegador o perder la red no avisan, y emitirlo solo en cierres limpios daría un dato sesgado |
| **Duración mediana (duelos)** | Esta **sí es exacta**: el duelo empieza y acaba con escrituras en `duel_matches` |
| **Usuarios / Sesiones / Entradas** | Tres cifras que **no se suman**. Un jugador entra once veces en el mercado: una persona, once entradas |
| **Mixtas** | Sesiones que empezaron anónimas y siguieron autenticadas. Es el tramo previo al registro |

---

## 9. Fallo parcial

Las nueve consultas van en paralelo y **cada una puede fallar por su cuenta**. Si el
mercado revienta, el mercado dice «No disponible · el resto de la consola sigue
funcionando» y las otras ocho secciones siguen ahí.

El tipo lo obliga: cada bloque llega como `{ok:true, data} | {ok:false, error}`, así que la
pantalla no puede pintar un cero sin enterarse de que hubo un fallo.

Es la diferencia entre una sala de control y un informe: cuando algo va mal —que es justo
cuando se abre esta pantalla— lo último que debe pasar es que la consola se caiga porque
una métrica secundaria no responde.

---

## 10. Errores y versión

Agrupados **por huella**: veinte apariciones del mismo fallo son una fila con
`2 VECES · 1 USUARIOS`, no veinte filas.

Cada grupo muestra: severidad · código · apariciones · usuarios · zona · flujo · origen ·
**versión** · un ejemplo del mensaje (ya saneado por el endpoint de ingestión).

**La versión es lo que responde «¿esto solo pasa en la nueva?»**, que es la pregunta real
cuando algo empieza a fallar.

Si hay un error `critical`, el bloque de Estado cambia de tono y muestra una insignia
pulsante con el número. **Solo visualización: no hay alertas, ni correo, ni Telegram, ni
notificaciones.**

---

## 11. Privacidad

El snapshot es **exclusivamente agregado**. Verificado por barrido del JSON completo:

| no contiene | comprobado |
|---|---|
| Direcciones de correo | ✅ |
| Identificadores de usuario | ✅ |
| Tokens, cookies, cabeceras | ✅ |
| Direcciones IP, `user agent` | ✅ |
| Recorridos individuales | ✅ |

**No hay buscador de jugadores, ni fichas individuales, ni línea de tiempo personal.** La
función `analytics_session_journey` existe en SQL pero **no se expone en esta consola**:
tiene la ejecución revocada a PUBLIC y no hay ninguna ruta que la llame.

---

## 12. Diseño

Sistema de diseño de la casa, sin inventar otro: `Stage`, `Plate`, `Recessed`, `Rail`,
`Readout`, `Badge`, `Meter`, `SectionTitle`, `NxButton`, `Segmented`.

Medido en la pantalla renderizada: **10 primitivas** con `data-surface`, **35 chaflanes**,
**0 cápsulas decorativas**, **0 focalizables sin nombre**.

*(La barra `Meter` y el punto de estado de `Badge` son redondos por definición y no cuentan
como cápsulas decorativas: uno es una barra de progreso y el otro un punto.)*

### Móvil

Verificado a **390 px**: cero desbordamiento horizontal, tarjetas apiladas, las nueve
secciones presentes, errores legibles con su versión, cero errores de consola.

La tabla de zonas es lo único que puede necesitar desplazamiento lateral, y lo hace
**dentro de su propio contenedor** (`overflow-x: auto`), nunca en la página.

---

## 13. Rendimiento

| medida | valor |
|---|---|
| Construcción del snapshot | **17-26 ms** |
| Peticiones desde el cliente | **1** |
| Consultas SQL | 9 en paralelo + 1 de cobertura |
| Refresco automático | 60 s |

Nueve consultas en paralelo, no diez peticiones desde React. El tiempo se enseña en
pantalla.

**Umbral a vigilar:** `analytics_active_users` medía 376 ms con 60 000 filas y una ventana
de 30 días (deuda **D-AN-1**). Con la retención de 90 días y ~1,4 M de filas escalaría mal.
La solución, cuando toque, es una tabla diaria de agregados — **no se crea ahora**, y el
tiempo visible en la cabecera es el aviso.

---

## 14. Limitaciones

| límite | detalle |
|---|---|
| **No es tiempo real** | Es una foto cada 60 s. No hay websocket |
| **No hay alertas** | Si nadie mira la pantalla, nadie se entera. Solo visualización |
| **Media consola depende de la telemetría** | Actividad, sesiones, zonas y errores existen desde la Fase 14. Los embudos que salen de tablas autoritativas son retroactivos |
| **`ftue_started` no es retroactivo** | Para cohortes anteriores sale «SIN COBERTURA» (D-AN-2) |
| **Retención no está en la consola** | Las cohortes existentes salen `no medibles`, así que enseñarlas sería enseñar ceros. La consulta existe (`analytics_retention`); la sección se añadirá cuando haya datos que enseñar |
| **El manejador global nunca emite `critical`** | Desde `window.onerror` no se sabe el flujo (D-ING-5). Los críticos vienen de emisiones explícitas |
| **`environment` no separa despliegues** | `next start` local escribe `production` (D-ING-6) |
| **La consola es agregada** | Sin fichas de jugador, por diseño |

---

## 15. Deuda técnica

| id | deuda |
|---|---|
| **D-OPS-1** | Sin sección de retención: las cohortes actuales no son medibles y mostrarlas sería mostrar ceros |
| **D-OPS-2** | El refresco es polling de 60 s. Con más volumen convendría refrescar solo lo que cambia |
| **D-OPS-3** | `analytics_flows` se pide y no se pinta: con un solo flujo instrumentado no aporta una sección propia |
| **D-AN-1** | `analytics_active_users` escalará mal (§13) |
| **D-ING-5** | El manejador global nunca marca `critical` |
| **D-ING-6** | `NODE_ENV` no distingue portátil de despliegue |

---

*Métricas: [`METRICS.md`](METRICS.md) · embudos: [`FUNNELS.md`](FUNNELS.md) ·
ingestión: [`INGESTION.md`](INGESTION.md) · modelo: [`DATA-MODEL.md`](DATA-MODEL.md).*
