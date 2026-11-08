// Renders the whole course in one of the cloned native voices (tools/voice-ref/*),
// with the same QA gate as the original render: every take is transcribed by the
// Telugu recognizer — decoding exactly the way the app grades (greedy + lesson
// context) — and a take passes only if the first word and the whole sentence are
// heard; failures re-roll with new seeds, best take wins. Winners get the polish
// pass (lead-in, tail, matched loudness) and max-quality AAC.
//
// Writes:  app/public/audio/v-<voice>/<id>.m4a  + manifest.json
//          app/src/content/reference-transcripts-<voice>.json   (what the recognizer
//            hears in each reference clip — the grader's calibration)
//          tools/render-<voice>-report.json                      (flagged clips)
//
//   node tools/render-voice.mjs --voice female|male [--force] [--only u01] [--ids u65-i03,u66-i01 | --ids @list.txt] [--rounds 3] [--nfe 16]
//
// Second gate (Nov 2026, after Arnav heard stray syllables): every take is also
// force-aligned to its text with Meta's MMS aligner (tools/voice-align.py); a take
// is rejected when audio stretches past the last character (an extra syllable),
// before the first one, or the characters align with low confidence (slur/warble).
// Thresholds come from the corpus audit: --max-tail, --max-head, --min-conf.

import { readdirSync, readFileSync, mkdirSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import net from 'node:net';
import { readWav, writeWav, polishWav, encodeM4a, FFMPEG } from './lib/audio.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const UNITS_DIR = join(ROOT, 'app/content/units');
const PYTHON = join(ROOT, 'vendor/f5-venv/bin/python');
const WORKER = join(__dirname, 'clone-render.py');
const WSERVER = join(ROOT, 'vendor/whisper.cpp/build/bin/whisper-server');
const ASR_MODEL = join(ROOT, 'desktop/resources/models/ggml-telugu-medium-q5_0.bin');

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : dflt; };
const VOICE = arg('--voice', 'female');
if (!['female', 'male'].includes(VOICE)) throw new Error('--voice female|male');
const force = process.argv.includes('--force');
const only = arg('--only', null);
const idsArg = arg('--ids', null);
const onlyIds = idsArg ? new Set((idsArg.startsWith('@') ? readFileSync(idsArg.slice(1), 'utf8') : idsArg).split(/[\s,]+/).filter(Boolean)) : null;
const ALIGNER = join(__dirname, 'voice-align.py');
// corpus audit (Nov 2026): tail_extra median 0.006 s female / 0.063 s male, p95 0.062 / 0.142; the
// clips Arnav heard with a stray syllable sit above that. Confidence is skipped for letter items.
const MAX_TAIL = Number(arg('--max-tail', VOICE === 'male' ? 0.15 : 0.10));
const MAX_HEAD = Number(arg('--max-head', 0.10));
// alignment confidence is noisy on short words ('aavu' scores 0.31 while the recognizer hears it
// perfectly), so it only gates items of six or more roman letters; regular clips sit at 0.55+
const MIN_CONF = Number(arg('--min-conf', 0.4));
const confApplies = (a) => (a?.roman || '').replace(/\s/g, '').length >= 6;
// letter cards ("అ, అమ్మ.") must say the letter on its own: ≥80 ms, then a pause ≥25 dB down
// before the word — the clone often fuses "ఇ, ఇల్లు" into one long "iillu" (tools/lib/mmsalign.py)
const letterOk = (a) => a?.sep_dip === undefined || (a.letter_span >= 0.08 && a.sep_dip <= -25);
const ROUNDS = Number(arg('--rounds', 3));
// The male reference (6.7 s) throws a stray syllable before the sentence at
// 16 steps / 0.92 pace (Arnav heard it on every clip); 32 steps at natural pace
// was clean in every audition. The female reference is fine at the faster settings.
const NFE = Number(arg('--nfe', VOICE === 'male' ? 32 : 16));
const SPEED = Number(arg('--speed', VOICE === 'male' ? 1.0 : 0.92));
const MIN_GEN = Number(arg('--min-gen', 1.4)); // floor (s) of generated speech for one-word items
const SIM_PASS = 0.7;
// single words must come back whole (ఒకటి heard as ఒక is a 0.75 — not good enough)
const passSim = (te) => (fold(te).split(' ').filter(Boolean).length <= 1 ? 0.92 : SIM_PASS);
const OUT_DIR = join(ROOT, `app/public/audio/v-${VOICE}`);
const REF_WAV = join(__dirname, 'voice-ref', `${VOICE}.wav`);
const REF_TEXT = readFileSync(join(__dirname, 'voice-ref', `${VOICE}.txt`), 'utf8').trim();

