# NEXUS — MAPA DEL CICLO DE JUEGO

> Levantado por observación del producto en ejecución, no por diseño.
> Fase 13 · 2026-09-06 · instrumentos `scripts/_fase13-loop-audit.ts` y
> `scripts/_fase13-transiciones.ts`

Todo lo que aparece aquí **existe**. Lo que falta se marca como hueco y no se dibuja como
si estuviera.

---

## EL CICLO PRINCIPAL

```
                              ┌──────────────────────────────┐
                              │  ENTRAR  ·  /                │
                              │  GameShell: nivel + créditos │
                              └──────────────┬───────────────┘
                                             │
                    ┌────────────────────────▼────────────────────────┐
                    │  ¿QUÉ HAGO AHORA?                               │
                    │  GET /api/game/loop → NextUp                    │
                    │  Server-authoritative. Los pasos se ORDENAN:    │
                    │   0 · abrir sobres  (si tienes 0 cartas)        │
                    │   1 · retomar duelo (partida a medias)          │
                    │   2 · predecir      (caduca)                    │
                    │   3 · reclamar      (ya te lo ganaste)          │
                    │   4 · abrir sobres  (caso normal)               │
                    │   5 · construir mazo                            │
                    │   6 · jugar duelo                               │
                    │   7 · seguir el circuito                        │
                    └────────────────────────┬────────────────────────┘
                                             │
        ┌────────────────┬───────────────────┼───────────────────┬────────────────┐
        ▼                ▼                   ▼                   ▼                ▼
   ┌─────────┐    ┌────────────┐      ┌────────────┐     ┌────────────┐   ┌───────────┐
   │ CICLO   │    │  CICLO     │      │  CICLO     │     │  CICLO     │   │  CICLO    │
   │ CARTA   │    │  DUELO     │      │ COMPETITIVO│     │ PROGRESIÓN │   │ ECONOMÍA  │
   └────┬────┘    └─────┬──────┘      └─────┬──────┘     └─────┬──────┘   └─────┬─────┘
        │               │                   │                  │                │
        └───────────────┴─────────┬─────────┴──────────────────┴────────────────┘
                                  ▼
                     ┌────────────────────────────┐
                     │  app_grant_reward (RPC)    │
                     │  UNA sola puerta, con      │
                     │  clave de idempotencia     │
                     │  → créditos · XP · puntos  │
                     └────────────┬───────────────┘
                                  ▼
                     ┌────────────────────────────┐
                     │  profiles.{credits,xp,     │
                     │            points}         │
                     │  + credit_transactions     │
                     │    (libro mayor trazable)  │
                     └────────────┬───────────────┘
                                  ▼
                     ┌────────────────────────────┐
                     │  GameShell repinta nivel   │
                     │  y créditos EN TODAS las   │
                     │  pantallas (16-17 de 18)   │
                     └────────────┬───────────────┘
                                  │
                                  └──────► vuelve a /api/game/loop
```

**El ciclo principal está CERRADO.** Cada acción con recompensa pasa por la misma puerta
(`app_grant_reward`), escribe en el mismo sitio, y el resultado se ve sin recargar en el
armazón. Verificado por `loop:verify` a nivel de datos y por
`_fase13-transiciones.ts` a nivel de pantalla (abrir un sobre: XP 0 → 130, cartas 0 → 5,
sobres 4 → 3, todo en una sola acción del jugador).

---

## CICLO 1 · CARTA

```
   /tienda ──compra──┐
                     ▼
              user_packs (sobres)
                     │
                     ▼
   /inventario ──elige sobre──► /abrir/[packId]
                                      │
                            ┌─────────▼──────────┐
                            │  CEREMONIA         │
                            │  desliza para abrir│
                            │  revelado 1 a 1    │
                            │  ¡NUEVA! · valor   │
                            └─────────┬──────────┘
                                      ▼
                            openPackForUser()
                            → cartas + xpGained
                            → app_grant_reward
                                      │
                     ┌────────────────┼────────────────┐
                     ▼                ▼                ▼
              user_cards        profiles.xp      duplicados
                     │                │                │
                     ▼                ▼                ▼
              /coleccion        nivel sube       /mercado (vender)
              /colecciones                       forja / salvamento
              (progreso por                             │
               colección)                               ▼
                     │                            créditos
                     └────────────► ¿SIGUIENTE? ◄───────┘
```

**Estado: CERRADO con dos fugas.**

