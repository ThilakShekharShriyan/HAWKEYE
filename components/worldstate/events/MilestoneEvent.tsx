import { EventFrame } from "@/components/worldstate/events/EventFrame";
import { SpatialBreadcrumb } from "@/components/worldstate/SpatialBreadcrumb";
import { formatConfidence } from "@/lib/time";
import type { WorldEvent } from "@/lib/types";

export function MilestoneEvent({
  event,
  opacity,
}: {
  event: WorldEvent;
  opacity: number;
}) {
  const meta = event.metadata;
  const isQuantity = event.type === "state";

  return (
    <EventFrame event={event} opacity={opacity}>
      <article className="milestone-card max-w-[420px] border border-ink/10 bg-ink/[0.03] px-5 py-4">
        <p className="text-[10px] tracking-[0.18em] text-change uppercase">
          {event.title}
        </p>
        {meta?.object ? (
          <h3 className="mt-3 text-[22px] font-medium tracking-tight text-ink">
            {meta.object}
          </h3>
        ) : null}
        {isQuantity && meta?.from && meta.to ? (
          <p className="mt-3 flex items-baseline gap-3">
            <span className="text-[32px] leading-none font-medium tracking-tight text-ink/35 tabular-nums">
              {meta.from}
            </span>
            <span className="text-[18px] text-ink/30" aria-hidden>
              →
            </span>
            <span className="text-[32px] leading-none font-medium tracking-tight text-ink tabular-nums">
              {meta.to}
            </span>
          </p>
        ) : null}
        {!isQuantity && meta?.from && meta.to ? (
          <div className="mt-4 flex flex-col items-start gap-1 text-[12px] tracking-[0.16em] text-ink/80 uppercase">
            <span>{meta.from}</span>
            <span className="pl-4 text-ink/30" aria-hidden>
              ↓
            </span>
            <span>{meta.to}</span>
          </div>
        ) : null}
        {event.location && isQuantity ? (
          <div className="mt-4">
            <SpatialBreadcrumb segments={event.location} />
          </div>
        ) : null}
        {meta?.state ? (
          <p className="mt-4 font-mono text-[10px] tracking-[0.16em] text-ink/45">
            STATE
            <span className="px-2 text-ink/25">·</span>
            <span className="text-ink/80">{meta.state.toUpperCase()}</span>
          </p>
        ) : null}
        <p className="mt-4 font-mono text-[10px] tracking-[0.12em] text-ink/35">
          {event.observerId ? `OBSERVER ${event.observerId}` : null}
          {event.observerId && event.confidence !== undefined ? (
            <span className="px-2 text-ink/20">·</span>
          ) : null}
          {event.confidence !== undefined
            ? `CONF ${formatConfidence(event.confidence)}`
            : null}
        </p>
      </article>
    </EventFrame>
  );
}
