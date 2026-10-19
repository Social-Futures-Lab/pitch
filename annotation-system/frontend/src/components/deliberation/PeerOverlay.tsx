import { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from "react";
import ReactDOM from "react-dom";
import type { PeerAnnotation, Turn, Annotation } from "@/types";
import { getSpeakerColor } from "@/components/chat/ChatMessage";
import { getConversationTurnsRange } from "@/api/annotation";

export const PEER_COLORS = [
  { fill: "rgba(59, 130, 246, 0.25)", dot: "#3b82f6", border: "#3b82f6", name: "blue" },
  { fill: "rgba(168, 85, 247, 0.25)", dot: "#a855f7", border: "#a855f7", name: "purple" },
  { fill: "rgba(249, 115, 22, 0.25)", dot: "#f97316", border: "#f97316", name: "orange" },
  { fill: "rgba(236, 72, 153, 0.25)", dot: "#ec4899", border: "#ec4899", name: "pink" },
  { fill: "rgba(16, 185, 129, 0.25)", dot: "#10b981", border: "#10b981", name: "emerald" },
  { fill: "rgba(234, 179, 8, 0.25)", dot: "#ca8a04", border: "#ca8a04", name: "gold" },
];

// Color for the user's own original annotation (warm amber color to distinguish from blue editable selection)
export const OWN_COLOR = { fill: "rgba(251, 191, 36, 0.25)", dot: "#f59e0b", border: "#f59e0b", name: "amber" };

// Grayed color scheme for should-not-appear annotations
export const GRAYED_COLOR = { fill: "rgba(209, 213, 219, 0.2)", dot: "#9ca3af", border: "#d1d5db", name: "gray" };

const STRIPE_WIDTH = 20;
const STRIPE_GAP = 2;

// Star icon component for best turn indicator
const StarIcon = ({ color }: { color: string }) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 12 12"
    fill={color}
    style={{
      filter: "drop-shadow(0 1px 2px rgba(0, 0, 0, 0.3))",
      stroke: "white",
      strokeWidth: "1.5px",
    }}
  >
    <path d="M6 1L7.5 4.5L11 5L8.5 7.5L9 11L6 9L3 11L3.5 7.5L1 5L4.5 4.5Z" />
  </svg>
);

// Custom tooltip wrapper component with React Portal to escape overflow:hidden clipping
const CustomTooltip = ({
  children,
  content,
}: {
  children: React.ReactNode;
  content: string;
}) => {
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, placement: 'top' as 'top' | 'bottom', align: 'center' as 'left' | 'center' | 'right' });

  const updatePosition = useCallback(() => {
    if (!triggerRef.current || !tooltipRef.current || !isVisible) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const margin = 16;
    const offset = 8;

    // Vertical positioning (top vs bottom)
    const spaceAbove = triggerRect.top;
    const spaceBelow = viewportHeight - triggerRect.bottom;
    const preferTop = spaceAbove > tooltipRect.height + margin || spaceAbove > spaceBelow;

    let top = preferTop
      ? triggerRect.top - tooltipRect.height - offset
      : triggerRect.bottom + offset;

    // Horizontal positioning (left vs center vs right alignment)
    const centeredLeft = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
    let left = centeredLeft;
    let align: 'left' | 'center' | 'right' = 'center';

    if (centeredLeft < margin) {
      align = 'left';
      left = triggerRect.left;
    } else if (centeredLeft + tooltipRect.width > viewportWidth - margin) {
      align = 'right';
      left = triggerRect.right - tooltipRect.width;
    }

    setPosition({
      top,
      left,
      placement: preferTop ? 'top' : 'bottom',
      align
    });
  }, [isVisible]);

  useLayoutEffect(() => {
    updatePosition();
  }, [updatePosition, isVisible, content]);

  useEffect(() => {
    if (!isVisible) return;
    const handleScroll = () => updatePosition();
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [isVisible, updatePosition]);

  const handleMouseEnter = () => setIsVisible(true);
  const handleMouseLeave = () => setIsVisible(false);

  const arrowOffset = position.align === 'left' ? 8 : position.align === 'right' ? tooltipRef.current ? tooltipRef.current.offsetWidth - 16 : 0 : '50%';

  const tooltipElement = isVisible ? (
    <div
      ref={tooltipRef}
      style={{
        position: 'fixed',
        top: `${position.top}px`,
        left: `${position.left}px`,
        zIndex: 9999,
      }}
      className="pointer-events-none whitespace-pre-line rounded-md bg-gray-900 px-3 py-2 text-xs text-white shadow-lg"
    >
      {content}
      <div
        style={{
          position: 'absolute',
          left: position.align === 'center' ? '50%' : position.align === 'left' ? '8px' : 'auto',
          right: position.align === 'right' ? '8px' : 'auto',
          transform: position.align === 'center' ? 'translateX(-50%)' : undefined,
          [position.placement === 'top' ? 'top' : 'bottom']: '100%',
        }}
        className={`border-4 border-transparent ${position.placement === 'top' ? 'border-t-gray-900' : 'border-b-gray-900'}`}
      />
    </div>
  ) : null;

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="inline-block"
      >
        {children}
      </div>
      {tooltipElement && ReactDOM.createPortal(tooltipElement, document.body)}
    </>
  );
};

