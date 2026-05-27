import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  content: string | React.ReactNode;
  children: React.ReactElement;
  delay?: number;
  position?: "top" | "bottom" | "left" | "right";
  className?: string;
}

/**
 * A premium tooltip component that replaces standard browser title tooltips.
 * Uses React Portal to avoid overflow/clipping issues.
 */
export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  delay = 400,
  position = "top",
  className = "",
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const targetRef = useRef<HTMLElement>(null);

  const updatePosition = useCallback(() => {
    if (targetRef.current) {
      const rect = targetRef.current.getBoundingClientRect();
      let top = 0;
      let left = 0;

      // Distance from the element
      const offset = 8;

      switch (position) {
        case "top":
          top = rect.top - offset;
          left = rect.left + rect.width / 2;
          break;
        case "bottom":
          top = rect.bottom + offset;
          left = rect.left + rect.width / 2;
          break;
        case "left":
          top = rect.top + rect.height / 2;
          left = rect.left - offset;
          break;
        case "right":
          top = rect.top + rect.height / 2;
          left = rect.right + offset;
          break;
      }

      setCoords({ top, left });
    }
  }, [position]);

  const showTooltip = useCallback(() => {
    if (timerRef.current) {clearTimeout(timerRef.current);}
    timerRef.current = setTimeout(() => {
      updatePosition();
      setIsVisible(true);
    }, delay);
  }, [delay, updatePosition]);

  const hideTooltip = useCallback(() => {
    if (timerRef.current) {clearTimeout(timerRef.current);}
    setIsVisible(false);
  }, []);

  useEffect(() => {
    if (!isVisible) {return;}
    let rafId = 0;
    const throttledUpdate = () => {
      window.cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(updatePosition);
    };
    // Dismiss tooltip on scroll instead of chasing position — avoids
    // expensive getBoundingClientRect + setState on every scroll frame.
    const dismissOnScroll = () => {
      window.cancelAnimationFrame(rafId);
      setIsVisible(false);
    };
    window.addEventListener("scroll", dismissOnScroll, true);
    window.addEventListener("resize", throttledUpdate);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", dismissOnScroll, true);
      window.removeEventListener("resize", throttledUpdate);
      if (timerRef.current) {clearTimeout(timerRef.current);}
    };
  }, [isVisible, updatePosition]);

  // Clone the child to inject mouse events and ref
  const clonedChild = React.cloneElement(children, {
    ref: (node: HTMLElement) => {
      // @ts-expect-error - targetRef.current mutation
      targetRef.current = node;
      // Handle existing ref if any
      const { ref } = children as React.ReactElement & { ref: React.Ref<HTMLElement> };
      if (typeof ref === "function") {
        ref(node);
      } else if (ref && 'current' in ref) {
        // eslint-disable-next-line react-hooks/immutability
        (ref as React.MutableRefObject<HTMLElement | null>).current = node;
      }
    },
    onMouseEnter: (e: React.MouseEvent) => {
      children.props.onMouseEnter?.(e);
      showTooltip();
    },
    onMouseLeave: (e: React.MouseEvent) => {
      children.props.onMouseLeave?.(e);
      hideTooltip();
    },
    onFocus: (e: React.FocusEvent) => {
      children.props.onFocus?.(e);
      showTooltip();
    },
    onBlur: (e: React.FocusEvent) => {
      children.props.onBlur?.(e);
      hideTooltip();
    },
  });

  const getAnimationClass = () => {
    switch (position) {
      case "top": return "animate-tooltip-top";
      case "bottom": return "animate-tooltip-bottom";
      case "left": return "animate-tooltip-left";
      case "right": return "animate-tooltip-right";
      default: return "";
    }
  };

  const getPositionStyles = () => {
    switch (position) {
      case "top": return { transform: "translateX(-50%) translateY(-100%)" };
      case "bottom": return { transform: "translateX(-50%)" };
      case "left": return { transform: "translateX(-100%) translateY(-50%)" };
      case "right": return { transform: "translateY(-50%)" };
      default: return {};
    }
  };

  return (
    <>
      {clonedChild}
      {isVisible && content && createPortal(
        <div
          className={`fixed z-[9999] px-2.5 py-1.5 text-[11px] font-medium 
                     text-[var(--text-primary)] bg-[var(--bg-elevated)] 
                     border border-[var(--border-color)] rounded-lg 
                     shadow-xl pointer-events-none backdrop-blur-md 
                     whitespace-nowrap ${getAnimationClass()} ${className}`}
          style={{
            top: coords.top,
            left: coords.left,
            ...getPositionStyles(),
          }}
          role="tooltip"
        >
          {content}
          {/* Subtle accent glow */}
          <div className="absolute inset-0 rounded-lg bg-accent/[0.03] -z-10" />
        </div>,
        document.body
      )}
    </>
  );
};
