import React from "react";
import {
  BadgeCheck,
  Crown,
  Flame,
  Gem,
  Rocket,
  Sparkles,
  Star,
} from "lucide-react";

type IconComponent = React.ComponentType<{ className?: string }>;

const ICON_BY_BADGE_ID: Record<string, IconComponent> = {
  tier_10: Sparkles,
  tier_20: Star,
  tier_40: Gem,
  tier_70: Rocket,
  tier_100: Crown,
  month_events: Flame,
  club_regular: BadgeCheck,
};

export function BadgeIcon({ id, className }: { id: string; className?: string }) {
  const Icon = ICON_BY_BADGE_ID[id] ?? Star;
  return <Icon className={className} />;
}