export type SelectingFor = "start" | "end" | "best" | null;

// Legend panel to explain peer annotations
const LegendPanel = ({
  peers,
  ownOriginalAnnotation
}: {
  peers: PeerAnnotation[];
  ownOriginalAnnotation?: Annotation | null;
}) => {
  const activePeers = peers.filter((p) => !p.do_not_surface);
  const inactivePeers = peers.filter((p) => p.do_not_surface);
  const ownActive = ownOriginalAnnotation;

  if (activePeers.length === 0 && inactivePeers.length === 0 && !ownActive) return null;

  const ownColor = ownOriginalAnnotation?.do_not_surface ? GRAYED_COLOR : OWN_COLOR;
  const ownLabelSuffix = ownOriginalAnnotation?.do_not_surface ? " (Should not appear)" : "";

  return (
    <div className="shrink-0 border-b border-gray-200 bg-gray-50 px-4 py-2">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="font-semibold text-gray-700">Annotations:</span>
        {ownActive && (
          <CustomTooltip content={ownOriginalAnnotation.do_not_surface ? "Marked as should not appear\nYou decided not to surface this message" : "Your original annotation from the annotation stage"}>
            <div className="flex items-center gap-1.5" style={{ opacity: ownOriginalAnnotation.do_not_surface ? 0.6 : 1 }}>
              <div
                className="h-3 w-3 rounded-sm border-l-2"
                style={{
                  backgroundColor: ownColor.fill,
                  borderLeftColor: ownColor.border,
                  backgroundImage: ownOriginalAnnotation.do_not_surface
                    ? 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(156, 163, 175, 0.15) 2px, rgba(156, 163, 175, 0.15) 3px)'
                    : undefined,
                }}
              />
              <span className="font-medium text-gray-600">Y = Your original{ownLabelSuffix}</span>
            </div>
          </CustomTooltip>
        )}
        {activePeers.map((peer, idx) => {
          const peerColor = PEER_COLORS[idx % PEER_COLORS.length];
          const initial = peer.annotator_label
            .replace("Annotator ", "")
            .replace("Original author", "O")
            .charAt(0);
          return (
            <div key={idx} className="flex items-center gap-1.5">
              <div
                className="h-3 w-3 rounded-sm border-l-2"
                style={{
                  backgroundColor: peerColor.fill,
                  borderLeftColor: peerColor.border,
                }}
              />
              <span className="font-medium text-gray-600">
                {initial} = {peer.annotator_label}
              </span>
            </div>
          );
        })}
        {inactivePeers.map((peer, idx) => {
          const initial = peer.annotator_label
            .replace("Annotator ", "")
            .replace("Original author", "O")
            .charAt(0);
          return (
            <div key={`inactive-${idx}`} className="flex items-center gap-1.5" style={{ opacity: 0.6 }}>
              <div
                className="h-3 w-3 rounded-sm border-l-2"
                style={{
                  backgroundColor: GRAYED_COLOR.fill,
                  borderLeftColor: GRAYED_COLOR.border,
                  backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(156, 163, 175, 0.15) 2px, rgba(156, 163, 175, 0.15) 3px)',
                }}
              />
              <span className="font-medium text-gray-600">
                {initial} = {peer.annotator_label} (Should not appear)
              </span>
            </div>
          );
        })}
        <div className="flex items-center gap-1">
          <StarIcon color="#6b7280" />
          <span className="text-gray-500">= Best turn</span>
        </div>
      </div>
    </div>
  );
};

