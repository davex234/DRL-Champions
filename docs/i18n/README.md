# Internacionalización (ES · EN · DE · IT)

Sistema propio, sin dependencias nuevas. Español es el idioma de origen y el fallback.

## Cómo se escribe un texto

```tsx
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("store");                       // un traductor por fichero; el módulo es la carpeta funcional

export function Offer({ pack, n }: Props) {
  useLocale();                               // el componente se repinta al cambiar el idioma
  return (
    <>
      <h2>{t("Abrir sobre")}</h2>
      <p>{t("Tienes {n} sobres", { n })}</p>
      <p>{t("{n, plural, one {# carta} other {# cartas}}", { n })}</p>
      <p>{td(pack.name)}</p>                 {/* texto que llega como DATO: tabla, servidor, BD */}
    </>
  );
}
```

- **La clave es el texto español.** Nunca se ve una clave en pantalla: si falta una traducción se ve el español.
- `t(texto, vars?)` para texto escrito en el código. `td(valor)` para texto que llega como dato (etiqueta de una tabla,
  error de la API, nombre de un sobre): se traduce si está en algún catálogo y, si no (un nick, un equipo), pasa intacto.
- Variables `{nombre}` y plurales ICU `{n, plural, one {…} other {…}}` (reglas de `Intl.PluralRules` de cada idioma).
- Números y fechas: `formatNumber`, `formatPercent`, `formatDate`, `getIntlLocale()`; `formatCredits` ya sigue el idioma.
- Un texto español que es un **identificador** (se compara, es un tipo literal) no se envuelve: se marca
  `/* i18n-id */ "EN CURSO"` y se traduce al pintarlo con `td(...)`.

## Dónde vive cada cosa

| Ruta | Qué es |
|---|---|
| `src/i18n/config.ts` | Idiomas, nombres, negociación del idioma del navegador, cookie |
| `src/i18n/icu.ts` | Formato de mensajes (variables y plurales) |
| `src/i18n/runtime.ts` | `ns`, `td`, idioma activo, catálogos, formato de números/fechas |
| `src/i18n/preference.ts` | Precedencia dispositivo / cuenta / navegador (pura, testeada) |
| `src/i18n/critical.ts` | Operaciones críticas: un cambio de idioma se aplaza mientras dura una compra o una apertura |
| `src/i18n/react.tsx` | `I18nProvider`, `useLocale`, `useI18n` (selector), carga de los trozos por idioma |
| `src/i18n/messages/es/<módulo>.json` | Lista canónica de textos fuente (generada; no se edita) |
| `src/i18n/messages/{en,de,it}/<módulo>.json` | Traducciones (texto español → traducción) |
| `src/i18n/bundles/` | Trozos generados: uno por idioma para el juego y otro para administración |
| `src/i18n/glossary.json` | Términos fijados (el auditor y los tests los exigen) |
| `src/i18n/extra-sources.json` | Textos que no se pueden deducir del código (mensajes compuestos por el servidor, contenido de BD) |
| `src/components/ui/game/LanguageSettings.tsx` | Selector de idioma (Ajustes y pantalla de acceso) |
| `scripts/i18n/` | Codemod, auditor, generador de trozos, reparto/fusión de traducción |
| `docs/i18n/TRANSLATION-BRIEF.md` | Guía de estilo y glosario completo para traducir |

## Flujo de trabajo

```
npm run i18n:extract    # tras tocar textos: regenera messages/es y los trozos, y audita
npm run i18n:audit      # CI: falla si hay texto sin internacionalizar, claves ausentes/vacías/huérfanas, variables distintas…
npx tsx scripts/i18n/codemod.ts [--write]              # envuelve texto nuevo que se haya escrito «a pelo»
npx tsx scripts/i18n/translate-work.ts split|merge     # reparte lo pendiente por trozos / fusiona lo traducido
```

Añadir un idioma: añadirlo a `LOCALES` y `LOCALE_INFO` (`config.ts`), a `TARGET_LOCALES` (`scripts/i18n/core.ts`) y a los
cargadores de `react.tsx`; `split` genera el trabajo y `merge` + `i18n:bundles` lo publican.

## Decisiones

- **Sin rutas por idioma.** La sesión vive en `localStorage` (no hay cookies de auth ni `@supabase/ssr`), casi todas las
  pantallas son de cliente y las URL de producción se comparten. El idioma es una preferencia, no parte de la URL: los
  enlaces existentes no cambian. (Propuesta de SEO por idioma: ver el informe de entrega.)
- **El servidor responde en español canónico.** El contrato de la API, los tests de servicio y lo que se guarda en la base
  de datos no dependen del idioma del jugador. El cliente traduce los mensajes del servidor por su texto, y los mensajes
  compuestos («Necesitas 3.000 créditos») por su plantilla, extraída del propio código del servidor.
