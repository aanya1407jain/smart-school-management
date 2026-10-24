"use client";
import { useState } from "react";
import { Medal, Star, Target, Trophy } from "lucide-react";
import type { AchievementCategory, StudentAchievement } from "@/types/domain";
import { Avatar, Badge, CardHeader, EmptyState, GlassCard, Segmented, type Tone } from "@/components/ui";
import { formatDate } from "@/lib/utils/dates";

const CATEGORY: Record<AchievementCategory, { label: string; short: string; tone: Tone; Icon: typeof Medal }> = {
  sports: { label: "Sports & Competitions", short: "Sports", tone: "sapphire", Icon: Medal },
  academic: { label: "Academic Excellence", short: "Academic", tone: "teal", Icon: Target },
  special: { label: "Special Recognition", short: "Special", tone: "lavender", Icon: Star },
};

type Filter = "all" | AchievementCategory;

/** Admin dashboard showcase: "Student Achievements & Honors". */
export function StudentAchievementsCard({ achievements, live }: { achievements: StudentAchievement[]; live: boolean }) {
  const [filter, setFilter] = useState<Filter>("all");
  const shown = filter === "all" ? achievements : achievements.filter((a) => a.category === filter);
  return (
    <GlassCard data-testid="dash-achievements">
      <CardHeader
        title="Student Achievements & Honors"
        description="Medals, toppers and special recognition across the school"
        icon={<Trophy className="h-4 w-4" />}
        action={achievements.length > 0 && (
          <Segmented<Filter>
            label="Achievement category"
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              ...(Object.keys(CATEGORY) as AchievementCategory[]).map((k) => ({ value: k, label: CATEGORY[k].short })),
            ]}
          />
        )}
        className="flex-wrap"
      />
      <div className="p-5 pt-4">
        {achievements.length === 0 ? (
          <EmptyState
            icon={<Trophy className="h-6 w-6" />}
            title="No achievements recorded yet"
            description={live ? "Medals, class toppers and special recognition for your students will be showcased here." : "Nothing to showcase right now."}
            className="py-6"
          />
        ) : shown.length === 0 ? (
          <EmptyState title={`No ${CATEGORY[filter as AchievementCategory].label.toLowerCase()} yet`} className="py-6" />
        ) : (
          <ul className="scrollbar-thin grid max-h-[26rem] gap-2 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((a) => {
              const c = CATEGORY[a.category];
              return (
                <li key={a.id} className="flex min-w-0 gap-3 rounded-xl border border-line/70 bg-white/70 p-3">
                  <Avatar name={a.studentName} />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="truncate text-[13.5px] font-semibold leading-5 text-ink" title={a.title}>{a.title}</p>
                    <p className="truncate text-[12.5px] leading-4 text-ink-soft">{a.studentName} · Class {a.classLabel}</p>
                    <p className="line-clamp-2 text-[12px] leading-4 text-ink-muted">{a.highlight}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Badge tone={c.tone} className="text-[11px]"><c.Icon className="h-3 w-3" aria-hidden />{c.label}</Badge>
                      <span className="whitespace-nowrap text-[11.5px] text-ink-muted">{formatDate(a.date)}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </GlassCard>
  );
}
