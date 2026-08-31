import { HelpCircle } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DEFAULT_DIFFICULTY_MODE,
  DIFFICULTY_HELP,
  DIFFICULTY_HELP_NOTE,
  DIFFICULTY_MODE_LABEL,
  DIFFICULTY_MODES,
  type DifficultyMode,
} from "@/lib/quiz-difficulty";

/**
 * "Question difficulty" control for AI quiz generation, with an inline
 * "How does difficulty work?" popover. Shared by the standalone quiz builder
 * (module + general course quizzes) and the Create-module quiz step. The chosen
 * mode is passed to generateModuleQuiz and steers the AI prompt server-side;
 * "Let AI decide" is the default and reproduces the previous behaviour.
 */
export function DifficultyModeField({
  value,
  onChange,
  disabled,
  id = "ai-difficulty",
}: {
  value: DifficultyMode;
  onChange: (mode: DifficultyMode) => void;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Label htmlFor={id}>Question difficulty</Label>
        <Popover>
          <PopoverTrigger
            type="button"
            className="inline-flex items-center gap-1 rounded-full text-xs text-muted-foreground transition-colors hover:text-foreground"
            aria-label="How does difficulty work?"
          >
            <HelpCircle className="h-3.5 w-3.5" />
            How does difficulty work?
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 text-xs">
            <p className="text-sm font-medium">How difficulty works</p>
            <dl className="mt-2 space-y-2">
              {DIFFICULTY_HELP.map((h) => (
                <div key={h.term}>
                  <dt className="font-medium text-foreground">{h.term}</dt>
                  <dd className="text-muted-foreground">{h.body}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 border-t border-border pt-2 text-muted-foreground">
              {DIFFICULTY_HELP_NOTE}
            </p>
          </PopoverContent>
        </Popover>
      </div>
      <Select
        value={value}
        onValueChange={(v) => onChange(v as DifficultyMode)}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="sm:w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DIFFICULTY_MODES.map((m) => (
            <SelectItem key={m} value={m}>
              {DIFFICULTY_MODE_LABEL[m]}
              {m === DEFAULT_DIFFICULTY_MODE ? " (default)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
