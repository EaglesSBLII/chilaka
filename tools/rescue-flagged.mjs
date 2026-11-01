// Rescue pass for QA-flagged clips: re-render each with the SAME voice in the
// more deliberate BOOK narration style (cleaner onsets) across several seeds,
// score with the local ASR, and replace the stored take only when the new one
// scores strictly better. Natural-merge clips that still tie keep their
// authentic conversational take.
//
//   node rescue-flagged.mjs

import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import net from 'node:net';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const AUDIO = join(ROOT, 'app/public/audio');
const PYTHON = join(ROOT, 'vendor/convert-venv/bin/python');
const WORKER = join(__dirname, 'rasa-render.py');
const WSERVER = join(ROOT, 'vendor/whisper.cpp/build/bin/whisper-server');
const ASR_MODEL = join(ROOT, 'desktop/resources/models/ggml-telugu-medium-q5_0.bin');
const BOOK_STYLE = 3;
const TAKES = 3;

// ---- folding (same as render-audio) ----
const V = { అ:'a',ఆ:'aa',ఇ:'i',ఈ:'ii',ఉ:'u',ఊ:'uu',ఋ:'ru',ఎ:'e',ఏ:'ee',ఐ:'ai',ఒ:'o',ఓ:'oo',ఔ:'au' };
const C = { క:'k',ఖ:'kh',గ:'g',ఘ:'gh',ఙ:'ng',చ:'ch',ఛ:'chh',జ:'j',ఝ:'jh',ఞ:'ny',ట:'T',ఠ:'Th',డ:'D',ఢ:'Dh',ణ:'N',త:'t',థ:'th',ద:'d',ధ:'dh',న:'n',ప:'p',ఫ:'ph',బ:'b',భ:'bh',మ:'m',య:'y',ర:'r',ల:'l',వ:'v',శ:'sh',ష:'Sh',స:'s',హ:'h',ళ:'L',ఱ:'rr' };
const MA = { 'ా':'aa','ి':'i','ీ':'ii','ు':'u','ూ':'uu','ృ':'ru','ె':'e','ే':'ee','ై':'ai','ొ':'o','ో':'oo','ౌ':'au' };
function teToRoman(t){const c=[...t.normalize('NFC')];let o='';for(let i=0;i<c.length;i++){const x=c[i];if(C[x]!==undefined){o+=C[x];const n=c[i+1];if(n==='్'){i++}else if(n&&MA[n]!==undefined){o+=MA[n];i++}else o+='a'}else if(V[x]!==undefined)o+=V[x];else if(x==='ం'){const n=c[i+1];o+=!(n&&C[n]!==undefined)?'m':(new Set(['ప','ఫ','బ','భ','మ']).has(n)?'m':'n')}else if(x==='ః')o+='h';else o+=x}return o}
function fold(t){let s=t.normalize('NFC');if(/[ఀ-౿]/.test(s))s=teToRoman(s);s=s.toLowerCase().replace(/[^a-z\s]/g,' ').replace(/chh/g,'c').replace(/ch/g,'c').replace(/kh/g,'k').replace(/gh/g,'g').replace(/jh/g,'j').replace(/th/g,'t').replace(/dh/g,'d').replace(/ph/g,'p').replace(/bh/g,'b').replace(/sh/g,'s').replace(/w/g,'v').replace(/z/g,'j').replace(/f/g,'p').replace(/q/g,'k').replace(/aa/g,'a').replace(/ee/g,'e').replace(/ii/g,'i').replace(/oo/g,'o').replace(/uu/g,'u');return s.replace(/\s+/g,' ').trim()}
function lev(a,b){const m=a.length,n=b.length;if(!m)return n;if(!n)return m;let p=[...Array(n+1).keys()],c=new Array(n+1);for(let i=1;i<=m;i++){c[0]=i;for(let j=1;j<=n;j++){const k=a[i-1]===b[j-1]?0:1;c[j]=Math.min(p[j]+1,c[j-1]+1,p[j-1]+k)}[p,c]=[c,p]}return p[n]}
function simF(A,B){if(!A&&!B)return 1;const L=Math.max(A.length,B.length);return L?1-lev(A,B)/L:1}
function sim(a,b){return simF(fold(a),fold(b))}
function firstOk(want,heard){const e=fold(want).split(' ')[0]??'';const h=fold(heard).split(' ')[0]??'';if(!e)return true;if(!h)return false;return simF(e,h)>=0.7}
function scoreOf(want,heard){return sim(want,heard)+(firstOk(want,heard)?0.25:0)}

function readWav(p){const b=readFileSync(p);let dO=44,dL=b.length-44,sr=24000,o=12;
 while(o<b.length-8){const id=b.toString('ascii',o,o+4);const sz=b.readUInt32LE(o+4);
  if(id==='fmt ')sr=b.readUInt32LE(o+12); if(id==='data'){dO=o+8;dL=sz;break;} o+=8+sz;}
 const n=Math.floor(dL/2);const s=new Float32Array(n);
 for(let i=0;i<n;i++)s[i]=b.readInt16LE(dO+i*2)/32768; return {samples:s,sampleRate:sr};}
