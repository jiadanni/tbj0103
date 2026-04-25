import React from "react";

interface ZoomIndicatorProps {
  fontSize: number;
  visible: boolean;
}

const ZoomIndicator: React.FC<ZoomIndicatorProps> = ({ fontSize, visible }) => {
  const percentage = Math.round((fontSize / 16) * 100);

  return (
    <div
      className={`fixed top-12 left-1/2 -translate-x-1/2 z-[9999] transition-all duration-300 transform ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4 pointer-events-none"
      }`}
    >
      <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/80 dark:bg-zinc-800/80 backdrop-blur-md border border-zinc-200 dark:border-zinc-700 shadow-2xl">
        <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
          Zoom
        </span>
        <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100 min-w-[3rem] text-center">
          {percentage}%
        </span>
      </div>
    </div>
  );
};

export default ZoomIndicator;
