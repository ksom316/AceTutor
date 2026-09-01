import { useEffect, useState, type RefObject } from "react";

/**
 * Largest whole-pixel cell size that lets a `cols × rows` grid fit inside
 * `ref`'s box, re-measured whenever that box changes. Puzzle boards use this to
 * fill the screen on start without ever spilling past it into a scrollbar.
 */
export function useFitSquare(
  ref: RefObject<HTMLElement | null>,
  cols: number,
  rows: number,
  gap = 2,
  { min = 16, max = 44 }: { min?: number; max?: number } = {},
) {
  const [cell, setCell] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height) return;
      const perCol = (width - gap * (cols - 1)) / cols;
      const perRow = (height - gap * (rows - 1)) / rows;
      const fit = Math.floor(Math.min(perCol, perRow));
      setCell(Math.min(max, Math.max(min, fit)));
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ref, cols, rows, gap, min, max]);

  return cell;
}
