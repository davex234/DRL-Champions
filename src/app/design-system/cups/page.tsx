"use client";

/**
 * ARNÉS QA · TORNEOS (F86) — `/design-system/cups?scene=<escena>` (404 en producción salvo NEXUS_QA_HARNESS=1).
 *
 * Las vistas REALES (`CupsHubView`, `CupDetailView` → cabecera, mi partida, campeón, `CupBracket`) con fixtures QA
 * SYNTHETIC salidas del dominio real. Sin servidor: los botones no hacen nada.
 *   hub · hub-empty · open · registered · full · scheduled · live-8 (mi partida lista) · active-8 · live-64 ·
 *   eliminated · champion (yo) · completed (público) · cancelled · anon-open
 *   F86.1: before-ready · waiting (listo, esperando al rival) · deadline · review · advanced (esperando rival que se
 *   juega ahora) · next-playable · notice (aviso global del armazón sobre el hub)
 */
import { useEffect, useState } from "react";
import { CupsHubView } from "@/components/cups/CupsHubScreen";
import { CupDetailView } from "@/components/cups/CupDetailScreen";
import { CupLiveNoticeView } from "@/components/cups/CupLiveNotice";
import type { DuelDeckDTO } from "@/lib/duel/types";
import {
  HUB, HUB_EMPTY, DETAIL_OPEN, DETAIL_REGISTERED, DETAIL_FULL, DETAIL_SCHEDULED, DETAIL_LIVE_8, DETAIL_ACTIVE_8, DETAIL_LIVE_64,
  DETAIL_ELIMINATED, DETAIL_CHAMPION, DETAIL_COMPLETED_PUBLIC, DETAIL_CANCELLED, QA_NOW,
  DETAIL_BEFORE_READY, DETAIL_WAITING, DETAIL_DEADLINE, DETAIL_REVIEW, DETAIL_ADVANCED, DETAIL_NEXT_PLAYABLE, NOTICE_READY,
} from "./fixtures";

const SCENES = ["hub", "hub-empty", "open", "registered", "full", "scheduled", "live-8", "active-8", "live-64", "eliminated", "champion", "completed", "cancelled", "anon-open",
  "before-ready", "waiting", "deadline", "review", "advanced", "next-playable", "notice"] as const;
type Scene = (typeof SCENES)[number];
const DECKS = [{ id: "d1", name: "Equipo principal", valid: true }, { id: "d2", name: "Equipo agresivo", valid: true }] as unknown as DuelDeckDTO[];

export default function CupsQaPage() {
  const [scene, setScene] = useState<Scene | null>(null);
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("scene");
    setScene((SCENES as readonly string[]).includes(s ?? "") ? (s as Scene) : "hub");
  }, []);
  if (!scene) return null;
  // La cuenta atrás del arnés se fija a la hora QA (como si el servidor dijera QA_NOW).
  const offset = QA_NOW - Date.now();
  const d = (detail: typeof DETAIL_OPEN, signedIn = true) => <CupDetailView detail={detail} signedIn={signedIn} decks={DECKS} activeDeckId="d1" offset={offset} harness viewerId="qa" />;
  return (
    <div data-qa-scene={scene}>
      {scene === "hub" && <CupsHubView hub={HUB} signedIn offset={offset} onMore={() => {}} />}
      {scene === "hub-empty" && <CupsHubView hub={HUB_EMPTY} signedIn offset={offset} />}
      {scene === "open" && d(DETAIL_OPEN)}
      {scene === "registered" && d(DETAIL_REGISTERED)}
      {scene === "full" && d(DETAIL_FULL)}
      {scene === "scheduled" && d(DETAIL_SCHEDULED)}
      {scene === "live-8" && d(DETAIL_LIVE_8)}
      {scene === "active-8" && d(DETAIL_ACTIVE_8)}
      {scene === "live-64" && d(DETAIL_LIVE_64)}
      {scene === "eliminated" && d(DETAIL_ELIMINATED)}
      {scene === "champion" && d(DETAIL_CHAMPION)}
      {scene === "completed" && d(DETAIL_COMPLETED_PUBLIC, false)}
      {scene === "cancelled" && d(DETAIL_CANCELLED)}
      {scene === "anon-open" && d({ ...DETAIL_OPEN, me: null }, false)}
      {scene === "before-ready" && d(DETAIL_BEFORE_READY)}
      {scene === "waiting" && d(DETAIL_WAITING)}
      {scene === "deadline" && d(DETAIL_DEADLINE)}
      {scene === "review" && d(DETAIL_REVIEW)}
      {scene === "advanced" && d(DETAIL_ADVANCED)}
      {scene === "next-playable" && d(DETAIL_NEXT_PLAYABLE)}
      {scene === "notice" && <div className="mx-auto w-full max-w-6xl px-4 pt-6 sm:px-6"><CupLiveNoticeView notice={NOTICE_READY} onDismiss={() => {}} /><CupsHubView hub={HUB} signedIn offset={offset} /></div>}
    </div>
  );
}
