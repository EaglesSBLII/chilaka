// Pronunciation QA harness: renders (or reads) each clip, transcribes it with
// the Telugu ASR, and compares the transcript to the expected text. Flags any
// clip the recognizer doesn't hear correctly — catches TTS artifacts like the
// spurious onset phoneme MMS sometimes adds.
//
//   node asr-regression.mjs [--strategy plain|trail] [--limit N] [--words]
//
// Exit non-zero if any clip scores below THRESHOLD.

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const sherpa = require('sherpa-onnx-node');
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const M = join(ROOT, 'desktop/resources/models/vits-mms-tel');
const WHISPER = join(ROOT, 'vendor/whisper.cpp/build/bin/whisper-cli');
const ASR_MODEL = join(ROOT, 'desktop/resources/models/ggml-telugu-medium-q5_0.bin');
const UNITS = join(ROOT, 'app/content/units');
const THRESHOLD = 0.75;

const args = process.argv.slice(2);
const strategy = args.includes('--strategy') ? args[args.indexOf('--strategy') + 1] : 'trail';
const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;

// ---- fold (mirror of app engine/speech/normalize foldForCompare) ----
const V = { అ:'a',ఆ:'aa',ఇ:'i',ఈ:'ii',ఉ:'u',ఊ:'uu',ఋ:'ru',ఌ:'lu',ఎ:'e',ఏ:'ee',ఐ:'ai',ఒ:'o',ఓ:'oo',ఔ:'au' };
const C = { క:'k',ఖ:'kh',గ:'g',ఘ:'gh',ఙ:'ng',చ:'ch',ఛ:'chh',జ:'j',ఝ:'jh',ఞ:'ny',ట:'T',ఠ:'Th',డ:'D',ఢ:'Dh',ణ:'N',త:'t',థ:'th',ద:'d',ధ:'dh',న:'n',ప:'p',ఫ:'ph',బ:'b',భ:'bh',మ:'m',య:'y',ర:'r',ల:'l',వ:'v',శ:'sh',ష:'Sh',స:'s',హ:'h',ళ:'L',ఱ:'rr' };
const MA = { 'ా':'aa','ి':'i','ీ':'ii','ు':'u','ూ':'uu','ృ':'ru','ె':'e','ే':'ee','ై':'ai','ొ':'o','ో':'oo','ౌ':'au' };
function teToRoman(text){
  const ch=[...text.normalize('NFC')]; let o='';
  for(let i=0;i<ch.length;i++){const c=ch[i];
    if(C[c]!==undefined){o+=C[c];const n=ch[i+1];if(n==='్'){i++;}else if(n&&MA[n]!==undefined){o+=MA[n];i++;}else o+='a';}
    else if(V[c]!==undefined)o+=V[c];
    else if(c==='ం'){const n=ch[i+1];const nc=n&&C[n]!==undefined;const lab=new Set(['ప','ఫ','బ','భ','మ']);o+=!nc?'m':(lab.has(n)?'m':'n');}
    else if(c==='ః')o+='h'; else if(c==='ఁ')o+='n'; else o+=c;}
  return o;
}
function fold(t){let s=t.normalize('NFC');if(/[ఀ-౿]/.test(s))s=teToRoman(s);s=s.toLowerCase().replace(/[^a-z\s]/g,' ');
  s=s.replace(/chh/g,'c').replace(/ch/g,'c').replace(/kh/g,'k').replace(/gh/g,'g').replace(/jh/g,'j').replace(/th/g,'t').replace(/dh/g,'d').replace(/ph/g,'p').replace(/bh/g,'b').replace(/sh/g,'s');
  s=s.replace(/w/g,'v').replace(/z/g,'j').replace(/f/g,'p').replace(/q/g,'k').replace(/x/g,'ks');
  s=s.replace(/aa/g,'a').replace(/ee/g,'e').replace(/ii/g,'i').replace(/oo/g,'o').replace(/uu/g,'u');
  return s.replace(/\s+/g,' ').trim();}
function lev(a,b){const m=a.length,n=b.length;if(!m)return n;if(!n)return m;let p=[...Array(n+1).keys()],c=new Array(n+1);
  for(let i=1;i<=m;i++){c[0]=i;for(let j=1;j<=n;j++){const cost=a[i-1]===b[j-1]?0:1;c[j]=Math.min(p[j]+1,c[j-1]+1,p[j-1]+cost);}[p,c]=[c,p];}return p[n];}
function sim(a,b){const A=fold(a),B=fold(b);if(!A&&!B)return 1;const L=Math.max(A.length,B.length);return L?1-lev(A,B)/L:1;}

function cleanForTts(text){return text.replace(/[.,!?'"‘’“”\-–:;()]/gu,' ').replace(/\s+/g,' ').trim();}
function applyStrategy(text){const base=cleanForTts(text);return strategy==='trail'?base+' ':base;}

const tts = new sherpa.OfflineTts({ model:{ vits:{ model:join(M,'model.onnx'), tokens:join(M,'tokens.txt') }, numThreads:4, debug:0, provider:'cpu' }, maxNumSentences:2 });
const tmp = mkdtempSync(join(tmpdir(),'asrqa-'));

function transcribe(text){
  const a = tts.generate({ text: applyStrategy(text), sid:0, speed:0.88, enableExternalBuffer:false });
  const wav = join(tmp,'clip.wav');
  sherpa.writeWave(wav,{samples:a.samples,sampleRate:a.sampleRate});
  const out = execFileSync(WHISPER,['-m',ASR_MODEL,'-l','te','--no-timestamps','-f',wav],{encoding:'utf8',stdio:['ignore','pipe','ignore']});
  return out.trim();
}

// gather items
const items=[];
for(const f of readdirSync(UNITS).filter(x=>x.endsWith('.json'))){
  const u=JSON.parse(readFileSync(join(UNITS,f),'utf8'));
  for(const it of u.items) items.push({id:it.id,te:it.te});
}
const sample = items.slice(0, limit === Infinity ? items.length : limit);

console.log(`Checking ${sample.length} clips with strategy="${strategy}" (threshold ${THRESHOLD})\n`);
const fails=[];
let i=0;
for(const it of sample){
  const heard=transcribe(it.te);
  const score=sim(it.te,heard);
  i++;
  if(score<THRESHOLD){fails.push({...it,heard,score});
    console.log(`  ✗ ${it.id}  score=${score.toFixed(2)}\n      want:  ${it.te}\n      heard: ${heard}`);
  }
  if(i%25===0) console.log(`  …${i}/${sample.length}`);
}
writeFileSync(join(ROOT,'tools/asr-regression-report.json'), JSON.stringify(fails,null,2));
console.log(`\nDone. ${sample.length-fails.length}/${sample.length} clean. ${fails.length} below ${THRESHOLD}.`);
process.exit(fails.length>0?1:0);
