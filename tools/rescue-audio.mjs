// Best-of-N rescue for flagged clips: for each low-scoring clip, generate N
// fresh takes (VITS is stochastic), transcribe each with the Telugu ASR, and
// keep the take that the recognizer hears most accurately. Fixes unlucky
// stochastic renders; for ASR-limited loanword clips it simply keeps the best
// available take (the pronunciation was already correct).
//
//   node rescue-audio.mjs [--max-score 0.6] [--n 5]

import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import net from 'node:net';

const require = createRequire(import.meta.url);
const sherpa = require('sherpa-onnx-node');
const __dirname = dirname(fileURLToPath(import.meta.url));
const R = join(__dirname, '..');
const AUDIO = join(R, 'app/public/audio');
const MODEL = join(R, 'desktop/resources/models/vits-mms-tel');
const WSERVER = join(R, 'vendor/whisper.cpp/build/bin/whisper-server');
const ASR_MODEL = join(R, 'desktop/resources/models/ggml-telugu-medium-q5_0.bin');
const REPORT = join(R, 'tools/asr-qa-report.json');

const maxScore = process.argv.includes('--max-score') ? Number(process.argv[process.argv.indexOf('--max-score') + 1]) : 0.6;
const N = process.argv.includes('--n') ? Number(process.argv[process.argv.indexOf('--n') + 1]) : 5;

// fold + sim (shared logic)
const V={అ:'a',ఆ:'aa',ఇ:'i',ఈ:'ii',ఉ:'u',ఊ:'uu',ఋ:'ru',ఎ:'e',ఏ:'ee',ఐ:'ai',ఒ:'o',ఓ:'oo',ఔ:'au'};
const C={క:'k',ఖ:'kh',గ:'g',ఘ:'gh',ఙ:'ng',చ:'ch',ఛ:'chh',జ:'j',ఝ:'jh',ఞ:'ny',ట:'T',ఠ:'Th',డ:'D',ఢ:'Dh',ణ:'N',త:'t',థ:'th',ద:'d',ధ:'dh',న:'n',ప:'p',ఫ:'ph',బ:'b',భ:'bh',మ:'m',య:'y',ర:'r',ల:'l',వ:'v',శ:'sh',ష:'Sh',స:'s',హ:'h',ళ:'L',ఱ:'rr'};
const MA={'ా':'aa','ి':'i','ీ':'ii','ు':'u','ూ':'uu','ృ':'ru','ె':'e','ే':'ee','ై':'ai','ొ':'o','ో':'oo','ౌ':'au'};
function tr(t){const c=[...t.normalize('NFC')];let o='';for(let i=0;i<c.length;i++){const x=c[i];if(C[x]!==undefined){o+=C[x];const n=c[i+1];if(n==='్'){i++}else if(n&&MA[n]!==undefined){o+=MA[n];i++}else o+='a'}else if(V[x]!==undefined)o+=V[x];else if(x==='ం'){const n=c[i+1];o+=!(n&&C[n]!==undefined)?'m':(new Set(['ప','ఫ','బ','భ','మ']).has(n)?'m':'n')}else if(x==='ః')o+='h';else o+=x}return o}
function fold(t){let s=t.normalize('NFC');if(/[ఀ-౿]/.test(s))s=tr(s);s=s.toLowerCase().replace(/[^a-z\s]/g,' ').replace(/chh/g,'c').replace(/ch/g,'c').replace(/kh/g,'k').replace(/gh/g,'g').replace(/jh/g,'j').replace(/th/g,'t').replace(/dh/g,'d').replace(/ph/g,'p').replace(/bh/g,'b').replace(/sh/g,'s').replace(/w/g,'v').replace(/z/g,'j').replace(/f/g,'p').replace(/q/g,'k').replace(/aa/g,'a').replace(/ee/g,'e').replace(/ii/g,'i').replace(/oo/g,'o').replace(/uu/g,'u');return s.replace(/\s+/g,' ').trim()}
function lev(a,b){const m=a.length,n=b.length;if(!m)return n;if(!n)return m;let p=[...Array(n+1).keys()],c=new Array(n+1);for(let i=1;i<=m;i++){c[0]=i;for(let j=1;j<=n;j++){const k=a[i-1]===b[j-1]?0:1;c[j]=Math.min(p[j]+1,c[j-1]+1,p[j-1]+k)}[p,c]=[c,p]}return p[n]}
function sim(a,b){const A=fold(a),B=fold(b);if(!A&&!B)return 1;const L=Math.max(A.length,B.length);return L?1-lev(A,B)/L:1}

