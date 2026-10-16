/**
 * The sign-in form (src/features/auth/login-form.ts) accepts the Login IDs the
 * school issues and never asks for an email address.
 */
import { describe, expect, test } from "vitest";
import { loginFormSchema, signInErrorMessage, SIGN_IN_FAILED } from "../../src/features/auth/login-form";

const parse = (loginId: string) => loginFormSchema.safeParse({ loginId, password: "x", remember: true });
const messages = (loginId: string) => {
  const r = parse(loginId);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe("login form", () => {
  test.each(["ADMIN-001", "TCH-00001", "STU-2026-00001", "GRD-00001", " stu-2026-00001 ", "tch-00124"])("accepts Login ID %j", (id) => {
    expect(parse(id).success).toBe(true);
  });

  test("never shows an email-format error", () => {
    for (const id of ["ADMIN-001", "", "x", "admin@asteracademy.edu"]) {
      expect(messages(id).join(" ")).not.toMatch(/email/i);
    }
  });

  test("rejects values that can never be a Login ID, with the Login ID hint", () => {
    expect(messages("")[0]).toBe("Enter your Login ID");
    expect(messages("admin@asteracademy.edu")).toEqual(["Enter the Login ID given by your school (e.g. TCH-00124)"]);
    expect(messages("ab")).toEqual(["Enter the Login ID given by your school (e.g. TCH-00124)"]);
  });

  test("unknown Login ID and wrong password show the same message", () => {
    expect(signInErrorMessage(new Error("Uncaught Error: InvalidAccountId"))).toBe(SIGN_IN_FAILED);
    expect(signInErrorMessage(new Error("Uncaught Error: InvalidSecret"))).toBe(SIGN_IN_FAILED);
    expect(signInErrorMessage(new Error("Server Error"))).toBe(SIGN_IN_FAILED);
  });
});
