import { useRef, useState } from "react";
import { FileUp, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import {
  formatBytes,
  isUploadedMaterialUrl,
  MATERIAL_RULES,
  type UploadKind,
  validateMaterialFile,
} from "@/lib/course-material-storage";
import {
  LESSON_TITLE_MAX,
  type LessonFormTarget,
  type LessonFormValue,
  type LessonModality,
  type LessonSource,
  isAllowedLessonMediaUrl,
  looksLikeUrl,
} from "@/lib/lesson-shared";

/**
 * Add / edit one lesson. Emits a {@link LessonFormValue} — the caller decides
 * whether to save it to the DB now (materials page) or hold it as a draft
 * (create-module flow). Give it a `key` that changes with the edit target so it
 * re-seeds from `target`.
 */
export function LessonFormDialog({
  open,
  target,
  saving,
  onClose,
  onSubmit,
}: {
  open: boolean;
  target: LessonFormTarget;
  saving: boolean;
  onClose: () => void;
  onSubmit: (value: LessonFormValue) => void;
}) {
  const editing = target.lesson;
  const pendingFile = target.pendingFile ?? null;

  const seededModality = ((editing?.modality as LessonModality) ?? "text") as LessonModality;
  const [modality, setModality] = useState<LessonModality>(seededModality);
  const [source, setSource] = useState<LessonSource>(
    editing &&
      (seededModality === "video" || seededModality === "audio") &&
      !isUploadedMaterialUrl(editing.media_url) &&
      !pendingFile
      ? "url"
      : "upload",
  );
  const [title, setTitle] = useState(editing?.title ?? "");
  const [body, setBody] = useState(editing?.body_md ?? "");
  const [url, setUrl] = useState(
    editing && !isUploadedMaterialUrl(editing.media_url) ? (editing.media_url ?? "") : "",
  );
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const hasKeepableFile = (!!editing && isUploadedMaterialUrl(editing.media_url)) || !!pendingFile;
  const keepsExistingFile =
    modality !== "text" && hasKeepableFile && (modality === "slides" || source === "upload");

  const isFileMode =
    modality === "slides" ||
    ((modality === "video" || modality === "audio") && source === "upload");
  const isUrlMode = (modality === "video" || modality === "audio") && source === "url";

  const titleInvalid = title.trim().length === 0 || title.length > LESSON_TITLE_MAX;
  const bodyInvalid = modality === "text" && body.trim().length === 0;
  const needFile = isFileMode && !file && !keepsExistingFile;
  const urlMalformed = isUrlMode && !looksLikeUrl(url);
  const urlNotAllowed = isUrlMode && looksLikeUrl(url) && !isAllowedLessonMediaUrl(url);
  const urlInvalid = urlMalformed || urlNotAllowed;
  const invalid = titleInvalid || bodyInvalid || needFile || urlInvalid || !!fileError;

  const rule = modality === "text" ? null : MATERIAL_RULES[modality as UploadKind];

  const pickFile = (picked: File | null) => {
    setTouched(true);
    if (!picked) {
      setFile(null);
      setFileError(null);
      return;
    }
    const err = validateMaterialFile(modality as UploadKind, picked);
    setFileError(err);
    setFile(err ? null : picked);
  };

  const submit = () => {
    setTouched(true);
    if (invalid) return;
    onSubmit({
      title,
      modality,
      source,
      body,
      url,
      // keep the carried-over pending file when the lecturer didn't re-pick one
      file: file ?? (keepsExistingFile ? pendingFile : null),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !saving && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit course content" : "Add course content"}</DialogTitle>
          <DialogDescription>
            Content appears on the module page in the matching Read / Watch / Listen / Slides tab.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select
              value={modality}
              onValueChange={(v) => setModality(v as LessonModality)}
              disabled={!!editing}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">Text</SelectItem>
                <SelectItem value="video">Video</SelectItem>
                <SelectItem value="audio">Audio</SelectItem>
                <SelectItem value="slides">Slides (PDF)</SelectItem>
              </SelectContent>
            </Select>
            {editing && (
              <p className="text-xs text-muted-foreground">
                The type can&apos;t be changed after content is created.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="lesson-title">Title</Label>
            <Input
              id="lesson-title"
              value={title}
              maxLength={LESSON_TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="e.g. Introduction to linked lists"
            />
            {touched && titleInvalid && <p className="text-xs text-destructive">Enter a title.</p>}
          </div>

          {modality === "text" && (
            <div className="space-y-1.5">
              <Label htmlFor="lesson-body">Content</Label>
              <Textarea
                id="lesson-body"
                value={body}
                rows={10}
                onChange={(e) => setBody(e.target.value)}
                onBlur={() => setTouched(true)}
                placeholder="Markdown is supported."
              />
              {touched && bodyInvalid && (
                <p className="text-xs text-destructive">Enter the lesson content.</p>
              )}
            </div>
          )}

          {(modality === "video" || modality === "audio") && (
            <div className="space-y-1.5">
              <Label>{modality === "video" ? "Video source" : "Audio source"}</Label>
              <div className="inline-flex rounded-lg border border-border p-0.5 text-sm">
                <button
                  type="button"
                  onClick={() => setSource("upload")}
                  className={cn(
                    "rounded-md px-3 py-1 transition-colors",
                    source === "upload"
                      ? "bg-secondary font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Upload {modality === "video" ? "video" : "audio"}
                </button>
                <button
                  type="button"
                  onClick={() => setSource("url")}
                  className={cn(
                    "rounded-md px-3 py-1 transition-colors",
                    source === "url"
                      ? "bg-secondary font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Use URL
                </button>
              </div>
            </div>
          )}

          {isUrlMode && (
            <div className="space-y-1.5">
              <Label htmlFor="lesson-url">
                {modality === "video" ? "Video embed URL" : "Audio URL"}
              </Label>
              <Input
                id="lesson-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onBlur={() => setTouched(true)}
                placeholder={
                  modality === "video"
                    ? "https://www.youtube.com/embed/VIDEO_ID"
                    : "https://example.com/audio.mp3"
                }
              />
              {touched && urlMalformed && (
                <p className="text-xs text-destructive">Enter a valid URL (starting with http).</p>
              )}
              {touched && urlNotAllowed && (
                <p className="text-xs text-destructive">
                  {modality === "video"
                    ? "Only YouTube or Vimeo embed links, or a direct video file, are allowed."
                    : "Only a direct https audio file (.mp3, .wav, …) is allowed."}
                </p>
              )}
              {modality === "video" && (
                <p className="text-xs text-muted-foreground">
                  Use the YouTube <span className="font-medium">embed</span> link
                  (youtube.com/embed/…), not the watch link.
                </p>
              )}
            </div>
          )}

          {isFileMode && rule && (
            <div className="space-y-1.5">
              <Label>{modality === "slides" ? "PDF file" : `${rule.noun} file`}</Label>
              <input
                ref={fileRef}
                type="file"
                accept={rule.accept}
                className="sr-only"
                onChange={(e) => {
                  const picked = e.target.files?.item(0) ?? null;
                  e.target.value = "";
                  pickFile(picked);
                }}
              />
              {file ? (
                <div className="flex items-center gap-3 rounded-xl border border-border bg-card/60 p-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <FileUp className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{file.name}</p>
                    <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
                  </div>
                  <button
                    type="button"
                    aria-label="Remove file"
                    onClick={() => pickFile(null)}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : keepsExistingFile ? (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card/60 p-3 text-sm">
                  <span className="flex-1 text-muted-foreground">
                    {pendingFile
                      ? `${pendingFile.name} — will be uploaded when the module is created.`
                      : `A ${rule.noun} file is already attached.`}
                  </span>
                  {editing?.media_url && !pendingFile && (
                    <a
                      href={editing.media_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-primary hover:underline"
                    >
                      Preview
                    </a>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileRef.current?.click()}
                  >
                    Replace file
                  </Button>
                </div>
              ) : (
                <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
                  <FileUp className="mr-1.5 h-4 w-4" /> Choose {rule.noun} file
                </Button>
              )}
              {fileError ? (
                <p className="text-xs text-destructive">{fileError}</p>
              ) : (
                <p className="text-xs text-muted-foreground">{rule.hint}</p>
              )}
              {touched && needFile && !fileError && (
                <p className="text-xs text-destructive">Choose a file to upload.</p>
              )}
            </div>
          )}

          {modality !== "text" && (
            <div className="space-y-1.5">
              <Label htmlFor="lesson-caption">Caption (optional)</Label>
              <Textarea
                id="lesson-caption"
                value={body}
                rows={2}
                onChange={(e) => setBody(e.target.value)}
                placeholder="A short note shown beneath the material."
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button disabled={saving || invalid} onClick={submit}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {saving ? "Saving…" : editing ? "Save" : "Add content"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
