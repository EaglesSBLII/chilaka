// Renders curriculum audio with the SYSPIN Telugu Female studio voice, with
// built-in pronunciation QA:
//   1. Python worker (syspin-render.py) batch-generates raw 22k WAVs.
//   2. Each take is trimmed (variable leading silence cut hard), edge-faded,
//      and transcribed by the on-device Telugu ASR.
//   3. A take passes only if the FIRST word is heard correctly (kills onset
//      artifacts) and the whole transcript matches well. Failures re-roll with
//      new seeds, best take wins.
//   4. Winning takes encode to .m4a (max-quality VBR AAC).
//
//   node render-audio.mjs [--force] [--only u01] [--no-qa] [--rounds 3]

import { readdirSync, readFileSync, mkdirSync, existsSync, rmSync, writeFileSync, mkdtempSync, copyFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import net from 'node:net';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const UNITS_DIR = join(ROOT, 'app/content/units');
const OUT_DIR = join(ROOT, 'app/public/audio');
const PYTHON = join(ROOT, 'vendor/convert-venv/bin/python');
const WORKER = join(__dirname, 'rasa-render.py');
const WSERVER = join(ROOT, 'vendor/whisper.cpp/build/bin/whisper-server');
const ASR_MODEL = join(ROOT, 'desktop/resources/models/ggml-telugu-medium-q5_0.bin');

const force = process.argv.includes('--force');
const noQa = process.argv.includes('--no-qa');
const onlyIdx = process.argv.indexOf('--only');
const only = onlyIdx > -1 ? process.argv[onlyIdx + 1] : null;
const roundsIdx = process.argv.indexOf('--rounds');
const ROUNDS = roundsIdx > -1 ? Number(process.argv[roundsIdx + 1]) : 3;
const SIM_PASS = 0.7;

// ---------- text folding (mirror of app engine/speech/normalize) ----------
const V = { అ:'a',ఆ:'aa',ఇ:'i',ఈ:'ii',ఉ:'u',ఊ:'uu',ఋ:'ru',ఎ:'e',ఏ:'ee',ఐ:'ai',ఒ:'o',ఓ:'oo',ఔ:'au' };
const C = { క:'k',ఖ:'kh',గ:'g',ఘ:'gh',ఙ:'ng',చ:'ch',ఛ:'chh',జ:'j',ఝ:'jh',ఞ:'ny',ట:'T',ఠ:'Th',డ:'D',ఢ:'Dh',ణ:'N',త:'t',థ:'th',ద:'d',ధ:'dh',న:'n',ప:'p',ఫ:'ph',బ:'b',భ:'bh',మ:'m',య:'y',ర:'r',ల:'l',వ:'v',శ:'sh',ష:'Sh',స:'s',హ:'h',ళ:'L',ఱ:'rr' };
const MA = { 'ా':'aa','ి':'i','ీ':'ii','ు':'u','ూ':'uu','ృ':'ru','ె':'e','ే':'ee','ై':'ai','ొ':'o','ో':'oo','ౌ':'au' };
function teToRoman(t){const c=[...t.normalize('NFC')];let o='';for(let i=0;i<c.length;i++){const x=c[i];if(C[x]!==undefined){o+=C[x];const n=c[i+1];if(n==='్'){i++}else if(n&&MA[n]!==undefined){o+=MA[n];i++}else o+='a'}else if(V[x]!==undefined)o+=V[x];else if(x==='ం'){const n=c[i+1];o+=!(n&&C[n]!==undefined)?'m':(new Set(['ప','ఫ','బ','భ','మ']).has(n)?'m':'n')}else if(x==='ః')o+='h';else o+=x}return o}
function fold(t){let s=t.normalize('NFC');if(/[ఀ-౿]/.test(s))s=teToRoman(s);s=s.toLowerCase().replace(/[^a-z\s]/g,' ').replace(/chh/g,'c').replace(/ch/g,'c').replace(/kh/g,'k').replace(/gh/g,'g').replace(/jh/g,'j').replace(/th/g,'t').replace(/dh/g,'d').replace(/ph/g,'p').replace(/bh/g,'b').replace(/sh/g,'s').replace(/w/g,'v').replace(/z/g,'j').replace(/f/g,'p').replace(/q/g,'k').replace(/aa/g,'a').replace(/ee/g,'e').replace(/ii/g,'i').replace(/oo/g,'o').replace(/uu/g,'u');return s.replace(/\s+/g,' ').trim()}
function lev(a,b){const m=a.length,n=b.length;if(!m)return n;if(!n)return m;let p=[...Array(n+1).keys()],c=new Array(n+1);for(let i=1;i<=m;i++){c[0]=i;for(let j=1;j<=n;j++){const k=a[i-1]===b[j-1]?0:1;c[j]=Math.min(p[j]+1,c[j-1]+1,p[j-1]+k)}[p,c]=[c,p]}return p[n]}
function simFolded(A,B){if(!A&&!B)return 1;const L=Math.max(A.length,B.length);return L?1-lev(A,B)/L:1}
function sim(a,b){return simFolded(fold(a),fold(b))}
/** Did the ASR hear the first word cleanly, with nothing spurious before it? */
function firstWordOk(expected, heard){
  const e = fold(expected).split(' ')[0] ?? '';
  const h = fold(heard).split(' ')[0] ?? '';
  if (!e) return true;
  if (!h) return false;
  return simFolded(e, h) >= 0.7;
}

// ---------- WAV I/O + hygiene ----------
function readWav(path){
  const buf=readFileSync(path);let off=12,dataOff=44,dataLen=buf.length-44,sr=22050;
  // fmt chunk
  let o=12;while(o<buf.length-8){const id=buf.toString('ascii',o,o+4);const sz=buf.readUInt32LE(o+4);
    if(id==='fmt ')sr=buf.readUInt32LE(o+12);
    if(id==='data'){dataOff=o+8;dataLen=sz;break;}o+=8+sz;}
  void off;
  const n=Math.floor(dataLen/2);const s=new Float32Array(n);
  for(let i=0;i<n;i++)s[i]=buf.readInt16LE(dataOff+i*2)/32768;
  return {samples:s,sampleRate:sr};
}
function writeWav(path,samples,sr){
  const buf=Buffer.alloc(44+samples.length*2);
  buf.write('RIFF',0);buf.writeUInt32LE(36+samples.length*2,4);buf.write('WAVE',8);buf.write('fmt ',12);
  buf.writeUInt32LE(16,16);buf.writeUInt16LE(1,20);buf.writeUInt16LE(1,22);buf.writeUInt32LE(sr,24);
  buf.writeUInt32LE(sr*2,28);buf.writeUInt16LE(2,32);buf.writeUInt16LE(16,34);buf.write('data',36);
  buf.writeUInt32LE(samples.length*2,40);
  for(let i=0;i<samples.length;i++){const v=Math.max(-1,Math.min(1,samples[i]));buf.writeInt16LE(v<0?v*0x8000:v*0x7fff,44+i*2);}
  writeFileSync(path,buf);
}
/** Trim variable leading/trailing silence, fade edges. Gentle on soft onsets
 *  (h/v/s starts) — lower threshold + longer runway than before. */
function cleanAudio(samples, sr){
  const n=samples.length;let peak=0;for(let i=0;i<n;i++)peak=Math.max(peak,Math.abs(samples[i]));
  const th=Math.max(0.015, peak*0.035);
  let start=0;while(start<n&&Math.abs(samples[start])<th)start++;
  let end=n-1;while(end>start&&Math.abs(samples[end])<th)end--;
  if(start>=end)return samples;
  const lead=Math.floor(sr*0.03), tail=Math.floor(sr*0.1);
  start=Math.max(0,start-lead);end=Math.min(n-1,end+tail);
  const out=samples.slice(start,end+1);
  const fi=Math.floor(sr*0.01), fo=Math.floor(sr*0.05);
  for(let i=0;i<fi&&i<out.length;i++)out[i]*=i/fi;
  for(let i=0;i<fo&&i<out.length;i++)out[out.length-1-i]*=i/fo;
  return out;
}

// ---------- ASR (warm server) ----------
function freePort(){return new Promise((res,rej)=>{const s=net.createServer();s.on('error',rej);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>res(p))})})}
async function startAsr(){
  const port=await freePort();
  const proc=spawn(WSERVER,['-m',ASR_MODEL,'--host','127.0.0.1','--port',String(port),'-l','te','--no-timestamps','-t','6'],{stdio:'ignore'});
  process.on('exit',()=>proc.kill());
  for(let i=0;i<120;i++){try{await fetch(`http://127.0.0.1:${port}/`);return{port,proc};}catch{await new Promise(r=>setTimeout(r,500))}}
  throw new Error('ASR server failed to start');
}
async function transcribeOnce(port, wav16Path){
  const form=new FormData();
  form.append('file',new Blob([readFileSync(wav16Path)],{type:'audio/wav'}),'c.wav');
  form.append('response_format','json');form.append('language','te');form.append('temperature','0.0');
  const res=await fetch(`http://127.0.0.1:${port}/inference`,{method:'POST',body:form});
  return String((await res.json()).text??'').trim();
}

