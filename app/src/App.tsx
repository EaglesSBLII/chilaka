import { useEffect } from 'react';
import { useApp, useDailyGoal, useDueCount, useStreakStanding, type View } from './store';
import { Path } from './features/Path';
import { LessonPlayer } from './features/LessonPlayer';
import { DialoguePlayer } from './features/DialoguePlayer';
import { Review } from './features/Review';
import { Profile } from './features/Profile';
import { Settings } from './features/Settings';
import { Onboarding } from './features/Onboarding';
import { Placement } from './features/Placement';
import { ProgressBar } from './components/ui';
import { Mascot } from './components/Mascot';
import { UpdateBanner } from './components/UpdateBanner';

function Header() {
  const { standing, count } = useStreakStanding();
  const { goal, earned, pct } = useDailyGoal();
  const navigate = useApp((s) => s.navigate);
  const flameTone =
    standing === 'safe-done-today' ? '' : standing === 'at-risk' ? 'grayscale opacity-70' : 'grayscale opacity-40';
  return (
    <header className="sticky top-0 z-30 bg-bg/70 backdrop-blur-md border-b border-line/60 shadow-[0_1px_12px_rgba(0,0,0,0.04)]">
      <div className="mx-auto flex max-w-2xl items-center gap-4 px-4 py-2.5">
        <button
          onClick={() => navigate({ name: 'path' })}
          className="flex items-center gap-1 font-extrabold text-teal text-xl"
          aria-label="Home"
        >
          <Mascot size={34} />
          <span className="hidden sm:inline">Chilaka</span>
        </button>
        <div className="flex-1">
          <div className="flex items-center justify-between text-xs font-bold text-ink-soft mb-1">
            <span>Daily goal</span>
            <span>
              {earned}/{goal} XP
            </span>
          </div>
          <ProgressBar pct={pct} />
        </div>
        <button
          onClick={() => navigate({ name: 'profile' })}
          className={`flex items-center gap-1 text-xl font-extrabold text-flame ${flameTone}`}
          aria-label={`Streak: ${count} days`}
        >
          <span className={standing === 'safe-done-today' ? 'animate-flame inline-block' : 'inline-block'}>🔥</span>
          {count}
        </button>
      </div>
    </header>
  );
}

function Nav() {
  const view = useApp((s) => s.view);
  const navigate = useApp((s) => s.navigate);
  const due = useDueCount();
  const items: { key: View['name']; label: string; icon: string; to: View }[] = [
    { key: 'path', label: 'Learn', icon: '🏠', to: { name: 'path' } },
    { key: 'review', label: 'Review', icon: '🗂️', to: { name: 'review' } },
    { key: 'profile', label: 'Profile', icon: '🦜', to: { name: 'profile' } },
    { key: 'settings', label: 'Settings', icon: '⚙️', to: { name: 'settings' } },
  ];
  return (
    <nav className="fixed bottom-3 inset-x-0 z-30 px-4 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-md rounded-3xl border-2 border-line bg-card/90 shadow-xl backdrop-blur-md">
        {items.map((it) => (
          <button
            key={it.key}
            onClick={() => navigate(it.to)}
            className={`relative m-1 flex-1 rounded-2xl py-2.5 text-center text-2xl transition-all active:scale-90 ${
              view.name === it.key ? 'bg-teal-soft' : 'grayscale opacity-60 hover:opacity-90'
            }`}
            aria-label={it.label}
          >
            {it.icon}
            {it.key === 'review' && due > 0 && (
              <span className="absolute top-1 right-1/2 translate-x-5 rounded-full bg-flame px-1.5 text-xs font-bold text-white">
                {due}
              </span>
            )}
            <div className={`text-[10px] font-bold uppercase tracking-wide ${view.name === it.key ? 'text-teal' : 'text-ink-soft'}`}>
              {it.label}
            </div>
          </button>
        ))}
      </div>
    </nav>
  );
}

export function App() {
  const loaded = useApp((s) => s.loaded);
  const view = useApp((s) => s.view);
  const init = useApp((s) => s.init);

  useEffect(() => {
    void init();
    void import('./music').then(({ music }) => music.init());
    void import('./sync').then(async ({ sync }) => {
      // never swap state out from under an active lesson/dialogue/placement
      sync.canApply = () => {
        const v = useApp.getState().view.name;
        return v !== 'lesson' && v !== 'dialogue' && v !== 'placement';
      };
      sync.onApplied = async () => {
        await useApp.getState().init();
      };
      await sync.init();
      // zero-touch: once the learner is onboarded, sync just works — no
      // button. Watches state so it also fires right after onboarding.
      const { SYNC_ENDPOINT } = await import('./sync-config');
      const maybeAuto = () => {
        const st = useApp.getState();
        if (st.loaded && st.profile?.onboarded) void sync.autoEnableIfNeeded(SYNC_ENDPOINT);
      };
      maybeAuto();
      useApp.subscribe(maybeAuto);
    });
  }, [init]);

  // Desktop auto-backup: every 10 minutes and whenever the window hides.
  useEffect(() => {
    if (!loaded) return;
    const { platform } = window.chilakaBridge
      ? { platform: 'electron' }
      : { platform: 'web' };
    if (platform !== 'electron') return;
    const backup = async () => {
      try {
        const json = await useApp.getState().exportBackupJson();
        await window.chilakaBridge!.saveBackup(json);
      } catch {
        // best-effort
      }
    };
    const interval = setInterval(backup, 10 * 60 * 1000);
    const onHide = () => {
      if (document.visibilityState === 'hidden') void backup();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [loaded]);

  if (!loaded) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <Mascot pose="cheer" size={140} />
        <p className="font-bold text-ink-soft">Loading your Telugu…</p>
      </div>
    );
  }

  // Full-screen flows without chrome
  if (view.name === 'onboarding')
    return (
      <>
        <UpdateBanner />
        <Onboarding />
      </>
    );
  if (view.name === 'placement') return <Placement />;
  if (view.name === 'lesson') return <LessonPlayer unitId={view.unitId} lessonId={view.lessonId} />;
  if (view.name === 'dialogue') return <DialoguePlayer unitId={view.unitId} />;

  return (
    <div className="min-h-screen pb-24">
      <UpdateBanner />
      <Header />
      <main className="mx-auto max-w-2xl px-4 py-6">
        {view.name === 'path' && <Path />}
        {view.name === 'review' && <Review />}
        {view.name === 'profile' && <Profile />}
        {view.name === 'settings' && <Settings />}
      </main>
      <Nav />
    </div>
  );
}
