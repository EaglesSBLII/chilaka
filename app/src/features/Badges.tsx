// Achievements grid: 8 badges, 3 tiers each, with progress to the next tier.
import { Award, Flame, Gem, GraduationCap, Layers, Map, Sparkles, Star, type LucideIcon } from 'lucide-react';
import { useApp, useBadgeStats } from '../store';
import { Card, Ring } from '../components/ui';
import { BADGES, tierProgress } from '../engine/badges';

const ICONS: Record<string, LucideIcon> = {
  'first-steps': Star,
  perfectionist: Sparkles,
  'on-fire': Flame,
  scholar: GraduationCap,
  reviewer: Layers,
  wordsmith: Award,
  collector: Gem,
  trailblazer: Map,
};

const TIER_COLOR = ['var(--c-line)', '#b87333', '#b8b8b8', '#f5a623'];
const TIER_NAME = ['', 'Bronze', 'Silver', 'Gold'];

export function Badges() {
  const stats = useBadgeStats();
  const earned = useApp((s) => s.badges);
  const count = earned.length;
  return (
    <div className="flex flex-col gap-5">
      <div className="surface-hero p-5">
        <h1 className="text-2xl font-extrabold">Badges</h1>
        <p className="text-sm font-semibold text-ink-soft">
          {count} of {BADGES.length} earned. Bronze, silver, gold.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {BADGES.map((def) => {
          const value = stats[def.stat];
          const { tier, next, pct } = tierProgress(def, value);
          const Icon = ICONS[def.id] ?? Star;
          return (
            <Card key={def.id} className={`flex flex-col items-center gap-2 p-4 text-center ${tier === 0 ? 'opacity-80' : ''}`} data-testid={`badge-${def.id}`}>
              <Ring pct={pct} size={72} stroke={6} color={tier === 0 ? 'var(--c-accent)' : TIER_COLOR[tier]}>
                <span
                  className="flex h-12 w-12 items-center justify-center rounded-full text-white shadow-soft"
                  style={{ background: tier === 0 ? 'var(--c-locked)' : TIER_COLOR[tier] }}
                >
                  <Icon size={24} />
                </span>
              </Ring>
              <div>
                <h3 className="font-extrabold leading-tight">{def.name}</h3>
                <p className="text-xs font-semibold text-ink-soft">{def.blurb}</p>
              </div>
              <p className="text-xs font-bold text-accent-dark">
                {tier > 0 ? TIER_NAME[tier] : 'Locked'} · {value}
                {next !== null ? ` / ${next}` : ' · maxed'}
              </p>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
