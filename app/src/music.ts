// Background music, two sources:
//  - 'files': the learner's own DRM-free songs as blobs in IndexedDB,
//    shuffle-looped through a faint <audio> element.
//  - 'apple': the macOS Music app remote-controlled over the desktop bridge —
//    Apple Music playlists (DRM included) play inside Apple's player at low
//    volume while Chilaka presses its buttons.
// Either way the music PAUSES automatically while the microphone records.

import { db, type MusicTrackRow } from './db/schema';

const DEFAULT_VOLUME = 0.12; // "faintly hear them in the background"
const DEFAULT_APPLE_VOLUME = 12; // Music app volume 0-100

export type MusicSource = 'files' | 'apple';

class MusicManager {
  private el: HTMLAudioElement | null = null;
  private order: number[] = [];
  private cursor = 0;
  private url: string | null = null;
  private started = false;
  private ducked = false;
  private wasPlaying = false;
  enabled = false;
  volume = DEFAULT_VOLUME;
  source: MusicSource = 'files';
  applePlaylist = '';
  appleVolume = DEFAULT_APPLE_VOLUME;
  private appleStarted = false;

  get appleAvailable(): boolean {
    return Boolean(window.chilakaBridge?.appleMusic);
  }

  async init(): Promise<void> {
    const en = await db.settings.get('musicEnabled');
    const vol = await db.settings.get('musicVolume');
    const src = await db.settings.get('musicSource');
    const apl = await db.settings.get('applePlaylist');
    const avol = await db.settings.get('appleVolume');
    this.enabled = en ? Boolean(en.value) : true; // on by default once configured
    this.volume = typeof vol?.value === 'number' ? (vol.value as number) : DEFAULT_VOLUME;
    this.source = src?.value === 'apple' && this.appleAvailable ? 'apple' : 'files';
    this.applePlaylist = typeof apl?.value === 'string' ? (apl.value as string) : '';
    this.appleVolume = typeof avol?.value === 'number' ? (avol.value as number) : DEFAULT_APPLE_VOLUME;
    // arm on the first user gesture (browser autoplay policy)
    const arm = () => {
      window.removeEventListener('pointerdown', arm);
      void this.maybeStart();
    };
    window.addEventListener('pointerdown', arm);
  }

  async setSource(source: MusicSource): Promise<void> {
    if (this.source === source) return;
    // silence the old source before switching
    if (this.source === 'apple') await window.chilakaBridge?.appleMusic?.stop().catch(() => {});
    else this.stop();
    this.source = source;
    this.started = false;
    this.appleStarted = false;
    await db.settings.put({ key: 'musicSource', value: source });
    if (this.enabled) await this.maybeStart();
  }

  async setApplePlaylist(name: string): Promise<void> {
    this.applePlaylist = name;
    await db.settings.put({ key: 'applePlaylist', value: name });
    this.appleStarted = false;
    if (this.enabled && this.source === 'apple') await this.maybeStart();
  }

  async setAppleVolume(v: number): Promise<void> {
    this.appleVolume = Math.max(0, Math.min(50, Math.round(v)));
    await db.settings.put({ key: 'appleVolume', value: this.appleVolume });
    if (this.appleStarted) await window.chilakaBridge?.appleMusic?.setVolume(this.appleVolume).catch(() => {});
  }

  /** Fetch playlist names from the Music app (triggers the consent prompt). */
  async applePlaylists(): Promise<{ ok: boolean; playlists: string[]; error?: string }> {
    const res = await window.chilakaBridge?.appleMusic?.playlists();
    if (!res) return { ok: false, playlists: [], error: 'desktop-only' };
    return { ok: res.ok, playlists: res.playlists ?? [], error: res.error };
  }

  async tracks(): Promise<MusicTrackRow[]> {
    return db.musicTracks.toArray();
  }

  async addFiles(files: File[]): Promise<number> {
    let added = 0;
    for (const f of files) {
      if (!f.type.startsWith('audio/') && !/\.(mp3|m4a|aac|wav|ogg|flac)$/i.test(f.name)) continue;
      await db.musicTracks.add({ name: f.name.replace(/\.[^.]+$/, ''), blob: f, addedAt: new Date().toISOString() });
      added++;
    }
    if (added > 0 && this.enabled) await this.restart();
    return added;
  }

  async removeTrack(id: number): Promise<void> {
    await db.musicTracks.delete(id);
    await this.restart();
  }

  async setEnabled(on: boolean): Promise<void> {
    this.enabled = on;
    await db.settings.put({ key: 'musicEnabled', value: on });
    if (on) {
      await this.maybeStart();
    } else {
      this.stop();
      if (this.appleStarted) {
        this.appleStarted = false;
        await window.chilakaBridge?.appleMusic?.stop().catch(() => {});
      }
    }
  }

  async setVolume(v: number): Promise<void> {
    this.volume = Math.max(0, Math.min(0.5, v));
    await db.settings.put({ key: 'musicVolume', value: this.volume });
    if (this.el && !this.ducked) this.el.volume = this.volume;
  }

  /** Pause while the mic records (true), resume after (false). */
  duck(on: boolean): void {
    this.ducked = on;
    if (this.source === 'apple') {
      if (!this.appleStarted) return;
      if (on) void window.chilakaBridge?.appleMusic?.pause().catch(() => {});
      else void window.chilakaBridge?.appleMusic?.resume().catch(() => {});
      return;
    }
    if (!this.el) return;
    if (on) {
      this.wasPlaying = !this.el.paused;
      this.el.pause();
    } else if (this.wasPlaying && this.enabled) {
      void this.el.play().catch(() => {});
    }
  }

  private async maybeStart(): Promise<void> {
    if (!this.enabled) return;
    if (this.source === 'apple') {
      if (this.appleStarted || !this.applePlaylist || !this.appleAvailable) return;
      const res = await window.chilakaBridge!.appleMusic!.play(this.applePlaylist, this.appleVolume);
      this.appleStarted = Boolean(res.ok);
      return;
    }
    if (this.started) {
      if (this.el?.paused && !this.ducked) void this.el?.play().catch(() => {});
      return;
    }
    const rows = await db.musicTracks.toArray();
    if (rows.length === 0) return;
    this.started = true;
    this.order = rows.map((r) => r.id!).sort(() => Math.random() - 0.5);
    this.cursor = 0;
    await this.playCurrent();
  }

  private async restart(): Promise<void> {
    this.stop();
    this.started = false;
    await this.maybeStart();
  }

  private async playCurrent(): Promise<void> {
    if (!this.enabled || this.order.length === 0) return;
    const id = this.order[this.cursor % this.order.length];
    const row = await db.musicTracks.get(id);
    if (!row) {
      this.order = this.order.filter((x) => x !== id);
      return this.playCurrent();
    }
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(row.blob);
    if (!this.el) {
      this.el = new Audio();
      this.el.addEventListener('ended', () => {
        this.cursor++;
        void this.playCurrent();
      });
    }
    this.el.src = this.url;
    this.el.volume = this.volume;
    if (!this.ducked) {
      await this.el.play().catch(() => {
        // autoplay refused — the pointerdown arm will retry
        this.started = false;
      });
    }
  }

  private stop(): void {
    this.el?.pause();
    if (this.el) this.el.src = '';
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
  }
}

export const music = new MusicManager();
