/**
 * Data onboarding: bulk import (and single-record manual entry) of students
 * and teachers into this school's deployment.
 *
 * Flow (UI: Admin → Accounts & Import):
 *   upload CSV/XLSX → map columns → preview* (server validation, per-row
 *   errors/warnings) → commit* (re-validated server-side; all-or-nothing) →
 *   optional account credentials via accounts.issuePendingCredentials.
 *
 * Permissions: students:write (students) / staff:manage (teachers), plus
 * users:manage when accounts are created. `today` is the school-local date
 * supplied by the client (queries never read the clock); it is only used as
 * the default admission date and as the "not in the future" bound.
 */
import { v } from "convex/values";
import { schoolMutation, schoolQuery, moduleQuery, moduleMutation } from "./core/functions";
import { requirePermission } from "./core/authorization";
import type { Actor } from "./core/actor";
import { assertIsoDate } from "./core/validators";
import { analyzeStudents, analyzeTeachers, commitStudents, commitTeachers, summarize } from "./model/importers";

const studentsQuery = moduleQuery("students");
const studentsMutation = moduleMutation("students");

const vRows = v.array(v.object({ rowNumber: v.number(), values: v.record(v.string(), v.string()) }));
const importArgs = { rows: vRows, createAccounts: v.boolean(), today: v.string() };

function authorize(actor: Actor, target: "students" | "teachers", createAccounts: boolean) {
  requirePermission(actor, target === "students" ? "students:write" : "staff:manage");
  if (createAccounts) requirePermission(actor, "users:manage");
}

export const previewStudents = studentsQuery({
  args: importArgs,
  handler: async (ctx, { rows, createAccounts, today }) => {
    authorize(ctx.actor, "students", createAccounts);
    assertIsoDate(today, "today");
    const { results } = await analyzeStudents(ctx, rows, { createAccounts, today });
    return { results, summary: summarize(results) };
  },
});

export const commitStudentRows = studentsMutation({
  args: importArgs,
  handler: async (ctx, { rows, createAccounts, today }) => {
    authorize(ctx.actor, "students", createAccounts);
    assertIsoDate(today, "today");
    return await commitStudents(ctx, rows, { createAccounts, today });
  },
});

export const previewTeachers = schoolQuery({
  args: importArgs,
  handler: async (ctx, { rows, createAccounts, today }) => {
    authorize(ctx.actor, "teachers", createAccounts);
    assertIsoDate(today, "today");
    const { results } = await analyzeTeachers(ctx, rows, { createAccounts, today });
    return { results, summary: summarize(results) };
  },
});

export const commitTeacherRows = schoolMutation({
  args: importArgs,
  handler: async (ctx, { rows, createAccounts, today }) => {
    authorize(ctx.actor, "teachers", createAccounts);
    assertIsoDate(today, "today");
    return await commitTeachers(ctx, rows, { createAccounts, today });
  },
});
