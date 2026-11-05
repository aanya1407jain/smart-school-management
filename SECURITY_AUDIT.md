# Security Audit Report: OWASP Top 10 Assessment

| | |
|---|---|
| **Repository** | `D:\smart-school-management` |
| **Branch / commit** | `feat/convex-backend-foundation` @ `d712689` (includes "Auth: admin-only credential management with OTP-authorized resets") |
| **Date** | 2026-11-05 |
| **Scope** | `src/` (Next.js 16 App Router), `convex/` (all modules, `core/`, `model/`, `schema.ts`, `http.ts`, `auth.ts`), `next.config.ts`, `src/proxy.ts`, `.gitignore`, `.env.example`, `package.json` / `package-lock.json` |
| **Method** | Manual code review against OWASP Top 10 (2021). Scripted sweeps covered every exported Convex function (197) for permission checks and for client-supplied IDs that skip the tenant check, plus grep sweeps for XSS sinks, secrets and outbound hosts. `npm audit --omit=dev` and `npm audit` were run. Library behavior (Convex Auth 0.0.96, Next 16.3.8) was checked in `node_modules`. |
| **Type** | Audit only. No application code was changed, and nothing was committed, pushed or deployed. |

> Secrets policy: no secret values appear in this report. `.env.local` exists and is git-ignored; it holds `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL` and `NEXT_PUBLIC_CONVEX_SITE_URL`. Values were not read into this report.

---

## 1. Executive summary

**Overall rating: HIGH RISK. The architecture is strong, but one critical credential flaw must be fixed before production.**

Server-side authorization is the strongest part of the codebase. Each school function derives the actor on the server (`requireActor`). Each client-supplied ID is loaded through `getInSchool`, which returns NOT_FOUND across tenants. Permissions are checked per handler, and every flagged handler was confirmed by hand. No IDOR or cross-school leak was found. The new admin OTP reset (`convex/credentials.ts`) is well designed: it stores only a salted hash, has a 10-minute TTL, allows 5 attempts and is single-use, binds to both admin and target, is admin-only, and never stores the password.

The main risk is **authentication policy**:

- Every student account is created with the same hardcoded password, and the Login ID is the student's scholar number. Students have no way to change it (**SEC-01**).
- The installed `next` version falls inside a range with critical advisories (**SEC-02**).
- The app sends no security headers (**SEC-03**).
- TC QR codes are still rendered by the third-party `api.qrserver.com`, even though `qrcode-generator` is already a dependency (**SEC-04**).

### Counts by severity

| Critical | High | Medium | Low | Total |
|:-:|:-:|:-:|:-:|:-:|
| 1 | 1 | 6 | 8 | **16** |

### Counts by OWASP category

| OWASP 2021 category | Crit | High | Med | Low | Findings |
|---|:-:|:-:|:-:|:-:|---|
| A01 Broken Access Control | | | 1 | | SEC-05 |
| A02 Cryptographic Failures | | | | | none (see Passed controls) |
| A03 Injection | | | | | none |
| A04 Insecure Design | | | | 2 | SEC-10, SEC-12 |
| A05 Security Misconfiguration | | | 1 | 2 | SEC-03, SEC-13, SEC-14 |
| A06 Vulnerable & Outdated Components | | 1 | | 1 | SEC-02, SEC-16 |
| A07 Identification & Authentication Failures | 1 | | 2 | 2 | SEC-01, SEC-06, SEC-07, SEC-09, SEC-15 |
| A08 Software & Data Integrity Failures | | | 1 | | SEC-04 |
| A09 Security Logging & Monitoring Failures | | | 1 | 1 | SEC-08, SEC-11 |
| A10 Server-Side Request Forgery | | | | | none |

---

## 2. Findings

Each finding was checked against the code at the cited lines. Findings that depend on deployment or library behavior are marked **[Uncertain]**, with the reason.

---

### [SEC-01] Shared, hardcoded default password for every student account
- **OWASP:** A07 Identification & Authentication Failures (also A05: default credentials)
- **Severity:** **Critical**
- **Location:**
  - `convex/model/accounts.ts:49`: `export const STUDENT_DEFAULT_PASSWORD = "Aster@123";`
  - `convex/model/accounts.ts:71-73`: `initialPasswordFor("student")` always returns that constant.
  - `convex/model/accounts.ts:76-82`: a student's Login ID is their **scholar number**.
  - `convex/bulkAccounts.ts:442`, `convex/accounts.ts:233-234`, `convex/studentLoginMigration.ts:99`: bulk creation, single creation and the login migration all set or reset the default.
  - `convex/auth.ts:57-59`: `validatePasswordRequirements` always throws, so **no user can ever change their own password**.
