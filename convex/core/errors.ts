/**
 * Predictable, client-safe backend errors.
 *
 * Every authorization / validation failure is thrown as a `ConvexError` whose
 * `data` is an `AppErrorData`. The client can branch on `data.code`
 * (see `src/lib/convex/errors.ts`). Messages never reveal whether a record in
 * another school exists: cross-school IDs surface as NOT_FOUND.
 */
import { ConvexError } from "convex/values";

export type AppErrorCode =
  | "UNAUTHENTICATED" // no valid session
  | "NO_SCHOOL_ACCESS" // signed in, but no active membership for the requested/derived school
  | "SCHOOL_SELECTION_REQUIRED" // user belongs to several schools and did not pick one
  | "FORBIDDEN" // authenticated member lacks the permission / ownership
  | "NOT_FOUND" // missing OR belongs to another school (indistinguishable on purpose)
  | "INVALID_ARGUMENT" // input failed validation
  | "INVALID_RELATIONSHIP" // ids exist but do not belong together (e.g. section of another class)
  | "CONFLICT" // uniqueness / state conflict
  | "PASSWORD_CHANGE_REQUIRED" // signed in with a temporary password: only the password change is allowed
  | "TEMPORARY_PASSWORD_EXPIRED"; // the temporary password is too old; an administrator must issue a new one

export type AppErrorData = {
  code: AppErrorCode;
  message: string;
  fields?: Record<string, string>;
};

export class AppError extends ConvexError<AppErrorData> {
  constructor(code: AppErrorCode, message: string, fields?: Record<string, string>) {
    super(fields ? { code, message, fields } : { code, message });
  }
}

export const unauthenticated = () => new AppError("UNAUTHENTICATED", "Please sign in to continue.");
export const noSchoolAccess = () => new AppError("NO_SCHOOL_ACCESS", "You do not have access to this school.");
export const schoolSelectionRequired = () =>
  new AppError("SCHOOL_SELECTION_REQUIRED", "Your account belongs to more than one school. Choose a school to continue.");
export const forbidden = (message = "You do not have permission to do this.") => new AppError("FORBIDDEN", message);
export const notFound = (what = "Record") => new AppError("NOT_FOUND", `${what} not found.`);
export const invalid = (message: string, fields?: Record<string, string>) => new AppError("INVALID_ARGUMENT", message, fields);
export const invalidRelationship = (message: string) => new AppError("INVALID_RELATIONSHIP", message);
export const conflict = (message: string) => new AppError("CONFLICT", message);
export const passwordChangeRequired = () =>
  new AppError("PASSWORD_CHANGE_REQUIRED", "Choose a new password to continue. You signed in with a temporary password.");
export const temporaryPasswordExpired = () =>
  new AppError("TEMPORARY_PASSWORD_EXPIRED", "This temporary password has expired. Ask your school office for a new one.");
