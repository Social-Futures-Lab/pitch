import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useTutorial } from "./TutorialProvider";

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function parseBoldText(text: string): React.ReactNode[] {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-semibold">
        {part}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export function TutorialOverlay() {
  const { currentStep, tutorialActive, advanceStep } = useTutorial();
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const [bubbleStyle, setBubbleStyle] = useState<React.CSSProperties>({});
  const observerRef = useRef<ResizeObserver | null>(null);
  const rafRef = useRef<number>(0);

  const updatePosition = useCallback(() => {
    if (!currentStep) {
      setTargetRect(null);
      return;
    }

    const selector = currentStep.target.startsWith("[")
      ? currentStep.target
      : `[data-tutorial="${currentStep.target}"]`;

    const el = document.querySelector(selector);
    if (!el) {
      setTargetRect(null);
      return;
    }

    const rect = el.getBoundingClientRect();
    const padding = currentStep.highlightPadding ?? 8;

    setTargetRect({
      top: rect.top - padding,
      left: rect.left - padding,
      width: rect.width + padding * 2,
      height: rect.height + padding * 2,
    });

    const bubbleGap = 12;
    const preferredPos = currentStep.position;
    const bubbleW = 384; // max-w-sm
    const bubbleH = 100; // estimated height
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const m = 16; // viewport margin

    // Target rect with padding already applied
    const target = {
      top: rect.top - padding,
      bottom: rect.bottom + padding,
      left: rect.left - padding,
      right: rect.right + padding,
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
    };

    // Compute bubble rect for each candidate position, return null if it overlaps target or overflows viewport
    const clampX = (centerX: number) => Math.max(m, Math.min(centerX - bubbleW / 2, vw - bubbleW - m));

    type Candidate = { style: React.CSSProperties; pos: string };

    const candidates: Record<string, () => Candidate | null> = {
      bottom: () => {
        const top = target.bottom + bubbleGap;
        if (top + bubbleH > vh - m) return null;
        return { pos: "bottom", style: { top, left: clampX(target.centerX) } };
      },
      top: () => {
        const bottom = vh - target.top + bubbleGap;
        if (vh - bottom + bubbleH > vh || target.top - bubbleGap - bubbleH < m) return null;
        return { pos: "top", style: { bottom, left: clampX(target.centerX) } };
      },
      right: () => {
        const left = target.right + bubbleGap;
        if (left + bubbleW > vw - m) return null;
        const top = Math.max(m, Math.min(target.centerY - bubbleH / 2, vh - bubbleH - m));
        return { pos: "right", style: { top, left } };
      },
      left: () => {
        const right = vw - target.left + bubbleGap;
        if (right + bubbleW > vw - m) return null;
        const top = Math.max(m, Math.min(target.centerY - bubbleH / 2, vh - bubbleH - m));
        return { pos: "left", style: { top, right } };
      },
    };

    // Try preferred position first, then cycle through alternatives
    const order = [preferredPos, "bottom", "top", "right", "left"].filter(
      (v, i, a) => a.indexOf(v) === i,
    );

    let chosen: Candidate | null = null;
    for (const pos of order) {
      const result = candidates[pos]?.();
      if (result) { chosen = result; break; }
    }

    // Last resort: place below target, clamped to viewport even if it means slight overlap
    if (!chosen) {
      chosen = {
        pos: "bottom",
        style: {
          top: Math.min(target.bottom + bubbleGap, vh - bubbleH - m),
          left: clampX(target.centerX),
        },
      };
    }

    setBubbleStyle(chosen.style);
  }, [currentStep]);

  // Lock scrolling while a tutorial step is active — only allow programmatic scrolls
  const allowScrollRef = useRef(false);

  useEffect(() => {
    if (!tutorialActive || !currentStep) return;

    const lockScroll = (e: Event) => {
      if (allowScrollRef.current) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-tutorial-header]")) return;
      e.preventDefault();
      e.stopPropagation();
    };

    // Capture wheel/touchmove/keydown that cause scroll on all scrollable containers
    const opts: AddEventListenerOptions = { passive: false, capture: true };
    document.addEventListener("wheel", lockScroll, opts);
    document.addEventListener("touchmove", lockScroll, opts);

    const lockKeys = (e: KeyboardEvent) => {
      if (allowScrollRef.current) return;
      const scrollKeys = ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "];
      if (scrollKeys.includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("keydown", lockKeys, { capture: true });

    return () => {
      document.removeEventListener("wheel", lockScroll, opts);
      document.removeEventListener("touchmove", lockScroll, opts);
      document.removeEventListener("keydown", lockKeys, { capture: true });
    };
  }, [tutorialActive, currentStep]);

  useEffect(() => {
    if (!currentStep || !tutorialActive) return;

    const selector = currentStep.target.startsWith("[")
      ? currentStep.target
      : `[data-tutorial="${currentStep.target}"]`;

    const handleScroll = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updatePosition);
    };

    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", updatePosition);

    const scrollToElement = (el: Element) => {
      // Temporarily allow scrolling for programmatic scrollIntoView
      allowScrollRef.current = true;
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      // Re-lock after scroll animation completes
      setTimeout(() => {
        allowScrollRef.current = false;
        updatePosition();
      }, 400);
    };

    // Use rAF to ensure DOM has painted before querying element position
    const initialRaf = requestAnimationFrame(() => {
      const el = document.querySelector(selector);
      if (el) {
        scrollToElement(el);
        updatePosition();
        observerRef.current = new ResizeObserver(updatePosition);
        observerRef.current.observe(el);
      }
    });

    // Retry finding element if not immediately available (e.g. lazy-loaded content)
    const retryInterval = setInterval(() => {
      const found = document.querySelector(selector);
      if (found) {
        clearInterval(retryInterval);
        scrollToElement(found);
        updatePosition();
        if (!observerRef.current) {
          observerRef.current = new ResizeObserver(updatePosition);
          observerRef.current.observe(found);
        }
      }
    }, 100);

    return () => {
      cancelAnimationFrame(initialRaf);
      clearInterval(retryInterval);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", updatePosition);
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, [currentStep, tutorialActive, updatePosition]);

  // Handle timeout-based advancement
  useEffect(() => {
    if (!currentStep || currentStep.advanceOn !== "timeout") return;
    const timer = setTimeout(
      () => advanceStep(),
      currentStep.timeoutMs ?? 2000,
    );
    return () => clearTimeout(timer);
  }, [currentStep, advanceStep]);

  // Handle click-target advancement
  useEffect(() => {
    if (!currentStep || currentStep.advanceOn !== "click-target") return;

    const selector = currentStep.target.startsWith("[")
      ? currentStep.target
      : `[data-tutorial="${currentStep.target}"]`;

    let advanced = false;
    const handler = (e: MouseEvent) => {
      if (advanced) return;
      const el = document.querySelector(selector);
      if (el && (el === e.target || el.contains(e.target as Node))) {
        advanced = true;
        // Small delay to let the click propagate to the underlying element first
        setTimeout(() => advanceStep(), 50);
      }
    };

    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [currentStep, advanceStep]);

  if (!tutorialActive || !currentStep || !targetRect) return null;

  const clipPath = `polygon(
    0% 0%, 0% 100%,
    ${targetRect.left}px 100%,
    ${targetRect.left}px ${targetRect.top}px,
    ${targetRect.left + targetRect.width}px ${targetRect.top}px,
    ${targetRect.left + targetRect.width}px ${targetRect.top + targetRect.height}px,
    ${targetRect.left}px ${targetRect.top + targetRect.height}px,
    ${targetRect.left}px 100%,
    100% 100%, 100% 0%
  )`;

  return createPortal(
    <>
      {/* Dimming overlay with cutout */}
      <div
        className="fixed inset-0 z-100 bg-black/60 transition-all duration-200"
        style={{ clipPath }}
        onClick={(e) => e.stopPropagation()}
      />

      {/* Spotlight ring around target */}
      <div
        className="fixed z-100 rounded-lg ring-4 ring-indigo-400/80 pointer-events-none transition-all duration-200"
        style={{
          top: targetRect.top,
          left: targetRect.left,
          width: targetRect.width,
          height: targetRect.height,
        }}
      />

      {/* Instruction bubble */}
      <div
        className="fixed z-101 max-w-sm rounded-xl bg-white px-5 py-4 shadow-2xl border border-gray-200"
        style={bubbleStyle}
      >
        <p className="text-sm text-gray-800 leading-relaxed">
          {parseBoldText(currentStep.instruction)}
        </p>
        {currentStep.action === "observe" && (
          <button
            onClick={advanceStep}
            className="mt-3 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 transition-colors"
          >
            Got it
          </button>
        )}
      </div>
    </>,
    document.body,
  );
}