function writeWav(p,s,sr){const b=Buffer.alloc(44+s.length*2);
 b.write('RIFF',0);b.writeUInt32LE(36+s.length*2,4);b.write('WAVE',8);b.write('fmt ',12);
 b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(sr,24);
 b.writeUInt32LE(sr*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);
 b.writeUInt32LE(s.length*2,40);
 for(let i=0;i<s.length;i++){const v=Math.max(-1,Math.min(1,s[i]));b.writeInt16LE(v<0?v*0x8000:v*0x7fff,44+i*2);}
 writeFileSync(p,b);}
function clean(samples,sr){const n=samples.length;let peak=0;for(let i=0;i<n;i++)peak=Math.max(peak,Math.abs(samples[i]));
 const th=Math.max(0.015,peak*0.035);let st=0;while(st<n&&Math.abs(samples[st])<th)st++;
 let en=n-1;while(en>st&&Math.abs(samples[en])<th)en--;if(st>=en)return samples;
 const lead=Math.floor(sr*0.05),tail=Math.floor(sr*0.1);
 st=Math.max(0,st-lead);en=Math.min(n-1,en+tail);const out=samples.slice(st,en+1);
 const fi=Math.floor(sr*0.008),fo=Math.floor(sr*0.05);
 for(let i=0;i<fi&&i<out.length;i++)out[i]*=i/fi;
 for(let i=0;i<fo&&i<out.length;i++)out[out.length-1-i]*=i/fo;return out;}

function freePort(){return new Promise((res,rej)=>{const s=net.createServer();s.on('error',rej);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>res(p))})})}
async function startAsr(){const port=await freePort();
 const proc=spawn(WSERVER,['-m',ASR_MODEL,'--host','127.0.0.1','--port',String(port),'-l','te','--no-timestamps','-t','6'],{stdio:'ignore'});
 process.on('exit',()=>proc.kill());
 for(let i=0;i<120;i++){try{await fetch(`http://127.0.0.1:${port}/`);return{port,proc};}catch{await new Promise(r=>setTimeout(r,500))}}
 throw new Error('ASR start failed');}
async function transcribe(asr,wav16){const form=new FormData();
 form.append('file',new Blob([readFileSync(wav16)],{type:'audio/wav'}),'c.wav');
 form.append('response_format','json');form.append('language','te');form.append('temperature','0.0');
 const res=await fetch(`http://127.0.0.1:${asr.port}/inference`,{method:'POST',body:form});
 return String((await res.json()).text??'').trim();}

// ---- load flagged + item audio texts ----
const flagged = JSON.parse(readFileSync(join(__dirname,'render-qa-report.json'),'utf8')).filter(f=>f.te);
import { readdirSync } from 'node:fs';
const textById = new Map();
for (const f of readdirSync(join(ROOT,'app/content/units')).filter(x=>x.endsWith('.json'))) {
  const u = JSON.parse(readFileSync(join(ROOT,'app/content/units',f),'utf8'));
  for (const it of u.items) textById.set(it.id, it.audioTe ?? it.te);
}

const tmp = mkdtempSync(join(tmpdir(),'rescue-'));
const jobs = [];
for (const f of flagged) {
  const text = textById.get(f.id);
  if (!text) continue;
  for (let t = 0; t < TAKES; t++) jobs.push({ id: `${f.id}__${t}`, text, seed: 9000 + t * 37, style: BOOK_STYLE });
}
console.log(`rescuing ${flagged.length} flagged clips × ${TAKES} BOOK-style takes`);
writeFileSync(join(tmp,'manifest.json'), JSON.stringify({jobs}));
execFileSync(PYTHON,[WORKER,join(tmp,'manifest.json'),join(tmp,'takes')],{stdio:['ignore','inherit','inherit']});

const asr = await startAsr();
let improved = 0, kept = 0;
const remaining = [];
for (const f of flagged) {
  const want = textById.get(f.id);
  if (!want) continue;
  let best = { score: scoreOf(want, f.heard ?? ''), path: null, heard: f.heard };
  for (let t = 0; t < TAKES; t++) {
    const raw = join(tmp,'takes',`${f.id}__${t}.wav`);
    if (!existsSync(raw)) continue;
    const {samples,sampleRate} = readWav(raw);
    const cleaned = clean(samples,sampleRate);
    const cp = join(tmp,`c-${f.id}-${t}.wav`);
    writeWav(cp,cleaned,sampleRate);
    execFileSync('afconvert',['-f','WAVE','-d','LEI16@16000',cp,join(tmp,'q16.wav')],{stdio:'pipe'});
    const heard = await transcribe(asr,join(tmp,'q16.wav'));
    const sc = scoreOf(want,heard);
    if (sc > best.score + 0.02) best = { score: sc, path: cp, heard };
  }
  if (best.path) {
    execFileSync('afconvert',['-f','m4af','-d','aac','-q','127','-s','0',best.path,join(AUDIO,`${f.id}.m4a`)],{stdio:'pipe'});
    improved++;
    if (!(firstOk(want,best.heard) && sim(want,best.heard) >= 0.7)) remaining.push({id:f.id, te:want, heard:best.heard, score:+best.score.toFixed(2)});
  } else {
    kept++;
    remaining.push({id:f.id, te:want, heard:f.heard, score:+best.score.toFixed(2), note:'kept conversational take'});
  }
}
asr.proc.kill();
writeFileSync(join(__dirname,'rescue-report.json'), JSON.stringify(remaining,null,1));
rmSync(tmp,{recursive:true,force:true});
console.log(`RESCUE_COMPLETE improved=${improved} keptOriginal=${kept} stillImperfect=${remaining.length}`);
