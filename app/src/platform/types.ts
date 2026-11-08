// The seam between the shared web app and its host platform.
// Desktop (Electron) implements real ASR/TTS/reminders/backup; the PWA build
// falls back to echo-mode speaking and in-app reminder guidance.

export interface ReminderSpec {
  hh: number;
  mm: number;
  enabled: boolean;
  label: string;
}

export interface AsrResult {
  ok: boolean;
  text: string;
  error?: string;
}

/**
 * Context the recognizer may use while decoding: the phrases of the lesson
 * around the one being said (never the sentence itself, so a pass still means
 * the learner was understood, not that the model was told the answer).
 */
export interface AsrHint {
  prompt?: string;
}

export interface PlatformBridge {
  kind: 'electron' | 'web';
  /** scored speaking available (whisper on desktop) */
  asrAvailable(): Promise<boolean>;
  /** transcribe 16kHz mono 16-bit WAV bytes → Telugu text */
  transcribe(wav: ArrayBuffer, hint?: AsrHint): Promise<AsrResult>;
  /** synthesize arbitrary Telugu text → WAV bytes (desktop only; null if unsupported) */
  speak(text: string): Promise<ArrayBuffer | null>;
  /** push the current reminder schedule to the host scheduler (no-op on web) */
  setReminders(reminders: ReminderSpec[]): Promise<void>;
  /** host supports OS-level scheduled reminders */
  remindersSupported: boolean;
  /** write an auto-backup JSON somewhere durable outside the browser store */
  saveBackup(json: string): Promise<void>;
  /** ask the host to keep storage persistent (web: navigator.storage.persist) */
  requestPersistence(): Promise<boolean>;
}

export interface AppleMusicResult {
  ok: boolean;
  error?: string;
  playlists?: string[];
}

export interface AppleMusicBridge {
  playlists(): Promise<AppleMusicResult>;
  play(playlist: string, volume: number): Promise<AppleMusicResult>;
  pause(): Promise<AppleMusicResult>;
  resume(): Promise<AppleMusicResult>;
  setVolume(volume: number): Promise<AppleMusicResult>;
  stop(): Promise<AppleMusicResult>;
}

/** Mac app self-updater, as seen by the window (desktop/src/updater.js). */
export type DesktopUpdatePhase = 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'error';
export interface DesktopUpdateState {
  phase: DesktopUpdatePhase;
  version?: string;
  notes?: string;
  size?: number;
  received?: number;
  percent?: number;
  error?: string;
}
export interface DesktopUpdaterBridge {
  state(): Promise<DesktopUpdateState>;
  check(): Promise<void>;
  download(): Promise<void>;
  install(): Promise<void>;
  onState(cb: (state: DesktopUpdateState) => void): () => void;
}

declare global {
  interface Window {
    chilakaBridge?: {
      updater?: DesktopUpdaterBridge;
      transcribe(wav: ArrayBuffer, hint?: AsrHint): Promise<AsrResult>;
      speak(text: string): Promise<ArrayBuffer | null>;
      asrAvailable(): Promise<boolean>;
      setReminders(reminders: ReminderSpec[]): Promise<void>;
      saveBackup(json: string): Promise<void>;
      appleMusic?: AppleMusicBridge;
    };
  }
}
