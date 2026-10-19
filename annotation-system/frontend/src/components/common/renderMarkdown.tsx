import type { ReactNode } from "react";

export function renderMarkdown(text: string): ReactNode {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={i}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-indigo-600 underline hover:text-indigo-800"
        >
          {linkMatch[1]}
        </a>
      );
    }
    const boldMatch = part.match(/^\*\*([^*]+)\*\*$/);
    if (boldMatch) {
      return <strong key={i}>{boldMatch[1]}</strong>;
    }
    const italicMatch = part.match(/^\*([^*]+)\*$/);
    if (italicMatch) {
      return <em key={i}>{italicMatch[1]}</em>;
    }
    return part;
  });
}