- **Root cause:**
  - Every student in every school gets the same password, and it is published in source code.
  - The username is the scholar number, which appears on ID cards, registers and TCs, and is often sequential.
  - Students can't rotate the password, so it stays valid until an administrator overwrites it.
  - Convex Auth limits failed sign-ins only per account (10/hour, `rateLimit.js`) and has no per-IP or global limit. An attacker can try the one known password once against every scholar number (password spraying) without hitting any lockout.
  - A successful login exposes the student's profile, results, fees, attendance, homework and submission rights.
- **Remediation:** issue a random password per student, require a change on first sign-in, add a self-service change flow that needs the current password, and rotate every account still flagged `defaultPassword`.

```ts
// convex/model/accounts.ts: remove STUDENT_DEFAULT_PASSWORD entirely
export function initialPasswordFor(_role: Role): { password: string; mustChange: boolean } {
  return { password: generateSecurePassword(), mustChange: true };
}
export function passwordIssuedFields(opts: { mustChange: boolean }) {
  return { mustChangePassword: opts.mustChange ? (true as const) : undefined, temporaryPasswordIssuedAt: Date.now(), defaultPassword: undefined };
}

// convex/account.ts (new): self-service change; requires the current password
import { retrieveAccount, modifyAccountCredentials, invalidateSessions } from "@convex-dev/auth/server";
export const changeOwnPassword = action({
  args: { currentPassword: v.string(), newPassword: v.string() },
  handler: async (ctx, { currentPassword, newPassword }) => {
    const me = await ctx.runQuery(internal.users.selfForPasswordChange, {}); // requireAuthenticatedUser
    validatePassword(newPassword);
    await retrieveAccount(ctx, { provider: PASSWORD_PROVIDER, account: { id: me.loginId, secret: currentPassword } }); // throws if wrong (rate-limited)
    await modifyAccountCredentials(ctx, { provider: PASSWORD_PROVIDER, account: { id: me.loginId, secret: newPassword } });
    await invalidateSessions(ctx, { userId: me.userId, except: [me.sessionId] });
    await ctx.runMutation(internal.users.recordOwnPasswordChange, {}); // clears mustChangePassword, writes audit
  },
});
```

```ts
// src/proxy.ts / AppShell: while viewer.mustChangePassword is true, allow only /account/password.
// One-off migration: for each users row with defaultPassword === true, set a random password
// (shown once to the admin on a print sheet) and mustChangePassword = true.
```

---

### [SEC-02] `next@16.3.8` falls within critical advisory ranges
- **OWASP:** A06 Vulnerable & Outdated Components
- **Severity:** **High** (npm rates it Critical; lowered here because the vulnerable features look unused). **[Uncertain]**
- **Location:** `package.json:38` (`"next": "16.3.8"`); `npm audit --omit=dev` reports `next 16.0.0 - 16.4.0`:
  - GHSA-2464-fhr4-w9xw: unauthenticated RCE in the Image Optimization API when SVG files are used.
  - GHSA-673q-mjm6-r5xr: unauthenticated RCE in `use cache` functions that return typed arrays.
  - GHSA-p3m5-59mp-jv5r: denial of service in the App Router through Server Actions.
- **Root cause:** a pinned framework version with known vulnerabilities. Exposure as found in the code:
  - No `"use cache"` and no `"use server"` was found in `src/`, and nothing imports `next/image`.
  - The `/_next/image` endpoint is still on by default, and `public/favicon.svg` exists.
  - Whether the RCE can be exploited depends on the advisory's exact preconditions, which weren't reproduced. Treat it as exploitable until the upgrade is done.
- **Remediation:**

```jsonc
// package.json
"next": "16.4.5"
```

```ts
// next.config.ts: defense in depth while the image optimizer is unused
const nextConfig: NextConfig = {
  images: { unoptimized: true },   // disables /_next/image optimization
  // ...
};
```

---

### [SEC-03] No HTTP security headers (CSP, HSTS, framing, nosniff, Referrer-Policy)
- **OWASP:** A05 Security Misconfiguration
- **Severity:** **Medium**
- **Location:** `next.config.ts:3-14` has no `headers()` and doesn't disable `poweredByHeader`, and `src/proxy.ts:50-54` adds no headers.
- **Root cause:**
  - Every page, including `/admin/credentials` where admins set passwords, can be framed. That allows clickjacking.
  - There is no CSP to limit XSS impact. This matters more because the Convex access JWT sits in `localStorage` (SEC-07).
  - No HSTS is sent, and `Referer` leaks full URLs to third parties (see SEC-04).
  - `X-Powered-By: Next.js` is sent.
