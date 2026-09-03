import { supabase } from "@/integrations/supabase/client";

/**
 * Helpers for lecturer-uploaded course material files (video / audio / slides).
 *
 * Files go into the public-read `course-materials` bucket under
 *   {course_id}/{topic_id}/{uuid}.{ext}
 * The first path segment is the course id; Storage RLS checks it against
 * current_lecturer_course(), so a forged course id just fails the policy.
 */

export const MATERIAL_BUCKET = "course-materials";

export type UploadKind = "video" | "audio" | "slides";

type Rule = { accept: string; exts: string[]; maxMb: number; noun: string; hint: string };

export const MATERIAL_RULES: Record<UploadKind, Rule> = {
  video: {
    accept: "video/mp4,video/webm,video/ogg,video/quicktime,.mp4,.webm,.ogv,.ogg,.mov",
    exts: ["mp4", "webm", "ogv", "ogg", "mov"],
    maxMb: 50,
    noun: "Video",
    hint: "MP4, WebM or MOV, up to 50 MB.",
  },
  audio: {
    accept:
      "audio/mpeg,audio/wav,audio/ogg,audio/aac,audio/mp4,audio/x-m4a,.mp3,.wav,.ogg,.oga,.m4a,.aac",
    exts: ["mp3", "wav", "ogg", "oga", "m4a", "aac"],
    maxMb: 20,
    noun: "Audio",
    hint: "MP3, WAV, OGG or M4A, up to 20 MB.",
  },
  slides: {
    accept: "application/pdf,.pdf",
    exts: ["pdf"],
    maxMb: 20,
    noun: "PDF",
    hint: "PDF only, up to 20 MB.",
  },
};

/** Extension -> MIME, so the upload always declares a type on the bucket's
 *  allow-list even when the browser leaves File.type blank (common for .m4a). */
const EXT_MIME: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  oga: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  pdf: "application/pdf",
};

function mimeFor(ext: string, kind: UploadKind, fallbackType: string): string {
  if (EXT_MIME[ext]) return EXT_MIME[ext];
  if (ext === "ogg") return kind === "video" ? "video/ogg" : "audio/ogg";
  return fallbackType || "application/octet-stream";
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0
    ? name
        .slice(dot + 1)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
    : "";
}

/** Human-readable byte size. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Returns a friendly error message, or null when the file is acceptable. */
export function validateMaterialFile(kind: UploadKind, file: File): string | null {
  const rule = MATERIAL_RULES[kind];
  const ext = extensionOf(file.name);
  if (!rule.exts.includes(ext)) {
    return `Choose a ${rule.noun} file (${rule.exts.map((e) => `.${e}`).join(", ")}).`;
  }
  if (file.size > rule.maxMb * 1024 * 1024) {
    return `${rule.noun} files must be smaller than ${rule.maxMb} MB.`;
  }
  return null;
}

export type UploadedMaterial = { path: string; publicUrl: string };

export async function uploadMaterialFile(params: {
  kind: UploadKind;
  file: File;
  courseId: string;
  topicId: string;
}): Promise<UploadedMaterial> {
  const { kind, file, courseId, topicId } = params;
  const invalid = validateMaterialFile(kind, file);
  if (invalid) throw new Error(invalid);

  const ext = extensionOf(file.name) || MATERIAL_RULES[kind].exts[0];
  const path = `${courseId}/${topicId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from(MATERIAL_BUCKET)
    .upload(path, file, { contentType: mimeFor(ext, kind, file.type), upsert: false });
  if (error) throw error;

  const { data } = supabase.storage.from(MATERIAL_BUCKET).getPublicUrl(path);
  return { path, publicUrl: data.publicUrl };
}

const PUBLIC_MARKER = `/storage/v1/object/public/${MATERIAL_BUCKET}/`;

/** True when a lesson media_url points at a file in our upload bucket. */
export function isUploadedMaterialUrl(url: string | null | undefined): boolean {
  return !!url && url.includes(PUBLIC_MARKER);
}

/** Storage object path for an uploaded-material URL, or null for external URLs. */
export function materialPathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const i = url.indexOf(PUBLIC_MARKER);
  if (i < 0) return null;
  const raw = url.slice(i + PUBLIC_MARKER.length).split(/[?#]/)[0];
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Best-effort delete of one uploaded material file. Accepts either a Storage
 * object path or a full public URL. Returns true only when the object was
 * removed (or was never one of ours). Scoped by Storage RLS to the lecturer's
 * own course folder.
 */
export async function removeMaterialFile(pathOrUrl: string | null | undefined): Promise<boolean> {
  if (!pathOrUrl) return false;
  const path = pathOrUrl.includes(PUBLIC_MARKER) ? materialPathFromUrl(pathOrUrl) : pathOrUrl;
  if (!path) return false;
  const { error } = await supabase.storage.from(MATERIAL_BUCKET).remove([path]);
  return !error;
}
