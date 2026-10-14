/**
 * Shared model for post attachments — used by the posts API, the feed
 * composer, and every surface that renders a post.
 */

export type PostMediaType = "image" | "video" | "audio" | "file";

export interface PostMedia {
  /** Display URL (for images: the web-optimised variant). */
  url: string;
  type: PostMediaType;
  name: string;
  size: number; // bytes
  mime: string;
  /** Untouched original upload, when an optimised variant is served as `url`. */
  originalUrl?: string;
  /** Small poster/thumbnail (images, videos). */
  thumbUrl?: string;
  /** Flagged as borderline NSFW at upload — blur until the viewer opts in. */
  sensitive?: boolean;
  width?: number;
  height?: number;
}

export const MAX_POST_ATTACHMENTS = 4;
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MB

/** `accept` strings for each picker button. */
export const ACCEPT: Record<PostMediaType, string> = {
  image: "image/*",
  video: "video/*",
  audio: "audio/*",
  file: [
    ".pdf", ".doc", ".docx", ".odt", ".rtf", ".txt", ".md", ".log",
    ".xls", ".xlsx", ".ods", ".csv", ".tsv",
    ".ppt", ".pptx", ".odp", ".key",
    ".epub", ".mobi",
    ".json", ".xml", ".yaml", ".yml", ".toml", ".ini",
    ".html", ".htm", ".svg", ".mmd", ".mermaid",
    ".js", ".ts", ".tsx", ".jsx", ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift", ".c", ".cpp", ".h", ".cs", ".php", ".sh", ".sql", ".css", ".scss",
    ".zip", ".rar", ".7z", ".tar", ".gz",
  ].join(","),
};

/**
 * Executables we never accept — uploads are served from a public bucket.
 * Source code and HTML ARE accepted, but the upload route stores them as
 * text/plain so the bucket can never serve them as runnable pages/scripts.
 */
export const BLOCKED_EXTENSIONS = new Set([
  "exe", "msi", "bat", "cmd", "com", "scr", "pif", "vbs", "wsf",
  "jar", "apk", "dmg", "pkg", "deb", "rpm", "app", "dll", "so", "dylib",
]);

/** Extensions that must be stored/served as text/plain (never as html/js). */
export const FORCE_TEXT_EXTENSIONS = new Set([
  "html", "htm", "xhtml", "js", "mjs", "cjs", "jsx", "ts", "tsx", "sh", "bash", "zsh", "ps1", "psm1", "php", "asp", "aspx", "jsp",
]);

/** Source files we syntax-highlight. Keys are extensions, values highlight.js language ids. */
export const CODE_LANGS: Record<string, string> = {
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
  ts: "typescript", tsx: "typescript",
  py: "python", rb: "ruby", go: "go", rs: "rust", java: "java", kt: "kotlin", swift: "swift",
  c: "c", h: "c", cpp: "cpp", cc: "cpp", hpp: "cpp", cs: "csharp", php: "php",
  sh: "bash", bash: "bash", zsh: "bash", ps1: "powershell",
  sql: "sql", css: "css", scss: "scss", less: "less",
  json: "json", yaml: "yaml", yml: "yaml", xml: "xml", toml: "ini", ini: "ini", env: "ini",
  md: "markdown", markdown: "markdown", txt: "plaintext", log: "plaintext", csv: "plaintext", tsv: "plaintext",
  html: "xml", htm: "xml", svg: "xml", mmd: "plaintext", mermaid: "plaintext",
  dockerfile: "dockerfile", makefile: "makefile", graphql: "graphql", r: "r", lua: "lua", dart: "dart", scala: "scala",
};

export function isBlockedFilename(name: string): boolean {
  return BLOCKED_EXTENSIONS.has(extensionOf(name));
}

/** Text-like formats we can fetch as text and preview inline. */
export const TEXT_PREVIEW_EXTENSIONS = new Set([
  ...Object.keys(CODE_LANGS),
  "mmd", "mermaid", "html", "htm", "svg", "txt", "log",
]);
export const TEXT_PREVIEW_MAX_BYTES = 1024 * 1024; // 1 MB of text is plenty for a feed card

export function isTextPreviewable(m: Pick<PostMedia, "name" | "size">): boolean {
  return TEXT_PREVIEW_EXTENSIONS.has(extensionOf(m.name)) && (m.size || 0) <= TEXT_PREVIEW_MAX_BYTES;
}

/** Which in-app renderer a file gets. Every kind except "none" previews inline. */
export type PreviewKind =
  | "image" | "video" | "audio" | "pdf"
  | "markdown" | "mermaid" | "html" | "svg" | "code" | "table"
  | "sheet" | "docx" | "epub" | "none";

export function previewKind(m: PostMedia): PreviewKind {
  const ext = extensionOf(m.name);
  if (ext === "svg" || m.mime === "image/svg+xml") return "svg";
  if (m.type === "image") return "image";
  if (m.type === "video") return "video";
  if (m.type === "audio") return "audio";
  if (isPdf(m)) return "pdf";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "mmd" || ext === "mermaid") return "mermaid";
  if (ext === "html" || ext === "htm" || ext === "xhtml") return "html";
  if (ext === "csv" || ext === "tsv") return "table";
  if (ext === "xlsx" || ext === "xls" || ext === "ods") return "sheet";
  if (ext === "docx") return "docx";
  if (ext === "epub") return "epub";
  if (isTextPreviewable(m)) return "code";
  return "none";
}

/** Classify a MIME type into one of our attachment buckets. */
export function classifyMime(mime: string): PostMediaType {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "file";
}

