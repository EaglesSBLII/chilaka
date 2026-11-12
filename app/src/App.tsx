import { useEffect } from 'react';
import { useApp } from './store';
import { Path } from './features/Path';
import { LessonPlayer } from './features/LessonPlayer';
import { DialoguePlayer } from './features/DialoguePlayer';
import { Play } from './features/Play';
import { GameShell } from './features/games/GameShell';
import { Profile } from './features/Profile';
import { Settings } from './features/Settings';
import { Onboarding } from './features/Onboarding';
import { Placement } from './features/Placement';
import { Quests } from './features/Quests';
import { Shop } from './features/Shop';
import { Badges } from './features/Badges';
import { Auth } from './features/Auth';
import { Mascot } from './components/Mascot';
import { UpdateBanner } from './components/UpdateBanner';
import { Header, Nav } from './components/Shell';
import { PageTransition } from './components/motion';

export function App() {
  const loaded = useApp((s) => s.loaded);
  const view = useApp((s) => s.view);
  const init = useApp((s) => s.init);

  useEffect(() => {
    void init().then(() => {
      const accent = useApp.getState().profile?.accent;
      if (accent) document.documentElement.dataset.accent = accent;
    });
    void import('./music').then(({ music }) => music.init());
    void import('./sync').then(async ({ sync }) => {
      // never swap state out from under an active lesson/dialogue/placement/game round
      sync.canApply = () => {
        const v = useApp.getState().view.name;
        return v !== 'lesson' && v !== 'dialogue' && v !== 'placement' && v !== 'game';
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

  // The app can stay open across midnight (a backgrounded PWA, the Mac app in
  // the tray): when it comes back, start the new day's XP count and quests.
  useEffect(() => {
    if (!loaded) return;
    const check = () => {
      if (document.visibilityState === 'visible') void useApp.getState().rollDay();
    };
    document.addEventListener('visibilitychange', check);
    const t = window.setInterval(check, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.clearInterval(t);
    };
  }, [loaded]);

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
  if (view.name === 'game') return <GameShell game={view.game} />;

  return (
    <div className="min-h-screen pb-24">
      <UpdateBanner />
      <Header />
      <main className="mx-auto max-w-2xl px-4 py-6">
        <PageTransition id={view.name}>
          {view.name === 'path' && <Path />}
          {view.name === 'play' && <Play />}
          {view.name === 'quests' && <Quests />}
          {view.name === 'shop' && <Shop />}
          {view.name === 'badges' && <Badges />}
          {view.name === 'auth' && <Auth initialMode={view.mode} />}
          {view.name === 'profile' && <Profile />}
          {view.name === 'settings' && <Settings />}
        </PageTransition>
      </main>
      <Nav />
    </div>
  );
}