/** Transcribe with self-healing: if the QA server died (or was killed),
 *  restart it and retry rather than crashing a long render. */
async function transcribe(wav16Path){
  for(let attempt=0;attempt<3;attempt++){
    try{
      return await transcribeOnce(asr.port,wav16Path);
    }catch(err){
      console.log(`  ! ASR unavailable (${err.message}) — restarting server (attempt ${attempt+1})`);
      try{asr.proc.kill();}catch{/* already dead */}
      asr=await startAsr();
    }
  }
  throw new Error('ASR server unrecoverable after 3 restarts');
}

// ---------- pipeline ----------
const files=readdirSync(UNITS_DIR).filter(f=>f.endsWith('.json'));
const items=[];
for(const f of files){
  const u=JSON.parse(readFileSync(join(UNITS_DIR,f),'utf-8'));
  if(only&&u.id!==only)continue;
  for(const it of u.items)items.push({id:it.id,te:it.audioTe??it.te});
}
const todo=items.filter(it=>force||!existsSync(join(OUT_DIR,`${it.id}.m4a`)));
mkdirSync(OUT_DIR,{recursive:true});
console.log(`Rendering ${todo.length}/${items.length} clips (SYSPIN female, QA=${!noQa}, rounds=${ROUNDS})`);

const tmp=mkdtempSync(join(tmpdir(),'render-'));
const best=new Map(); // id -> {score, wavPath, heard}