// ---------- text folding (mirror of app engine/speech/normalize) ----------
const V = { అ:'a',ఆ:'aa',ఇ:'i',ఈ:'ii',ఉ:'u',ఊ:'uu',ఋ:'ru',ఎ:'e',ఏ:'ee',ఐ:'ai',ఒ:'o',ఓ:'oo',ఔ:'au' };
const C = { క:'k',ఖ:'kh',గ:'g',ఘ:'gh',ఙ:'ng',చ:'ch',ఛ:'chh',జ:'j',ఝ:'jh',ఞ:'ny',ట:'T',ఠ:'Th',డ:'D',ఢ:'Dh',ణ:'N',త:'t',థ:'th',ద:'d',ధ:'dh',న:'n',ప:'p',ఫ:'ph',బ:'b',భ:'bh',మ:'m',య:'y',ర:'r',ల:'l',వ:'v',శ:'sh',ష:'Sh',స:'s',హ:'h',ళ:'L',ఱ:'rr' };
const MA = { 'ా':'aa','ి':'i','ీ':'ii','ు':'u','ూ':'uu','ృ':'ru','ె':'e','ే':'ee','ై':'ai','ొ':'o','ో':'oo','ౌ':'au' };
function teToRoman(t){const c=[...t.normalize('NFC')];let o='';for(let i=0;i<c.length;i++){const x=c[i];if(C[x]!==undefined){o+=C[x];const n=c[i+1];if(n==='్'){i++}else if(n&&MA[n]!==undefined){o+=MA[n];i++}else o+='a'}else if(V[x]!==undefined)o+=V[x];else if(x==='ం'){const n=c[i+1];o+=!(n&&C[n]!==undefined)?'m':(new Set(['ప','ఫ','బ','భ','మ']).has(n)?'m':'n')}else if(x==='ః')o+='h';else o+=x}return o}
function fold(t){let s=t.normalize('NFC');if(/[ఀ-౿]/.test(s))s=teToRoman(s);s=s.toLowerCase().replace(/[^a-z\s]/g,' ').replace(/chh/g,'c').replace(/ch/g,'c').replace(/kh/g,'k').replace(/gh/g,'g').replace(/jh/g,'j').replace(/th/g,'t').replace(/dh/g,'d').replace(/ph/g,'p').replace(/bh/g,'b').replace(/sh/g,'s').replace(/w/g,'v').replace(/z/g,'j').replace(/f/g,'p').replace(/q/g,'k').replace(/aa/g,'a').replace(/ee/g,'e').replace(/ii/g,'i').replace(/oo/g,'o').replace(/uu/g,'u');return s.replace(/\s+/g,' ').trim()}
function lev(a,b){const m=a.length,n=b.length;if(!m)return n;if(!n)return m;let p=[...Array(n+1).keys()],c=new Array(n+1);for(let i=1;i<=m;i++){c[0]=i;for(let j=1;j<=n;j++){const k=a[i-1]===b[j-1]?0:1;c[j]=Math.min(p[j]+1,c[j-1]+1,p[j-1]+k)}[p,c]=[c,p]}return p[n]}
function simFolded(A,B){if(!A&&!B)return 1;const L=Math.max(A.length,B.length);return L?1-lev(A,B)/L:1}
function sim(a,b){return simFolded(fold(a),fold(b))}
function firstWordOk(expected, heard){const e=fold(expected).split(' ')[0]??'';const h=fold(heard).split(' ')[0]??'';if(!e)return true;if(!h)return false;return simFolded(e,h)>=0.7}

