"use client";
import { useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils/cn";
import { Medal, Star, Target, Trophy } from "lucide-react";
import type { AchievementCategory, StudentAchievement } from "@/types/students";
import { Avatar, Badge, CardHeader, EmptyState, GlassCard, Segmented, type Tone } from "@/components/ui";
import { formatDate } from "@/lib/utils/dates";

const CATEGORY: Record<AchievementCategory, { label: string; short: string; tone: Tone; Icon: typeof Medal; wash: string }> = {
  sports: { label: "Sports & Competitions", short: "Sports", tone: "sapphire", Icon: Medal, wash: "from-sapphire/15 via-cyan/10 to-transparent" },
  academic: { label: "Academic Excellence", short: "Academic", tone: "teal", Icon: Target, wash: "from-teal/20 via-aqua/10 to-transparent" },
  special: { label: "Special Recognition", short: "Special", tone: "lavender", Icon: Star, wash: "from-lavender/40 via-blush/25 to-transparent" },
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
          <ul className="scrollbar-thin grid max-h-[28rem] gap-3 overflow-y-auto p-0.5 pr-1 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((a, i) => {
              const c = CATEGORY[a.category];
              return (
                // Media card: category-tinted cover band, frosted avatar, badge; the highlight expands on hover/focus.
                <li
                  key={a.id}
                  tabIndex={0}
                  style={{ "--stagger-i": i } as CSSProperties}
                  className="stagger group relative min-w-0 overflow-hidden rounded-2xl border border-white/70 bg-white/65 shadow-ambient backdrop-blur-md transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-ambient-lg focus-visible:outline-none focus-visible:shadow-focus"
                >
                  <div aria-hidden className={cn("relative h-14 bg-gradient-to-br", c.wash)}>
                    <c.Icon className="absolute right-3 top-2.5 h-9 w-9 text-white/70 drop-shadow-sm transition-transform duration-300 group-hover:rotate-6 group-hover:scale-110" />
                  </div>
                  <div className="-mt-7 flex min-w-0 flex-col gap-1 px-3.5 pb-3.5">
                    <Avatar name={a.studentName} size="md" className="ring-4 ring-white/90 backdrop-blur" />
                    <p className="mt-1 truncate text-[13.5px] font-semibold leading-5 text-ink" title={a.title}>{a.title}</p>
                    <p className="truncate text-[12.5px] leading-4 text-ink-soft">{a.studentName} · Class {a.classLabel}</p>
                    <p className="line-clamp-2 text-[12px] leading-4 text-ink-muted transition-all group-hover:line-clamp-none group-focus-visible:line-clamp-none">{a.highlight}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Badge tone={c.tone} className="text-[11px]"><c.Icon className="h-3 w-3" aria-hidden />{c.label}</Badge>
                      <span className="mono-id whitespace-nowrap text-ink-muted">{formatDate(a.date)}</span>
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
