import { useState } from "react";
import { HelpCircle, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DIFFICULTY_HELP, DIFFICULTY_HELP_NOTE } from "@/lib/quiz-difficulty";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  CHOICE_MAX,
  cleanDraft,
  DIFFICULTY_LABEL,
  MAX_CHOICES,
  MIN_CHOICES,
  PROMPT_MAX,
  type QuizDraft,
} from "@/lib/quiz-shared";

/**
 * Add / edit one multiple-choice question. Shared by the standalone quiz
 * builder and the "Create module" quiz step. Give it a `key` that changes with
 * the edit target so it re-seeds from `initial`.
 */
export function QuizQuestionDialog({
  open,
  title,
  initial,
  saving,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  initial: QuizDraft;
  saving: boolean;
  onClose: () => void;
  onSubmit: (draft: QuizDraft) => void;
}) {
  const [prompt, setPrompt] = useState(initial.prompt);
  const [choices, setChoices] = useState<string[]>(
    initial.choices.length >= MIN_CHOICES ? initial.choices : ["", "", "", ""],
  );
  const [correctIndex, setCorrectIndex] = useState(initial.correctIndex);
  const [explanation, setExplanation] = useState(initial.explanation);
  const [difficulty, setDifficulty] = useState(initial.difficulty);
  const [touched, setTouched] = useState(false);

  const draft: QuizDraft = { prompt, choices, correctIndex, explanation, difficulty };
  const clean = cleanDraft(draft);
  const promptError = !prompt.trim()
    ? "Enter the question."
    : prompt.length > PROMPT_MAX
      ? `Keep the question under ${PROMPT_MAX} characters.`
      : null;
  const choiceError =
    choices.map((c) => c.trim()).filter(Boolean).length < MIN_CHOICES
      ? `Add at least ${MIN_CHOICES} answer options.`
      : !clean
        ? "Options must be unique, and the correct answer can't be blank."
        : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Pick the one correct answer. Students see the options in this order.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="q-prompt">Question</Label>
            <Textarea
              id="q-prompt"
              value={prompt}
              rows={2}
              maxLength={PROMPT_MAX + 50}
              onChange={(e) => setPrompt(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="e.g. Which data structure gives O(1) average-case lookup?"
            />
            {touched && promptError && <p className="text-xs text-destructive">{promptError}</p>}
          </div>

          <div className="space-y-2">
            <Label>Answer options</Label>
            {choices.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="correct-choice"
                  aria-label={`Mark option ${String.fromCharCode(65 + i)} correct`}
                  checked={correctIndex === i}
                  onChange={() => setCorrectIndex(i)}
                  className="h-4 w-4 shrink-0 accent-primary"
                />
                <Input
                  value={c}
                  maxLength={CHOICE_MAX}
                  placeholder={`Option ${String.fromCharCode(65 + i)}`}
                  onChange={(e) =>
                    setChoices((prev) => prev.map((p, pi) => (pi === i ? e.target.value : p)))
                  }
                  onBlur={() => setTouched(true)}
                />
                {choices.length > MIN_CHOICES && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-9 w-9 shrink-0"
                    aria-label={`Remove option ${String.fromCharCode(65 + i)}`}
                    onClick={() => {
                      setChoices((prev) => prev.filter((_, pi) => pi !== i));
                      setCorrectIndex((x) => (x === i ? 0 : x > i ? x - 1 : x));
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            {choices.length < MAX_CHOICES && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setChoices((prev) => [...prev, ""])}
              >
                <Plus className="mr-1.5 h-4 w-4" /> Add option
              </Button>
            )}
            {touched && choiceError && <p className="text-xs text-destructive">{choiceError}</p>}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Label>Difficulty</Label>
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
                    {DIFFICULTY_HELP.filter((h) => ["Easy", "Medium", "Hard"].includes(h.term)).map(
                      (h) => (
                        <div key={h.term}>
                          <dt className="font-medium text-foreground">{h.term}</dt>
                          <dd className="text-muted-foreground">{h.body}</dd>
                        </div>
                      ),
                    )}
                  </dl>
                  <p className="mt-3 border-t border-border pt-2 text-muted-foreground">
                    {DIFFICULTY_HELP_NOTE}
                  </p>
                </PopoverContent>
              </Popover>
            </div>
            <Select value={String(difficulty)} onValueChange={(v) => setDifficulty(Number(v))}>
              <SelectTrigger className="sm:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5].map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {DIFFICULTY_LABEL[d]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="q-explanation">Explanation (optional)</Label>
            <Textarea
              id="q-explanation"
              value={explanation}
              rows={2}
              onChange={(e) => setExplanation(e.target.value)}
              placeholder="Shown to students on the results page."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            disabled={saving || !clean}
            onClick={() => {
              setTouched(true);
              if (clean) onSubmit(draft);
            }}
          >
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Save question
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
