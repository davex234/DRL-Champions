# NEXUS — Guion de la demo

> Ensayado de principio a fin con `npm run demo:rehearsal`: **46/46**, sobre la build de
> producción. Todo lo que hay aquí abajo se hace **con el ratón**, sin tocar código.

---

## 0. Antes de entrar en la reunión

```bash
# 1. Docker Desktop en marcha, y después:
npx supabase start                  # puerto 54521

# 2. LA APP, EN PRODUCCIÓN — no en `next dev`
npm run build
npx next start -p 3005

# 3. Ensayo completo (opcional, ~3 min). Deja el juego como estaba.
BASE_URL=http://127.0.0.1:3005 npm run demo:rehearsal
```

**Usa la build de producción, no `next dev`.** En desarrollo Next pinta su propia insignia
flotante («N · 2 Issues») en la esquina inferior izquierda, encima de la barra de navegación
en móvil. No es un fallo del juego, pero sale en todas las capturas y en la pantalla
compartida. `next start` no la tiene.

Comprobación rápida antes de empezar:

```bash
curl -o /dev/null -w "%{http_code}\n" http://127.0.0.1:54521/rest/v1/    # 200
curl -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3005/api/game/state  # 401
```

Y hace falta una cuenta con `profiles.is_admin = true` para la primera mitad.

---

## 1. El recorrido, paso a paso

### A · El administrador crea una carta (3 min)

| # | Dónde | Qué se hace | Qué se enseña |
|---|---|---|---|
| 1 | `/admin/cartas` | Entrar | El catálogo real: 773 cartas, filtros por estado, rareza y pool |
| 2 | `/admin/cartas/nueva` | Escribir un nick, elegir jugador | El buscador va contra la base, no contra una lista local |
| 3 | | Elegir una variante | **La preview se dibuja al instante** con `Card3D`, el mismo componente que pinta la carta en el juego |
| 4 | | Mirar el OVR | Nadie lo ha tecleado: lo deriva el dominio del trío de combate. Rareza, estadísticas, `source` y huella, igual |
| 5 | | Motivo + **Crear** | Nace en `DRAFT`, versión 1 |

> **La frase que conviene decir aquí:** *«los campos derivados no se pueden escribir; si los
> mando en la petición, el servidor me los rechaza diciendo de dónde salen de verdad»*. Está
> verificado: 9 campos derivados y 7 de identidad, todos 400.

### B · Publicar y repartir (4 min)

| # | Dónde | Qué se hace |
|---|---|---|
| 6 | `/admin/cartas/<id>` | **Publicar carta** → motivo → confirmar. Queda `PUBLISHED` |
| 7 | `/admin/pools/nueva` | Crear un pool (nace `DRAFT`) |
| 8 | `/admin/pools/<id>` | Buscar la carta en **Añadir una carta**, peso, motivo, **Añadir** |
| 9 | | Cambiar el peso en la tabla y salir del campo: **se guarda solo** |
| 10 | | **Publicar** el pool → queda `ACTIVE` |
| 11 | `/admin/pools/pack-estandar` | **Desvincular** el sobre «estandar» de su pool de siempre |
| 12 | `/admin/pools/<id>` | Elegir «Sobre Estándar» y **Vincular** |

> **Por qué el paso 11.** Cuando un sobre tiene varios pools, sus cartas se **unen**. Si se
> deja el pool original, la carta nueva compite con las 772 de siempre y no sale. La ficha lo
> explica en pantalla, y conviene leerlo en voz alta: es la clase de detalle que demuestra que
> el modelo está pensado.

> **Truco de demo.** Con la carta **sola** en el pool, el sobre entrega cinco ejemplares suyos
> con series #1…#5: se ve a la primera. Con más cartas dentro es más realista, pero entonces
> hay que estar dispuesto a abrir dos o tres sobres — una carta `rare` sale en un hueco el
> 12,7 % de las veces, y eso es una moneda al aire.

### C · El jugador la consigue (4 min)

