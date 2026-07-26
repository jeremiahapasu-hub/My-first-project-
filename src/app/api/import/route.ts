import type { NextRequest } from "next/server";
import { audit, requireRole } from "@/lib/auth/guard";
import { badRequest, handler, ok } from "@/lib/http";
import { importChat, importSignals } from "@/lib/services/import";
import { importSchema } from "@/lib/validation";

/** Uploads larger than this are rejected before the body is read into memory. */
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Ingests a signal or chat export.
 *
 * Accepts either `multipart/form-data` (a real file picker) or a JSON body with
 * the contents inline (pasted text, and what the API docs show).
 *
 * This is the only way rows enter the system. Nothing here contacts a broker.
 */
export const POST = handler(async (request: NextRequest) => {
  // VIEWER is read-only, so importing needs ANALYST or above.
  const session = await requireRole("ANALYST");

  const declaredSize = Number(request.headers.get("content-length") ?? 0);
  if (declaredSize > MAX_BYTES) {
    throw badRequest("File is larger than the 8 MB limit");
  }

  const contentType = request.headers.get("content-type") ?? "";

  let kind: "SIGNALS" | "CHAT";
  let filename: string;
  let content: string;
  let channel: string | undefined;

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      throw badRequest("No file was attached to the upload");
    }

    if (file.size > MAX_BYTES) {
      throw badRequest("File is larger than the 8 MB limit");
    }

    const rawKind = String(form.get("kind") ?? "").toUpperCase();
    if (rawKind !== "SIGNALS" && rawKind !== "CHAT") {
      throw badRequest('`kind` must be either "SIGNALS" or "CHAT"');
    }

    kind = rawKind;
    filename = file.name || "upload";
    content = await file.text();
    channel = (form.get("channel") as string | null)?.trim() || undefined;
  } else {
    const parsed = importSchema.parse(await request.json());
    kind = parsed.kind;
    filename = parsed.filename;
    content = parsed.content;
    channel = parsed.channel;
  }

  if (!content.trim()) {
    throw badRequest("The file is empty");
  }

  const summary =
    kind === "SIGNALS"
      ? await importSignals(session.sub, content, filename)
      : await importChat(session.sub, content, filename, channel || "imported");

  await audit("import", session.sub, {
    kind,
    filename,
    accepted: summary.accepted,
    rejected: summary.rejected,
  });

  return ok({ kind, ...summary }, { status: 201 });
});
