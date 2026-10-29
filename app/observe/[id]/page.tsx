import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PhoneObserver } from "@/components/observe/PhoneObserver";
import { isObserverId } from "@/lib/signal-store";

export function generateStaticParams() {
  return [{ id: "01" }, { id: "02" }];
}

// `params` is request data, so it is read inside a <Suspense> boundary: the page's
// shell can then be served at once (see the Next.js "instant shell" check).
async function Observer({ params }: { params: PageProps<"/observe/[id]">["params"] }) {
  const { id } = await params;
  if (!isObserverId(id)) notFound();
  return <PhoneObserver observerId={id} />;
}

export default function ObservePage({ params }: PageProps<"/observe/[id]">) {
  return (
    <Suspense fallback={null}>
      <Observer params={params} />
    </Suspense>
  );
}