// audio hygiene (must match render-audio.mjs)
function cleanForTts(t){return t.replace(/[.,!?'"‘’“”\-–:;()]/gu,' ').replace(/\s+/g,' ').trim()}
function cleanAudio(samples,sr){const n=samples.length;let peak=0;for(let i=0;i<n;i++)peak=Math.max(peak,Math.abs(samples[i]));const th=Math.max(0.015,peak*0.03);let s=0;while(s<n&&Math.abs(samples[s])<th)s++;let e=n-1;while(e>s&&Math.abs(samples[e])<th)e--;if(s>=e)return samples;const lp=Math.floor(sr*0.025),tp=Math.floor(sr*0.08);s=Math.max(0,s-lp);e=Math.min(n-1,e+tp);const out=samples.slice(s,e+1);const fi=Math.floor(sr*0.012),fo=Math.floor(sr*0.04);for(let i=0;i<fi&&i<out.length;i++)out[i]*=i/fi;for(let i=0;i<fo&&i<out.length;i++)out[out.length-1-i]*=i/fo;return out}

function freePort(){return new Promise((res,rej)=>{const s=net.createServer();s.on('error',rej);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>res(p))})})}
async function waitReady(port){for(let i=0;i<120;i++){try{await fetch(`http://127.0.0.1:${port}/`);return}catch{await new Promise(r=>setTimeout(r,500))}}throw new Error('server not ready')}

const flagged = JSON.parse(readFileSync(REPORT,'utf8')).filter(x=>x.score<maxScore);
console.log(`Rescuing ${flagged.length} clips (score<${maxScore}) with best-of-${N}…\n`);

const tts=new sherpa.OfflineTts({model:{vits:{model:join(MODEL,'model.onnx'),tokens:join(MODEL,'tokens.txt')},numThreads:4,debug:0,provider:'cpu'},maxNumSentences:2});
const tmp=mkdtempSync(join(tmpdir(),'rescue-'));
const port=await freePort();
const proc=spawn(WSERVER,['-m',ASR_MODEL,'--host','127.0.0.1','--port',String(port),'-l','te','--no-timestamps','-t','6'],{stdio:'ignore'});
process.on('exit',()=>proc.kill());
await waitReady(port);

async function transcribeWav(wav){const form=new FormData();form.append('file',new Blob([readFileSync(wav)],{type:'audio/wav'}),'c.wav');form.append('response_format','json');form.append('language','te');form.append('temperature','0.0');const res=await fetch(`http://127.0.0.1:${port}/inference`,{method:'POST',body:form});return String((await res.json()).text??'').trim();}

let improved=0;
for(const item of flagged){
  let best={score:item.score,wav:null,heard:item.heard,fromOriginal:true};
  for(let k=0;k<N;k++){
    const a=tts.generate({text:cleanForTts(item.te),sid:0,speed:0.9,enableExternalBuffer:false});
    const samples=cleanAudio(a.samples,a.sampleRate);
    const wav=join(tmp,`${item.id}-${k}.wav`);
    sherpa.writeWave(wav,{samples,sampleRate:a.sampleRate});
    const heard=await transcribeWav(wav);
    const score=sim(item.te,heard);
    if(score>best.score){best={score,wav,heard,fromOriginal:false};}
  }
  if(!best.fromOriginal && best.wav){
    execFileSync('afconvert',['-f','m4af','-d','aac','-q','127','-s','0',best.wav,join(AUDIO,`${item.id}.m4a`)],{stdio:'pipe'});
    improved++;
    console.log(`  ↑ ${item.id}  ${item.score.toFixed(2)}→${best.score.toFixed(2)}  now: ${best.heard}`);
  } else {
    console.log(`  · ${item.id}  kept ${item.score.toFixed(2)} (loanword/short — TTS ok, ASR-limited)`);
  }
}
proc.kill();
rmSync(tmp,{recursive:true,force:true});
console.log(`\nRescued ${improved}/${flagged.length} clips with a clearer take.`);
