import { useCallback, useRef, useEffect, useState } from "react";

interface ResizeHandleProps {
  onResize: (leftWidthPercent: number) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export default function ResizeHandle({
  onResize,
  containerRef,
}: ResizeHandleProps) {
  const [isDragging, setIsDragging] = useState(false);
  const draggingRef = useRef(false);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      draggingRef.current = true;
    },
    []
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percent = Math.min(Math.max((x / rect.width) * 100, 25), 75);
      onResize(percent);
    };

    const handleMouseUp = () => {
      draggingRef.current = false;
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, onResize, containerRef]);

  return (
    <div
      onMouseDown={handleMouseDown}
      className={`hidden lg:flex w-2 shrink-0 cursor-col-resize items-center justify-center transition-colors ${
        isDragging ? "bg-indigo-200" : "bg-gray-100 hover:bg-gray-200"
      }`}
      title="Drag to resize panels"
    >
      <div className="flex flex-col gap-1">
        <div
          className={`h-1 w-1 rounded-full ${
            isDragging ? "bg-indigo-500" : "bg-gray-400"
          }`}
        />
        <div
          className={`h-1 w-1 rounded-full ${
            isDragging ? "bg-indigo-500" : "bg-gray-400"
          }`}
        />
        <div
          className={`h-1 w-1 rounded-full ${
            isDragging ? "bg-indigo-500" : "bg-gray-400"
          }`}
        />
      </div>
    </div>
  );
}
