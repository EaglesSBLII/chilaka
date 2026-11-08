// Settings: reminders, music, script mode, pace, sound, backup export/import.

import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store';
import { platform } from '../platform';
import { playItemAudio, setSfxEnabled } from '../audio';
import { DEFAULT_VOICE, VOICES } from '../content/voices';
import { music } from '../music';
import { sync } from '../sync';
import { SYNC_ENDPOINT } from '../sync-config';
import { Button, Card } from '../components/ui';
import { AccountCard } from './settings/AccountCard';
import { PushToggle } from './settings/PushToggle';
import type { Difficulty, ScriptMode } from '../engine/types';
import type { MusicTrackRow, ReminderRow } from '../db/schema';

export function Settings() {
  const profile = useApp((s) => s.profile);
  const reminders = useApp((s) => s.reminders);
  const setDifficulty = useApp((s) => s.setDifficulty);
  const setScriptMode = useApp((s) => s.setScriptMode);
  const setSoundOn = useApp((s) => s.setSoundOn);
  const setVoice = useApp((s) => s.setVoice);
  const saveReminders = useApp((s) => s.saveReminders);
  const exportBackupJson = useApp((s) => s.exportBackupJson);
  const importBackupJson = useApp((s) => s.importBackupJson);

  const [drafts, setDrafts] = useState<Omit<ReminderRow, 'id'>[]>(
    reminders.length > 0
      ? reminders.map(({ hh, mm, enabled, label }) => ({ hh, mm, enabled, label }))
      : [{ hh: 19, mm: 30, enabled: true, label: 'Telugu time!' }],
  );
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const musicFileRef = useRef<HTMLInputElement>(null);
  const [tracks, setTracks] = useState<MusicTrackRow[]>([]);
  const [musicOn, setMusicOn] = useState(music.enabled);
  const [musicVol, setMusicVol] = useState(music.volume);
  const [musicSource, setMusicSource] = useState(music.source);
  const [applePlaylists, setApplePlaylists] = useState<string[] | null>(null);
  const [applePlaylist, setApplePlaylist] = useState(music.applePlaylist);
  const [appleVol, setAppleVol] = useState(music.appleVolume);
  const [appleError, setAppleError] = useState<string | null>(null);

  useEffect(() => {
    void music.tracks().then(setTracks);
  }, []);

  const connectAppleMusic = async () => {
    setAppleError(null);
    const res = await music.applePlaylists();
    if (res.ok) {
      setApplePlaylists(res.playlists);
      if (res.playlists.length === 0) setAppleError('No playlists found in your Music app.');
    } else if (res.error === 'not-authorized') {
      setAppleError(
        'macOS blocked control of Music. Allow it in System Settings → Privacy & Security → Automation → Chilaka → Music, then try again.',
      );
    } else {
      setAppleError(res.error ?? 'Could not reach the Music app.');
    }
  };

  const flash = (msg: string) => {
    setSavedFlash(msg);
    setTimeout(() => setSavedFlash(null), 2500);
  };

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-2xl font-extrabold">Settings</h2>

      <AccountCard />

      <Card>
        <h3 className="mb-3 font-extrabold">⏰ Daily reminders</h3>
        {!platform.remindersSupported && (
          <PushToggle hh={drafts.find((d) => d.enabled)?.hh ?? 19} mm={drafts.find((d) => d.enabled)?.mm ?? 30} flash={flash} />
        )}
        <div className="flex flex-col gap-2">
          {drafts.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="time"
                value={`${String(r.hh).padStart(2, '0')}:${String(r.mm).padStart(2, '0')}`}
                onChange={(e) => {
                  const [hh, mm] = e.target.value.split(':').map(Number);
                  setDrafts((d) => d.map((x, j) => (j === i ? { ...x, hh, mm } : x)));
                }}
                className="rounded-xl border-2 border-line bg-card px-3 py-2 font-bold"
              />
              <input
                value={r.label}
                onChange={(e) => setDrafts((d) => d.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                className="flex-1 rounded-xl border-2 border-line bg-card px-3 py-2 font-semibold"
                placeholder="Label"
              />
              <button
                onClick={() => setDrafts((d) => d.map((x, j) => (j === i ? { ...x, enabled: !x.enabled } : x)))}
                className={`text-2xl ${r.enabled ? '' : 'grayscale opacity-50'}`}
                aria-label={r.enabled ? 'Disable' : 'Enable'}
              >
                🔔
              </button>
              <button
                onClick={() => setDrafts((d) => d.filter((_, j) => j !== i))}
                className="text-xl text-error"
                aria-label="Remove reminder"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <Button
            variant="ghost"
            onClick={() => setDrafts((d) => [...d, { hh: 8, mm: 0, enabled: true, label: 'Morning Telugu' }])}
          >
            + Add time
          </Button>
          <Button
            onClick={async () => {
              await saveReminders(drafts);
              flash('Reminders saved!');
            }}
          >
            Save reminders
          </Button>
        </div>
      </Card>


      <Card>
        <h3 className="mb-1 font-extrabold">🎵 Background music</h3>
        <p className="mb-3 text-sm font-semibold text-ink-soft">
          Songs play faintly behind lessons and pause automatically while you're speaking.
        </p>
        <div className="mb-3 flex items-center gap-2">
          <Button
            variant={musicOn ? 'secondary' : 'ghost'}
            className="px-3 py-2 text-sm"
            onClick={async () => {
              const next = !musicOn;
              setMusicOn(next);
              await music.setEnabled(next);
            }}
          >
            {musicOn ? 'On' : 'Off'}
          </Button>
          {music.appleAvailable && (
            <div className="flex flex-1 gap-2">
              <Button
                variant={musicSource === 'apple' ? 'secondary' : 'ghost'}
                className="flex-1 px-2 py-2 text-sm normal-case tracking-normal"
                onClick={async () => {
                  setMusicSource('apple');
                  await music.setSource('apple');
                  if (!applePlaylists) await connectAppleMusic();
                }}
              >
                 Apple Music
              </Button>
              <Button
                variant={musicSource === 'files' ? 'secondary' : 'ghost'}
                className="flex-1 px-2 py-2 text-sm normal-case tracking-normal"
                onClick={async () => {
                  setMusicSource('files');
                  await music.setSource('files');
                }}
              >
                My files
              </Button>
            </div>
          )}
        </div>

        {musicSource === 'apple' && music.appleAvailable ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold text-ink-soft">
              Chilaka plays one of your Apple Music playlists through the Music app — make a playlist there (e.g.
              “Telugu Study”), and it shows up here. First connect asks macOS permission for Chilaka to control Music.
            </p>
            {applePlaylists === null ? (
              <Button variant="ghost" onClick={connectAppleMusic}>
                Connect to Apple Music
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <select
                  value={applePlaylist}
                  onChange={async (e) => {
                    setApplePlaylist(e.target.value);
                    await music.setApplePlaylist(e.target.value);
                    flash(`Playing “${e.target.value}” faintly 🎶`);
                  }}
                  className="flex-1 rounded-xl border-2 border-line bg-card px-3 py-2 font-semibold"
                  aria-label="Apple Music playlist"
                >
                  <option value="" disabled>
                    Choose a playlist…
                  </option>
                  {applePlaylists.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <Button variant="ghost" className="px-3 py-2 text-sm" onClick={connectAppleMusic}>
                  ↻
                </Button>
              </div>
            )}
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold text-ink-soft">Volume</span>
              <input
                type="range"
                min="0"
                max="40"
                step="2"
                value={appleVol}
                onChange={async (e) => {
                  const v = Number(e.target.value);
                  setAppleVol(v);
                  await music.setAppleVolume(v);
                }}
                className="flex-1 accent-[var(--c-teal)]"
                aria-label="Apple Music volume"
              />
            </div>
            {appleError && (
              <p className="rounded-xl bg-error-soft px-3 py-2 text-sm font-semibold text-error-dark">{appleError}</p>
            )}
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-3">
              <span className="text-sm font-bold text-ink-soft">Volume</span>
              <input
                type="range"
                min="0"
                max="0.4"
                step="0.02"
                value={musicVol}
                onChange={async (e) => {
                  const v = Number(e.target.value);
                  setMusicVol(v);
                  await music.setVolume(v);
                }}
                className="flex-1 accent-[var(--c-teal)]"
                aria-label="Music volume"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              {tracks.map((t) => (
                <div key={t.id} className="flex items-center justify-between rounded-xl border-2 border-line px-3 py-1.5">
                  <span className="truncate font-semibold">{t.name}</span>
                  <button
                    className="text-error font-bold"
                    aria-label={`Remove ${t.name}`}
                    onClick={async () => {
                      await music.removeTrack(t.id!);
                      setTracks(await music.tracks());
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {tracks.length === 0 && (
                <p className="text-sm font-semibold text-ink-soft">
                  No songs yet. Add DRM-free files (MP3/M4A) below — note: Apple Music downloads (.m4p) are
                  copy-protected and can't be added as files; use the Apple Music mode instead.
                </p>
              )}
            </div>
            <Button variant="ghost" className="mt-3" onClick={() => musicFileRef.current?.click()}>
              + Add songs
            </Button>
            <input
              ref={musicFileRef}
              type="file"
              accept="audio/*,.mp3,.m4a,.aac,.wav"
              multiple
              className="hidden"
              onChange={async (e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length === 0) return;
                const added = await music.addFiles(files);
                setTracks(await music.tracks());
                flash(added > 0 ? `Added ${added} song${added > 1 ? 's' : ''}!` : 'No audio files found.');
                e.target.value = '';
              }}
            />
          </>
        )}
      </Card>

      <Card>
        <h3 className="mb-3 font-extrabold">🔤 Script display</h3>
        <div className="flex gap-2">
          {(
            [
              ['roman', 'English letters'],
              ['roman+telugu', 'Both'],
              ['telugu', 'తెలుగు first'],
            ] as [ScriptMode, string][]
          ).map(([mode, label]) => (
            <Button
              key={mode}
              variant={profile?.scriptMode === mode ? 'secondary' : 'ghost'}
              className="flex-1 px-2 text-sm normal-case tracking-normal"
              onClick={() => void setScriptMode(mode)}
            >
              {label}
            </Button>
          ))}
        </div>
      </Card>

      <Card>
        <h3 className="mb-3 font-extrabold">🏃 Daily pace</h3>
        <div className="flex gap-2">
          {(
            [
              ['relaxed', 'Relaxed'],
              ['standard', 'Standard'],
              ['intense', 'Intense'],
            ] as [Difficulty, string][]
          ).map(([d, label]) => (
            <Button
              key={d}
              variant={profile?.difficulty === d ? 'secondary' : 'ghost'}
              className="flex-1 px-2 text-sm"
              onClick={() => void setDifficulty(d)}
            >
              {label}
            </Button>
          ))}
        </div>
      </Card>

      <Card>
        <h3 className="mb-1 font-extrabold">🎙 Voice</h3>
        <p className="mb-3 text-xs font-semibold text-ink-soft">
          Who reads the lessons. In dialogues, named men and women keep their own voice either way.
        </p>
        <div className="flex gap-2">
          {VOICES.map((v) => (
            <Button
              key={v.id}
              variant={(profile?.voice ?? DEFAULT_VOICE) === v.id ? 'secondary' : 'ghost'}
              className="flex-1 px-2 text-sm normal-case tracking-normal"
              onClick={() => {
                void setVoice(v.id);
                void playItemAudio('u01-i01', false, v.id);
              }}
            >
              {v.label}
            </Button>
          ))}
        </div>
      </Card>

      <Card>
        <h3 className="mb-3 font-extrabold">🔊 Sound effects</h3>
        <Button
          variant={profile?.soundOn !== false ? 'secondary' : 'ghost'}
          onClick={() => {
            const next = !(profile?.soundOn !== false);
            void setSoundOn(next);
            setSfxEnabled(next);
          }}
        >
          {profile?.soundOn !== false ? 'On' : 'Off'}
        </Button>
      </Card>

      <details className="group">
        <summary className="cursor-pointer select-none px-1 text-sm font-extrabold text-ink-soft">Advanced: pair devices with a code (no account)</summary>
        <div className="mt-3">
          <SyncCard flash={flash} />
        </div>
      </details>

      <Card>
        <h3 className="mb-1 font-extrabold">💾 Backup & sync</h3>
        <p className="mb-3 text-sm font-semibold text-ink-soft">
          Your progress lives on this device. Export a backup to move it to your iPhone (AirDrop the file) or keep it
          safe.
        </p>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            onClick={async () => {
              const json = await exportBackupJson();
              await platform.saveBackup(json);
              flash(platform.kind === 'electron' ? 'Backup saved to your backups folder!' : 'Backup downloaded!');
            }}
          >
            Export backup
          </Button>
          <Button variant="ghost" onClick={() => fileRef.current?.click()}>
            Import backup
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                await importBackupJson(await f.text());
                flash('Backup restored!');
              } catch (err) {
                flash(err instanceof Error ? err.message : 'Import failed.');
              }
              e.target.value = '';
            }}
          />
        </div>
      </Card>

      <p className="text-center text-xs font-bold text-ink-soft">
        Chilaka · build {__BUILD_STAMP__}
      </p>
      <p className="text-center text-[11px] font-semibold text-ink-soft">
        Voices generated with AI4Bharat IndicF5 from OpenSLR Telugu speakers (CC BY-SA 4.0).
      </p>

      {savedFlash && (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-2xl bg-teal px-5 py-3 font-bold text-white animate-pop">
          {savedFlash}
        </div>
      )}
    </div>
  );
}

function SyncCard({ flash }: { flash: (msg: string) => void }) {
  const [, force] = useState(0);
  const [pasteCode, setPasteCode] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [showJoin, setShowJoin] = useState(false);

  useEffect(() => sync.subscribe(() => force((n) => n + 1)), []);

  const configured = Boolean(sync.endpoint && sync.key);
  const code = sync.pairingCode();

  return (
    <Card>
      <h3 className="mb-1 font-extrabold">🔄 Sync between devices</h3>
      <p className="mb-3 text-sm font-semibold text-ink-soft">
        Sync is on automatically — your streak, XP, and review deck stay identical on every paired device. AI speech
        grading on the phone rides on it too.
      </p>

      {!configured && (
        <div className="flex flex-col gap-3">
          {SYNC_ENDPOINT ? (
            <Button
              onClick={async () => {
                await sync.setUp(SYNC_ENDPOINT);
                flash('Sync is on! Pair your other device with the code below.');
              }}
            >
              Start sync now
            </Button>
          ) : (
            <p className="rounded-xl bg-amber-soft px-3 py-2 text-sm font-semibold">
              The sync server isn't deployed yet — finish the one-time setup in SYNC-SETUP.md, then rebuild.
            </p>
          )}
          <div className="flex items-center gap-2">
            <input
              value={pasteCode}
              onChange={(e) => setPasteCode(e.target.value)}
              placeholder="Or paste a pairing code from your other device"
              className="flex-1 rounded-xl border-2 border-line bg-card px-3 py-2 font-semibold"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <Button
              variant="ghost"
              className="px-3 py-2 text-sm"
              disabled={!pasteCode.trim()}
              onClick={async () => {
                const ok = await sync.pair(pasteCode);
                if (ok) {
                  setPasteCode('');
                  flash('Paired! Your progress is syncing.');
                } else {
                  flash('That code doesn’t look right — copy it exactly.');
                }
              }}
            >
              Pair
            </Button>
          </div>
        </div>
      )}

      {configured && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                sync.status === 'idle' ? 'bg-success' : sync.status === 'syncing' ? 'bg-marigold animate-pulse' : sync.status === 'error' ? 'bg-error' : 'bg-locked'
              }`}
            />
            <span className="text-sm font-bold">
              {sync.status === 'idle' && 'Synced'}
              {sync.status === 'syncing' && 'Syncing…'}
              {sync.status === 'error' && `Sync problem: ${sync.lastError ?? 'unknown'}`}
              {sync.status === 'disabled' && 'Paused'}
            </span>
            {sync.lastSyncAt && (
              <span className="text-xs font-semibold text-ink-soft">
                · last {new Date(sync.lastSyncAt).toLocaleTimeString()}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" className="px-3 py-2 text-sm" onClick={() => void sync.syncNow()}>
              Sync now
            </Button>
            <Button variant="ghost" className="px-3 py-2 text-sm" onClick={() => setShowCode((s) => !s)}>
              {showCode ? 'Hide pairing code' : 'Pair another device'}
            </Button>
            <Button variant="ghost" className="px-3 py-2 text-sm" onClick={() => setShowJoin((s) => !s)}>
              {showJoin ? 'Cancel join' : 'Join another device'}
            </Button>
            <Button
              variant="ghost"
              className="px-3 py-2 text-sm"
              onClick={async () => {
                await sync.setEnabled(sync.status === 'disabled' ? true : false);
              }}
            >
              {sync.status === 'disabled' ? 'Resume' : 'Pause'}
            </Button>
          </div>
          {showJoin && (
            <div className="flex items-center gap-2">
              <input
                value={pasteCode}
                onChange={(e) => setPasteCode(e.target.value)}
                placeholder="Paste a pairing code from your other device"
                className="flex-1 rounded-xl border-2 border-line bg-card px-3 py-2 font-semibold"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
              <Button
                variant="ghost"
                className="px-3 py-2 text-sm"
                disabled={!pasteCode.trim()}
                onClick={async () => {
                  const ok = await sync.pair(pasteCode);
                  if (ok) {
                    setPasteCode('');
                    setShowJoin(false);
                    flash('Paired! Your progress is syncing.');
                  } else {
                    flash('That code doesn’t look right — copy it exactly.');
                  }
                }}
              >
                Pair
              </Button>
            </div>
          )}
          {showCode && code && (
            <div className="rounded-xl border-2 border-teal/40 bg-teal-soft p-3">
              <p className="mb-2 text-xs font-bold text-ink-soft">
                On your other device: Settings → Sync → paste this code. Keep it private — it IS the key to your progress.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 select-all break-all rounded-lg bg-card px-2 py-1 text-xs font-bold">{code}</code>
                <Button
                  variant="ghost"
                  className="px-2 py-1 text-xs"
                  onClick={async () => {
                    await navigator.clipboard.writeText(code);
                    flash('Pairing code copied!');
                  }}
                >
                  Copy
                </Button>
              </div>
              <p className="mb-1 mt-3 text-xs font-bold text-ink-soft">
                …or paste a code FROM your other device here (your progress here merges in — nothing is lost):
              </p>
              <div className="flex items-center gap-2">
                <input
                  value={pasteCode}
                  onChange={(e) => setPasteCode(e.target.value)}
                  placeholder="CHK1-…"
                  className="flex-1 rounded-lg border-2 border-line bg-card px-2 py-1 text-xs font-semibold"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <Button
                  variant="ghost"
                  className="px-2 py-1 text-xs"
                  disabled={!pasteCode.trim()}
                  onClick={async () => {
                    const ok = await sync.pair(pasteCode);
                    if (ok) {
                      setPasteCode('');
                      setShowCode(false);
                      flash('Linked! Your devices now share one progress.');
                    } else {
                      flash('That code doesn’t look right — copy it exactly.');
                    }
                  }}
                >
                  Link
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
