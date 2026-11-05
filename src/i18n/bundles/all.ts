// GENERADO por scripts/i18n/bundles.ts — no editar a mano. Las traducciones viven en src/i18n/messages/.

import type { Catalog } from "../runtime";
import type { Locale } from "../config";
import en from "./en";
import enAdmin from "./en.admin";
import de from "./de";
import deAdmin from "./de.admin";
import it from "./it";
import itAdmin from "./it.admin";
import fr from "./fr";
import frAdmin from "./fr.admin";
import ptPT from "./pt-PT";
import ptPTAdmin from "./pt-PT.admin";
import ptBR from "./pt-BR";
import ptBRAdmin from "./pt-BR.admin";
import ja from "./ja";
import jaAdmin from "./ja.admin";

export const ALL_CATALOGS: Record<Exclude<Locale, "es">, Catalog> = {
  "en": { ...en, ...enAdmin },
  "de": { ...de, ...deAdmin },
  "it": { ...it, ...itAdmin },
  "fr": { ...fr, ...frAdmin },
  "pt-PT": { ...ptPT, ...ptPTAdmin },
  "pt-BR": { ...ptBR, ...ptBRAdmin },
  "ja": { ...ja, ...jaAdmin },
};