| # | Dónde | Qué se enseña |
|---|---|---|
| 13 | `/tienda` | La Armería: sobre protagonista, probabilidades **escritas antes de comprar**, saldo |
| 14 | `/abrir/estandar` | **Abrir sobre** → la ceremonia → la carta que se acaba de crear |
| 15 | | Serie, versión acuñada, dueño y fecha: la instancia es real |
| 16 | `/coleccion` | La carta, en el álbum del jugador |
| 17 | `/duelos/mazos` → **+ Nuevo mazo** | La carta, disponible para jugar |

---

## 2. Lo que hay detrás, por si preguntan

```
ADMIN → DEFINICIÓN → VERSIÓN → POOL → DISTRIBUCIÓN → SOBRE → ACUÑACIÓN → INSTANCIA
```

- **La carta es una fila**, no el resultado de una función (`content_cards`, 773).
- **La instancia congela su versión.** Si mañana se edita la carta, el ejemplar que alguien ya
  tiene **no cambia**: conserva su OVR, su trío, su serie y su identidad. Verificado con 30
  ejemplares en v1 y 19 en v2 del mismo `card_id`, conviviendo.
- **Nada de esto es editable desde el cliente.** 22 intentos por las rutas y 16 escrituras
  directas contra la base: todas rechazadas. Un jugador tampoco puede hacerse administrador.
- **Dos administradores a la vez**: gana el primero, el segundo recibe un conflicto marcado y
  no pierde lo que tenía escrito. Nunca «el último que escribe, gana».

---

## 3. Preguntas incómodas, con respuesta honesta

| Pregunta | Respuesta |
|---|---|
| «¿Esto es una maqueta?» | No. El sobre se abre por `/api/game/packs`, la tirada la decide el motor en el servidor con semilla criptográfica y la acuñación es una transacción. |
| «¿Y si cambio la carta después?» | Los ejemplares ya repartidos no se mueven. Es el punto entero del modelo de versiones. |
| «¿Puedo quitar una carta de circulación?» | Sí: `RETIRED`. Deja de salir en sobres nuevos y sigue funcionando en las colecciones, los mazos y el mercado. No se puede borrar mientras exista un ejemplar. |
| «¿Hay arte?» | Todavía no: `public/players` está vacío y las cartas caen a su representación de sigilo. Es lo que falta, y se nota. |

---

## 4. Lo que NO conviene enseñar

- **El mercado entre jugadores** está cerrado por bandera (`GLOBAL_MARKET_ENABLED = false`).
  Las lecturas funcionan; las escrituras responden 503 a propósito.
- **Editar el roster desde `/admin`** (jugadores) usa `localStorage` como origen: es anterior
  al plano de contenido y no comparte camino con lo que se enseña aquí.
- **El sobre «prime»** está marcado `retired` en el catálogo.

---

## 5. Si algo se tuerce en directo

| Síntoma | Causa casi segura | Salida |
|---|---|---|
| La carta no sale del sobre | El sobre sigue vinculado a su pool original | `/admin/pools/pack-estandar` → **Desvincular** |
| El sobre reparte lo de antes | La caché de distribución vive 5 s | Esperar 6 s y volver a abrir |
| «Acceso restringido» en `/admin` | La cuenta no es admin, o falta `NEXT_PUBLIC_ADMIN=1` | Comprobar `profiles.is_admin` y `.env.local` |
| Aparece una insignia «N · Issues» | Se está sirviendo `next dev` | `npm run build && npx next start -p 3005` |
| «Otro administrador se ha adelantado» | Dos pestañas del panel abiertas | Recargar la ficha; no se ha guardado nada |

---

## 6. Después de la reunión

El ensayo y las verificaciones **no dejan nada detrás**: borran sus cuentas, sus cartas, sus
pools y devuelven los contadores de acuñación. Si la demo se hace a mano, en cambio, quedan la
carta, el pool y los ejemplares creados. Para deshacerlo:

```bash
# el vínculo original del sobre (desde /admin/pools/pack-estandar → Vincular)
# y después, si se quiere borrar la carta de prueba: solo se puede si NADIE tiene un ejemplar.
```

Retirar la carta (`RETIRED`) es siempre preferible a borrarla: es lo que el modelo espera y no
rompe nada de lo que ya se repartió.
