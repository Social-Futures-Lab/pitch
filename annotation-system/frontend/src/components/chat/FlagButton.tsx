import { useState, useCallback, useEffect, useRef } from "react";

const STORAGE_KEY = "pitch-flag-used";
const TOOLTIP_STORAGE_KEY = "pitch-flag-tooltip-dismissed";

interface FlagButtonProps {
  onFlag: () => void;
  disabled?: boolean;
}

export default function FlagButton({ onFlag, disabled }: FlagButtonProps) {
  const [pulsing, setPulsing] = useState(false);
  const [showTooltip, setShowTooltip] = useState(
    () => !localStorage.getItem(TOOLTIP_STORAGE_KEY)
  );
  const tooltipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (showTooltip) {
      tooltipTimeoutRef.current = setTimeout(() => {
        setShowTooltip(false);
        localStorage.setItem(TOOLTIP_STORAGE_KEY, "1");
      }, 12000);
    }
    return () => {
      if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
    };
  }, [showTooltip]);

  const dismissTooltip = useCallback(() => {
    setShowTooltip(false);
    localStorage.setItem(TOOLTIP_STORAGE_KEY, "1");
    if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
  }, []);

  const handleClick = useCallback(() => {
    if (disabled || pulsing) return;
    onFlag();
    setPulsing(true);
    setTimeout(() => setPulsing(false), 1000);

    if (!localStorage.getItem(STORAGE_KEY)) {
      localStorage.setItem(STORAGE_KEY, "1");
    }
    if (showTooltip) {
      dismissTooltip();
    }
  }, [onFlag, disabled, pulsing, showTooltip, dismissTooltip]);

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="flag-button"
        onClick={handleClick}
        disabled={disabled || pulsing}
        title="Mark this moment for later annotation"
        className={`flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs transition-all duration-200 ${
          pulsing
            ? "border-amber-400 bg-amber-100 text-amber-600 scale-105"
            : "border-gray-300 bg-white text-gray-500 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-500"
        } ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
      >
        {/* Lightbulb icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`h-3.5 w-3.5 ${pulsing ? "animate-bounce" : ""}`}
        >
          <path d="M10 1a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 1zM5.05 3.05a.75.75 0 011.06 0l1.062 1.06A.75.75 0 116.11 5.173L5.05 4.11a.75.75 0 010-1.06zm9.9 0a.75.75 0 010 1.06l-1.06 1.062a.75.75 0 01-1.062-1.061l1.061-1.06a.75.75 0 011.06 0zM10 7a3 3 0 00-2.905 3.75.75.75 0 01-.542.868l-.138.03A2.75 2.75 0 009.167 14.5h1.666a2.75 2.75 0 002.752-2.852l-.138-.03a.75.75 0 01-.542-.868A3 3 0 0010 7zM8.75 15.5a.75.75 0 00-.75.75 2 2 0 104 0 .75.75 0 00-.75-.75h-2.5z" />
        </svg>
        <span className="hidden sm:inline">Bookmark</span>
      </button>

      {/* One-time coach mark tooltip */}
      {showTooltip && !disabled && (
        <div className="absolute bottom-full right-0 z-30 mb-2 w-64 rounded-lg border border-indigo-200 bg-indigo-50 p-3 shadow-lg">
          <p className="text-xs leading-relaxed text-indigo-900">
            If you notice a moment where outside knowledge could help, tap
            this to bookmark it. You'll revisit these marks in the annotation
            stage to describe what a knowledgeable participant could have contributed.
          </p>
          <button
            onClick={dismissTooltip}
            className="mt-2 text-xs font-medium text-indigo-600 hover:text-indigo-800"
          >
            Got it
          </button>
          <div className="absolute -bottom-1.5 right-4 h-3 w-3 rotate-45 border-b border-r border-indigo-200 bg-indigo-50" />
        </div>
      )}
    </div>
  );
}