const EXT_TYPE: Record<string, PostMediaType> = {
  jpg: "image", jpeg: "image", png: "image", gif: "image", webp: "image", avif: "image", heic: "image", svg: "image", bmp: "image",
  mp4: "video", mov: "video", webm: "video", m4v: "video", mkv: "video", avi: "video",
  mp3: "audio", wav: "audio", m4a: "audio", aac: "audio", ogg: "audio", oga: "audio", flac: "audio", opus: "audio",
};

export function extensionOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name || "");
  return m ? m[1].toLowerCase() : "";
}

/**
 * Decide the bucket from the file itself — MIME first, extension as a
 * fallback for browsers that report an empty/generic type. The picker button
 * used is deliberately ignored: an .mp4 chosen via "audio" is still a video.
 */
export function classifyFile(name: string, mime: string): PostMediaType {
  if (mime && mime !== "application/octet-stream") {
    const byMime = classifyMime(mime);
    if (byMime !== "file") return byMime;
  }
  return EXT_TYPE[extensionOf(name)] ?? "file";
}

const FORMAT_LABELS: Record<string, string> = {
  pdf: "PDF document",
  doc: "Word document", docx: "Word document",
  xls: "Excel spreadsheet", xlsx: "Excel spreadsheet", csv: "CSV spreadsheet",
  ppt: "PowerPoint deck", pptx: "PowerPoint deck", key: "Keynote deck",
  txt: "Text file", md: "Markdown file", markdown: "Markdown file", rtf: "Rich text", log: "Log file",
  odt: "OpenDocument text", ods: "OpenDocument spreadsheet", odp: "OpenDocument deck", tsv: "TSV spreadsheet",
  epub: "EPUB book", mobi: "Kindle book",
  html: "HTML file", htm: "HTML file", mmd: "Mermaid diagram", mermaid: "Mermaid diagram",
  js: "JavaScript", mjs: "JavaScript", jsx: "React (JSX)", ts: "TypeScript", tsx: "React (TSX)",
  py: "Python", rb: "Ruby", go: "Go", rs: "Rust", java: "Java", kt: "Kotlin", swift: "Swift",
  c: "C source", h: "C header", cpp: "C++ source", cs: "C#", php: "PHP", sh: "Shell script", sql: "SQL",
  css: "CSS", scss: "SCSS", toml: "TOML", ini: "INI config",
  json: "JSON file", xml: "XML file", yaml: "YAML file", yml: "YAML file",
  zip: "ZIP archive", rar: "RAR archive", "7z": "7-Zip archive", tar: "TAR archive", gz: "Gzip archive",
  mp4: "MP4 video", mov: "QuickTime video", webm: "WebM video", mkv: "MKV video",
  mp3: "MP3 audio", wav: "WAV audio", m4a: "M4A audio", aac: "AAC audio", ogg: "OGG audio", flac: "FLAC audio",
  jpg: "JPEG image", jpeg: "JPEG image", png: "PNG image", gif: "GIF image", webp: "WebP image", svg: "SVG image", heic: "HEIC image",
};

/** Human-readable format name, e.g. "Word document", "MP4 video". */
export function describeFormat(m: Pick<PostMedia, "name" | "mime" | "type">): string {
  const ext = extensionOf(m.name);
  if (FORMAT_LABELS[ext]) return FORMAT_LABELS[ext];
  if (m.mime === "application/pdf") return "PDF document";
  if (m.type === "image") return "Image";
  if (m.type === "video") return "Video";
  if (m.type === "audio") return "Audio";
  return ext ? `${ext.toUpperCase()} file` : "File";
}

export function isPdf(m: PostMedia): boolean {
  return m.mime === "application/pdf" || /\.pdf$/i.test(m.name);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Server-side validation of an incoming media array. Returns an error or null. */
export function validateMedia(input: unknown): { media: PostMedia[]; error: string | null } {
  if (input == null) return { media: [], error: null };
  if (!Array.isArray(input)) return { media: [], error: "media must be an array" };
  if (input.length > MAX_POST_ATTACHMENTS) {
    return { media: [], error: `At most ${MAX_POST_ATTACHMENTS} attachments per post` };
  }
  const out: PostMedia[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return { media: [], error: "Invalid attachment" };
    const m = raw as Record<string, unknown>;
    if (typeof m.url !== "string" || !m.url) return { media: [], error: "Attachment url missing" };
    // Only allow URLs we could have issued: our own /uploads path or an http(s) URL.
    if (!/^(\/uploads\/|https?:\/\/)/.test(m.url)) {
      return { media: [], error: "Attachment url not allowed" };
    }
    const mime = typeof m.mime === "string" ? m.mime : "application/octet-stream";
    const name = typeof m.name === "string" && m.name ? m.name.slice(0, 200) : "attachment";
    // Derive the bucket from the file's own MIME/extension; the client-sent
    // `type` is only a hint and must not mislabel (e.g. a video as audio).
    const type = classifyFile(name, mime);
    const size = typeof m.size === "number" && m.size >= 0 ? Math.floor(m.size) : 0;
    if (size > MAX_ATTACHMENT_BYTES) return { media: [], error: "Attachment exceeds 25 MB" };
    const okUrl = (u: unknown) => typeof u === "string" && /^(\/uploads\/|https?:\/\/)/.test(u) ? u : undefined;
    out.push({
      url: m.url,
      type,
      name,
      size,
      mime,
      originalUrl: okUrl(m.originalUrl),
      thumbUrl: okUrl(m.thumbUrl),
      sensitive: m.sensitive === true,
      width: typeof m.width === "number" ? Math.floor(m.width) : undefined,
      height: typeof m.height === "number" ? Math.floor(m.height) : undefined,
    });
  }
  return { media: out, error: null };
}