- **Remediation:**

```ts
// next.config.ts
const convex = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const convexWs = convex.replace(/^https:/, "wss:");
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",          // move to nonces via proxy.ts when feasible
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.convex.cloud",
  `connect-src 'self' ${convex} ${convexWs}`,
  "font-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: csp },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
  // ...existing config
};
```

---

### [SEC-04] TC verification QR rendered by the third-party `api.qrserver.com` (known item, **confirmed still present**)
- **OWASP:** A08 Software & Data Integrity Failures (also data exposure)
- **Severity:** **Medium**
- **Location:** `src/features/students/lifecycle/tc-document.tsx:45-63`. The comment says "Zero external runtime dependencies", but line 46 builds `https://api.qrserver.com/v1/create-qr-code/?...&data=${encodeURIComponent(text)}` and line 57 loads it as an `<img>`.
- **Root cause:**
  1. **Data leak:** each TC view or print sends the full verification URL, including its 16-hex verification code, to a third party. `convex/tcVerification.ts:10-33` shows that code acts as a bearer token for the student's name, admission number, last class and dates. The browser also sends a `Referer` header with the admin page URL and its Convex document IDs.
  2. **Integrity:** the QR printed on an official certificate is produced by a service the school doesn't control. If that service is compromised or hijacked, it could encode a different (phishing) verification URL, and nobody could easily tell.
  3. **Availability:** QR rendering fails if the service is down or blocked.

  `qrcode-generator@2.0.4` is already in `package.json:39` but isn't used anywhere.
- **Remediation:** generate the QR locally.

```tsx
// src/features/students/lifecycle/tc-document.tsx
import qrcode from "qrcode-generator";

export function QrCode({ text, size = 112, className }: { text: string; size?: number; className?: string }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c},${r}h1v1h-1z`;
    return { n, d };
  }, [text]);
  return (
    <svg role="img" aria-label="Verification QR code" viewBox={`-2 -2 ${svg.n + 4} ${svg.n + 4}`} width={size} height={size}
         className={cn("rounded-lg bg-white border border-line/40", className)} shapeRendering="crispEdges">
      <rect x={-2} y={-2} width={svg.n + 4} height={svg.n + 4} fill="#fff" />
      <path d={svg.d} fill="#000" />
    </svg>
  );
}
```

The fix builds the SVG path from booleans, so it doesn't need `dangerouslySetInnerHTML`.

---

### [SEC-05] Open redirect after sign-in through the `next` query parameter
- **OWASP:** A01 Broken Access Control (unvalidated redirect)
- **Severity:** **Medium**
- **Location:**
  - `src/features/auth/login-screen.tsx:49-50`: `router.replace(next && canAccessRoute(u, next) === "allowed" ? next : landingRouteFor(u))`
  - `src/lib/permissions/routes.ts:71-76`: `canAccessRoute` returns `"allowed"` for any path that isn't a portal route, including `https://evil.example` and `//evil.example`.
- **Root cause:** the redirect target is checked for **permission**, not for **origin**. In Next 16.3.8, `navigate-reducer.js` hard-navigates when `isExternalURL(url)`, so `/login?next=https://evil.example/login` sends the user to the attacker right after a real sign-in. That makes credential phishing easy. `javascript:` URLs are blocked by Next (`isJavaScriptURLString`), so this can't be turned into XSS.
- **Remediation:**

```ts
// src/lib/permissions/routes.ts
export function safeInternalPath(next: string | null): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  try {
    const u = new URL(next, window.location.origin);
    return u.origin === window.location.origin ? u.pathname + u.search + u.hash : null;
  } catch { return null; }
}

// src/features/auth/login-screen.tsx
const next = safeInternalPath(params.get("next"));
router.replace(next && canAccessRoute(u, next) === "allowed" ? next : landingRouteFor(u));
```

---

### [SEC-06] Administrators know users' passwords permanently; overwritten users aren't told
- **OWASP:** A07 Identification & Authentication Failures
- **Severity:** **Medium**
- **Location:**
  - `convex/credentials.ts:247`: after an OTP-authorized overwrite, `passwordIssuedFields(false)` **clears** `mustChangePassword` (`convex/model/accounts.ts:66-68`).
  - `convex/auth.ts:14-22, 57-59`: the design says "Nobody changes their own password".
  - `convex/credentials.ts:297-310`: the OTP email goes only to the acting admin. The target account's owner gets nothing.
