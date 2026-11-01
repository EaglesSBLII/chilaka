// Pronunciation QA over the ACTUAL rendered clips: decode each m4a, transcribe
// with the Telugu ASR (warm whisper-server), fold-compare to the expected text.
// Flags clips the recognizer can't hear correctly. Reports, never mutates.
//
//   node asr-qa.mjs [--limit N]

import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import net from 'node:net';

const __dirname = dirname(fileURLToPath(import.meta.url));
const R = join(__dirname, '..');
const AUDIO = join(R, 'app/public/audio');
const UNITS = join(R, 'app/content/units');
const WSERVER = join(R, 'vendor/whisper.cpp/build/bin/whisper-server');
const ASR_MODEL = join(R, 'desktop/resources/models/ggml-telugu-medium-q5_0.bin');
const THRESHOLD = 0.7;
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

// fold (mirror of engine/speech/normalize)
const V = { అ:'a',ఆ:'aa',ఇ:'i',ఈ:'ii',ఉ:'u',ఊ:'uu',ఋ:'ru',ఎ:'e',ఏ:'ee',ఐ:'ai',ఒ:'o',ఓ:'oo',ఔ:'au' };
const C = { క:'k',ఖ:'kh',గ:'g',ఘ:'gh',ఙ:'ng',చ:'ch',ఛ:'chh',జ:'j',ఝ:'jh',ఞ:'ny',ట:'T',ఠ:'Th',డ:'D',ఢ:'Dh',ణ:'N',త:'t',థ:'th',ద:'d',ధ:'dh',న:'n',ప:'p',ఫ:'ph',బ:'b',భ:'bh',మ:'m',య:'y',ర:'r',ల:'l',వ:'v',శ:'sh',ష:'Sh',స:'s',హ:'h',ళ:'L',ఱ:'rr' };
const MA = { 'ా':'aa','ి':'i','ీ':'ii','ు':'u','ూ':'uu','ృ':'ru','ె':'e','ే':'ee','ై':'ai','ొ':'o','ో':'oo','ౌ':'au' };
function tr(t){const c=[...t.normalize('NFC')];let o='';for(let i=0;i<c.length;i++){const x=c[i];if(C[x]!==undefined){o+=C[x];const n=c[i+1];if(n==='్'){i++}else if(n&&MA[n]!==undefined){o+=MA[n];i++}else o+='a'}else if(V[x]!==undefined)o+=V[x];else if(x==='ం'){const n=c[i+1];o+=!(n&&C[n]!==undefined)?'m':(new Set(['ప','ఫ','బ','భ','మ']).has(n)?'m':'n')}else if(x==='ః')o+='h';else o+=x}return o}
function fold(t){let s=t.normalize('NFC');if(/[ఀ-౿]/.test(s))s=tr(s);s=s.toLowerCase().replace(/[^a-z\s]/g,' ').replace(/chh/g,'c').replace(/ch/g,'c').replace(/kh/g,'k').replace(/gh/g,'g').replace(/jh/g,'j').replace(/th/g,'t').replace(/dh/g,'d').replace(/ph/g,'p').replace(/bh/g,'b').replace(/sh/g,'s').replace(/w/g,'v').replace(/z/g,'j').replace(/f/g,'p').replace(/q/g,'k').replace(/aa/g,'a').replace(/ee/g,'e').replace(/ii/g,'i').replace(/oo/g,'o').replace(/uu/g,'u');return s.replace(/\s+/g,' ').trim()}
function lev(a,b){const m=a.length,n=b.length;if(!m)return n;if(!n)return m;let p=[...Array(n+1).keys()],c=new Array(n+1);for(let i=1;i<=m;i++){c[0]=i;for(let j=1;j<=n;j++){const k=a[i-1]===b[j-1]?0:1;c[j]=Math.min(p[j]+1,c[j-1]+1,p[j-1]+k)}[p,c]=[c,p]}return p[n]}
function sim(a,b){const A=fold(a),B=fold(b);if(!A&&!B)return 1;const L=Math.max(A.length,B.length);return L?1-lev(A,B)/L:1}

function freePort(){return new Promise((res,rej)=>{const s=net.createServer();s.on('error',rej);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>res(p))})})}
async function waitReady(port){for(let i=0;i<120;i++){try{await fetch(`http://127.0.0.1:${port}/`);return}catch{await new Promise(r=>setTimeout(r,500))}}throw new Error('server not ready')}

const items=[];
for(const f of readdirSync(UNITS).filter(x=>x.endsWith('.json'))){const u=JSON.parse(readFileSync(join(UNITS,f),'utf8'));for(const it of u.items)items.push(it)}
const sample=items.filter(it=>existsSync(join(AUDIO,`${it.id}.m4a`))).slice(0,LIMIT===Infinity?items.length:LIMIT);

const port=await freePort();
const proc=spawn(WSERVER,['-m',ASR_MODEL,'--host','127.0.0.1','--port',String(port),'-l','te','--no-timestamps','-t','6'],{stdio:'ignore'});
process.on('exit',()=>proc.kill());
await waitReady(port);
const tmp=mkdtempSync(join(tmpdir(),'asrqa-'));
console.log(`QA over ${sample.length} rendered clips (threshold ${THRESHOLD})…\n`);

const fails=[]; let i=0;
const refMap={}; // id → what the ASR hears in the reference clip (speaking-score calibration)
for(const it of sample){
  const wav=join(tmp,'c.wav');
  execFileSync('afconvert',['-f','WAVE','-d','LEI16@16000',join(AUDIO,`${it.id}.m4a`),wav],{stdio:'pipe'});
  const form=new FormData();
  form.append('file',new Blob([readFileSync(wav)],{type:'audio/wav'}),'c.wav');
  form.append('response_format','json'); form.append('language','te'); form.append('temperature','0.0');
  const res=await fetch(`http://127.0.0.1:${port}/inference`,{method:'POST',body:form});
  const heard=String((await res.json()).text??'').trim();
  refMap[it.id]=heard;
  const score=sim(it.te,heard);
  i++;
  if(score<THRESHOLD){fails.push({id:it.id,te:it.te,heard,score:Number(score.toFixed(2))});
    console.log(`  ✗ ${it.id} (${score.toFixed(2)})  want: ${it.te}\n              heard: ${heard}`);}
  if(i%50===0)console.log(`  …${i}/${sample.length}  (${fails.length} flagged)`);
}
proc.kill();
writeFileSync(join(R,'tools/asr-qa-report.json'),JSON.stringify(fails,null,2));
writeFileSync(join(R,'app/src/content/reference-transcripts.json'),JSON.stringify(refMap,null,1));
const rate=(((sample.length-fails.length)/sample.length)*100).toFixed(1);
console.log(`\nDone. ${sample.length-fails.length}/${sample.length} (${rate}%) transcribe correctly. ${fails.length} flagged → tools/asr-qa-report.json`);
console.log(`Reference transcripts → app/src/content/reference-transcripts.json (${Object.keys(refMap).length} ids)`);
