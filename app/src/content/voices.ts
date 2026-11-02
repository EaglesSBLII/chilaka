// The two native Telugu voices of the course. Both are generated with AI4Bharat's
// IndicF5 from short references of real speakers in the OpenSLR SLR66 corpus
// (CC BY-SA 4.0 — see tools/voice-ref/ATTRIBUTION.md). The learner picks one in
// Settings; dialogues additionally give named men and women the matching voice.

export type VoiceId = 'female' | 'male';
export const DEFAULT_VOICE: VoiceId = 'female';
export const VOICES: { id: VoiceId; label: string; blurb: string }[] = [
  { id: 'female', label: 'Female', blurb: 'Warm, clear — the default teacher voice' },
  { id: 'male', label: 'Male', blurb: 'Steady and low' },
];
export function otherVoice(v: VoiceId): VoiceId {
  return v === 'female' ? 'male' : 'female';
}

const FEMALE = new Set([
  'amma', 'aunty', 'ammamma', 'nanamma', 'nannamma', 'peddamma', 'pinni', 'attayya', 'akka', 'chelli',
  'chinni', 'padma', 'priya', 'divya', 'meghana', 'meena', 'sruthi', 'vadina', 'atta', 'lakshmi',
]);
const MALE = new Set([
  'nanna', 'tata', 'tatayya', 'grandpa', 'uncle', 'mavayya', 'babai', 'bava', 'anna', 'tammudu', 'chinnu',
  'ravi', 'raju', 'kiran', 'suresh', 'anil', 'imran', 'farhan', 'rao gaaru', 'driver', 'guard', 'waiter',
  'broker', 'tailor', 'painter',
]);

export function genderOf(speaker: string): 'f' | 'm' | null {
  const k = speaker.trim().toLowerCase();
  if (FEMALE.has(k)) return 'f';
  if (MALE.has(k)) return 'm';
  return null;
}

/** Voice for a dialogue character: named women/men keep their gender; other roles use the learner's pick. */
export function voiceForSpeaker(speaker: string, selected: VoiceId): VoiceId {
  const g = genderOf(speaker);
  if (g === 'f') return 'female';
  if (g === 'm') return 'male';
  return selected;
}
