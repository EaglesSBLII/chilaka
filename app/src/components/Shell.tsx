// App chrome: the top bar (goal ring, coins, streak) and the floating tab bar.
import { Flame, Gamepad2, Home, Settings as SettingsIcon, Target, Bird, type LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { useApp, useDailyGoal, useDueCount, useStreakStanding, type View } from '../store';
import { Mascot } from './Mascot';
import { CoinPill, Ring } from './ui';

export function Header() {
  const { standing, count } = useStreakStanding();
  const { goal, earned, pct } = useDailyGoal();
  const coins = useApp((s) => s.coins);
  const navigate = useApp((s) => s.navigate);
  const hot = standing === 'safe-done-today';
  const flameTone = hot ? 'text-flame' : standing === 'at-risk' ? 'text-flame/70' : 'text-ink-soft/60';
  return (
    <header className="sticky top-0 z-30 border-b border-line/50 bg-bg/70 backdrop-blur-xl pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-2">
        <button
          onClick={() => navigate({ name: 'path' })}
          className="flex items-center gap-1.5 text-xl font-extrabold text-teal"
          aria-label="Home"
        >
          <Mascot size={36} />
          <span className="hidden sm:inline">Chilaka</span>
        </button>
        <div className="flex flex-1 items-center justify-center gap-2">
          <Ring pct={pct} size={38} stroke={5} color={pct >= 1 ? 'var(--c-success)' : 'var(--c-accent)'}>
            <span className="text-[10px] font-extrabold text-ink-soft">{Math.round(pct * 100)}</span>
          </Ring>
          <div className="leading-tight">
            <div className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">Daily goal</div>
            <div className="text-sm font-extrabold">
              {earned}
              <span className="text-ink-soft">/{goal} XP</span>
            </div>
          </div>
        </div>
        <CoinPill amount={coins} onClick={() => navigate({ name: 'shop' })} />
        <button
          onClick={() => navigate({ name: 'profile' })}
          className={`flex items-center gap-1 text-lg font-extrabold ${flameTone}`}
          aria-label={`Streak: ${count} days`}
        >
          <Flame size={22} className={hot ? 'animate-flame fill-flame' : ''} strokeWidth={2.5} />
          {count}
        </button>
      </div>
    </header>
  );
}

const TABS: { key: View['name']; label: string; Icon: LucideIcon; to: View }[] = [
  { key: 'path', label: 'Learn', Icon: Home, to: { name: 'path' } },
  { key: 'play', label: 'Play', Icon: Gamepad2, to: { name: 'play' } },
  { key: 'quests', label: 'Quests', Icon: Target, to: { name: 'quests' } },
  { key: 'profile', label: 'Profile', Icon: Bird, to: { name: 'profile' } },
  { key: 'settings', label: 'Settings', Icon: SettingsIcon, to: { name: 'settings' } },
];

export function Nav() {
  const view = useApp((s) => s.view);
  const navigate = useApp((s) => s.navigate);
  const due = useDueCount();
  const quests = useApp((s) => s.quests);
  const claimable = quests.filter((q) => q.progress >= q.target && !q.claimedAt).length;
  // shop and badges live under their parent tabs for highlighting; a running game under Play
  const active = view.name === 'shop' ? 'profile' : view.name === 'badges' ? 'profile' : view.name === 'game' ? 'play' : view.name;
  return (
    <nav className="fixed inset-x-0 bottom-3 z-30 px-4 pb-[env(safe-area-inset-bottom)]">
      <div className="glass mx-auto flex max-w-md rounded-[26px] p-1.5">
        {TABS.map(({ key, label, Icon, to }) => {
          const on = active === key;
          // Play shows how many phrases are ready for a round (capped so it stays a nudge, not a chore)
          const badge = key === 'play' ? Math.min(due, 20) : key === 'quests' ? claimable : 0;
          return (
            <button
              key={key}
              onClick={() => navigate(to)}
              aria-label={label}
              aria-current={on ? 'page' : undefined}
              className={`relative flex flex-1 flex-col items-center gap-0.5 rounded-2xl py-2 transition-colors active:scale-95 ${
                on ? 'text-accent-dark' : 'text-ink-soft hover:text-ink'
              }`}
            >
              {on && (
                <motion.span
                  layoutId="tab-pill"
                  className="absolute inset-0 rounded-2xl bg-accent-soft"
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                />
              )}
              <span className="relative">
                <Icon size={22} strokeWidth={on ? 2.6 : 2} />
                {badge > 0 && (
                  <span className="absolute -right-2.5 -top-1.5 min-w-4 rounded-full bg-flame px-1 text-center text-[10px] font-extrabold leading-4 text-white shadow-soft">
                    {badge}
                  </span>
                )}
              </span>
              <span className="relative text-[10px] font-extrabold tracking-wide">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
