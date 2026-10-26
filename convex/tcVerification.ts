/**
 * Public verification of a transfer certificate by the code printed on it
 * (and encoded in its QR). No sign-in: a receiving school scans the QR or
 * types the code. Exposes only what the certificate itself states about its
 * authenticity — never contact details, fees or other records.
 */
import { v } from "convex/values";
import { query } from "./_generated/server";

export const verifyTransferCertificate = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const key = code.trim().toUpperCase();
    if (!/^[0-9A-F]{16}$/.test(key)) return null;
    const tc = await ctx.db.query("transferCertificates").withIndex("by_verification", (q) => q.eq("verificationCode", key)).first();
    if (!tc || tc.status === "draft") return null;
    const school = await ctx.db.get(tc.schoolId);
    if (!school) return null;
    return {
      valid: tc.status === "issued",
      status: tc.status,
      tcNo: tc.tcNo,
      school: school.name,
      studentName: tc.snapshot.studentName,
      admissionNo: tc.snapshot.admissionNo,
      lastClass: [tc.snapshot.lastClass, tc.snapshot.lastSection && `(${tc.snapshot.lastSection})`].filter(Boolean).join(" ") || null,
      leavingDate: tc.leavingDate,
      issueDate: tc.issueDate,
      cancelledAt: tc.cancelledAt ?? null,
    };
  },
});
