import { ChevronDown } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

export function ModelList({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const update = () => {
    const node = ref.current;
    if (node)
      setMore(node.scrollHeight - node.scrollTop - node.clientHeight > 2);
  };
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="usage-model-list">
      <div ref={ref} className="usage-legend" onScroll={update}>
        <div className="usage-legend-items">{children}</div>
      </div>
      {more && (
        <div className="usage-more-models" aria-hidden="true">
          <ChevronDown size={14} />
        </div>
      )}
    </div>
  );
}
