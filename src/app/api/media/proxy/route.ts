import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getAuthenticatedUser } from "@/lib/jwt-helper";
import { STORAGE_PUBLIC_BASE } from "@/lib/storage";
import { MAX_ATTACHMENT_BYTES, extensionOf, isBlockedFilename } from "@/lib/post-media";

/**
 * GET /api/media/proxy?url=… — same-origin read access to an uploaded file so
 * in-app renderers (markdown, docx, xlsx, epub, …) can fetch bytes without
 * depending on bucket CORS. Only URLs we issued are allowed (our own
 * /uploads path or the configured public bucket), and the body is capped.
 *
 * Everything is served as an opaque download-safe type: text for text-ish
 * files, octet-stream otherwise, with nosniff — never as a renderable page.
 */
export async function GET(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url") || "";
  if (!url) return NextResponse.json({ error: "url is required" }, { status: 400 });

  const name = url.split("?")[0].split("/").pop() || "";
  if (isBlockedFilename(name)) {
    return NextResponse.json({ error: "Not allowed" }, { status: 415 });
  }

  try {
    let body: Buffer;

    if (url.startsWith("/uploads/")) {
      const uploadDir = path.join(process.cwd(), "public", "uploads");
      const filePath = path.join(uploadDir, path.basename(url)); // no traversal
      const stat = await fs.stat(filePath);
      if (stat.size > MAX_ATTACHMENT_BYTES) {
        return NextResponse.json({ error: "File too large" }, { status: 413 });
      }
      body = await fs.readFile(filePath);
    } else {
      const base = (STORAGE_PUBLIC_BASE || "").replace(/\/$/, "");
      if (!base || !url.startsWith(base + "/")) {
        return NextResponse.json({ error: "URL not allowed" }, { status: 403 });
      }
      const upstream = await fetch(url, {
        headers: { Range: `bytes=0-${MAX_ATTACHMENT_BYTES - 1}` },
      });
      if (!upstream.ok && upstream.status !== 206) {
        return NextResponse.json({ error: "Could not fetch file" }, { status: 502 });
      }
      body = Buffer.from(await upstream.arrayBuffer());
    }

    const ext = extensionOf(name);
    const textish = /^(txt|md|markdown|csv|tsv|json|log|xml|yaml|yml|toml|ini|html|htm|svg|mmd|mermaid|js|mjs|cjs|jsx|ts|tsx|py|rb|go|rs|java|kt|swift|c|h|cpp|cc|hpp|cs|php|sh|bash|zsh|ps1|sql|css|scss|less|env|graphql|r|lua|dart|scala)$/.test(ext);

    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": textish ? "text/plain; charset=utf-8" : "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `inline; filename="${encodeURIComponent(name)}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    console.error("Media proxy error:", error);
    return NextResponse.json({ error: "Could not load file" }, { status: 500 });
  }
}
