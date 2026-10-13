/** `/pickems/cuadro/[slug]` — F87 · un Pick'em 2.0: el cuadro real del evento y, con sesión, MI cuadro de predicción. */
import type { Metadata } from "next";
import Link from "next/link";
import { PredictScreen } from "@/components/pickems/predict/PredictScreen";

export const metadata: Metadata = { title: "Pick'em" };

export default async function PickemBracketPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <section className="animate-rise space-y-4">
      <nav aria-label="Migas"><Link href="/pickems" className="nx-label nx-focus hover:text-white">← Pick&apos;ems</Link></nav>
      <PredictScreen slug={slug} />
    </section>
  );
}
