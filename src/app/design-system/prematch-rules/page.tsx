"use client";

/**
 * ARNÉS QA · PRE-PARTIDA — `/design-system/prematch-rules?u=<cuenta>` (solo QA; oculto en producción).
 *
 * La `PreMatch` REAL con el hook REAL `useDuelRulesIntro` (adaptador KV de la plataforma → localStorage), como en
 * `/duelos/jugar`, pero con una cuenta QA SINTÉTICA elegida por `?u=` y sin sesión, red ni BD. Sirve para probar en
 * un navegador de verdad: primera entrada (reglas), segunda entrada / F5 (sin reglas), otra cuenta (reglas), cambio
 * de dificultad y «Comenzar duelo», a 1440 / 1024 / 390.
 */
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PreMatch } from "@/components/duel/PreMatch";
import { useDuelRulesIntro } from "@/lib/duel/rulesIntro";
import type { BotDifficulty } from "@/lib/duel/types";
import { DECK_SECOND as DECK } from "../fase32/fixtures";

function Harness() {
  const user = (useSearchParams().get("u") ?? "qa-a").replace(/[^a-z0-9-]/gi, "").slice(0, 40) || "qa-a";
  const rules = useDuelRulesIntro(user);
  const [difficulty, setDifficulty] = useState<BotDifficulty>("NORMAL");
  const [started, setStarted] = useState<string | null>(null);
  return (
    <div className="mx-auto max-w-5xl px-4 py-6" data-qa-user={user} data-rules-state={rules.intro} data-started={started ?? ""}>
      <PreMatch decks={[DECK]} deckId={DECK.id} onDeck={() => undefined} difficulty={difficulty} onDifficulty={setDifficulty}
        onStart={() => setStarted(difficulty)} busy={false} error={null} onHelp={() => undefined} activeDeckId={DECK.id}
        showRules={rules.intro === "show"} onRulesShown={rules.markSeen} />
    </div>
  );
}

export default function PrematchRulesHarness() {
  return <Suspense fallback={null}><Harness /></Suspense>;
}