function runPython(jobs, round){
  if(jobs.length===0)return;
  const manifest=join(tmp,`manifest-${round}.json`);
  writeFileSync(manifest,JSON.stringify({jobs}));
  const dir=join(tmp,`takes-${round}`);
  execFileSync(PYTHON,[WORKER,manifest,dir],{stdio:['ignore','inherit','inherit']});
  return dir;
}

let asr=null;
if(!noQa && todo.length>0) asr=await startAsr();

let pending=todo.map((it,i)=>({...it,seed:5000+i}));
for(let round=0; round<(noQa?1:ROUNDS) && pending.length>0; round++){
  console.log(`— round ${round+1}: ${pending.length} clips`);
  const dir=runPython(pending.map(p=>({id:p.id,text:p.te,seed:p.seed+round*17})),round);
  const next=[];
  for(const p of pending){
    const raw=join(dir,`${p.id}.wav`);
    if(!existsSync(raw)){next.push(p);continue;}
    const {samples,sampleRate}=readWav(raw);
    const cleaned=cleanAudio(samples,sampleRate);
    const cleanPath=join(tmp,`${p.id}-r${round}.wav`);
    writeWav(cleanPath,cleaned,sampleRate);
    if(noQa){best.set(p.id,{score:1,wavPath:cleanPath,heard:''});continue;}
    // downsample for ASR
    const wav16=join(tmp,'qa16.wav');
    execFileSync('afconvert',['-f','WAVE','-d','LEI16@16000',cleanPath,wav16],{stdio:'pipe'});
    const heard=await transcribe(wav16);
    const score=sim(p.te,heard)+(firstWordOk(p.te,heard)?0.25:0); // onset bonus dominates ties
    const prev=best.get(p.id);
    if(!prev||score>prev.score)best.set(p.id,{score,wavPath:cleanPath,heard});
    const good=firstWordOk(p.te,heard)&&sim(p.te,heard)>=SIM_PASS;
    if(!good)next.push(p);
  }
  pending=next;
}
if(asr)asr.proc.kill();

// encode winners
let encoded=0;
const flagged=[];
for(const it of todo){
  const b=best.get(it.id);
  if(!b){flagged.push({id:it.id,reason:'no take generated'});continue;}
  execFileSync('afconvert',['-f','m4af','-d','aac','-q','127','-s','0',b.wavPath,join(OUT_DIR,`${it.id}.m4a`)],{stdio:'pipe'});
  encoded++;
  if(!noQa){
    const clean=sim(it.te,b.heard)>=SIM_PASS&&firstWordOk(it.te,b.heard);
    if(!clean)flagged.push({id:it.id,te:it.te,heard:b.heard,score:Number((b.score).toFixed(2))});
  }
}

// coverage manifest
const manifest=[];
for(const f of files){
  const u=JSON.parse(readFileSync(join(UNITS_DIR,f),'utf-8'));
  for(const it of u.items)if(existsSync(join(OUT_DIR,`${it.id}.m4a`)))manifest.push(it.id);
}
writeFileSync(join(OUT_DIR,'manifest.json'),JSON.stringify(manifest));
writeFileSync(join(__dirname,'render-qa-report.json'),JSON.stringify(flagged,null,2));
rmSync(tmp,{recursive:true,force:true});
console.log(`\nRENDER_COMPLETE encoded=${encoded} totalWithAudio=${manifest.length} stillFlagged=${flagged.length} (report: tools/render-qa-report.json)`);
if(encoded<todo.length){console.error(`RENDER_INCOMPLETE: ${todo.length-encoded} clips missing takes`);process.exit(2);}
