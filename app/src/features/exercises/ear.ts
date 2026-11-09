// Grading a take "by ear" in the browser: the learner's recording against the
// native clip of the phrase and the clips of the phrases around it (see
// engine/speech/acoustic). Used on the web, where the speech recogniser cannot
// transcribe one-second clips, for short phrases first and as a second opinion
// on longer ones. Works offline once the clips are cached.
import { getActiveVoice, loadClipPcm16k } from '../../audio';
import { gradeByEar, mfcc, wavToFloat32, type EarReference, type EarVerdict } from '../../engine/speech/acoustic';
import { foldForCompare } from '../../engine/speech/normalize';
import type { ContentItem, Unit } from '../../engine/types';
import { platform } from '../../platform';
import type { VoiceId } from '../../content/voices';

const MAX_REFS = 12;
const featureCache = new Map<string, Promise<Float32Array[]>>();

function refFeatures(itemId: string, voice: VoiceId): Promise<Float32Array[]> {
  const key = `${voice}:${itemId}`;
  let p = featureCache.get(key);
  if (!p) {
    p = loadClipPcm16k(itemId, voice).then(mfcc);
    p.catch(() => featureCache.delete(key));
    featureCache.set(key, p);
  }
  return p;
}

/** Short phrases are graded by ear first on the web (the recogniser hallucinates on them). */
export function earFirst(item: ContentItem): boolean {
  if (platform.kind !== 'web') return false;
  const letters = foldForCompare(item.te).replace(/ /g, '').length;
  return item.words.length <= 2 || letters <= 12;
}

/** The phrase itself plus its nearest neighbours in the unit — the "line-up" the take is judged against. */
export function earReferenceIds(item: ContentItem, unit: Unit | undefined): string[] {
  if (!unit) return [item.id];
  const idx = unit.items.findIndex((it) => it.id === item.id);
  const ordered = [...unit.items].sort(
    (a, b) => Math.abs(unit.items.indexOf(a) - idx) - Math.abs(unit.items.indexOf(b) - idx),
  );
  const ids = [item.id];
  for (const it of ordered) {
    if (ids.length >= MAX_REFS) break;
    if (it.id !== item.id && it.te !== item.te) ids.push(it.id);
  }
  return ids;
}

/** Decode and featurise the line-up ahead of the take so grading is instant. */
export function warmEar(item: ContentItem, unit: Unit | undefined, voice: VoiceId = getActiveVoice()): void {
  for (const id of earReferenceIds(item, unit)) refFeatures(id, voice).catch(() => {});
}

/** null when the references cannot be loaded (offline before the clips were cached). */
export async function gradeTakeByEar(
  wav: ArrayBuffer,
  item: ContentItem,
  unit: Unit | undefined,
  voice: VoiceId = getActiveVoice(),
): Promise<EarVerdict | null> {
  const parsed = wavToFloat32(wav);
  if (!parsed) return null;
  const refs: EarReference[] = await Promise.all(
    earReferenceIds(item, unit).map(async (id) => ({ id, features: await refFeatures(id, voice).catch(() => [] as Float32Array[]) })),
  );
  if (!refs.find((r) => r.id === item.id)?.features.length) return null;
  return gradeByEar(mfcc(parsed.samples), item.id, refs.filter((r) => r.features.length > 0));
}
