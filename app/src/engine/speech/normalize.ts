// Telugu text normalization for speech/typing comparison.
//
// Two layers:
//  1. teluguToRoman — deterministic Telugu-script → roman transliteration
//     (learner-friendly, matches the style used in curriculum `roman` fields).
//  2. foldForCompare — collapses romanization variance (vowel length,
//     aspiration, retroflex/dental spelling, sh/s, w/v …) so that what the
//     ASR heard and what the learner typed can be compared fairly.

const INDEPENDENT_VOWELS: Record<string, string> = {
  అ: 'a', ఆ: 'aa', ఇ: 'i', ఈ: 'ii', ఉ: 'u', ఊ: 'uu',
  ఋ: 'ru', ౠ: 'ruu', ఌ: 'lu',
  ఎ: 'e', ఏ: 'ee', ఐ: 'ai', ఒ: 'o', ఓ: 'oo', ఔ: 'au',
};

const CONSONANTS: Record<string, string> = {
  క: 'k', ఖ: 'kh', గ: 'g', ఘ: 'gh', ఙ: 'ng',
  చ: 'ch', ఛ: 'chh', జ: 'j', ఝ: 'jh', ఞ: 'ny',
  ట: 'T', ఠ: 'Th', డ: 'D', ఢ: 'Dh', ణ: 'N',
  త: 't', థ: 'th', ద: 'd', ధ: 'dh', న: 'n',
  ప: 'p', ఫ: 'ph', బ: 'b', భ: 'bh', మ: 'm',
  య: 'y', ర: 'r', ల: 'l', వ: 'v', శ: 'sh',
  ష: 'Sh', స: 's', హ: 'h', ళ: 'L', ఱ: 'rr', ఴ: 'zh',
};

const MATRAS: Record<string, string> = {
  'ా': 'aa', 'ి': 'i', 'ీ': 'ii', 'ు': 'u', 'ూ': 'uu',
  'ృ': 'ru', 'ౄ': 'ruu',
  'ె': 'e', 'ే': 'ee', 'ై': 'ai', 'ొ': 'o', 'ో': 'oo', 'ౌ': 'au',
};

const VIRAMA = '్';
const ANUSVARA = 'ం';
const VISARGA = 'ః';
const CHANDRABINDU = 'ఁ';

const TELUGU_DIGITS: Record<string, string> = {
  '౦': '0', '౧': '1', '౨': '2', '౩': '3', '౪': '4',
  '౫': '5', '౬': '6', '౭': '7', '౮': '8', '౯': '9',
};

export function isTelugu(text: string): boolean {
  return /[ఀ-౿]/.test(text);
}

/** Transliterate Telugu script into learner-friendly roman letters. */
export function teluguToRoman(text: string): string {
  const chars = Array.from(text.normalize('NFC'));
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (CONSONANTS[c] !== undefined) {
      out += CONSONANTS[c];
      const next = chars[i + 1];
      if (next === VIRAMA) {
        i++; // consonant cluster / final consonant: no inherent vowel
      } else if (next !== undefined && MATRAS[next] !== undefined) {
        out += MATRAS[next];
        i++;
      } else {
        out += 'a'; // inherent vowel
      }
    } else if (INDEPENDENT_VOWELS[c] !== undefined) {
      out += INDEPENDENT_VOWELS[c];
    } else if (c === ANUSVARA) {
      // Assimilated nasal: 'm' before labials and word-finally, else 'n'.
      const next = chars[i + 1];
      const nextIsConsonant = next !== undefined && CONSONANTS[next] !== undefined;
      const labials = new Set(['ప', 'ఫ', 'బ', 'భ', 'మ']);
      if (!nextIsConsonant) {
        out += 'm'; // end of word (space, punctuation, or end of text)
      } else {
        out += labials.has(next) ? 'm' : 'n';
      }
    } else if (c === VISARGA) {
      out += 'h';
    } else if (c === CHANDRABINDU) {
      out += 'n';
    } else if (TELUGU_DIGITS[c] !== undefined) {
      out += TELUGU_DIGITS[c];
    } else {
      out += c; // spaces, latin letters, punctuation pass through
    }
  }
  return out;
}

/**
 * Collapse romanization variance so two romanizations of the same Telugu
 * utterance compare equal. Lossy on purpose — used only for comparison,
 * never for display.
 */
export function foldForCompare(text: string): string {
  let s = text.normalize('NFC');
  if (isTelugu(s)) s = teluguToRoman(s);
  s = s.toLowerCase();
  // strip everything that isn't a letter or space
  s = s.replace(/[^a-z\s]/g, ' ');
  // aspiration: kh→k, gh→g, chh/ch→c, jh→j, th→t, dh→d, ph→p, bh→b, sh→s
  s = s
    .replace(/chh/g, 'c')
    .replace(/ch/g, 'c')
    .replace(/kh/g, 'k')
    .replace(/gh/g, 'g')
    .replace(/jh/g, 'j')
    .replace(/th/g, 't')
    .replace(/dh/g, 'd')
    .replace(/ph/g, 'p')
    .replace(/bh/g, 'b')
    .replace(/sh/g, 's');
  // common letter-variant folds
  s = s.replace(/w/g, 'v').replace(/z/g, 'j').replace(/f/g, 'p').replace(/q/g, 'k').replace(/x/g, 'ks');
  // vowel length: aa→a etc. (after digraph folds so 'aa' in 'chaa' survives to here)
  s = s.replace(/aa/g, 'a').replace(/ee/g, 'e').replace(/ii/g, 'i').replace(/oo/g, 'o').replace(/uu/g, 'u');
  // collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** Fold and split into comparison words. */
export function foldWords(text: string): string[] {
  const folded = foldForCompare(text);
  return folded.length === 0 ? [] : folded.split(' ');
}

/** Levenshtein distance between two strings. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** Similarity in 0..1 between two already-folded strings. */
export function similarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  const maxLen = Math.max(a.length, b.length);
  return 1 - levenshtein(a, b) / maxLen;
}

/**
 * Forgiving equality for typed answers: fold both sides, then allow a small
 * edit distance proportional to length (so "entha"≈"enta", "vachanu"≈"vaccanu").
 */
export function romanAnswerMatches(input: string, target: string): boolean {
  const a = foldForCompare(input);
  const b = foldForCompare(target);
  if (a === b) return true;
  if (b.length === 0) return a.length === 0;
  const allowed = Math.max(1, Math.floor(b.replace(/ /g, '').length / 8));
  return levenshtein(a.replace(/ /g, ''), b.replace(/ /g, '')) <= allowed;
}
