# DRL Champions 🃏

Videojuego de cartas coleccionables de esports de **Valorant**. Inspirado en FIFA
Ultimate Team, Pokémon TCG Pocket y NBA 2K MyTeam. Interfaz íntegramente en español.

> Estado: **v0.8 — DRL Data Engine**: pipeline autónomo que detecta torneos,
> genera cartas/eventos y los inserta en el juego (con fuente *mock* lista para
> demo y conector VLR enchufable). Sobre la plataforma online (Supabase), admin,
> PWA, eventos, cartas premium, mercado y apertura de sobres.

## 🚀 Cómo ejecutar

```bash
npm install
npm run dev      # http://localhost:3000 (el service worker NO se registra en dev)
npm run build    # build de producción
npm run start    # sirve la build — necesario para probar PWA/offline/instalación
npm run typecheck
node scripts/generate-icons.mjs   # regenera los iconos PWA (sin dependencias)
```

> **Probar la instalación**: `npm run build && npm run start`, abre
> `http://localhost:3000` en Chrome/Edge → aparece el botón **Instalar**.
> En iPhone (Safari): Compartir → «Añadir a pantalla de inicio».

## 🎮 Qué hay implementado

- **Cartas premium por capas** (`CardRenderer`): Plantilla + Foto jugador + Logo
  equipo + Bandera + OVR + Stats + Serial + Nombre, construidas dinámicamente.
  Soporte de imágenes reales (PNG) con fallback a silueta/monograma. Efectos por
  rareza (metal pulido, reflejos dorados, partículas Winner, aura MVP, rayos
  legendarios, holo Icon). Vista de **inspección** completa (`CardInspector`).
