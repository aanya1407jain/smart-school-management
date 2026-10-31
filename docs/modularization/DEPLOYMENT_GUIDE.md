# Deployment guide — modular product bundles

This guide is for the operator who builds and ships a product (a combination of modules) for one customer.

Each customer gets:
- their own exported bundle;
- their own Convex deployment;
- their own Vercel project.

## 1. Modules and valid products

| Module | Requires | Stored entitlement key |
|---|---|---|
| Students (base: every product contains it) | — | `students` |
| Attendance | Students | `attendance` |
| Academics | Students | `academics` |
| Fees | Students | `finance` |
| Examinations | Students, Academics | `academics` (shared until the D2 migration) |

Core is always shipped: school structure, staff, accounts, notices and events, notifications, settings and audit.

A product must list every module it requires. Nothing is added automatically: `examinations` without `academics` is refused.

## 2. Export a bundle

Run this from the source repository, on a clean, reviewed commit:

```bash
npx tsx scripts/distribute.ts <out-dir> students attendance
npx tsx scripts/distribute.ts <out-dir> students academics attendance
npx tsx scripts/distribute.ts <out-dir> all
```

- `<out-dir>` must be outside the repository. It is wiped and rebuilt.
- `--skip-build` skips `next build`, which is faster while iterating. Never use it for a delivery.

**What the script does:**
1. Refuses the export if the selection is invalid, or if any shipped file still depends on an excluded module.
2. Copies Core plus the selected modules only.
   - Never copied: `.git`, `.env*`, `tests/`, `scripts/`, `docs/`, other modules' code, or the internal demo layer.
3. Regenerates the composition files for the selection:
   - Convex: provider registry, crons, schema (selected tables only), demo stubs and `convex/_generated/api.d.ts`.
   - Frontend: the manifest and UI-contribution registries.
4. Verifies the bundle and writes `distribution-report.md` and `distribution-report.json` into `<out-dir>`. The checks are:
   - owner scan;
   - forbidden-reference scan;
   - route coverage;
   - schema;
   - Convex typecheck and app typecheck;
   - `next build`, including a scan of the built routes.

**Delivery gate:** every line of `distribution-report.md` reads **PASS**. The script exits with code 1 otherwise.

`<out-dir>/node_modules` is only a link to the source checkout, used for the verification build. Delete it before the next step.

## 3. Create the customer's Convex deployment

Each customer gets a separate Convex project, so data and functions are never shared with another customer.

In a fresh copy of the bundle:

```bash
cd <customer-repo>          # the exported bundle, as its own Git repository
rm -rf node_modules && npm ci
npx convex deploy           # first time: create/select the customer's project when prompted
npx @convex-dev/auth --prod # once per deployment: JWT keys + SITE_URL (set SITE_URL to the Vercel URL)
```

Never run `npm run seed:demo` against a customer deployment. Customer bundles contain no demo seed or demo layer, and the script removes the seed script.

## 4. Deploy the frontend to Vercel

1. Push the bundle to its own Git repository, and import it as a new Vercel project (framework: Next.js).
2. In Vercel → Settings → Environment Variables, set:
   - `CONVEX_DEPLOY_KEY`: a production deploy key from the customer's Convex dashboard (Settings → Deploy keys).
   - `NEXT_PUBLIC_CONVEX_URL`: the customer deployment's URL (`https://<name>.convex.cloud`). When the build command below is used, `convex deploy` sets this during the build. Setting it explicitly as well is harmless.
3. Set the build command:

   ```
   npx convex deploy --cmd 'npm run build'
   ```

   This pushes the Convex functions and schema of the bundle, then builds Next.js against that deployment.
4. Deploy. Then set `SITE_URL` on the Convex deployment to the final Vercel domain:

   ```bash
   npx convex env set SITE_URL https://<customer-domain> --prod
   ```

## 5. Initialise the school (once per deployment)

Run from a trusted machine. `setup:initSchool` refuses to run if the deployment already has a school.

Pass `modules` with the stored entitlement keys of the product, plus `administration` for notices and reports. The school's entitlements then match the code that was shipped.

```bash
npx convex run --prod setup:initSchool '{
  "school": {"name":"Green Valley School","shortName":"Green Valley","code":"GVS","slug":"green-valley",
             "timezone":"Asia/Kolkata","locale":"en-IN","currency":"INR"},
  "academicYear": {"name":"2026-27","startDate":"2026-04-01","endDate":"2027-03-31"},
  "admin": {"displayName":"Principal"},
  "modules": ["students","attendance","administration"]
}'
```

| Product | `modules` |
|---|---|
| students | `["students","administration"]` |
| students attendance | `["students","attendance","administration"]` |
| students academics attendance | `["students","academics","attendance","administration"]` |
| all | `["students","attendance","academics","finance","administration"]` |

The command prints the first administrator's Login ID and a temporary password, **once**:
- Hand them over through a private channel.
- The administrator must change the password at first sign-in. It expires after 7 days.
- Break-glass helpers, CLI only: `setup:addAdministrator` and `setup:issueTemporaryPassword` (see `convex/setup.ts`).

Enabling a module that was not shipped has no effect: its pages and functions do not exist in the bundle. To add a module later, export a new bundle with it and redeploy.

## 6. Upgrades

Re-export the same product from the new source commit into the customer repository's working tree. Review the diff, then push; Vercel redeploys.

Schema changes ship only as data-preserving migrations (`MigrationDeclaration.dataPreserving: true`). Never run a destructive migration on a customer deployment.
