/**
 * File storage foundation (Convex Storage).
 *
 * Upload flow (3 steps, standard Convex pattern):
 *   1. const url = await generateUploadUrl({})            // authorized
 *   2. POST the file to `url` from the browser → { storageId }
 *   3. await register({ storageId, kind, ownerType, ownerId, fileName })
 *      → validates ownership/permission, records metadata in `files`.
 * Download: `getUrl({ fileId })` re-checks read access every time.
 * Homework / submission attachments: create the homework (homework.create) or
 * the submission (homework.submit) first, then register each file with
 * ownerType "homework" / "submission"; the file id is appended to the record
 * in the same transaction. Client helper: src/lib/convex/use-file-upload.ts.
 *
 * Size and content type are read from Convex's own `_storage` metadata,
 * never from the client.
 */
import { v, type Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { schoolMutation, schoolQuery } from "./core/functions";
import type { Actor } from "./core/actor";
import { getInSchool, hasPermission, requireAnyPermission, requireStudentAccess } from "./core/authorization";
import { conflict, forbidden, invalid, invalidRelationship, notFound } from "./core/errors";
import { assertNonEmpty, vFileKind, vFileOwnerType } from "./core/validators";
import { writeAudit } from "./model/audit";
import { maybeProvider } from "./core/registry";
import type { FileOwnerProvider } from "./contracts/providers";
import { requireModule } from "./model/modules";
import type { ModuleKey } from "./core/modules";

type Ctx = QueryCtx & { actor: Actor };
type OwnerType = Infer<typeof vFileOwnerType>;
type FileKind = Infer<typeof vFileKind>;

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

/** Which kinds may be attached to which owner, and who may write them. */
const WRITE_POLICY: Record<FileKind, { owners: OwnerType[]; permission: Parameters<typeof hasPermission>[1] }> = {
  student_document: { owners: ["student"], permission: "students:write" },
  profile_photo: { owners: ["student", "teacher"], permission: "students:write" },
  receipt: { owners: ["receipt"], permission: "fees:manage" },
  report_card: { owners: ["result"], permission: "exams:publish" },
  school_document: { owners: ["school"], permission: "settings:manage" },
  // Record-level checks (owning teacher / submitting student) are applied in requireRecordWrite.
  homework_attachment: { owners: ["homework"], permission: "homework:manage:assigned" },
  submission_attachment: { owners: ["submission"], permission: "homework:submit" },
};

/**
 * Module entitlement per file kind (model/modules.ts). A kind whose module the
 * school does not have cannot be uploaded, listed, opened or deleted; the
 * files themselves are kept. Profile photos and school documents are core.
 */
const KIND_MODULE: Record<FileKind, ModuleKey | null> = {
  student_document: "students",
  profile_photo: null,
  receipt: "finance",
  report_card: "academics",
  school_document: null,
  homework_attachment: "academics",
  submission_attachment: "academics",
};

async function requireKindModule(ctx: Ctx, kind: FileKind) {
  const module = KIND_MODULE[kind];
  if (module) await requireModule(ctx, ctx.actor.schoolId, module);
}

const OWNER_TABLE = { student: "students", teacher: "teachers" } as const;

/** Owner types attached to a module's records are authorised by that module (null when it is not shipped). */
const MODULE_FILE_OWNERS = ["fees.receiptFiles", "examinations.resultFiles", "academics.homeworkFiles"] as const;
function moduleOwner(ownerType: OwnerType): FileOwnerProvider | null {
  for (const id of MODULE_FILE_OWNERS) {
    const p = maybeProvider(id);
    if (p && p.ownerTypes.includes(ownerType)) return p;
  }
  return null;
}

/** Most attachments per homework / submission. */
export const MAX_ATTACHMENTS = 5;

/**
 * Record-level write rule for attachments that their record lists (homework,
 * submissions): decided by the owning module (FileOwnerProvider.writableRecord).
 */
async function requireRecordWrite(ctx: Ctx & MutationCtx, ownerType: OwnerType, ownerId: string) {
  const owner = moduleOwner(ownerType);
  return owner ? await owner.writableRecord(ctx, ownerType, ownerId) : null;
}

/** Resolve and tenant-check the owner record. Returns the owner doc (or the school id). */
async function loadOwner(ctx: Ctx, ownerType: OwnerType, ownerId: string) {
  if (ownerType === "school") {
    if (ownerId !== ctx.actor.schoolId) throw notFound("Owner");
    return { ownerType, doc: null };
  }
  if (ownerType !== "student" && ownerType !== "teacher") {
    const owner = moduleOwner(ownerType);
    if (!owner) throw notFound("Owner");
    await owner.loadOwner(ctx, ownerType, ownerId);
    return { ownerType, doc: null };
  }
  const table = OWNER_TABLE[ownerType];
  const id = ctx.db.normalizeId(table, ownerId);
  if (!id) throw notFound("Owner");
  const doc = await getInSchool(ctx, table, id as Id<typeof table>, "Owner");
  return { ownerType, doc };
}

/** Read access to a file, based on its owner. */
async function requireFileRead(ctx: Ctx, file: Doc<"files">) {
  await requireKindModule(ctx, file.kind);
  switch (file.ownerType) {
    case "school":
      return; // any member of the school
    case "student":
      // Student documents (certificates, ID proofs…): administrators (students:write) and the
      // the student themself only — not subject or class teachers, not the accountant set.
      if (file.kind === "student_document") {
        await requireStudentAccess(ctx, file.ownerId as Id<"students">, { all: "students:write", own: "profile:read:own" });
        return;
      }
      await requireStudentAccess(ctx, file.ownerId as Id<"students">, { all: "students:read:all", assigned: "students:read:assigned", own: "profile:read:own" });
      return;
    case "teacher":
      if (hasPermission(ctx.actor, "staff:manage") || ctx.actor.teacherId === file.ownerId) return;
      throw notFound("File");
    default: {
      // Receipts, report cards, homework and submissions: the owning module decides.
      const owner = moduleOwner(file.ownerType);
      if (!owner) throw notFound("File");
      await owner.requireRead(ctx, file.ownerType, file.ownerId);
      return;
    }
  }
}

export const generateUploadUrl = schoolMutation({
  args: {},
  handler: async (ctx) => {
    requireAnyPermission(ctx.actor, ["files:upload", "students:write", "fees:manage", "exams:publish", "settings:manage", "homework:submit"]);
    return await ctx.storage.generateUploadUrl();
  },
});

export const register = schoolMutation({
  args: { storageId: v.id("_storage"), kind: vFileKind, ownerType: vFileOwnerType, ownerId: v.string(), fileName: v.string() },
  handler: async (ctx, a) => {
    await requireKindModule(ctx, a.kind);
    const policy = WRITE_POLICY[a.kind];
    if (!policy.owners.includes(a.ownerType)) throw invalidRelationship(`A ${a.kind} cannot be attached to a ${a.ownerType}.`);
    const teacherSelfPhoto = a.kind === "profile_photo" && a.ownerType === "teacher" && ctx.actor.teacherId === a.ownerId;
    const permission = a.kind === "profile_photo" && a.ownerType === "teacher" ? "staff:manage" : policy.permission;
    if (!teacherSelfPhoto && !hasPermission(ctx.actor, permission)) throw forbidden();
    await loadOwner(ctx, a.ownerType, a.ownerId);
    const record = await requireRecordWrite(ctx, a.ownerType, a.ownerId);
    if (record && record.attachments >= MAX_ATTACHMENTS) throw conflict(`At most ${MAX_ATTACHMENTS} files can be attached.`);

    const meta = await ctx.db.system.get(a.storageId);
    if (!meta) throw notFound("Uploaded file");
    if (await ctx.db.query("files").withIndex("by_storage", (q) => q.eq("storageId", a.storageId)).first()) throw conflict("This upload is already registered.");
    const contentType = meta.contentType ?? "application/octet-stream";
    if (!ALLOWED_TYPES.includes(contentType) || meta.size > MAX_BYTES) {
      await ctx.storage.delete(a.storageId);
      throw invalid("Only PDF, PNG, JPEG or WebP files up to 10 MB are accepted.");
    }
    const id = await ctx.db.insert("files", {
      schoolId: ctx.actor.schoolId, storageId: a.storageId, kind: a.kind, ownerType: a.ownerType, ownerId: a.ownerId,
      fileName: assertNonEmpty(a.fileName, "fileName", 200), contentType, size: meta.size, uploadedByUserId: ctx.actor.userId,
    });
    // Homework / submission attachments are linked to their record in the same transaction.
    if (record) await record.attach(id);
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "file.uploaded", entity: { table: "files", id }, summary: `Uploaded ${a.kind.replace("_", " ")} "${a.fileName}"`, metadata: { ownerType: a.ownerType, ownerId: a.ownerId } });
    return id;
  },
});

