import { useCallback, useRef, useState } from "react";
import { motion } from "framer-motion";
import { FileText, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";

type FileDropZoneProps = {
  accept: string;
  hint: string;
  file: File | null;
  onFile: (file: File | null) => void;
  maxSizeMb?: number;
};

export function FileDropZone({ accept, hint, file, onFile, maxSizeMb = 25 }: FileDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const pick = useCallback(
    (next: File | null) => {
      if (!next) {
        onFile(null);
        return;
      }
      const maxBytes = maxSizeMb * 1024 * 1024;
      if (next.size > maxBytes) {
        onFile(null);
        return;
      }
      onFile(next);
    },
    [maxSizeMb, onFile],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files.item(0);
    if (dropped) pick(dropped);
  };

  return (
    <div className="space-y-2">
      <motion.div
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        whileHover={{ y: -2 }}
        className={cn(
          "group relative cursor-pointer overflow-hidden rounded-2xl border-2 border-dashed p-8 text-center transition-colors",
          dragging
            ? "border-primary bg-primary/5"
            : "border-border bg-card/40 hover:border-primary/40 hover:bg-card/70",
        )}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,color-mix(in_oklab,var(--color-primary)_12%,transparent),transparent_70%)] opacity-0 transition-opacity group-hover:opacity-100"
        />
        <span className="relative mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary transition-transform duration-300 group-hover:scale-110">
          <Upload className="h-6 w-6" />
        </span>
        <p className="relative mt-4 text-sm font-medium">Drop your file here, or click to browse</p>
        <p className="relative mt-1 text-xs text-muted-foreground">{hint}</p>
        <p className="relative mt-1 text-xs text-muted-foreground">Max {maxSizeMb} MB</p>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => pick(e.target.files?.item(0) ?? null)}
        />
      </motion.div>

      {file && (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card/60 p-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <FileText className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{file.name}</p>
            <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
          </div>
          <button
            type="button"
            aria-label="Remove file"
            onClick={() => onFile(null)}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
