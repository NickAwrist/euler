import { useEffect, useState } from "react";
import { ThinkingBlock } from "../ThinkingBlock";

/** Streams the current model call's reasoning with a timer that stops once the reply starts. Remount per call. */
export function LiveThinking({
  thinking,
  responding,
}: {
  thinking: string;
  responding: boolean;
}) {
  const [startedAt] = useState(Date.now);
  const [now, setNow] = useState(startedAt);

  useEffect(() => {
    if (responding) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [responding]);

  if (!thinking) return null;
  return (
    <div className="ui-animate-slide-up pt-4 max-[640px]:pt-3.5">
      <ThinkingBlock
        thinking={thinking}
        durationMs={now - startedAt}
        active={!responding}
      />
    </div>
  );
}
