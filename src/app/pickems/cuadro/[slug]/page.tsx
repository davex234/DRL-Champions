/** `/pickems/cuadro/[slug]` — F87 · un Pick'em 2.0: el cuadro real del evento y, con sesión, MI cuadro de predicción. */
import type { Metadata } from "next";
import { PredictScreen } from "@/components/pickems/predict/PredictScreen";
import { PickemBackLink } from "@/components/pickems/predict/PickemBackLink";

export const metadata: Metadata = { title: "Pick'em" };

export default async function PickemBracketPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <section className="animate-rise space-y-4">
      <PickemBackLink />
      <PredictScreen slug={slug} />
    </section>
  );
}
