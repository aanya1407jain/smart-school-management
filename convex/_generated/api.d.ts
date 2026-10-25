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
import type * as admissionRegister from "../admissionRegister.js";
import type * as attendance from "../attendance.js";
import type * as audit from "../audit.js";
import type * as auth from "../auth.js";
import type * as bulkAccounts from "../bulkAccounts.js";
import type * as core_actor from "../core/actor.js";
import type * as core_authorization from "../core/authorization.js";
import type * as core_errors from "../core/errors.js";
import type * as core_functions from "../core/functions.js";
import type * as core_grants from "../core/grants.js";
import type * as core_modules from "../core/modules.js";
import type * as core_permissions from "../core/permissions.js";
import type * as core_validators from "../core/validators.js";
import type * as crons from "../crons.js";
import type * as dashboards from "../dashboards.js";
import type * as events from "../events.js";
import type * as exams from "../exams.js";
import type * as feeReminders from "../feeReminders.js";
import type * as fees from "../fees.js";
import type * as files from "../files.js";
import type * as homework from "../homework.js";
import type * as http from "../http.js";
import type * as imports from "../imports.js";
import type * as memberships from "../memberships.js";
import type * as migrations from "../migrations.js";
import type * as model_academics from "../model/academics.js";
import type * as model_accounts from "../model/accounts.js";
import type * as model_audit from "../model/audit.js";
import type * as model_calendar from "../model/calendar.js";
import type * as model_counters from "../model/counters.js";
import type * as model_feeData from "../model/feeData.js";
import type * as model_feeMath from "../model/feeMath.js";
import type * as model_grading from "../model/grading.js";
import type * as model_homeworkAccess from "../model/homeworkAccess.js";
import type * as model_importSpecs from "../model/importSpecs.js";
import type * as model_importers from "../model/importers.js";
import type * as model_loginIds from "../model/loginIds.js";
import type * as model_memberships from "../model/memberships.js";
import type * as model_modules from "../model/modules.js";
import type * as model_notifications from "../model/notifications.js";
import type * as model_rollNumbers from "../model/rollNumbers.js";
import type * as model_scholarNumbers from "../model/scholarNumbers.js";
import type * as model_sortedPagination from "../model/sortedPagination.js";
import type * as model_studentCounts from "../model/studentCounts.js";
import type * as model_studentRecords from "../model/studentRecords.js";
import type * as notices from "../notices.js";
import type * as notifications from "../notifications.js";
import type * as profile from "../profile.js";
import type * as reports from "../reports.js";
import type * as rollNumberMaintenance from "../rollNumberMaintenance.js";
import type * as scholarNumberMaintenance from "../scholarNumberMaintenance.js";
import type * as schoolModules from "../schoolModules.js";
import type * as schools from "../schools.js";
import type * as seed from "../seed.js";
import type * as seedData_asterAcademy from "../seedData/asterAcademy.js";
import type * as seedData_types from "../seedData/types.js";
import type * as setup from "../setup.js";
import type * as staff from "../staff.js";
import type * as studentLifecycle from "../studentLifecycle.js";
import type * as studentLoginMigration from "../studentLoginMigration.js";
import type * as studentPortal from "../studentPortal.js";
import type * as timetable from "../timetable.js";
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
  admissionRegister: typeof admissionRegister;
  attendance: typeof attendance;
  audit: typeof audit;
  auth: typeof auth;
  bulkAccounts: typeof bulkAccounts;
  "core/actor": typeof core_actor;
  "core/authorization": typeof core_authorization;
  "core/errors": typeof core_errors;
  "core/functions": typeof core_functions;
  "core/grants": typeof core_grants;
  "core/modules": typeof core_modules;
  "core/permissions": typeof core_permissions;
  "core/validators": typeof core_validators;
  crons: typeof crons;
  dashboards: typeof dashboards;
  events: typeof events;
  exams: typeof exams;
  feeReminders: typeof feeReminders;
  fees: typeof fees;
  files: typeof files;
  homework: typeof homework;
  http: typeof http;
  imports: typeof imports;
  memberships: typeof memberships;
  migrations: typeof migrations;
  "model/academics": typeof model_academics;
  "model/accounts": typeof model_accounts;
  "model/audit": typeof model_audit;
  "model/calendar": typeof model_calendar;
  "model/counters": typeof model_counters;
  "model/feeData": typeof model_feeData;
  "model/feeMath": typeof model_feeMath;
  "model/grading": typeof model_grading;
  "model/homeworkAccess": typeof model_homeworkAccess;
  "model/importSpecs": typeof model_importSpecs;
  "model/importers": typeof model_importers;
  "model/loginIds": typeof model_loginIds;
  "model/memberships": typeof model_memberships;
  "model/modules": typeof model_modules;
  "model/notifications": typeof model_notifications;
  "model/rollNumbers": typeof model_rollNumbers;
  "model/scholarNumbers": typeof model_scholarNumbers;
  "model/sortedPagination": typeof model_sortedPagination;
  "model/studentCounts": typeof model_studentCounts;
  "model/studentRecords": typeof model_studentRecords;
  notices: typeof notices;
  notifications: typeof notifications;
  profile: typeof profile;
  reports: typeof reports;
  rollNumberMaintenance: typeof rollNumberMaintenance;
  scholarNumberMaintenance: typeof scholarNumberMaintenance;
  schoolModules: typeof schoolModules;
  schools: typeof schools;
  seed: typeof seed;
  "seedData/asterAcademy": typeof seedData_asterAcademy;
  "seedData/types": typeof seedData_types;
  setup: typeof setup;
  staff: typeof staff;
  studentLifecycle: typeof studentLifecycle;
  studentLoginMigration: typeof studentLoginMigration;
  studentPortal: typeof studentPortal;
  timetable: typeof timetable;
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
