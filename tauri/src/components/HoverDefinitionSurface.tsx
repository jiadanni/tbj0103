import React, { useRef } from "react";
import { useWordHover } from "../hooks/useWordHover";
import { WordDefinitionTooltip } from "./WordDefinitionTooltip";

interface HoverDefinitionSurfaceProps {
  as?: "div" | "p" | "span";
  className?: string;
  workspaceId?: string | null;
  children: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLElement>;
}

export default function HoverDefinitionSurface({
  as = "div",
  className,
  workspaceId,
  children,
  onClick,
}: HoverDefinitionSurfaceProps) {
  const Element = as;
  const ref = useRef<HTMLElement | null>(null);
  const definition = useWordHover(ref, workspaceId);

  return (
    <>
      {definition && <WordDefinitionTooltip definition={definition} />}
      {React.createElement(
        Element,
        {
          ref: ref as React.Ref<HTMLElement>,
          className,
          onClick,
        },
        children,
      )}
    </>
  );
}