/** mirror of app engine/speech/hint.ts — the unit's OTHER phrases, nearest first */
function hintFor(unit, it){
  const idx=unit.items.findIndex(x=>x.id===it.id);
  const ordered=[...unit.items].sort((a,b)=>Math.abs(unit.items.indexOf(a)-idx)-Math.abs(unit.items.indexOf(b)-idx));
  const out=[];let chars=0;
  for(const x of ordered){if(x.id===it.id)continue;const te=x.te.trim();if(!te||te===it.te.trim())continue;if(out.length>=12||chars+te.length+1>600)break;out.push(te);chars+=te.length+1}
  return out.join(' ');
}

/** first-pass hygiene: cut raw lead/tail silence, fade edges (polish adds the real lead-in) */
function cleanAudio(samples, sr){
  const n=samples.length;let peak=0;for(let i=0;i<n;i++)peak=Math.max(peak,Math.abs(samples[i]));
  const th=Math.max(0.012, peak*0.03);
  let start=0;while(start<n&&Math.abs(samples[start])<th)start++;
  let end=n-1;while(end>start&&Math.abs(samples[end])<th)end--;
  if(start>=end)return samples;
  start=Math.max(0,start-Math.floor(sr*0.04));end=Math.min(n-1,end+Math.floor(sr*0.12));
  const out=samples.slice(start,end+1);
  const fi=Math.floor(sr*0.01), fo=Math.floor(sr*0.05);
  for(let i=0;i<fi&&i<out.length;i++)out[i]*=i/fi;
  for(let i=0;i<fo&&i<out.length;i++)out[out.length-1-i]*=i/fo;
  return out;
}

// ---------- ASR (warm server, self-healing) ----------
function freePort(){return new Promise((res,rej)=>{const s=net.createServer();s.on('error',rej);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>res(p))})})}
async function startAsr(){
  const port=await freePort();
  const proc=spawn(WSERVER,['-m',ASR_MODEL,'--host','127.0.0.1','--port',String(port),'-l','te','--no-timestamps','-t','4'],{stdio:'ignore'});
  process.on('exit',()=>proc.kill());
  for(let i=0;i<120;i++){try{await fetch(`http://127.0.0.1:${port}/`);return{port,proc};}catch{await new Promise(r=>setTimeout(r,500))}}
  throw new Error('ASR server failed to start');
}
let asr=null;
async function transcribe(wav16Path, hint){
  for(let attempt=0;attempt<3;attempt++){
    try{
      const form=new FormData();
      form.append('file',new Blob([readFileSync(wav16Path)],{type:'audio/wav'}),'c.wav');
      form.append('response_format','json');form.append('language','te');form.append('temperature','0.0');
      if(hint)form.append('prompt',hint);
      const res=await fetch(`http://127.0.0.1:${asr.port}/inference`,{method:'POST',body:form});
      return String((await res.json()).text??'').trim();
    }catch(err){
      console.log(`  ! ASR unavailable (${err.message}) — restarting (attempt ${attempt+1})`);
      try{asr.proc.kill();}catch{/* dead */}
      asr=await startAsr();
    }
  }
  throw new Error('ASR server unrecoverable');
}

// ---------- pipeline ----------
const files=readdirSync(UNITS_DIR).filter(f=>f.endsWith('.json'));
const items=[];
for(const f of files){
  const u=JSON.parse(readFileSync(join(UNITS_DIR,f),'utf-8'));
  if(only&&u.id!==only)continue;
  for(const it of u.items)items.push({id:it.id,te:speakable(it.audioTe??it.te),hint:hintFor(u,it)});
}
// Letter items ("అ. అమ్మ."): with a full stop the model merges the letter into the word about half
// the time and only "amma" comes out; a comma gives a clear letter, a pause, then the word.
function speakable(t){return t.replace(/^([\u0c00-\u0c7f]{1,2})\. /,'$1, ');}
const todo=items.filter(it=>(onlyIds?onlyIds.has(it.id):true)&&(force||onlyIds||!existsSync(join(OUT_DIR,`${it.id}.m4a`))));
mkdirSync(OUT_DIR,{recursive:true});
console.log(`[${VOICE}] rendering ${todo.length}/${items.length} clips (nfe=${NFE}, speed=${SPEED}, rounds=${ROUNDS})`);

