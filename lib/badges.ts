export type Badge = {
  id: string;
  label: string;
  description?: string;
  tone: "blue" | "purple" | "green" | "amber";
};

const TIER_THRESHOLDS = [10, 20, 40, 70, 100] as const;

export function computeAttendanceTierBadge(verifiedTotal: number): Badge | null {
  const v = Number(verifiedTotal || 0);
  if (v < TIER_THRESHOLDS[0]) return null;

  if (v >= TIER_THRESHOLDS[4]) return { id: "tier_100", label: "Legend (100+)", description: "Attend 100 events", tone: "purple" };
  if (v >= TIER_THRESHOLDS[3]) return { id: "tier_70", label: "Elite (70+)", description: "Attend 70 events", tone: "purple" };
  if (v >= TIER_THRESHOLDS[2]) return { id: "tier_40", label: "Dedicated (40+)", description: "Attend 40 events", tone: "blue" };
  if (v >= TIER_THRESHOLDS[1]) return { id: "tier_20", label: "Committed (20+)", description: "Attend 20 events", tone: "green" };
  return { id: "tier_10", label: "Rising (10+)", description: "Attend 10 events", tone: "amber" };
}

export function computeThisMonthBadge(verifiedThisMonth: number): Badge | null {
  const v = Number(verifiedThisMonth || 0);
  if (v < 3) return null;
  return { id: "month_events", label: "3+ events this month", description: "Attend 3+ events this month", tone: "blue" };
}

export function computeClubRegularBadge(clubRegularLabel?: string | null): Badge | null {
  const label = String(clubRegularLabel ?? "").trim();
  if (!label) return null;
  return { id: "club_regular", label, description: "Regular attendee", tone: "purple" };
}

export function computeBadges(args: {
  verifiedTotal: number;
  verifiedThisMonth: number;
  clubRegularLabel?: string | null;
}): Badge[] {
  const out: Badge[] = [];
  const tier = computeAttendanceTierBadge(args.verifiedTotal);
  if (tier) out.push(tier);
  const month = computeThisMonthBadge(args.verifiedThisMonth);
  if (month) out.push(month);
  const clubRegular = computeClubRegularBadge(args.clubRegularLabel);
  if (clubRegular) out.push(clubRegular);
  return out;
}

export function computeTopBadge(args: { verifiedTotal: number; verifiedThisMonth: number; clubRegularLabel?: string | null }): Badge | null {
  // Highest tier wins; if no tier yet, fall back to monthly, then club regular.
  return (
    computeAttendanceTierBadge(args.verifiedTotal) ||
    computeThisMonthBadge(args.verifiedThisMonth) ||
    computeClubRegularBadge(args.clubRegularLabel) ||
    null
  );
}

export function badgeToneClass(tone: Badge["tone"]) {
  switch (tone) {
    case "blue":
      return "bg-blue-50 text-blue-700 border-blue-200 shadow-sm dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-800/40";
    case "purple":
      return "bg-purple-50 text-purple-700 border-purple-200 shadow-sm dark:bg-purple-950/30 dark:text-purple-300 dark:border-purple-800/40";
    case "green":
      return "bg-green-50 text-green-700 border-green-200 shadow-sm dark:bg-green-950/30 dark:text-green-300 dark:border-green-800/40";
    case "amber":
      return "bg-amber-50 text-amber-800 border-amber-200 shadow-sm dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800/40";
    default:
      return "bg-muted text-foreground border-border";
  }
}
