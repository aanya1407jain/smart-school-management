/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as academics from "../academics.js";
import type * as account from "../account.js";
import type * as accounts from "../accounts.js";
import type * as attendance from "../attendance.js";
import type * as audit from "../audit.js";
import type * as auth from "../auth.js";
import type * as bulkAccounts from "../bulkAccounts.js";
import type * as core_actor from "../core/actor.js";
import type * as core_authorization from "../core/authorization.js";
import type * as core_errors from "../core/errors.js";
import type * as core_functions from "../core/functions.js";
import type * as core_permissions from "../core/permissions.js";
import type * as core_validators from "../core/validators.js";
import type * as files from "../files.js";
import type * as http from "../http.js";
import type * as imports from "../imports.js";
import type * as memberships from "../memberships.js";
import type * as model_academics from "../model/academics.js";
import type * as model_accounts from "../model/accounts.js";
import type * as model_audit from "../model/audit.js";
import type * as model_calendar from "../model/calendar.js";
import type * as model_counters from "../model/counters.js";
import type * as model_grading from "../model/grading.js";
import type * as model_importSpecs from "../model/importSpecs.js";
import type * as model_importers from "../model/importers.js";
import type * as model_loginIds from "../model/loginIds.js";
import type * as model_memberships from "../model/memberships.js";
import type * as model_notifications from "../model/notifications.js";
import type * as model_rollNumbers from "../model/rollNumbers.js";
import type * as model_studentRecords from "../model/studentRecords.js";
import type * as notifications from "../notifications.js";
import type * as schools from "../schools.js";
import type * as seed from "../seed.js";
import type * as seedData_asterAcademy from "../seedData/asterAcademy.js";
import type * as seedData_types from "../seedData/types.js";
import type * as setup from "../setup.js";
import type * as studentPortal from "../studentPortal.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  academics: typeof academics;
  account: typeof account;
  accounts: typeof accounts;
  attendance: typeof attendance;
  audit: typeof audit;
  auth: typeof auth;
  bulkAccounts: typeof bulkAccounts;
  "core/actor": typeof core_actor;
  "core/authorization": typeof core_authorization;
  "core/errors": typeof core_errors;
  "core/functions": typeof core_functions;
  "core/permissions": typeof core_permissions;
  "core/validators": typeof core_validators;
  files: typeof files;
  http: typeof http;
  imports: typeof imports;
  memberships: typeof memberships;
  "model/academics": typeof model_academics;
  "model/accounts": typeof model_accounts;
  "model/audit": typeof model_audit;
  "model/calendar": typeof model_calendar;
  "model/counters": typeof model_counters;
  "model/grading": typeof model_grading;
  "model/importSpecs": typeof model_importSpecs;
  "model/importers": typeof model_importers;
  "model/loginIds": typeof model_loginIds;
  "model/memberships": typeof model_memberships;
  "model/notifications": typeof model_notifications;
  "model/rollNumbers": typeof model_rollNumbers;
  "model/studentRecords": typeof model_studentRecords;
  notifications: typeof notifications;
  schools: typeof schools;
  seed: typeof seed;
  "seedData/asterAcademy": typeof seedData_asterAcademy;
  "seedData/types": typeof seedData_types;
  setup: typeof setup;
  studentPortal: typeof studentPortal;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
