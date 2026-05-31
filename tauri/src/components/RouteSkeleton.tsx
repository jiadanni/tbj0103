import { useEffect } from "react";
import { useLocation } from "react-router-dom";

function Block({ className = "" }: { className?: string }) {
  return <div className={`rounded-lg bg-[var(--bg-elevated)]/50 ${className}`} />;
}

function ChatSkeleton() {
  return (
    <div className="flex h-full w-full">
      <div className="hidden w-[260px] shrink-0 flex-col gap-2 border-r border-[var(--border-color)] p-3 md:flex">
        <Block className="h-8" />
        <Block className="h-6 w-2/3" />
        <div className="mt-2 flex flex-col gap-1.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <Block key={i} className="h-9" />
          ))}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-4 p-6">
        <Block className="h-6 w-1/3" />
        <Block className="h-4 w-1/2" />
        <div className="mt-4 flex flex-col gap-3">
          <Block className="h-16 w-4/5 self-start" />
          <Block className="h-12 w-3/5 self-end" />
          <Block className="h-20 w-4/5 self-start" />
        </div>
      </div>
    </div>
  );
}

function GenericSkeleton() {
  return (
    <div className="flex h-full w-full flex-col gap-4 p-6">
      <Block className="h-7 w-1/4" />
      <Block className="h-4 w-1/3" />
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Block key={i} className="h-24" />
        ))}
      </div>
    </div>
  );
}

export default function RouteSkeleton() {
  const location = useLocation();
  const segment = location.pathname.split("/")[1] ?? "";
  useEffect(() => {
    const startedAt = window.performance.now();
    // eslint-disable-next-line no-console
    console.log(`[route] suspense fallback shown for /${segment}`);
    return () => {
      const durationMs = Number((window.performance.now() - startedAt).toFixed(1));
      // eslint-disable-next-line no-console
      console.log(`[route] suspense resolved /${segment} after ${durationMs}ms`);
    };
  }, [segment]);
  if (segment === "chat") { return <ChatSkeleton />; }
  return <GenericSkeleton />;
}