interface PeerOverlayProps {
  peers: PeerAnnotation[];
  turns: Turn[];
  speakerMap: Map<string, number>;
  ownWindow: {
    startTurn: number | null;
    endTurn: number | null;
    bestTurn: number | null;
  };
  doNotSurface: boolean;
  selectingFor: SelectingFor;
  onTurnClick: (turnNumber: number) => void;
  conversationId?: string;
  conversationMinTurn?: number;
  conversationMaxTurn?: number;
  onExtendsBeforeChange?: (value: boolean) => void;
  onExtendsAfterChange?: (value: boolean) => void;
  onDisplayedTurnCountChange?: (count: number) => void;
  ownOriginalAnnotation?: Annotation | null; // User's frozen original annotation from cross-annotation phase
}

export default function PeerOverlay({
  peers,
  turns: initialTurns,
  speakerMap: initialSpeakerMap,
  ownWindow,
  doNotSurface,
  selectingFor,
  onTurnClick,
  conversationId,
  conversationMinTurn,
  conversationMaxTurn,
  onExtendsBeforeChange,
  onExtendsAfterChange,
  onDisplayedTurnCountChange,
  ownOriginalAnnotation,
}: PeerOverlayProps) {
  const [extraTurnsBefore, setExtraTurnsBefore] = useState<Turn[]>([]);
  const [extraTurnsAfter, setExtraTurnsAfter] = useState<Turn[]>([]);

  const allTurns = useMemo(
    () => [...extraTurnsBefore, ...initialTurns, ...extraTurnsAfter],
    [extraTurnsBefore, initialTurns, extraTurnsAfter]
  );

  useEffect(() => {
    onDisplayedTurnCountChange?.(allTurns.length);
  }, [allTurns.length, onDisplayedTurnCountChange]);

  // Load all conversation turns on mount
  useEffect(() => {
    if (!conversationId || conversationMinTurn == null || conversationMaxTurn == null) return;
    let cancelled = false;

    async function loadAll() {
      const firstExcerptTurn = initialTurns.length > 0 ? initialTurns[0].turn_number : null;
      const lastExcerptTurn = initialTurns.length > 0 ? initialTurns[initialTurns.length - 1].turn_number : null;

      if (firstExcerptTurn != null && firstExcerptTurn > conversationMinTurn!) {
        const before = await getConversationTurnsRange(conversationId!, conversationMinTurn!, firstExcerptTurn - 1);
        if (!cancelled) {
          setExtraTurnsBefore(before);
          onExtendsBeforeChange?.(true);
        }
      }
      if (lastExcerptTurn != null && lastExcerptTurn < conversationMaxTurn!) {
        const after = await getConversationTurnsRange(conversationId!, lastExcerptTurn + 1, conversationMaxTurn!);
        if (!cancelled) {
          setExtraTurnsAfter(after);
          onExtendsAfterChange?.(true);
        }
      }
    }

    loadAll();
    return () => { cancelled = true; };
  }, [conversationId, conversationMinTurn, conversationMaxTurn, initialTurns, onExtendsBeforeChange, onExtendsAfterChange]);

  const speakerMap = useMemo(() => {
    if (extraTurnsBefore.length === 0 && extraTurnsAfter.length === 0) {
      return initialSpeakerMap;
    }
    const map = new Map<string, number>();
    let idx = 0;
    for (const turn of allTurns) {
      if (!map.has(turn.speaker_id)) {
        map.set(turn.speaker_id, idx++);
      }
    }
    return map;
  }, [allTurns, initialSpeakerMap, extraTurnsBefore.length, extraTurnsAfter.length]);

  // Filter out do-not-surface annotations for peers only
  const activePeers = peers.filter((p) => !p.do_not_surface);
  // Always show own annotation if it exists (will be grayed if do_not_surface)
  const ownActive = ownOriginalAnnotation;
  const totalStripes = activePeers.length + (ownActive ? 1 : 0);
  const stripeAreaWidth =
    totalStripes > 0
      ? totalStripes * STRIPE_WIDTH + (totalStripes - 1) * STRIPE_GAP
      : 0;

  const isSelectable = (turnNumber: number): boolean => {
    if (!selectingFor || doNotSurface) return false;
    if (selectingFor === "end") {
      return ownWindow.startTurn !== null && turnNumber >= ownWindow.startTurn;
    }
    if (selectingFor === "best") {
      return (
        ownWindow.startTurn !== null &&
        ownWindow.endTurn !== null &&
        turnNumber >= ownWindow.startTurn &&
        turnNumber <= ownWindow.endTurn
      );
    }
    return true;
  };

  const getHintText = () => {
    if (doNotSurface) return "Placement disabled (marked as should not appear)";
    if (!selectingFor) return null;
    switch (selectingFor) {
      case "start":
        return "Click a turn to set as the FIRST relevant turn";
      case "end":
        return "Click a turn at or after the start to set as the LAST useful turn";
      case "best":
        return "Click a turn within the first-last range to set as the BEST turn";
    }
  };

  const hint = getHintText();

  return (
    <div className="flex h-full flex-col">
      <LegendPanel peers={peers} ownOriginalAnnotation={ownOriginalAnnotation} />
      {hint && (
        <div className={`shrink-0 border-b px-4 py-2 ${doNotSurface ? "border-gray-200 bg-gray-50" : "border-indigo-200 bg-indigo-50"}`}>
          <p className={`text-xs font-medium ${doNotSurface ? "text-gray-400" : "text-indigo-700"}`}>
            {hint}
          </p>
        </div>
      )}

      {/* Column header row with letter labels */}
      {totalStripes > 0 && (
        <div className="sticky top-0 z-20 bg-white border-b border-gray-200 pb-1 pt-3 px-3">
          <div className="flex">
            <div
              className="flex shrink-0 ml-2 mr-3"
              style={{ width: stripeAreaWidth, gap: STRIPE_GAP }}
            >
              {ownActive && (
                <div
                  style={{ width: STRIPE_WIDTH }}
                  className="flex items-center justify-center"
                >
                  <span
                    className="text-xs font-bold"
                    style={{ color: ownOriginalAnnotation.do_not_surface ? GRAYED_COLOR.dot : OWN_COLOR.border }}
                  >
                    Y
                  </span>
                </div>
              )}
              {activePeers.map((peer, idx) => {
                const color = PEER_COLORS[idx % PEER_COLORS.length];
                const initial = peer.annotator_label
                  .replace("Annotator ", "")
                  .replace("Original author", "O")
                  .charAt(0);
                return (
                  <div
                    key={idx}
                    style={{ width: STRIPE_WIDTH }}
                    className="flex items-center justify-center"
                  >
                    <span
                      className="text-xs font-bold"
                      style={{ color: color.border }}
                    >
                      {initial}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="flex-1" /> {/* Spacer for turn card area */}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3">
        <div className="space-y-1.5">
          {allTurns.map((turn) => {
            const speakerIndex = speakerMap.get(turn.speaker_id) ?? 0;
            const color = getSpeakerColor(speakerIndex);
            const tn = turn.turn_number;

            const inOwnWindow =
              !doNotSurface &&
              ownWindow.startTurn !== null &&
              ownWindow.endTurn !== null &&
              tn >= ownWindow.startTurn &&
              tn <= ownWindow.endTurn;
            const isOwnStartOnly =
              !doNotSurface &&
              ownWindow.startTurn !== null &&
              ownWindow.endTurn === null &&
              tn === ownWindow.startTurn;
            const isOwnBest = !doNotSurface && ownWindow.bestTurn === tn;
            const isOwnStart = !doNotSurface && ownWindow.startTurn === tn && ownWindow.endTurn !== null;
            const isOwnEnd = !doNotSurface && ownWindow.endTurn === tn && ownWindow.startTurn !== null;

            let ownBg = "";
            if (inOwnWindow) {
              ownBg = "bg-indigo-50 ring-1 ring-inset ring-indigo-300";
            } else if (isOwnStartOnly) {
              ownBg = "bg-green-50 ring-1 ring-inset ring-green-400";
            }

            // Create stripe data for peer annotations
            const peerStripes = activePeers.map((peer, peerIdx) => {
              const peerColor = PEER_COLORS[peerIdx % PEER_COLORS.length];
              const inRange =
                peer.window_start_turn_number !== null &&
                peer.window_end_turn_number !== null &&
                tn >= peer.window_start_turn_number &&
                tn <= peer.window_end_turn_number;
              const isBest = peer.best_turn_number === tn;
              return { peerColor, inRange, isBest, label: peer.annotator_label };
            });

            // Create stripe data for own original annotation (shown separately from current editable state)
            const ownStripe = ownActive ? {
              ownColor: ownOriginalAnnotation.do_not_surface ? GRAYED_COLOR : OWN_COLOR,
              inRange: ownOriginalAnnotation.window_start_turn_number !== null &&
                       ownOriginalAnnotation.window_end_turn_number !== null &&
                       tn >= ownOriginalAnnotation.window_start_turn_number &&
                       tn <= ownOriginalAnnotation.window_end_turn_number,
              isBest: ownOriginalAnnotation.best_turn_number === tn,
              label: 'Your original',
              isDoNotSurface: ownOriginalAnnotation.do_not_surface
            } : null;

            const selectable = isSelectable(tn);
            const clickable = !!selectingFor && selectable && !doNotSurface;

            return (
              <div
                key={turn.id}
                data-testid={`delib-turn-${turn.turn_number}`}
                className="relative flex"
              >
                {stripeAreaWidth > 0 && (
                  <div
                    className="flex shrink-0 ml-2 mr-3"
                    style={{ width: stripeAreaWidth, gap: STRIPE_GAP }}
                  >
                    {/* Render own original annotation stripe FIRST (leftmost) */}
                    {ownStripe && (() => {
                      const isOwnStart = ownOriginalAnnotation?.window_start_turn_number === tn;
                      const isOwnEnd = ownOriginalAnnotation?.window_end_turn_number === tn;

                      // Build tooltip content
                      const windowRange = ownOriginalAnnotation?.window_start_turn_number && ownOriginalAnnotation?.window_end_turn_number
                        ? `Window: Turn #${ownOriginalAnnotation.window_start_turn_number} → #${ownOriginalAnnotation.window_end_turn_number}`
                        : "";
                      const bestTurnText = ownOriginalAnnotation?.best_turn_number
                        ? `Best turn: #${ownOriginalAnnotation.best_turn_number}`
                        : "";

                      const ownStripeTooltip = ownStripe.isDoNotSurface
                        ? `Your original annotation — Marked as 'should not appear'\nYou decided this message should not be shown during the annotation stage.`
                        : `Your original annotation\n${windowRange}\n${bestTurnText}`;
                      const ownBestTurnTooltip = `Your original annotation — Best Turn (#${ownOriginalAnnotation?.best_turn_number})\n"Most important moment in your selected range"\n${windowRange}`;

                      return (
                        <div
                          key="own"
                          className="relative"
                          style={{
                            width: STRIPE_WIDTH,
                            minHeight: "100%",
                            opacity: ownStripe.isDoNotSurface ? 0.6 : 1
                          }}
                        >
                          {/* Window range stripe */}
                          {ownStripe.inRange && (
                            <CustomTooltip content={ownStripeTooltip}>
                              <div
                                className="absolute inset-0 rounded-sm flex items-center justify-center"
                                style={{
                                  backgroundColor: ownStripe.ownColor.fill,
                                  borderLeft: `3px solid ${ownStripe.ownColor.border}`,
                                  backgroundImage: ownStripe.isDoNotSurface
                                    ? 'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(156, 163, 175, 0.15) 4px, rgba(156, 163, 175, 0.15) 5px)'
                                    : undefined,
                                }}
                              >
                                {ownStripe.isDoNotSurface && (
                                  <span className="text-gray-500 text-[10px] font-medium">
                                    N/A
                                  </span>
                                )}
                                {!ownStripe.isDoNotSurface && isOwnStart && (
                                  <span
                                    className="text-[10px] font-bold leading-none"
                                    style={{ color: ownStripe.ownColor.dot }}
                                  >
                                    Y
                                  </span>
                                )}
                              </div>
                            </CustomTooltip>
                          )}

                          {/* Best turn indicator with star icon and subtle pulse animation */}
                          {ownStripe.isBest && !ownStripe.isDoNotSurface && (
                            <CustomTooltip content={ownBestTurnTooltip}>
                              <div
                                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 flex items-center justify-center"
                                style={{
                                  animation: "pulse-subtle 1.5s ease-in-out infinite",
                                }}
                              >
                                <StarIcon color={ownStripe.ownColor.dot} />
                              </div>
                            </CustomTooltip>
                          )}
                        </div>
                      );
                    })()}

                    {/* Render peer annotation stripes */}
                    {peerStripes.map((ps, sIdx) => {
                      const peer = activePeers[sIdx];
                      const initial = ps.label.replace("Annotator ", "").replace("Original author", "O").charAt(0);
                      const isStart = peer?.window_start_turn_number === tn;
                      const isEnd = peer?.window_end_turn_number === tn;
                      const tooltipLabel = ps.label === "Original author"
                        ? "Original author's annotation"
                        : `${ps.label}'s annotation`;

                      // Build tooltip content
                      const windowRange = peer?.window_start_turn_number && peer?.window_end_turn_number
                        ? `Window: Turn #${peer.window_start_turn_number} → #${peer.window_end_turn_number}`
                        : "";
                      const bestTurnText = peer?.best_turn_number
                        ? `Best turn: #${peer.best_turn_number}`
                        : "";

                      const stripeTooltip = ps.inRange
                        ? `${tooltipLabel}\n${windowRange}\n${bestTurnText}`
                        : "";

                      const bestTurnTooltip = `${tooltipLabel} — Best Turn (#${peer?.best_turn_number})\n"Most important moment in their selected range"\n${windowRange}`;

                      return (
                        <div
                          key={sIdx}
                          className="relative"
                          style={{ width: STRIPE_WIDTH, minHeight: "100%" }}
                        >
                          {/* Window range stripe */}
                          {ps.inRange && (
                            <CustomTooltip content={stripeTooltip}>
                              <div
                                className="absolute inset-0 rounded-sm flex items-center justify-center"
                                style={{
                                  backgroundColor: ps.peerColor.fill,
                                  borderLeft: `3px solid ${ps.peerColor.border}`,
                                }}
                              >
                                {isStart && (
                                  <span
                                    className="text-[10px] font-bold leading-none"
                                    style={{ color: ps.peerColor.dot }}
                                  >
                                    {initial}
                                  </span>
                                )}
                              </div>
                            </CustomTooltip>
                          )}

                          {/* Best turn indicator with star icon and subtle pulse animation */}
                          {ps.isBest && (
                            <CustomTooltip content={bestTurnTooltip}>
                              <div
                                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 flex items-center justify-center"
                                style={{
                                  animation: "pulse-subtle 1.5s ease-in-out infinite",
                                }}
                              >
                                <StarIcon color={ps.peerColor.dot} />
                              </div>
                            </CustomTooltip>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div
                  onClick={() => clickable && onTurnClick(tn)}
                  className={`group relative min-w-0 flex-1 rounded-md border border-transparent px-3 py-2 transition-colors ${
                    clickable
                      ? "cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/50"
                      : doNotSurface
                        ? "opacity-50"
                        : selectingFor && !selectable
                          ? "opacity-40"
                          : ""
                  } ${ownBg}`}
                >
                  {isOwnStart && !doNotSurface && (
                    <span className="absolute right-0 top-0 z-10 rounded-bl bg-green-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      FIRST
                    </span>
                  )}
                  {isOwnEnd && !doNotSurface && (
                    <span
                      className="absolute top-0 z-10 rounded-bl bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white"
                      style={{ right: isOwnStart ? '2.25rem' : '0' }}
                    >
                      LAST
                    </span>
                  )}
                  {isOwnBest && !doNotSurface && (
                    <span className="absolute bottom-0 right-0 z-10 rounded-tl bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      BEST
                    </span>
                  )}

                  {turn.flagged && (
                    <span
                      className="absolute -left-1 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-amber-400"
                      title="Flagged turn"
                    />
                  )}

                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0 font-mono text-xs text-gray-400">
                      #{turn.turn_number}
                    </span>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold ${color.bg} ${color.text}`}
                    >
                      {turn.speaker_name}
                    </span>
                    <p className="flex-1 text-sm leading-relaxed text-gray-700">
                      {turn.text}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}

        </div>
      </div>
    </div>
  );
}
