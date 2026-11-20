// Content validator for Chilaka: checks every authored unit, lesson, item, dialogue,
// audio clip and reference transcript without starting the app.
//
//   node tools/validate-content.mjs            # full report, exit code 1 on any error
//   node tools/validate-content.mjs --quiet    # errors and the summary only
//   node tools/validate-content.mjs --json out.json   # also write the findings as JSON
//   node tools/validate-content.mjs --audio-deep      # also measure every clip's length (macOS afinfo, ~1 min)
//
// Needs Node 22.18 or newer (it imports the app's own TypeScript schema and transliterator,
// so the checks can never drift from what the app does). No extra packages.
//
// ERROR   = a learner would hit something broken or wrong. Must be fixed.
// WARNING = probably fine, but a person should look once.
// INFO    = counts and notes for the report.

import { readFileSync, readdirSync, statSync, existsSync, openSync, readSync, closeSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authoredUnitSchema } from '../app/src/content/schema.ts';
import { teluguToRoman } from '../app/src/engine/speech/normalize.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UNITS_DIR = join(ROOT, 'app/content/units');
const AUDIO_DIR = join(ROOT, 'app/public/audio');
const TRANSCRIPTS_DIR = join(ROOT, 'app/src/content');
const VOICES = ['female', 'male'];
const args = process.argv.slice(2);
const quiet = args.includes('--quiet');
const audioDeep = args.includes('--audio-deep');
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;

const findings = [];
const add = (level, check, where, message) => findings.push({ level, check, where, message });
const error = (check, where, message) => add('ERROR', check, where, message);
const warn = (check, where, message) => add('WARNING', check, where, message);
const info = (check, where, message) => add('INFO', check, where, message);

// ---------------------------------------------------------------- load

const files = readdirSync(UNITS_DIR).filter((f) => f.endsWith('.json')).sort();
const units = [];
for (const f of files) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(join(UNITS_DIR, f), 'utf8'));
  } catch (e) {
    error('json', f, `not valid JSON: ${e.message}`);
    continue;
  }
  const parsed = authoredUnitSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) error('schema', `${f} ${issue.path.join('.')}`, issue.message);
    continue;
  }
  if (`${parsed.data.id}.json` !== f) error('ids', f, `file name does not match unit id "${parsed.data.id}"`);
  units.push({ ...parsed.data, file: f });
}
// the order the app uses (app/src/content/load.ts)
units.sort((x, y) => (x.track === 'script') - (y.track === 'script') || x.section - y.section || x.order - y.order);

const itemsById = new Map();
const unitOfItem = new Map();
const roman = (unit, te) => (unit.track === 'script' ? teluguToRoman(te) : teluguToRoman(te).toLowerCase());
const fold = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// ---------------------------------------------------------------- 1. pathways: ids, links, order

