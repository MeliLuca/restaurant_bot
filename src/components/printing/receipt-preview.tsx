"use client";

// On-screen thermal paper for a PrintDoc — the very structure render.ts
// encodes to ESC/POS, so the preview can't disagree with the printer.
//
// Geometry: the paper is `cols(Font A)` monospace cells wide. Every line is
// padded to its own column count and scaled horizontally by its magnification
// (Font B is narrower and shorter), so a 2× line of 24 chars spans exactly
// the same width as a normal line of 48, just like on the head.

import { Scissors, TriangleAlert } from "lucide-react";
import type { PaperSize } from "@/lib/database.types";
import type { DocLine, PrintDoc } from "@/lib/printing/layout";
import { columnsFor } from "@/lib/printing/layout";
import { cn } from "@/lib/utils";

// Font B cell is 9×17 dots against Font A's 12×24
const FONT_B_HEIGHT = 17 / 24;

interface ReceiptPreviewProps {
  doc: PrintDoc;
  paper: PaperSize;
  /** Base character size in px; the card thumbnails use a smaller one */
  fontSize?: number;
  selectedBlockId?: string | null;
  onSelectBlock?: (blockId: string) => void;
  className?: string;
  /** Labels for the end-of-ticket markers (already translated) */
  cutLabel?: string;
  tearLabel?: string;
  overflowLabel?: string;
}

/** A too-long line wraps on the printer one character past the edge */
function visualChunks(line: DocLine): string[] {
  if (!line.overflow) return [line.text];
  const chunks: string[] = [];
  for (let i = 0; i < line.text.length; i += line.cols) {
    chunks.push(line.text.slice(i, i + line.cols));
  }
  return chunks;
}

function PaperLine({
  text,
  line,
  paper,
  lineHeight,
  selected,
  clickable,
  onClick,
  overflowLabel,
}: {
  text: string;
  line: DocLine;
  paper: PaperSize;
  lineHeight: number;
  selected: boolean;
  clickable: boolean;
  onClick?: () => void;
  overflowLabel?: string;
}) {
  const { style, cols } = line;
  const colsA = columnsFor(paper, "A", 1);
  const scaleX = colsA / cols;
  const scaleY = style.height * (style.font === "B" ? FONT_B_HEIGHT : 1);
  const free = Math.max(0, cols - text.length);
  const lead =
    style.align === "center" ? Math.floor(free / 2) : style.align === "right" ? free : 0;

  return (
    <div
      onClick={onClick}
      title={line.overflow ? overflowLabel : undefined}
      className={cn(
        "relative",
        clickable && "cursor-pointer hover:bg-black/5",
        selected && "bg-sky-200/60 hover:bg-sky-200/80",
        line.overflow && "shadow-[inset_3px_0_0_0_#dc2626]",
      )}
      style={{ height: lineHeight * scaleY }}
    >
      <div
        className="absolute left-0 top-0 whitespace-pre"
        style={{
          width: `${cols}ch`,
          transform: `scale(${scaleX}, ${scaleY})`,
          transformOrigin: "0 0",
          lineHeight: `${lineHeight}px`,
          fontWeight: style.bold ? 700 : 400,
        }}
      >
        {" ".repeat(lead)}
        <span
          className={cn(style.invert && "bg-black text-white")}
          style={{ textDecoration: style.underline ? "underline" : undefined }}
        >
          {text || " "}
        </span>
      </div>
    </div>
  );
}

export function ReceiptPreview({
  doc,
  paper,
  fontSize = 13,
  selectedBlockId,
  onSelectBlock,
  className,
  cutLabel,
  tearLabel,
  overflowLabel,
}: ReceiptPreviewProps) {
  const colsA = columnsFor(paper, "A", 1);
  const lineHeight = Math.round(fontSize * 1.3);
  const overflowCount = doc.lines.filter((l) => l.overflow).length;

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <div
        className="rounded-sm bg-white font-mono text-black shadow-md ring-1 ring-black/10"
        style={{ fontSize, padding: `${lineHeight}px ${fontSize}px` }}
      >
        <div style={{ width: `${colsA}ch` }}>
          {doc.lines.flatMap((line, i) =>
            visualChunks(line).map((chunk, j) => (
              <PaperLine
                key={`${i}-${j}`}
                text={chunk}
                line={line}
                paper={paper}
                lineHeight={lineHeight}
                selected={!!selectedBlockId && line.blockId === selectedBlockId}
                clickable={!!onSelectBlock && !!line.blockId}
                onClick={
                  onSelectBlock && line.blockId
                    ? () => onSelectBlock(line.blockId!)
                    : undefined
                }
                overflowLabel={overflowLabel}
              />
            )),
          )}
          {Array.from({ length: doc.feedLines }, (_, i) => (
            <div key={`feed-${i}`} style={{ height: lineHeight }} />
          ))}
        </div>
        <div
          className="mt-3 flex items-center gap-2 border-t border-dashed border-black/40 pt-1 text-[11px] text-black/50"
          style={{ fontFamily: "system-ui, sans-serif" }}
        >
          {doc.cut && <Scissors className="h-3 w-3" />}
          {doc.cut ? cutLabel : tearLabel}
        </div>
      </div>
      {overflowCount > 0 && overflowLabel && (
        <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <TriangleAlert className="h-3.5 w-3.5" />
          {overflowLabel} ({overflowCount})
        </p>
      )}
    </div>
  );
}