- **Root cause:**
  - Every password a teacher or admin has was chosen by, or shown to, another administrator, and the owner can never change it.
  - This breaks non-repudiation: an admin can sign in as any teacher and enter marks or attendance under that teacher's name.
  - A full administrator can also take over another full administrator's account. The OTP only proves control of the *acting* admin's own inbox, so it adds nothing against a malicious or compromised admin.
  - The person whose password was overwritten finds out only when their sessions end.
- **Remediation:** make admin-set passwords temporary, and notify the owner.

```ts
// convex/credentials.ts recordOverwrite
if (m.userId) await ctx.db.patch(m.userId, { mustChangePassword: true, temporaryPasswordIssuedAt: Date.now(), defaultPassword: undefined });

// convex/credentials.ts verifyOtpAndSetPassword, after invalidateSessions:
const targetEmail = await ctx.runQuery(internal.credentials.targetContactEmail, { callerMembershipId: ctx.membershipId, challengeId });
if (targetEmail) await sendEmail({ to: targetEmail, subject: "Your password was reset by your school",
  text: "An administrator reset your password. If you did not expect this, contact the school office." }).catch(() => {});

// Optional: overwriting another FULL administrator requires a second administrator's approval.
```

Pair this with the self-service change flow in SEC-01.

---

### [SEC-07] Long-lived sessions (30 days) and the access JWT in `localStorage`
- **OWASP:** A07 Identification & Authentication Failures
- **Severity:** **Medium**
- **Location:**
  - `convex/auth.ts:62-90`: `convexAuth({...})` sets no `session` or `jwt` options. The Convex Auth 0.0.96 defaults are a 30-day total session and 30 days of allowed inactivity (`sessions.js`, `refreshTokens.js`), plus a 1-hour JWT (`tokens.js`).
  - `src/lib/convex/server-provider.tsx:6-12`: this file documents that the 1-hour access JWT is cached in `localStorage`, because `storage="inMemory"` is broken in 0.0.96.
- **Root cause:**
  - School PCs (staff rooms, labs, offices) are shared, and a 30-day idle allowance keeps people signed in there long after they've left.
  - Any XSS can read the JWT from `localStorage`, and nothing (no CSP, see SEC-03) limits that.
  - The httpOnly cookies are configured correctly (see Passed controls).
- **Remediation:**

```ts
// convex/auth.ts
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [LoginIdPassword],
  session: {
    totalDurationMs: 1000 * 60 * 60 * 12,      // 12 h absolute
    inactiveDurationMs: 1000 * 60 * 60 * 2,    // 2 h idle
  },
  jwt: { durationMs: 1000 * 60 * 15 },         // 15 min access token
  callbacks: { /* unchanged */ },
});
```

Also re-test `storage="inMemory"` when `@convex-dev/auth` is upgraded, and ship the CSP from SEC-03.

---

### [SEC-08] Credential-security events are only partly audited; the overwrite audit isn't atomic
- **OWASP:** A09 Security Logging & Monitoring Failures
- **Severity:** **Medium**
- **Location:**
  - `convex/credentials.ts:161-184` (`openChallenge`): an OTP request writes no audit row.
  - `convex/credentials.ts:216-236` (`consumeChallenge`): wrong codes and the `locked` state write no audit row.
  - `convex/credentials.ts:342-344`: `modifyAccountCredentials`, then `invalidateSessions`, then `recordOverwrite` (the audit). If either later step fails, the password has **already changed** but no `PASSWORD_OVERWRITE` row exists.
  - `convex/auth.ts`: neither successful nor failed sign-ins, nor sign-outs, are recorded in `auditLogs`.
- **Root cause:** only the successful end state is logged. A compromised admin account trying OTP codes, a burst of OTP requests, or password spraying against student IDs (SEC-01) leaves no trace in the school's audit log.
- **Remediation:**

```ts
// openChallenge: after insert
await writeAudit(ctx, { schoolId: actor.schoolId, actor, action: "credential.otp_requested",
  entity: { table: "schoolMemberships", id: targetMembershipId }, summary: `Requested a password-reset code for ${target.loginId}`,
  metadata: { challengeId } });

// consumeChallenge: on wrong / locked (the mutation returns rather than throws, so the write persists)
await writeAudit(ctx, { schoolId: actor.schoolId, actor, action: locked ? "credential.otp_locked" : "credential.otp_failed",
  entity: { table: "credentialOtps", id: c._id }, summary: `Incorrect reset code (${attempts}/${OTP_MAX_ATTEMPTS})` });

// verifyOtpAndSetPassword: write a "PASSWORD_OVERWRITE_PENDING" audit inside consumeChallenge (same
// transaction that consumes the code), then finalize it in recordOverwrite.
```