const tmp=mkdtempSync(join(tmpdir(),`voice-${VOICE}-`));
const best=new Map(); // id -> {score, wavPath, heard}
function runPython(jobs, round){
  const manifest=join(tmp,`manifest-${round}.json`);
  writeFileSync(manifest,JSON.stringify({jobs}));
  const dir=join(tmp,`takes-${round}`);
  execFileSync(PYTHON,[WORKER,manifest,dir,'--ref',REF_WAV,'--ref-text',REF_TEXT,'--nfe',String(NFE),'--speed',String(SPEED),'--min-gen',String(MIN_GEN)],
    {stdio:['ignore','inherit','inherit'],env:{...process.env,PATH:`${dirname(FFMPEG)}:${process.env.PATH}`}});
  return dir;
}

if(todo.length>0)asr=await startAsr();
const takeScore=(te,heard,a)=>{
  const ok=a&&!a.error&&!(a.buzz&&a.buzz.length)&&a.tail_extra<=MAX_TAIL&&a.head_extra<=MAX_HEAD&&(!confApplies(a)||a.conf>=MIN_CONF)&&letterOk(a);
  return sim(te,heard)+(firstWordOk(te,heard)?0.25:0)+(ok?0.5:0)-(a&&!a.error?Math.max(0,a.tail_extra-MAX_TAIL)*2+Math.max(0,a.head_extra-MAX_HEAD)*2+(a.buzz&&a.buzz.length?0.5:0):0.5);
};
// Baseline: the clip already shipped. A re-render only replaces it when a new take scores higher,
// so a clean clip is never traded for a worse one just because it was on the list.
const keep=new Set();
if(todo.length>0){
  const existing=todo.filter(it=>existsSync(join(OUT_DIR,`${it.id}.m4a`))).map(it=>{
    const wav=join(tmp,`${it.id}-current.wav`);
    execFileSync('afconvert',['-f','WAVE','-d','LEF32@24000','-c','1',join(OUT_DIR,`${it.id}.m4a`),wav],{stdio:'pipe'});
    return {id:it.id,wav,text:it.te};
  });
  if(existing.length){
    const bf=join(tmp,'align-current.json'); writeFileSync(bf,JSON.stringify(existing));
    const aligned=JSON.parse(execFileSync(PYTHON,['-W','ignore',ALIGNER,'--batch',bf],{encoding:'utf8',maxBuffer:64*1024*1024,stdio:['ignore','pipe','ignore']}));
    for(const e of existing){
      const it=todo.find(x=>x.id===e.id);
      const wav16=join(tmp,'qa16.wav');
      execFileSync('afconvert',['-f','WAVE','-d','LEI16@16000',e.wav,wav16],{stdio:'pipe'});
      const heard=await transcribe(wav16,it.hint);
      best.set(e.id,{score:takeScore(it.te,heard,aligned[e.id]),wavPath:null,heard,align:aligned[e.id],current:true});
    }
    console.log(`  baseline scored for ${existing.length} existing clips`);
  }
}
let pending=todo.map((it,i)=>({...it,seed:(VOICE==='male'?90000:50000)+i+(onlyIds?7000:0)}));
for(let round=0; round<ROUNDS && pending.length>0; round++){
  console.log(`— round ${round+1}: ${pending.length} clips`);
  const dir=runPython(pending.map(p=>({id:p.id,text:p.te,seed:p.seed+round*17})),round);
  const next=[];
  // alignment audit of every take in this round (one model load)
  const takes=pending.filter(p=>existsSync(join(dir,`${p.id}.wav`))).map(p=>{
    const {samples,sampleRate}=readWav(join(dir,`${p.id}.wav`));
    const cleanPath=join(tmp,`${p.id}-r${round}.wav`);
    writeWav(cleanPath,cleanAudio(samples,sampleRate),sampleRate);
    return {id:p.id,wav:cleanPath,text:p.te};
  });
  const batchFile=join(tmp,`align-${round}.json`);
  writeFileSync(batchFile,JSON.stringify(takes));
  const aligned=takes.length?JSON.parse(execFileSync(PYTHON,['-W','ignore',ALIGNER,'--batch',batchFile],{encoding:'utf8',maxBuffer:64*1024*1024,stdio:['ignore','pipe','ignore']})):{};
  const alignOk=(a)=>a&&!a.error&&!(a.buzz&&a.buzz.length)&&a.tail_extra<=MAX_TAIL&&a.head_extra<=MAX_HEAD&&(!confApplies(a)||a.conf>=MIN_CONF)&&letterOk(a);
  for(const p of pending){
    const cleanPath=join(tmp,`${p.id}-r${round}.wav`);
    if(!existsSync(cleanPath)){next.push(p);continue;}
    const wav16=join(tmp,'qa16.wav');
    execFileSync('afconvert',['-f','WAVE','-d','LEI16@16000',cleanPath,wav16],{stdio:'pipe'});
    const heard=await transcribe(wav16,p.hint);
    const a=aligned[p.id];
    const ok=alignOk(a);
    const score=takeScore(p.te,heard,a);
    const prev=best.get(p.id);
    if(!prev||score>prev.score)best.set(p.id,{score,wavPath:cleanPath,heard,align:a});
    const pass=firstWordOk(p.te,heard)&&sim(p.te,heard)>=passSim(p.te)&&ok;
    if(!pass){next.push(p);console.log(`  ✗ ${p.id} r${round+1}: sim ${sim(p.te,heard).toFixed(2)} tail ${a?.tail_extra} head ${a?.head_extra} conf ${a?.conf}${a?.sep_dip!==undefined?` letter ${a.letter_span}s/${a.sep_dip}dB`:''}`);}
  }
  pending=next;
  console.log(`  round ${round+1} done: ${pending.length} still flagged`);
}
if(asr)asr.proc.kill();