- **Texto español como clave** (estilo gettext): 193 tests del proyecto leen el código fuente y fijan textos; con claves
  sintéticas habría que reescribirlos todos y el texto dejaría de leerse en el componente. El precio: cambiar una frase en
  español cambia su clave, y el auditor lo denuncia como traducción ausente hasta que se retraduce.
- **Carga**: el español va en el código (como antes: ningún coste nuevo para quien juega en español). Cada otro idioma es
  un trozo que se descarga solo si se usa; la administración va en un trozo aparte.

## Precedencia del idioma

1. Preferencia guardada en este dispositivo (`localStorage: vr.locale`).
2. Idioma de la cuenta (`user_metadata.locale`), con sesión.
3. Idioma del navegador, si es es/en/de/it.
4. Español.

Si dispositivo y cuenta no coinciden gana la elección **más reciente** (cada una guarda su fecha) y se copia al otro lado.
Un idioma solo detectado nunca se guarda. Detalle y casos en `src/i18n/preference.ts` y sus tests.

## Contenido editable (CMS / base de datos)

El contenido que se escribe en el panel (sobres nuevos, misiones, sets, temporadas, torneos) se guarda en español y no se
toca. Sus traducciones son **opcionales** y viven en una capa aparte con la forma de todo el sistema, texto español →
traducción por idioma (`src/i18n/content.ts`):

- La capa se registra como el módulo `content` del catálogo, así que `td()` (que ya pinta todo el texto que llega como
  dato) la usa sin cambiar ningún componente. Sin traducción se ve el español: nunca una clave ni un hueco.
- Lo traducido en el código manda sobre la capa; una traducción con variables `{n}` distintas de su fuente se descarta.
- Origen: `GET /api/content/i18n?locale=en|de|it`, que lee la tabla **aditiva** `content_translations`
  (`docs/i18n/proposals/content_translations.PROPOSAL.sql`, **sin aplicar**: no está en `supabase/migrations`).
- Interruptor `CONTENT_TRANSLATIONS_ENABLED` (`src/config/features.ts`) en `false`: el juego no pide la capa y la ruta
  responde vacía. Para activarlo: numerar y aplicar la propuesta (backup previo, como cualquier migración), encender el
  interruptor y desplegar. Apagarlo o borrar la tabla no pierde contenido.
- Pendiente (no construido): pantalla de administración para editar la capa. Hasta entonces se rellena por SQL.

## Texto pintado en el servidor

El servidor responde y pinta en español canónico; el idioma lo decide el navegador. Por eso un componente de servidor
no debe pintar texto traducible: se extrae a una pieza de cliente con `useLocale()` (`PickemBackLink`, `AdminDisabled`).
Lo que sigue saliendo del servidor en español a propósito: `<html lang="es">` y los metadatos (`<title>`, Open Graph)
del HTML inicial — el cliente corrige `lang` y el título al hidratar; las vistas previas al compartir un enlace salen
en español.

## Frases enteras, no fragmentos (cierre 2026-10-11)

Una frase no se reparte en varios `t()` alrededor de un valor o de una etiqueta: el orden de las palabras cambia con el
idioma. Se escribe entera, con variables, y los trozos resaltados se pintan con `fill`/`slots` (`src/i18n/rich.tsx`):

```tsx
t("{n} de {total} cartas", { n, total })
fill(t("Pasará a {estado}. Sus {n} cartas…", { n, ...slots("estado") }), { estado: <strong>{td(estado)}</strong> })
t("{n} {n, plural, one {carta} other {cartas}}", { n })   // `#` agrupa miles; `{n}` pinta el número tal cual
```

Sí es correcto partir «Rótulo:» + valor y número + unidad (mismo orden en los cuatro idiomas).

`npx tsx scripts/_i18n-gaps.ts` (instrumento, fuera de CI) lista lo que el auditor no ve: frases a medias
(`logs/i18n/gaps-fragments-real.txt`) y literales con español que no están en ningún catálogo
(`logs/i18n/gaps-literals.txt`). Es heurístico: cada hallazgo se revisa a mano.

Una palabra que el servidor COMPARA (confirmaciones tecleadas como «ELIMINAR A LOS DOS», «PUBLICAR») nunca se envía
traducida: el admin teclea lo que ve en su idioma y al servidor va el literal canónico.

El manifiesto de la app instalable (`src/app/manifest.ts`) es lo único que el servidor pinta en el idioma del jugador:
lee la cookie `vr_locale`. El título y la vista previa al compartir (Open Graph) siguen en español: sin rutas por
idioma, quien pide la vista previa (un robot) no tiene preferencia.
