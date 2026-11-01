"use client";
/**
 * The LIVE student portal's My Fees page (Fees module).
 */
import { api } from "@convex/_generated/api";
import { useSchoolQuery } from "@/lib/convex/membership";
import { Card, EmptyState, LoadingState, PageHeader } from "@/components/ui";
import { LiveFeesPanel } from "./live-fees-panel";
import { MissingRecord, usePortalArgs } from "@/features/student-portal/live-portal";

export function LiveFees() {
  const f = useSchoolQuery(api.fees.myFees, usePortalArgs());
  if (f === undefined) return <LoadingState variant="table" label="Loading fees" />;
  if (f.state === "no_student_record") return <MissingRecord />;
  if (f.state === "no_current_year") return <Card className="mx-auto mt-6 max-w-xl"><EmptyState title="No current academic year" description="Fees are shown per academic year; the school has not set its current year yet." /></Card>;
  return (<div><PageHeader title="My Fees" description="Installments, concessions and payments recorded by the school office. Online payment is not available yet." /><LiveFeesPanel fees={f} /></div>);
}