// polish + encode winners; refresh the per-voice reference transcripts
const refFile=join(ROOT,`app/src/content/reference-transcripts-${VOICE}.json`);
const refs=existsSync(refFile)?JSON.parse(readFileSync(refFile,'utf8')):{};
const flagged=[];
let encoded=0;
for(const it of todo){
  const b=best.get(it.id);
  if(!b){flagged.push({id:it.id,reason:'no take generated'});continue;}
  if(b.current){keep.add(it.id);}
  else{
    const polished=join(tmp,`${it.id}-final.wav`);
    polishWav(b.wavPath,polished,tmp);
    encodeM4a(polished,join(OUT_DIR,`${it.id}.m4a`));
    refs[it.id]=b.heard;
    encoded++;
  }
  const a=b.align;
  const alignOk=a&&!a.error&&!(a.buzz&&a.buzz.length)&&a.tail_extra<=MAX_TAIL&&a.head_extra<=MAX_HEAD&&(!confApplies(a)||a.conf>=MIN_CONF)&&letterOk(a);
  if(!(sim(it.te,b.heard)>=passSim(it.te)&&firstWordOk(it.te,b.heard)&&alignOk))flagged.push({id:it.id,te:it.te,heard:b.heard,score:Number(b.score.toFixed(2)),align:a&&{tail:a.tail_extra,head:a.head_extra,conf:a.conf,...(a.sep_dip!==undefined?{letter_span:a.letter_span,sep_dip:a.sep_dip}:{})}});
}
rmSync(tmp,{recursive:true,force:true});

const manifest=[];
for(const f of files){
  const u=JSON.parse(readFileSync(join(UNITS_DIR,f),'utf-8'));
  for(const it of u.items)if(existsSync(join(OUT_DIR,`${it.id}.m4a`)))manifest.push(it.id);
}
writeFileSync(join(OUT_DIR,'manifest.json'),JSON.stringify(manifest));
writeFileSync(refFile,JSON.stringify(Object.fromEntries(Object.entries(refs).sort()),null,1)+'\n');
writeFileSync(join(__dirname,`render-${VOICE}-report.json`),JSON.stringify(flagged,null,2));
console.log(`\n[${VOICE}] encoded ${encoded}, kept ${keep.size} existing (no better take); ${manifest.length}/${items.length} clips present; ${flagged.length} flagged → tools/render-${VOICE}-report.json`);
