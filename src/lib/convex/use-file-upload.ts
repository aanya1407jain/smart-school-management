"use client";
/**
 * Upload a file through the shared Convex Storage pipeline (convex/files.ts):
 *
 *   const { upload, status, error } = useFileUpload();
 *   const fileId = await upload(file, { kind: "homework_attachment", ownerType: "homework", ownerId: homeworkId });
 *
 *  1. files.generateUploadUrl   — authorized by the server (membership + permission)
 *  2. POST the bytes to the short-lived URL → { storageId }
 *  3. files.register            — the server checks ownership/permission again,
 *     reads size and content type from storage (never from the browser),
 *     enforces PDF/PNG/JPEG/WebP ≤ 10 MB and links the file to its record.
 *
 * The same checks run in the browser first (fast feedback only — the server is
 * the authority). A failed step throws; nothing is registered, so retrying the
 * whole upload is safe. No storage credentials ever reach the browser.
 */
import { useCallback, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { FunctionArgs } from "convex/server";
import { useSchoolMutation } from "./membership";

export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const UPLOAD_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"] as const;

type Target = Pick<FunctionArgs<typeof api.files.register>, "kind" | "ownerType" | "ownerId">;
export type UploadStatus = "idle" | "uploading" | "done" | "error";

/** Client-side pre-check (the server repeats it with the stored metadata). */
export function checkUploadFile(file: Pick<File, "size" | "type">): string | null {
  if (!(UPLOAD_TYPES as readonly string[]).includes(file.type)) return "Only PDF, PNG, JPEG or WebP files can be uploaded.";
  if (file.size > UPLOAD_MAX_BYTES) return "Files can be at most 10 MB.";
  if (file.size === 0) return "The file is empty.";
  return null;
}

export function useFileUpload() {
  const generateUploadUrl = useSchoolMutation(api.files.generateUploadUrl);
  const register = useSchoolMutation(api.files.register);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(async (file: File, target: Target): Promise<Id<"files">> => {
    setStatus("uploading");
    setError(null);
    try {
      const problem = checkUploadFile(file);
      if (problem) throw new Error(problem);
      const url = await generateUploadUrl({});
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!res.ok) throw new Error("The upload did not complete. Please try again.");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      const fileId = await register({ storageId, fileName: file.name, ...target });
      setStatus("done");
      return fileId;
    } catch (e) {
      const message = e instanceof Error ? e.message : "The upload failed.";
      setStatus("error");
      setError(message);
      throw e;
    }
  }, [generateUploadUrl, register]);

  return { upload, status, error };
}