{
  const seenUnit = new Set();
  const slot = new Map();
  for (const u of units) {
    if (seenUnit.has(u.id)) error('ids', u.id, 'duplicate unit id');
    seenUnit.add(u.id);
    const key = `${u.track}:${u.section}.${u.order}`;
    if (slot.has(key)) error('order', u.id, `same track, section and order as ${slot.get(key)} (${key})`);
    slot.set(key, u.id);
  }
  // inside a track, sections and orders must run without gaps so the path has no hole
  for (const track of ['speak', 'script']) {
    const inTrack = units.filter((u) => u.track === track);
    const bySection = new Map();
    for (const u of inTrack) bySection.set(u.section, [...(bySection.get(u.section) ?? []), u.order]);
    const sections = [...bySection.keys()].sort((a, b) => a - b);
    for (let i = 1; i < sections.length; i++)
      if (sections[i] !== sections[i - 1] + 1) error('order', track, `section ${sections[i - 1]} is followed by section ${sections[i]} (gap)`);
    for (const [s, orders] of bySection) {
      orders.sort((a, b) => a - b);
      orders.forEach((o, i) => {
        if (o !== i + 1) error('order', `${track} section ${s}`, `unit orders are ${orders.join(',')} — expected 1..${orders.length}`);
      });
    }
  }

  for (const u of units) {
    for (const it of u.items) {
      if (itemsById.has(it.id)) error('ids', it.id, `duplicate item id (also in ${unitOfItem.get(it.id).id})`);
      if (!it.id.startsWith(`${u.id}-`)) error('ids', it.id, `item id does not belong to unit ${u.id}`);
      itemsById.set(it.id, it);
      unitOfItem.set(it.id, u);
    }
  }

  for (const u of units) {
    const own = new Set(u.items.map((i) => i.id));
    const lessonIds = new Set();
    const taught = new Map(); // item id → first lesson index
    u.lessons.forEach((l, li) => {
      if (lessonIds.has(l.id)) error('ids', `${u.id}:${l.id}`, 'duplicate lesson id in unit');
      lessonIds.add(l.id);
      if (l.id !== `l${li + 1}`) warn('ids', `${u.id}:${l.id}`, `lesson ${li + 1} of the unit has id "${l.id}" (expected l${li + 1})`);
      const inLesson = new Set();
      for (const id of l.itemIds) {
        if (!itemsById.has(id)) error('links', `${u.id}:${l.id}`, `lesson lists item ${id}, which does not exist`);
        else if (!own.has(id)) error('links', `${u.id}:${l.id}`, `lesson lists item ${id}, which belongs to another unit`);
        if (inLesson.has(id)) error('links', `${u.id}:${l.id}`, `item ${id} is listed twice in the lesson`);
        inLesson.add(id);
        if (!taught.has(id)) taught.set(id, li);
      }
    });
    for (const it of u.items) {
      const inDialogue = u.dialogue?.turns.some((t) => t.itemId === it.id);
      if (!taught.has(it.id)) {
        if (inDialogue) warn('links', it.id, 'used only in the dialogue — never taught in a lesson of the unit');
        else error('links', it.id, 'orphan item: in no lesson and no dialogue, so a learner never meets it');
      }
    }
    if (u.dialogue) {
      const d = u.dialogue;
      if (!d.turns.some((t) => t.userTurn)) error('dialogue', `${u.id}:${d.id}`, 'dialogue has no learner turn');
      if (!d.turns.some((t) => !t.userTurn)) error('dialogue', `${u.id}:${d.id}`, 'dialogue has only learner turns');
      for (const t of d.turns) {
        if (!itemsById.has(t.itemId)) error('links', `${u.id}:${d.id}`, `dialogue line uses item ${t.itemId}, which does not exist`);
        else if (!own.has(t.itemId)) error('links', `${u.id}:${d.id}`, `dialogue line uses item ${t.itemId} from another unit`);
        if (t.userTurn && t.speaker !== 'You') warn('dialogue', `${u.id}:${d.id}`, `learner turn is labelled "${t.speaker}" instead of "You"`);
        if (!t.userTurn && t.speaker === 'You') warn('dialogue', `${u.id}:${d.id}`, `a line labelled "You" (${t.itemId}) is not marked as a learner turn`);
      }
    }
    // difficulty should not fall sharply as the unit goes on
    const mean = (l) => l.itemIds.reduce((s, id) => s + (itemsById.get(id)?.difficulty ?? 0), 0) / l.itemIds.length;
    for (let i = 1; i < u.lessons.length; i++) {
      const drop = mean(u.lessons[i - 1]) - mean(u.lessons[i]);
      if (drop >= 1.5) warn('difficulty', `${u.id}:${u.lessons[i].id}`, `average difficulty falls from ${mean(u.lessons[i - 1]).toFixed(1)} to ${mean(u.lessons[i]).toFixed(1)} against the previous lesson`);
    }
  }
}

// ---------------------------------------------------------------- 2. text: Unicode, script, placeholders