| fuga | dónde | efecto |
|---|---|---|
| «Abrir otro» del resumen lleva a `/tienda` | `PackOpeningExperience` | al que le quedan 3 sobres de bienvenida se le manda a COMPRAR |
| `/coleccion` con cartas: 0 salidas propias | `/coleccion` | tras el mejor momento del juego no se propone nada |

---

## CICLO 2 · DUELO

```
   10 cartas (2 por rol, sin repetir jugador)
                     │
                     ▼
   /duelos/mazos ──► DeckBuilder ──► validateDuelDeck (DOMINIO)
                     │                        │
                     │                   ¿válido?
                     │                    /      \
                     │                  no       sí
                     │                   │        │
                     ▼                   ▼        ▼
              «faltan N cartas»    (bloqueado)  duel_decks
                                                    │
                     ┌──────────────────────────────┘
                     ▼
   /duelos/jugar ──► dificultad (Fácil · Normal · Difícil)
                     │
                     ▼
              startMatch() ──► 10 turnos ──► playTurn()
                     │                          │
                     │                    Combat Resolver
                     │                      (DOMINIO)
                     ▼                          │
              duel_matches ◄───────────────────┘
                     │
                     ▼
              duelAward(outcome, difficulty)   ← TABLA 3×3, determinista
                     │
        ganar NORMAL: 14 pts · 220 cr · 110 XP
        ganar HARD:   22 pts · 350 cr · 180 XP
        perder:        0 pts ·  25-60 cr · 15-40 XP   (nunca resta)
                     │
                     ▼
              app_grant_reward (una vez por partida)
                     │
        ┌────────────┼────────────┬──────────────┐
        ▼            ▼            ▼              ▼
    points        credits        xp        ResultScreen
        │                                        │
        ▼                                  ┌─────┴──────────────────┐
   rankProgress()                          │ Jugar otra · Ver repet.│
   8 escalones                             │ Mis mazos · ‹ Duelos   │
        │                                  │ + /ranking + /logros   │
        ▼                                  └─────┬──────────────────┘
   /ranking                                      │
                                                 └──► vuelve al ciclo
```

**Estado: CERRADO.** El resultado del duelo es la pantalla con más salidas del producto
(4 acciones + 2 enlaces) y es la única que ofrece explícitamente «otra vez». La tabla de
recompensa es determinista, así que el marcador puede ENSEÑARLA sin guardarla, y quien la
concede lo hace bajo clave de idempotencia.

**Fuga:** el tramo `1 ≤ cartas ≤ 9`. El constructor solo avisa de los sobres sin abrir
cuando la colección está **exactamente vacía**. Con 5 cartas —el estado exacto tras abrir
un sobre de bienvenida— no hay ninguna indicación en ninguna pantalla.

---

## CICLO 3 · COMPETITIVO

```
   events (torneo real o demo)
        │
        ▼
   matches ──► pickem_questions (locks_at)
        │              │
        ▼              ▼
   /torneos      /pickems ──► submitPick ──► pickem_answers
        │                                          │
        │                                    partido termina
        │                                          │
        │                                          ▼
        │                                   resolveFinished()
        │                                   scoring (DOMINIO)
        │                                          │
        │                                          ▼
        │                                   puntos de Pick'em
        │                                          │
        │                          ┌───────────────┼───────────────┐
        │                          ▼               ▼               ▼
        │                    escalón de       profiles.points   /recompensas
        │                    recompensa            │            (el recibo)
        │                    (5 escalones)         ▼
        │                          │          rankProgress()
        │                          ▼               │
        │                   app_grant_reward       ▼
        │                                      /ranking
        └──────────────────────────────────────────┘
```

**Estado: CERRADO y comprensible.** `/pickems` dice a la vez: cuántas quedan, cuántos
puntos vale cada una, cuándo cierra, qué escalón llevas y cuánto falta para el siguiente.
Es la pantalla del producto que mejor explica su propio bucle.

`profiles.points` es una moneda **compartida** entre este ciclo y el de duelos. Es una
decisión deliberada y documentada (`duelRewards.ts`): por eso perder un duelo no resta.

---

## CICLO 4 · PROGRESIÓN

