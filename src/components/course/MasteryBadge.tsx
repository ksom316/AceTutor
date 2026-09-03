import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  masteryBadgeClasses,
  masteryLabel,
  type MasteryLevel,
  type ModuleMastery,
} from "@/lib/mastery";

/**
 * Shared mastery chip + trend hint, so every student and lecturer surface shows
 * mastery identically. `score` is optional — omit it (or pass null) for a
 * level-only badge, e.g. "Not assessed".
 */
export function MasteryBadge({
  level,
  score,
  className,
}: {
  level: MasteryLevel;
  score?: number | null;
  className?: string;
}) {
  const hasScore = typeof score === "number";
  return (
    <Badge variant="outline" className={cn("font-medium", masteryBadgeClasses(level), className)}>
      {hasScore ? `${score}% · ` : ""}
      {masteryLabel(level)}
    </Badge>
  );
}

/** "↑ 12 pts vs previous quiz" style hint. Renders nothing when there is no
 *  previous completed attempt to compare against. */
export function MasteryTrend({
  mastery,
  className,
}: {
  mastery: ModuleMastery;
  className?: string;
}) {
  if (!mastery.trend) return null;

  if (mastery.trend === "same") {
    return (
      <span
        className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground", className)}
      >
        <Minus className="h-3.5 w-3.5" /> No change vs previous quiz
      </span>
    );
  }

  const up = mastery.trend === "improved";
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  const n = Math.abs(mastery.deltaPoints ?? 0);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium",
        up ? "text-success" : "text-destructive",
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {up ? "Improved" : "Declined"} {n} pt{n === 1 ? "" : "s"} vs previous quiz
    </span>
  );
}