const CONSONANT = /[క-హౘ-ౚ]/u;
const INDEPENDENT_VOWEL = /[అ-ఔౠౡ]/u;
const MATRA = /[ా-ౌౢౣ]/u;
const VIRAMA = '్';
const MARK = /[ంఃఁ]/u; // anusvara, visarga, chandrabindu
const INVISIBLE = /[​-‏‪-‮⁠-⁤﻿­ ]/u;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;
const OTHER_INDIC = /[ऀ-௿ಀ-෿]/u; // Devanagari … Tamil, Kannada, Malayalam, Sinhala
const UNASSIGNED_TELUGU = /[఍఑఩఺఻౅౉౎-౔౗౛౜౞౟౤౥౰-౶]/u;
const RARE = /[ఱఴౘౙఌౡౠఙఞ]/u;
const PLACEHOLDER = /\b(todo|tbd|fixme|lorem|ipsum|placeholder|xxx+|changeme|untitled)\b|\?\?\?|<[^>]+>|\{\{|\}\}/i;

/** Every way a Telugu string can be malformed at the character level. */
function teluguProblems(s) {
  const out = [];
  if (s !== s.normalize('NFC')) out.push('not in normalised (NFC) form');
  if (INVISIBLE.test(s)) out.push('contains an invisible character (zero-width, no-break space or direction mark)');
  if (CONTROL.test(s)) out.push('contains a control character');
  if (/�/.test(s)) out.push('contains the replacement character (corrupted text)');
  if (/[ÃÂâ€]/.test(s)) out.push('looks like mis-decoded text (mojibake)');
  if (OTHER_INDIC.test(s)) out.push('contains a letter from another Indian script');
  if (UNASSIGNED_TELUGU.test(s)) out.push('contains an unassigned Telugu code point');
  if (/[A-Za-z]/.test(s)) out.push('contains Latin letters');
  if (s !== s.trim()) out.push('has a leading or trailing space');
  if (/\s{2,}/.test(s)) out.push('has a double space');
  if (/\s[.,!?]/.test(s)) out.push('has a space before punctuation');
  const chars = Array.from(s);
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const prev = chars[i - 1];
    const at = `"${chars.slice(Math.max(0, i - 2), i + 2).join('')}"`;
    if (MATRA.test(c)) {
      if (prev === undefined || !CONSONANT.test(prev)) out.push(`vowel sign ${c} does not follow a consonant, near ${at}`);
    } else if (c === VIRAMA) {
      if (prev === undefined || !CONSONANT.test(prev)) out.push(`virama does not follow a consonant, near ${at}`);
    } else if (MARK.test(c)) {
      if (prev === undefined || !(CONSONANT.test(prev) || INDEPENDENT_VOWEL.test(prev) || MATRA.test(prev)))
        out.push(`${c} does not follow a letter or vowel sign, near ${at}`);
      if (prev !== undefined && MARK.test(prev)) out.push(`two nasal/visarga marks in a row, near ${at}`);
    } else if (INDEPENDENT_VOWEL.test(c)) {
      if (prev === VIRAMA) out.push(`ACRONYM? independent vowel right after a virama, near ${at}`);
    }
  }
  return out;
}

const dangling = (s) => new RegExp(`${VIRAMA}(?![క-హ])`, 'u').test(s);

function checkEnglish(where, field, s) {
  if (!s.trim()) error('text', where, `${field} is empty`);
  if (s !== s.trim()) warn('text', where, `${field} has a leading or trailing space`);
  if (/ {2,}/.test(s)) warn('text', where, `${field} has a double space`);
  if (PLACEHOLDER.test(s)) error('placeholder', where, `${field} looks like placeholder text: "${s.slice(0, 60)}"`);
  if (INVISIBLE.test(s) || CONTROL.test(s) || /�/.test(s)) error('unicode', where, `${field} contains an invisible, control or corrupted character`);
  if (/[ÃÂ]|â€/.test(s)) error('unicode', where, `${field} looks like mis-decoded text (mojibake)`);
  if (OTHER_INDIC.test(s)) error('unicode', where, `${field} contains a letter from another Indian script`);
}