For sign-ins, record success and failure from the `beforeSessionCreation` callback, or with a scheduled job over `authRateLimits`, so spraying shows up.

---

### [SEC-09] Account enumeration through the raw sign-in API
- **OWASP:** A07 Identification & Authentication Failures
- **Severity:** **Low**
- **Location:**
  - `node_modules/@convex-dev/auth/dist/server/implementation/mutations/retrieveAccountWithCredentials.js:23,31`: returns `InvalidAccountId` for an unknown account and `InvalidSecret` for a wrong password.
  - `src/features/auth/login-form.ts:34`: the UI merges both into one message, but the raw `auth:signIn` response still differs.
  - The rate limiter records failures only for existing accounts.
- **Root cause:** library behavior (Convex Auth 0.0.96). Anyone calling the Convex endpoint directly can tell valid Login IDs apart. The impact is low because scholar numbers are guessable anyway, but enumeration does feed the spraying in SEC-01.
- **Remediation:**

```ts
// convex/auth.ts: Password({ profile }) – map unknown/malformed IDs to a fixed decoy account id that exists
// (created once at setup with a random unusable password) so every failure returns InvalidSecret and is rate-limited.
return { email: canonicalLoginId(params.loginId) ?? DECOY_LOGIN_ID };
```

Also add an edge or IP rate limit on `POST /api/auth`, for example in `src/proxy.ts` or at the hosting WAF.

---