```
        ACCIÓN                        ¿QUÉ GENERA?
   ─────────────────────────────────────────────────────────
   abrir sobre        →  XP de cuenta (xpForCardRank por carta)
   ganar/perder duelo →  XP de cuenta + créditos + puntos
   acertar Pick'em    →  puntos + escalón de recompensa
   misiones (3 diarias + 2 semanales, sorteadas en servidor)
                      →  XP del PASE
        │
        ├──────────────► profiles.xp ──► levelFromXp() ──► NIVEL DE CUENTA
        │                                                  (armazón, 17/18 pantallas)
        │
        ├──────────────► PassState.xp ──► NIVEL DEL PASE
        │                                 3 carriles: libre · competitivo · premium
        │                                 30 niveles ── /logros
        │
        ├──────────────► profiles.points ──► rankProgress() ──► RANGO
        │                                    8 escalones ── /ranking
        │
        └──────────────► logros (achievements.ts) ──► /logros
```

**Estado: CERRADO, pero con DOS niveles distintos que se llaman igual.** El armazón dice
«NIVEL 11» (cuenta, de `profiles.xp`) y `/logros` dice «NIVEL 0 / 30» (pase, de
`PassState`). Son dos sistemas legítimos y deliberados —el código lo dice explícitamente:
«XP de cuenta (el nivel del perfil), no XP del pase»— pero conviven bajo la misma palabra
en la misma sección «PROGRESO».

**Hueco:** las misiones diarias existen y rotan, pero el ciclo del vestíbulo solo las
menciona cuando ya están **completas y sin reclamar**. Nadie le dice nunca a un jugador
«tienes tres misiones hoy». Es la razón de volver mañana que el producto tiene y no usa.

---

## CICLO 5 · ECONOMÍA

```
   ALTA ──► 6.000 créditos + 4 sobres      (credit_transactions: starter_grant)
        │
        ▼
   créditos ──┬──► /tienda ──► sobre ──► cartas
              │
              ├──► /mercado ──► comprar a otro jugador
              │                      │
              │                      ▼
              │                 su carta pasa a ser tuya
              │
              └──► /tienda/creditos (saldo y recibos)

   cartas ────┬──► duplicados ──► /mercado (vender) ──► créditos
              │
              └──► forja / salvamento ──► créditos

   TODO movimiento ──► credit_transactions (libro mayor, ref única)
```

**Estado: CERRADO y trazable.** Cada crédito tiene origen: el asiento inicial se escribe
en el alta con `ref = 'starter:<uuid>'`, y `app_adjust_credits` es idempotente por `ref`,
así que reintentar una petición de red nunca duplica saldo.

---

## CICLO 6 · SESIÓN

```
   PRIMERA SESIÓN                          SESIÓN RECURRENTE
   ──────────────────                      ──────────────────
   entrar                                  entrar
     │                                       │
     ▼                                       ▼
   «Abre tus sobres» (prioridad 0)         «Haz tus predicciones» (URGENTE, caduca)
     │                                       │
     ▼                                       ├─► «Reclama lo tuyo» (niveles/misiones/logros)
   ceremonia · cartas · XP                   ├─► «Retoma tu duelo» (partida a medias)
     │                                       ├─► «Juega un duelo» (siempre disponible)
     ▼                                       └─► «Hay partido en directo»
   colección crece                                  │
     │                                              ▼
     ▼                                        puntos · rango · pase
   ¿10 cartas? ──no──► abrir más                    │
     │ sí                                           ▼
     ▼                                        ¿por qué vuelvo mañana?
   construir mazo                             · torneos con fecha
     │                                        · predicciones que CADUCAN  ← la más fuerte
     ▼                                        · misiones diarias (existen, no se anuncian)
   primer duelo                               · pase de temporada
     │                                        · eventos con cuenta atrás
     ▼                                        · colecciones incompletas
   puntos · rango · XP                        · mercado (precios de otros jugadores)
```

**Razones REALES de volver que el producto ya tiene:** seis. La más fuerte —lo único que
se puede *perder*— son las predicciones con cierre, y es la única que el ciclo marca como
urgente. Las misiones diarias son la segunda más fuerte y no se anuncian.

---

## LO QUE NO EXISTE

No se dibuja porque no está. Documentado, **no implementado**:

- **Telemetría de producto.** No hay analítica de acciones, embudos ni errores de
  jugador. Cero integraciones. No se puede medir dónde se cae un jugador real.
- **Anuncio de misiones diarias** en el ciclo del vestíbulo.
- **PvP.** El duelo es contra un bot con tres dificultades. No hay emparejamiento.
- **Tutorial explícito.** La primera experiencia se guía por el orden de los pasos del
  ciclo, no por una secuencia enseñada.

---

*Verificación de la cadena de datos: `npm run loop:verify`.
Verificación de la cadena de pantallas: `npx tsx scripts/_fase13-loop-audit.ts`.*