for (const u of units) {
  checkEnglish(u.id, 'unit title', u.title);
  checkEnglish(u.id, 'unit description', u.description);
  if (/[ఀ-౿]/u.test(u.title)) warn('text', u.id, 'unit title contains Telugu script (titles are English)');
  if (u.teTitle !== undefined) {
    if (!/^[ఀ-౿\s0-9\-–,.&]+$/u.test(u.teTitle)) error('unicode', u.id, `teTitle is not Telugu script: "${u.teTitle}"`);
    for (const p of teluguProblems(u.teTitle)) error('unicode', u.id, `teTitle ${p}`);
  }
  for (const l of u.lessons) checkEnglish(`${u.id}:${l.id}`, 'lesson title', l.title);
  if (u.dialogue) {
    checkEnglish(`${u.id}:${u.dialogue.id}`, 'dialogue title', u.dialogue.title);
    checkEnglish(`${u.id}:${u.dialogue.id}`, 'dialogue scene', u.dialogue.scene);
  }
  for (const it of u.items) {
    for (const p of teluguProblems(it.te)) {
      // letters spelled out one by one (పీఎన్ఆర్ = PNR) legitimately put a vowel after a closed consonant
      if (p.startsWith('ACRONYM?')) warn('script', it.id, `"${it.te}": ${p.slice(9)} — normal only in a spelled-out abbreviation`);
      else error('unicode', it.id, `Telugu text ${p}`);
    }
    if (dangling(it.te)) info('script', it.id, `"${it.te}" has a consonant closed with a virama (normal for loanwords and letter cards)`);
    if (RARE.test(it.te) && u.track !== 'script') warn('script', it.id, `"${it.te}" uses a letter that is rare in modern Telugu`);
    if (it.audioTe !== undefined) for (const p of teluguProblems(it.audioTe)) error('unicode', it.id, `audio text ${p}`);
    checkEnglish(it.id, 'meaning', it.gloss);
    if (/[ఀ-౿]/u.test(it.gloss) && u.track !== 'script') warn('text', it.id, `meaning contains Telugu script: "${it.gloss}"`);
    if (it.note !== undefined) checkEnglish(it.id, 'note', it.note);
    if (it.romanOverride !== undefined) info('romanization', it.id, `hand-written transliteration "${it.romanOverride}" replaces the derived "${roman(u, it.te)}"`);
    for (const w of it.words) {
      for (const p of teluguProblems(w.te)) if (!p.startsWith('ACRONYM?')) error('unicode', it.id, `word "${w.te}" ${p}`);
      checkEnglish(it.id, `word meaning of "${w.te}"`, w.gloss);
      if (/\s/.test(w.te)) warn('words', it.id, `word "${w.te}" contains a space (one tile holds two words)`);
      if (w.romanOverride !== undefined) info('romanization', it.id, `hand-written transliteration "${w.romanOverride}" for word "${w.te}"`);
    }
    // the word breakdown must rebuild the sentence, because the word tiles are checked against it
    const strip = (s) => s.replace(/[.,!?'"‘’“”\-–]/gu, ' ').replace(/\s+/g, ' ').trim();
    const sentence = strip(it.te);
    const rebuilt = strip(it.words.map((w) => w.te).join(' '));
    if (sentence !== rebuilt) {
      if (sentence.replace(/\s/g, '') === rebuilt.replace(/\s/g, '')) {
        // the reading track cuts every word into syllable tiles on purpose
        if (u.track !== 'script') warn('words', it.id, `word breakdown splits the sentence differently: "${rebuilt}" vs "${sentence}"`);
      } else error('words', it.id, `word breakdown does not rebuild the sentence: "${rebuilt}" vs "${sentence}"`);
    }
    if (it.tags.length === 0) info('text', it.id, 'item has no tags');
  }
}

// ---------------------------------------------------------------- 3. transliteration inside notes

// A note often quotes Telugu followed by its reading: నాకు (naaku). That reading must be what the
// app itself derives, or the card shows two spellings of one word.
for (const u of units) {
  for (const it of u.items) {
    if (!it.note) continue;
    const re = /([ఀ-౿][ఀ-౿\s]*[ఀ-౿]|[ఀ-౿])\s*\(([^)]*)\)/gu;
    let m;
    while ((m = re.exec(it.note))) {
      const te = m[1];
      const inside = m[2];
      const want = roman(u, te);
      // only a parenthesis that is a reading, not a translation or an aside
      const said = inside.split(/[,;—–]| - | = /)[0].trim().replace(/^["'‘“]|["'’”]$/g, '');
      if (!/^[A-Za-z' -]+$/.test(said)) continue;
      const wantFold = want.toLowerCase().replace(/[^a-z]/g, '');
      const saidFold = said.toLowerCase().replace(/[^a-z]/g, '');
      if (wantFold === saidFold) {
        if (want.replace(/[^A-Za-z]/g, '') !== said.replace(/[^A-Za-z]/g, ''))
          warn('romanization', it.id, `note writes ${te} as "${said}"; the card shows "${want}" (capitals differ)`);
        continue;
      }
      // a reading shares most letters with the derived one; anything else is a translation in brackets
      const short = Math.min(wantFold.length, saidFold.length);
      let same = 0;
      for (let i = 0; i < short; i++) if (wantFold[i] === saidFold[i]) same++;
      if (short >= 2 && same / Math.max(wantFold.length, saidFold.length) >= 0.5)
        warn('romanization', it.id, `note writes ${te} as "${said}"; the app derives "${want}"`);
    }
    // notes quote bare endings (-ండి, -ే) on purpose, so only corruption is checked here
    for (const p of teluguProblems((it.note.match(/[ఀ-౿]+/gu) ?? []).join(' '))) {
      if (/normalised|another Indian script|unassigned/.test(p)) error('unicode', it.id, `Telugu quoted in the note ${p}`);
    }
  }
}

// Speaking-track text is all lowercase roman (ikkada); capitals inside a word (ikkaDa) or macrons (ē)
// are the other two schemes leaking in. The reading track's meanings start with the reading itself
// ("amma — mother"), which must be the derived one.
const CAMEL_OK = new Set(['PhonePe', 'WhatsApp', 'YouTube', 'iPhone', 'GPay', 'McDonald']);
for (const u of units) {
  const texts = [[u.id, 'description', u.description], ...u.lessons.map((l) => [`${u.id}:${l.id}`, 'lesson title', l.title])];
  if (u.dialogue) texts.push([`${u.id}:${u.dialogue.id}`, 'dialogue scene', u.dialogue.scene]);
  for (const it of u.items) {
    texts.push([it.id, 'meaning', it.gloss]);
    if (it.note) texts.push([it.id, 'note', it.note]);
    for (const w of it.words) texts.push([it.id, `word meaning of "${w.te}"`, w.gloss]);
  }
  for (const [where, field, text] of texts) {
    if (/[āēīōūṭḍṇḷśṣṅñṃ]/i.test(text)) warn('romanization', where, `${field} uses accented transliteration letters (the app writes aa, ee, T, D …): "${text.slice(0, 70)}"`);
    if (u.track === 'speak')
      for (const tok of text.match(/[A-Za-z]+/g) ?? [])
        if (/[a-z][TDNLS][a-z]|[a-z][TDNL]$/.test(tok) && !CAMEL_OK.has(tok)) warn('romanization', where, `${field} writes "${tok}" with capitals inside the word; speaking-track cards are all lowercase`);
  }
  if (u.track === 'script')
    for (const it of u.items) {
      const m = /^(.+?) — /.exec(it.gloss);
      if (!m) continue;
      const lead = m[1];
      const want = roman(u, it.te);
      if (/^[A-Za-z ?!.,']+$/.test(lead) && lead.replace(/[^A-Za-z]/g, '') !== want.replace(/[^A-Za-z]/g, '') && it.te.trim().split(/\s+/).length === lead.trim().split(/\s+/).length)
        warn('romanization', it.id, `meaning starts with the reading "${lead}"; the app derives "${want}"`);
    }
}

// ---------------------------------------------------------------- 4. answers: one right answer, wrong ones wrong

for (const u of units) {
  for (const it of u.items) {
    const seen = new Set();
    for (const d of it.distractors ?? []) {
      const other = itemsById.get(d);
      if (!other) {
        error('answers', it.id, `wrong-answer choice ${d} does not exist`);
        continue;
      }
      if (d === it.id) error('answers', it.id, 'lists itself as a wrong answer');
      if (seen.has(d)) warn('answers', it.id, `wrong-answer choice ${d} is listed twice`);
      seen.add(d);
      if (other.te === it.te) error('answers', it.id, `wrong-answer choice ${d} has the same Telugu, so it is also right`);
      if (fold(other.gloss) === fold(it.gloss)) error('answers', it.id, `wrong-answer choice ${d} has the same meaning ("${other.gloss}"), so it is also right`);
      if (unitOfItem.get(d).track !== u.track) warn('answers', it.id, `wrong-answer choice ${d} comes from the other track`);
    }
  }
  // unit-mates fill the remaining choices: two that read the same make a question with two right answers
  for (let a = 0; a < u.items.length; a++) {
    for (let b = a + 1; b < u.items.length; b++) {
      const x = u.items[a];
      const y = u.items[b];
      if (x.te === y.te) error('answers', `${x.id} / ${y.id}`, `same Telugu "${x.te}" twice in one unit`);
      else if (fold(x.gloss) === fold(y.gloss)) {
        if (x.gloss.toLowerCase() === y.gloss.toLowerCase()) info('answers', `${x.id} / ${y.id}`, `same meaning "${x.gloss}" for two phrases; the app never offers one as a wrong answer for the other`);
        else error('answers', `${x.id} / ${y.id}`, `meanings differ only in punctuation ("${x.gloss}" / "${y.gloss}"), so one can appear as a wrong answer for the other`);
      } else if (u.track !== 'script' && roman(u, x.te) === roman(u, y.te))
        error('answers', `${x.id} / ${y.id}`, `different Telugu (${x.te} / ${y.te}) reads the same in roman letters ("${roman(u, x.te)}")`);
    }
  }
}

// the same Telugu taught with different meanings in different places
{
  const byTe = new Map();
  for (const [id, it] of itemsById) byTe.set(it.te, [...(byTe.get(it.te) ?? []), id]);
  for (const [te, ids] of byTe) {
    if (ids.length < 2) continue;
    const sameTrack = ids.filter((id) => unitOfItem.get(id).track === unitOfItem.get(ids[0]).track);
    const glosses = new Set(sameTrack.map((id) => fold(itemsById.get(id).gloss)));
    if (sameTrack.length < ids.length) info('duplicates', ids.join(' / '), `"${te}" is taught in both the speaking and the reading track`);
    else if (glosses.size > 1) warn('duplicates', ids.join(' / '), `"${te}" is taught with different meanings: ${ids.map((id) => `"${itemsById.get(id).gloss}"`).join(' vs ')}`);
    else info('duplicates', ids.join(' / '), `"${te}" appears ${ids.length} times with the same meaning`);
  }
  // one word, different word-meanings (often fine: context), listed for review
  const byWord = new Map();
  for (const [id, it] of itemsById) for (const w of it.words) {
    const m = byWord.get(w.te) ?? new Map();
    m.set(fold(w.gloss), [...(m.get(fold(w.gloss)) ?? []), id]);
    byWord.set(w.te, m);
  }
  let multi = 0;
  for (const m of byWord.values()) if (m.size > 1) multi++;
  info('duplicates', 'words', `${byWord.size} distinct words; ${multi} are glossed in more than one way across the course (context-dependent glosses)`);
}

// ---------------------------------------------------------------- 5. reading track: nothing used before it is taught

{
  const script = units.filter((u) => u.track === 'script');
  const known = new Set(); // letters, vowel signs and the virama met so far
  for (const u of script) {
    const before = new Set(known);
    // everything this unit shows on its cards counts as taught by this unit
    const aksharas = (te) => te.match(/[క-హ](?:్[క-హ])*[ా-ౌ]?[ంఃఁ]?|[అ-ఔౠౡ][ంఃఁ]?/gu)?.length ?? 0;
    // a letter card shows one akshara, or a few of them side by side ("ఙ ఞ")
    const isCard = (te) => te.trim().split(/\s+/).every((t) => aksharas(t) <= 1);
    const single = u.items.filter((it) => isCard(it.te));
    for (const it of single) for (const c of Array.from(it.te)) if (/[ఀ-౿]/u.test(c)) known.add(c);
    const taughtHere = new Set([...known].filter((c) => !before.has(c)));
    for (const it of u.items) {
      const chars = Array.from(it.te).filter((c) => /[ఀ-౿]/u.test(c));
      if (isCard(it.te)) continue;
      const unknown = [...new Set(chars.filter((c) => !known.has(c)))];
      if (unknown.length) warn('order', it.id, `"${it.te}" uses ${unknown.join(' ')} before any letter card teaches ${unknown.length > 1 ? 'them' : 'it'}`);
    }
    for (const it of u.items) for (const c of Array.from(it.te)) if (/[ఀ-౿]/u.test(c)) known.add(c);
    info('order', u.id, `teaches ${[...taughtHere].join(' ') || '(no new single letters)'}`);
  }
}

// ---------------------------------------------------------------- 6. audio

const audioCounts = {};
for (const voice of VOICES) {
  const dir = join(AUDIO_DIR, `v-${voice}`);
  if (!existsSync(dir)) {
    error('audio', voice, `audio folder ${dir} is missing`);
    continue;
  }
  const present = new Set(readdirSync(dir).filter((f) => f.endsWith('.m4a')).map((f) => f.slice(0, -4)));
  audioCounts[voice] = present.size;
  for (const id of itemsById.keys()) {
    if (!present.has(id)) {
      error('audio', id, `no ${voice} clip`);
      continue;
    }
    const file = join(dir, `${id}.m4a`);
    const size = statSync(file).size;
    if (size < 1500) error('audio', id, `${voice} clip is only ${size} bytes (empty or truncated)`);
    const head = Buffer.alloc(12);
    const fd = openSync(file, 'r');
    readSync(fd, head, 0, 12, 0);
    closeSync(fd);
    if (head.toString('latin1', 4, 8) !== 'ftyp') error('audio', id, `${voice} clip is not an MP4/M4A file`);
  }
  for (const id of present) if (!itemsById.has(id)) warn('audio', id, `${voice} clip has no matching item (leftover file)`);
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) warn('audio', voice, 'manifest.json is missing');
  else {
    const manifest = new Set(JSON.parse(readFileSync(manifestPath, 'utf8')));
    for (const id of itemsById.keys()) if (!manifest.has(id)) error('audio', id, `not listed in the ${voice} manifest.json`);
    for (const id of manifest) if (!itemsById.has(id)) warn('audio', id, `${voice} manifest.json lists an item that does not exist`);
  }
  if (audioDeep) {
    for (const id of itemsById.keys()) {
      if (!present.has(id)) continue;
      let seconds = NaN;
      try {
        const out = execFileSync('afinfo', [join(dir, `${id}.m4a`)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        seconds = Number(/estimated duration: ([\d.]+)/.exec(out)?.[1]);
      } catch {
        error('audio', id, `${voice} clip cannot be decoded`);
        continue;
      }
      const it = itemsById.get(id);
      const syllables = (it.audioTe ?? it.te).match(/[అ-ఔౠౡ]|[క-హ](?:్[క-హ])*[ా-ౌ]?/gu)?.length ?? 1;
      if (!(seconds > 0.2)) error('audio', id, `${voice} clip is ${seconds}s long`);
      else if (seconds > 14) warn('audio', id, `${voice} clip is ${seconds.toFixed(1)}s long`);
      else if (seconds / syllables < 0.07) warn('audio', id, `${voice} clip is ${seconds.toFixed(2)}s for ${syllables} syllables (too short to hold the whole phrase?)`);
      else if (seconds / syllables > 1.6 && syllables > 1) warn('audio', id, `${voice} clip is ${seconds.toFixed(2)}s for ${syllables} syllables (long silence?)`);
    }
  }
}

// reference transcripts (what the speech grader expects to hear for each clip)
for (const voice of VOICES) {
  const p = join(TRANSCRIPTS_DIR, `reference-transcripts-${voice}.json`);
  if (!existsSync(p)) {
    warn('transcripts', voice, 'reference transcript file is missing');
    continue;
  }
  const t = JSON.parse(readFileSync(p, 'utf8'));
  for (const id of itemsById.keys()) if (!(id in t)) error('transcripts', id, `no ${voice} reference transcript`);
  for (const id of Object.keys(t)) if (!itemsById.has(id)) warn('transcripts', id, `${voice} reference transcript for an item that does not exist`);
}

// ---------------------------------------------------------------- report

const count = (level) => findings.filter((f) => f.level === level).length;
const lessons = units.reduce((s, u) => s + u.lessons.length, 0);
const words = units.reduce((s, u) => s + u.items.reduce((n, i) => n + i.words.length, 0), 0);
const summary = {
  units: units.length,
  speakUnits: units.filter((u) => u.track === 'speak').length,
  scriptUnits: units.filter((u) => u.track === 'script').length,
  lessons,
  items: itemsById.size,
  words,
  notes: [...itemsById.values()].filter((i) => i.note).length,
  dialogues: units.filter((u) => u.dialogue).length,
  audioClips: audioCounts,
  errors: count('ERROR'),
  warnings: count('WARNING'),
  info: count('INFO'),
};

const show = (level) => {
  const rows = findings.filter((f) => f.level === level);
  if (!rows.length) return;
  console.log(`\n${level}S (${rows.length})`);
  const byCheck = new Map();
  for (const r of rows) byCheck.set(r.check, [...(byCheck.get(r.check) ?? []), r]);
  for (const [check, list] of byCheck) {
    console.log(`  [${check}] ${list.length}`);
    for (const r of list) console.log(`    ${r.where}: ${r.message}`);
  }
};
show('ERROR');
if (!quiet) {
  show('WARNING');
  const infos = findings.filter((f) => f.level === 'INFO');
  const byCheck = new Map();
  for (const r of infos) byCheck.set(r.check, (byCheck.get(r.check) ?? 0) + 1);
  console.log(`\nINFO (${infos.length}): ${[...byCheck].map(([k, n]) => `${k} ${n}`).join(', ')}  — use --json to see them`);
}
console.log(
  `\nChecked ${summary.units} units (${summary.speakUnits} speaking, ${summary.scriptUnits} reading & writing), ${summary.lessons} lessons, ` +
    `${summary.items} items, ${summary.words} words, ${summary.notes} notes, ${summary.dialogues} dialogues, ` +
    `${VOICES.map((v) => `${audioCounts[v] ?? 0} ${v} clips`).join(', ')}${audioDeep ? ' (clip lengths measured)' : ''}.`,
);
console.log(`${summary.errors} errors, ${summary.warnings} warnings.  ${summary.errors === 0 ? 'PASS' : 'FAIL'}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ summary, findings }, null, 2));
process.exit(summary.errors === 0 ? 0 : 1);