### [SEC-10] OTP guess budget isn't capped per day
- **OWASP:** A04 Insecure Design
- **Severity:** **Low**
- **Location:** `convex/credentials.ts:41-45, 171-175`: 5 attempts per code and 5 codes per admin per 15 minutes.
- **Root cause:** an attacker holding an admin session (but not the admin's mailbox) gets 25 guesses per 15 minutes, which is up to 2,400 per day against a space of 10⁶. That's about a 0.24% success chance per day, and nothing caps it beyond that. Each request does email the real admin, which helps detection.
- **Remediation:**

```ts
export const OTP_DAILY_FAILED_LIMIT = 15;
// in consumeChallenge before comparing:
const since = now - 24 * 60 * 60 * 1000;
const failed = (await ctx.db.query("credentialOtps").withIndex("by_admin", (q) => q.eq("adminMembershipId", actor.membershipId).gte("_creationTime", since)).collect())
  .reduce((n, x) => n + x.attempts, 0);
if (failed >= OTP_DAILY_FAILED_LIMIT) return { ok: false as const, reason: "locked" as const };
```

Also consider ending the admin's other sessions after a lock.

---

### [SEC-11] Console email transport writes OTP codes to deployment logs, guarded only by an environment variable
- **OWASP:** A09 Security Logging & Monitoring Failures
- **Severity:** **Low**
- **Location:** `convex/model/email.ts:29-33`: when `RESEND_API_KEY` is missing and `EMAIL_TRANSPORT === "console"`, the full message, including `Your one-time code is …`, goes to `console.log`.
- **Root cause:** the code comments say this is for development only, but nothing enforces it. A production deployment set up by mistake would put live reset codes in function logs, which anyone with dashboard access can read.
- **Remediation:**

```ts
if (process.env.EMAIL_TRANSPORT === "console") {
  const site = process.env.CONVEX_SITE_URL ?? "";
  if (!/127\.0\.0\.1|localhost/.test(site) && process.env.ALLOW_CONSOLE_EMAIL !== "true") throw emailUnavailable();
  console.log(`[email:console] to=${message.to} subject=${JSON.stringify(message.subject)}\n${message.text.replace(/\b\d{6}\b/g, "******")}`);
  return;
}
```

You could also print the code only through `npx convex run` output, never through logs.

---

### [SEC-12] Upload type check trusts the client's Content-Type; storage URLs are long-lived bearer links
- **OWASP:** A04 Insecure Design
- **Severity:** **Low**
- **Location:**
  - `convex/files.ts:163-170`: `contentType` comes from storage metadata, which is the `Content-Type` the browser sent with the upload. There is no magic-byte check.
  - `convex/files.ts:187`: `getUrl` returns `ctx.storage.getUrl(...)`, an unauthenticated URL that doesn't expire.
  - `convex/files.ts:142-147`: uploads that are never registered stay in storage.
- **Root cause:**
  - A file declared as `image/png` but holding other content is accepted. Convex serves it from a separate origin, and the allow-list excludes HTML and SVG, so XSS impact is limited.
  - Once a student document URL leaks, revoking access doesn't stop it working.
- **Remediation:**

```ts
// files.ts register: sniff the first bytes in an action before register(), or in a follow-up internal action
const sig = new Uint8Array(await (await ctx.storage.get(storageId))!.slice(0, 12).arrayBuffer());
const isPdf = sig[0] === 0x25 && sig[1] === 0x50 && sig[2] === 0x44 && sig[3] === 0x46;
const isPng = sig[0] === 0x89 && sig[1] === 0x50 && sig[2] === 0x4e && sig[3] === 0x47;
const isJpg = sig[0] === 0xff && sig[1] === 0xd8 && sig[2] === 0xff;
const isWebp = sig[8] === 0x57 && sig[9] === 0x45 && sig[10] === 0x42 && sig[11] === 0x50;
if (!(isPdf || isPng || isJpg || isWebp)) { await ctx.storage.delete(storageId); throw invalid("Unsupported file."); }
```

For downloads, serve sensitive kinds (`student_document`, `report_card`) through an HTTP action that re-checks `requireFileRead` and streams the blob, instead of handing out the raw storage URL. Add a cron that deletes `_storage` rows that aren't referenced by `files` after 24 hours.

---

### [SEC-13] `.gitignore` only covers `.env*.local`
- **OWASP:** A05 Security Misconfiguration
- **Severity:** **Low**
- **Location:** `.gitignore:6`
- **Root cause:** `.env`, `.env.production` and the `.auth-keys.json` that the auth setup docs mention (`.claude/skills/convex-auth/SKILL.md`) would all be committable. Nothing like that is tracked or in history today; this was verified with `git ls-files` and `git log --all`.
- **Remediation:**

```gitignore
.env
.env.*
!.env.example
.auth-keys.json
*.pem
*.key
```

---

### [SEC-14] Demo logins with known passwords are rendered on the sign-in screen in the checked-in build
- **OWASP:** A05 Security Misconfiguration (default accounts)
- **Severity:** **Low** **[Uncertain]**: the risk depends on how the app is deployed.
- **Location:**
  - `src/modules/demo.generated.ts:10`: `DEMO = demoRuntime`, the internal full build.
  - `src/features/auth/login-screen.tsx:100-110`: the "Development demo accounts" panel fills in the Login ID and password.
  - `convex/seedData/asterAcademy.ts`: fixed demo passwords.
- **Root cause:** customer builds rely on `scripts/distribute.ts` replacing this with `DEMO = null`, and the seed is gated by `ALLOW_DEMO_SEED`. If the internal build is ever deployed against a deployment where the demo seed ran, anyone can sign in as admin.
- **Remediation:**

```ts
// src/modules/demo.generated.ts (internal build)
export const DEMO: DemoRuntime | null =
  process.env.NEXT_PUBLIC_ENABLE_DEMO === "true" && process.env.NODE_ENV !== "production" ? demoRuntime : null;
```

Also add a CI check that fails when `DEMO !== null` in any production build artifact.

---

### [SEC-15] Weak password policy for administrator-set passwords
- **OWASP:** A07 Identification & Authentication Failures
- **Severity:** **Low**
- **Location:** `convex/auth.ts:37-41`: requires only 8 characters, one letter and one digit.
- **Root cause:** `Password1` and `School2026` both pass. There's no length-first rule and no check against breached or common passwords.
- **Remediation:**

```ts
const COMMON = new Set(["password1", "password123", "aster@123", "school123", "welcome1", "admin123" /* + top-10k list */]);
export function validatePassword(password: string, loginId?: string) {
  const p = password.normalize("NFKC");
  if (p.length < 12) throw invalid("Use at least 12 characters.", { password: "Too short" });
  if (COMMON.has(p.toLowerCase()) || (loginId && p.toLowerCase().includes(loginId.toLowerCase())))
    throw invalid("This password is too common.", { password: "Too common" });
}
```

---

### [SEC-16] Other dependency advisories (zod, development tools)
- **OWASP:** A06 Vulnerable & Outdated Components
- **Severity:** **Low**
- **Location:**
  - `package.json:46`: `zod@3.25.76`, flagged for GHSA-mrhx-c7xc-m3w5 (memory exhaustion on oversized constrained collections), High.
  - `package.json:55`: `playwright@1.51.1`, flagged for GHSA-7mvr-c777-76hp (browser download without TLS verification), High, dev only.
  - `postcss-selector-parser <6.1.5`: GHSA-rj75-hqrm-r3gf, Moderate, dev only.
- **Root cause:** zod runs only in the browser for form validation (`login-form.ts`, `student-form.tsx`, `teacher-form.tsx`), and the server uses Convex validators. So the impact is limited to the user's own tab. The dev-tool advisories affect developer and CI machines, not production.
- **Remediation:**

```bash
npm i zod@^4.6.7          # API changes: update the three form schemas
npm i -D playwright@^1.55.1
npm audit fix              # postcss-selector-parser
```

---

## 3. Passed controls

| Area | Control verified | Evidence |
|---|---|---|
| A01 | **The actor is derived only on the server.** The client's `membershipId` can only choose among the caller's own active memberships. | `convex/core/actor.ts:208-224` |
| A01 | **Tenant isolation.** `getInSchool` returns NOT_FOUND for both missing and cross-school IDs. A sweep of all 197 exported functions found every client-supplied `v.id(...)` going through `getInSchool` or a `require*`/`load*`/`own*` helper, or an explicit `schoolId` check (for example `studentLifecycle.ts:211`, `bulkAccounts.ts:90-97`, `fees.ts:66-68`). | `convex/core/authorization.ts:272-277` |
| A01 | **Permissions checked per handler.** The 43 handlers flagged as having no visible check were reviewed by hand. Each one either checks permissions through a helper (`authorize`, `loadJob`, `editable`, `ownHomework`, `resolvePortalStudent`) or reads only the caller's own data (notifications, `my*` portal queries). | `imports.ts:28-31`, `notices.ts:159-164`, `model/portalStudent.ts:26-35` |
| A01 | **Deny by default.** Portal routes redirect to `/login` without a session, and stay closed when no backend is configured. Every Convex function re-checks access whatever the route. | `src/proxy.ts:34-54` |
| A01 | **Privilege boundaries.** `users:manage`, `settings:manage`, `audit:read` and `staff:manage` can't be granted to restricted logins. No one can change their own access or disable themselves. | `core/grants.ts:111-116`, `memberships.ts:59,96-100,177`, `accounts.ts:100,153` |
| A01 | **Only three public queries take no auth, and all return minimal fields:** `schools.publicProfile`, `tcVerification.verifyTransferCertificate` (strict 16-hex format, draft TCs hidden) and `users.me`/`session`. | `schools.ts:16-28`, `tcVerification.ts:10-33` |
| A02 | **Passwords are hashed with Scrypt by Convex Auth.** Temporary passwords are returned once and never stored. | `auth.ts:8-13`, `schema.ts:874`, `bulkAccounts.ts:426-452` |
| A02 | **OTP storage.** Only `SHA-256(salt:code)` is stored, with a 16-byte random salt. The code is drawn from CSPRNG with rejection sampling (no modulo bias). | `credentials.ts:264-283` |
| A02 | **Random passwords.** 12 characters from a 56-symbol alphabet using CSPRNG with rejection sampling. TC verification codes are about 64 bits from `crypto.randomUUID`. | `model/accounts.ts:255-268`, `studentLifecycle.ts:442-447` |
| A02 | **Auth cookies** are `httpOnly`, `secure` (except on localhost) and `SameSite=Lax`. | `@convex-dev/auth/dist/nextjs/server/cookies.js:72-77` |
| A02 | **No secrets in the repo or its history.** Test JWT keys are generated at runtime. `.env.local` is ignored and contains no server secrets. `RESEND_API_KEY`, `JWT_PRIVATE_KEY` and `JWKS` live in Convex environment variables. | `git grep` / `git log --all -S` sweeps; `.env.example` |
| A03 | **No `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function` or `document.write`** anywhere in `src/` or `convex/`. React escaping covers all rendering. The regexes in use are anchored with linear complexity (`isEmailAddress`, the OTP check, `/^[0-9A-F]{16}$/`). The database is accessed only through the typed Convex query builder, so there is no query injection. | grep sweep |
| A04 | **OTP reset design.** It's admin-only on the server (role must be `admin` and the caller needs `users:manage`) and the admin can't target their own account. The code goes to the **admin's** own email, which can't be edited in the app. It expires after 10 minutes, allows 5 attempts and works once. A new request replaces the old one; a failed email delivery closes the challenge; the code is bound to one admin membership and one target. The target is re-authorized when the code is consumed, and its sessions are invalidated on success. Wrong-code attempts are counted without a throw, so they aren't rolled back. | `credentials.ts:54-57,161-260,323-346`, `accounts.ts:98-111` |
| A04 | **Business rules run on the server.** Attendance ownership, marks entry scope, fee allocation and promotions are all checked in Convex. The in-browser mock store serves demo data only and is excluded from customer builds. | `authorization.ts:307-375`, `src/lib/demo/runtime.ts:1-14` |
| A05 | **CORS / HTTP actions.** `convex/http.ts` mounts only the Convex Auth JWKS and OpenID routes, with no custom HTTP actions, so there is no CORS or webhook surface. | `convex/http.ts:1-9` |
| A05 | **Errors are safe to show clients.** They use typed `AppError` codes, and cross-school IDs can't be told apart from missing ones. | `convex/core/errors.ts` |
| A07 | **Sign-out and revocation.** Each request re-validates that the session row exists, so sign-out, suspension and password overwrite take effect immediately. Disabled users are rejected. | `core/actor.ts:155-163`, `accounts.ts:243-252` |
| A07 | **No self-registration**, and sessions are issued only to enabled users with an active membership in an active school. | `auth.ts:57-59,69-88` |
| A07 | **Brute-force protection on sign-in.** Convex Auth limits each account to 10 failed attempts per hour, and the UI gives one generic failure message. Spraying across accounts is still possible (SEC-01, SEC-09). | `rateLimit.js`, `login-form.ts:31-34` |
| A08 | **No third-party `<script>` or CDN**, and fonts are self-hosted through `@fontsource`. The only third-party runtime asset is the QR code (SEC-04). | grep sweep, `package.json` |
| A09 | **Audit coverage of data changes.** Audit logs are append-only, read access requires `audit:read`, and metadata excludes passwords. Account, permission, fee, attendance, notice, file and TC changes are all audited. | `model/audit.ts`, `audit.ts:20` |
| A10 | **No SSRF surface.** The only server-side `fetch` targets the constant `https://api.resend.com/emails`, and no user-supplied URL is ever fetched. | `model/email.ts:17,39-45` |

---

## 4. Prioritized action plan

### Hotfixes (this sprint, before any production rollout)

| # | Finding | Action | Effort |
|---|---|---|---|
| 1 | **SEC-01** | Replace `STUDENT_DEFAULT_PASSWORD` with a random password per account and set `mustChangePassword`. Add a self-service password change that requires the current password. Rotate every account flagged `defaultPassword`. | M |
| 2 | **SEC-02** | Upgrade `next` to `16.4.5` and set `images.unoptimized: true`. | S |
| 3 | **SEC-04** | Switch `QrCode` to the already-installed `qrcode-generator`, and remove `api.qrserver.com`. | S |
| 4 | **SEC-05** | Add the `safeInternalPath()` check to the login `next` parameter. | S |
| 5 | **SEC-03** | Add `headers()` with CSP, HSTS, `frame-ancestors 'none'`, nosniff and Referrer-Policy, and set `poweredByHeader: false`. | S |
| 6 | **SEC-11** | Refuse the console email transport outside localhost. | S |
| 7 | **SEC-13** | Extend `.gitignore` to cover `.env`, `.env.*` and key files. | S |

### Short term (next 1-2 sprints)

| # | Finding | Action |
|---|---|---|
| 8 | **SEC-06** | Make admin-set passwords temporary (forced change on next sign-in), email the owner, and consider dual approval for overwriting a full admin. |
| 9 | **SEC-07** | Set session limits (12 h absolute, 2 h idle, 15 min JWT), and re-test `storage="inMemory"` when upgrading Convex Auth. |
| 10 | **SEC-08** | Audit OTP requests, failures and locks, plus sign-in success and failure, and make the overwrite audit atomic with consuming the code. |
| 11 | **SEC-10** | Cap OTP attempts per admin per day. |
| 12 | **SEC-16** | Upgrade `zod` (forms), `playwright` and `postcss-selector-parser`. |

### Long term (hardening)

| # | Finding | Action |
|---|---|---|
| 13 | **SEC-09** | Return a uniform `InvalidSecret` through a decoy account, and add IP/edge rate limits on `/api/auth`. |
| 14 | **SEC-12** | Check file magic bytes, serve sensitive files through an authorized HTTP action, and clean up orphaned uploads. |
| 15 | **SEC-14** | Gate the demo runtime on an explicit environment flag, and add a CI check that production builds ship `DEMO = null`. |
| 16 | **SEC-15** | Require 12+ characters and check against a breached or common password list. |
| 17 | Process | Add `npm audit --omit=dev` to CI (fail on high or critical). Add a lint rule banning raw `query`/`mutation` imports outside the three allow-listed public endpoints. Add a nonce-based CSP through `src/proxy.ts`. |