export const getUrl = schoolQuery({
  args: { fileId: v.id("files") },
  handler: async (ctx, { fileId }) => {
    const file = await getInSchool(ctx, "files", fileId, "File");
    await requireFileRead(ctx, file);
    return { url: await ctx.storage.getUrl(file.storageId), fileName: file.fileName, contentType: file.contentType, size: file.size };
  },
});

export const listForOwner = schoolQuery({
  args: { ownerType: vFileOwnerType, ownerId: v.string() },
  handler: async (ctx, { ownerType, ownerId }) => {
    const rows = await ctx.db.query("files").withIndex("by_owner", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("ownerType", ownerType).eq("ownerId", ownerId)).collect();
    if (rows.length === 0) return [];
    // Same owner → same rule per kind (student documents are stricter than other student files).
    const readable = new Map<string, boolean>();
    let firstError: unknown = null;
    for (const f of rows) {
      if (readable.has(f.kind)) continue;
      try { await requireFileRead(ctx, f); readable.set(f.kind, true); } catch (e) { readable.set(f.kind, false); firstError ??= e; }
    }
    if (![...readable.values()].some(Boolean)) throw firstError; // no access at all → the usual NOT_FOUND / FORBIDDEN
    return rows.filter((f) => readable.get(f.kind)).map((f) => ({ _id: f._id, kind: f.kind, fileName: f.fileName, contentType: f.contentType, size: f.size, uploadedAt: f._creationTime }));
  },
});

export const remove = schoolMutation({
  args: { fileId: v.id("files") },
  handler: async (ctx, { fileId }) => {
    const file = await getInSchool(ctx, "files", fileId, "File");
    await requireKindModule(ctx, file.kind);
    if (!hasPermission(ctx.actor, WRITE_POLICY[file.kind].permission)) throw forbidden();
    const record = await requireRecordWrite(ctx, file.ownerType, file.ownerId);
    await ctx.storage.delete(file.storageId);
    await ctx.db.delete(file._id);
    if (record) await record.detach(file._id);
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "file.deleted", entity: { table: "files", id: file._id }, summary: `Deleted "${file.fileName}"`, metadata: { kind: file.kind, ownerType: file.ownerType, ownerId: file.ownerId } });
    return { ok: true };
  },
});
