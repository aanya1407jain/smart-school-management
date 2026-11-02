"use client";
/**
 * Personal settings for teachers and students (/teacher/settings,
 * /student/settings): sign-in security for the signed-in account. School-wide
 * settings stay on the administrators' Settings page, which has the same
 * Password & Security card under its Security tab.
 */
import { PageHeader } from "@/components/ui";
import { PasswordSecurity } from "@/features/profile/password-card";

export function AccountSettingsPage() {
  return (
    <div className="space-y-6" data-testid="account-settings">
      <PageHeader title="Settings" description="Your account and sign-in security." />
      <section aria-labelledby="settings-security" className="max-w-3xl space-y-3">
        <h2 id="settings-security" className="text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Security</h2>
        <PasswordSecurity />
      </section>
    </div>
  );
}