- **Sistema de cartas**: jugador × variante, OVR calculado, 28 variantes
  (Bronce → Icon), números de serie premium en cartas especiales; el serial bajo
  multiplica el valor (≈5× en #1).
- **Apertura de sobres** (la característica estrella), con sus 4 fases:
  1. Sobre flotante en 3D con reflejos, luces y partículas.
  2. Corte **manual** deslizando ratón/dedo (la línea de corte sigue el gesto).
  3. Flash de luz + explosión de partículas + sonido sintetizado.
  4. Revelado carta a carta con flip 3D y **animación según rareza**
     (confeti para Winner, rayos cinematográficos para MVP/Icon...).
- **Tienda** de 11 sobres con probabilidades y precios distintos.
- **Colección**: rejilla del catálogo completo con búsqueda, filtros (región,
  grupo, posesión), orden y % completado. Modal de detalle por carta.
- **Inventario**: sobres sin abrir + gestión de duplicados con venta masiva.
- **Economía**: DRL Credits, valor de mercado (según OVR, rareza y nº de serie),
  venta rápida al 80 %.
- **Mercado** (estilo FUT): comprar (vendedores simulados), buscar, filtrar
  (región/rareza/equipo/OVR), ordenar, vender desde la colección a precio fijo,
  **Mis Ventas** (en venta + completadas, cancelar) y **Mis Compras**. Historial
  de precios por carta (última/media/mín/máx) y tendencia 📈📉➖.
- **Progresión**: niveles + XP y **logros** con recompensas reclamables.
- **Eventos en vivo** (Centro de Eventos): eventos temporales con cuenta atrás
  (Masters Toronto, EWC 2026, Champions Paris), **misiones**, **pase de evento**
  (50 niveles), **tienda de evento** con Tokens 🎟️, **sobres exclusivos**
  (solo durante el evento), **recompensas diarias** (racha de 7 días), **tareas
  semanales** y **notificaciones**. Insignia en el menú con lo reclamable.
- **App instalable (PWA)**: manifest, iconos (192/512 + maskable), iconos Apple,
  **service worker** con soporte offline (colección/inventario/mercado/eventos
  sin conexión), **botón instalar** (+ instrucciones iOS), **splash screen**
  propia, transiciones de página y ajustes de "sensación de app" (safe-areas,
  sin rebote, sin selección de UI). Instalable en Android, iPhone, Windows y Mac.
- **Capa de datos + Panel de administración** (`/admin`): importar jugadores
  reales (formulario, **JSON/CSV masivo**), editarlos, eliminarlos, **generar sus
  cartas automáticamente** (Bronce/Plata/Oro + variantes por palmarés),
  **regenerar stats** desde métricas reales (ACS, K/D, HS%…), gestionar imágenes
  y ver las **colecciones por región** auto-generadas. El catálogo es **dinámico**:
  añadir un jugador una vez genera todas sus cartas en todo el juego.
- **Plataforma online (Supabase, opcional)**: registro/login/recuperación de
  contraseña + **perfil** (`/cuenta`), **sincronización en la nube** del progreso
  (migración localStorage → Supabase manteniendo compatibilidad), **rankings**
  (`/ranking`: Top Nivel/Colección/Mercado/Rarezas) y **mercado real
  jugador ↔ jugador** (pestaña *Global* del mercado). Operaciones críticas
  validadas en el servidor (RLS + funciones RPC atómicas). Sin configurar
  Supabase, todo sigue funcionando en local.
- **DRL Data Engine** (`/admin/data-engine`): pipeline autónomo que **detecta
  torneos y partidos**, programa **monitores** alrededor de cada partido,
  identifica **ganador y MVP**, y al finalizar un torneo **genera cartas**
  (SERIES/WINNER/MVP/ICON/PRIME) con seriales y **puntuación de confianza** —
  si es < 90% requiere **aprobación manual** (Telegram). Las cartas se
  **insertan automáticamente** en el juego (sobres/mercado/colección) vía el
  catálogo dinámico. Genera también el **evento** del torneo. Incluye
  **Pick'ems**, **notificaciones** de incidencias y dashboard con logs/scheduler.
  Funciona con fuente **mock** (demo sin red) o el conector **VLR** enchufable;
  nunca usa datos crudos sin normalizar.
- Estado persistente en `localStorage` (Zustand). Juego single-player completo.

## 🧱 Arquitectura

Limpia y data-driven: añadir contenido es añadir datos, no reescribir lógica.

```
src/
├─ domain/                 # Lógica pura, sin React
│  ├─ cards/               # types · variants (registro) · ovr
│  ├─ economy/             # pricing (mercado, venta rápida, nº de serie)
│  ├─ market/              # types · history (precio medio/mín/máx, tendencia)
│  ├─ events/              # types · time (cuenta atrás) · pass · daily
│  ├─ packs/               # types · openPack (RNG inyectable)
│  ├─ collections.ts       # colecciones por región (auto-generadas)
│  └─ progression/         # levels · achievements
├─ data/                   # players · teams · countries · catalog (DINÁMICO) · packs · marketSeed · events
│  └─ sources/             # PlayerSource: local · vlr (stub) · normalize · import (JSON/CSV)
├─ engine/                 # DRL Data Engine: dataEngine · tournament · cardGenerator
│  │                       #   eventGenerator · scheduler · notifications · types
│  └─ sources/             # DataSource: mock (fixtures) · vlr (conector) · normalize
├─ config/                 # admin (gate del panel)
├─ store/                  # Zustand: useGameStore · useMarketStore · useEventsStore · useRosterStore · useEngineStore
├─ components/             # cards/ · packs/ · market/ · events/ · pwa/ · auth/ · sync/ · layout/ · ui/
├─ lib/                    # format · flags · assets · sound · useToast
│  └─ supabase/            # client · auth (provider) · cloud (sync) · market (RPC) · types
└─ app/                    # rutas Next.js + manifest.ts + /cuenta + /ranking (todo en español)

supabase/migrations/0001_init.sql  # esquema + RLS + RPC + vistas de ranking
supabase/README.md                 # cómo desplegar el backend
public/sw.js                       # service worker (offline)
public/icons/  public/*.png        # iconos PWA generados por scripts/generate-icons.mjs
public/players/  public/teams/     # deja aquí los PNG reales (ver sus README)
```

### Cómo ampliar

| Quiero… | Edito |
|---|---|
| Importar jugadores en caliente | **Panel `/admin`** (formulario o JSON/CSV) |
| Añadir un jugador semilla | `src/data/players.ts` (+ foto en `public/players/{id}.png`) |
| Añadir un equipo / logo | `src/data/teams.ts` (+ `public/teams/{slug}.png`) |
| Añadir un país/bandera | `src/data/countries.ts` |
| Añadir una variante/edición de carta | `src/domain/cards/variants.ts` |
| Añadir un sobre | `src/data/packs.ts` |
| Añadir un evento (Masters 2027…) | `src/data/events.ts` (solo datos) |
| Añadir tareas semanales | `src/data/events.ts` (`WEEKLY_TASKS`) |
| Cambiar el cálculo de OVR | `src/domain/cards/ovr.ts` |
| Ajustar precios/economía | `src/domain/economy/pricing.ts` |
| Añadir un logro | `src/domain/progression/achievements.ts` |

## 🔐 Panel de administración

`/admin` solo es accesible mediante configuración:
- **Desarrollo** (`npm run dev`): activado automáticamente.
- **Producción**: requiere la variable de entorno `NEXT_PUBLIC_ADMIN=1` al build.

Importa por **JSON** (`[{ "nick", "team", "region", "role", "country",
"metrics": { "acs", "kd", "hsPct", ... }, "accolades": [...] }]`) o **CSV** (con
cabecera: `nick,team,region,role,country,acs,kd,hspct,assists,clutches,accolades`).

## ☁️ Modo online (Supabase)

Opcional y aditivo. Pasos completos en **`supabase/README.md`**. Resumen:
1. Crea un proyecto Supabase y ejecuta `supabase/migrations/0001_init.sql`.
2. Copia URL + anon key a `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
3. `npm run dev` → **/cuenta** para registrarte. El progreso local se migra solo.

Sin estas variables, el juego funciona exactamente igual que antes (local).

## 🤖 DRL Data Engine

Ve a **/admin/data-engine** y pulsa **▶ Ejecutar engine** (fuente *Mock*): detecta
"Masters Toronto 2026" (finalizado) y "Champions Paris 2026" (en curso), genera
las cartas del primero (Leviatán campeón, aspas MVP) y las inserta en el juego;
programa monitores para los partidos en vivo/próximos; puedes hacer **Pick'ems**.
Tablas de servidor en `supabase/migrations/0002_data_engine.sql`. Para datos
reales: define `NEXT_PUBLIC_VLR_API` (proxy JSON a VLR) y `NEXT_PUBLIC_TELEGRAM_WEBHOOK`.

## 🛣️ Siguientes pasos sugeridos

- Añadir los PNG reales de jugadores y logos (el sistema ya los carga).
- Implementar un proxy real de **VLR.gg** detrás de `NEXT_PUBLIC_VLR_API` y
  ejecutar el engine desde una **edge function / cron** (hoy se dispara desde el
  dashboard; la estructura `scheduler_jobs` ya está preparada).
- Inyectar los **eventos generados** en el sistema de eventos en vivo (mismo
  patrón dinámico que el catálogo) y mover la economía a server-authoritative.
- Hacer las cartas de evento verdaderamente limitadas también en el mercado
  (hoy la limitación se aplica vía disponibilidad de sobres).
- Backend real (auth + BD) para mercado/eventos multijugador (hoy todo es local:
  vendedores, ventas y calendario de eventos se simulan en el navegador).

## 🧰 Tecnología

Next.js 15 · React 19 · TypeScript · Tailwind CSS · Framer Motion · GSAP · Zustand.
