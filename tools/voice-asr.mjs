// Transcribes shipped clips with the app's Telugu recognizer (same decoding as the render
// gate: greedy, lesson-context prompt) and compares with the item text. Used after a clip is
// changed outside render-voice.mjs (tools/voice-trim.py, tools/voice-stitch.py).
//
//   node tools/voice-asr.mjs --voice female|male --ids u26-i03,u66-i10 | @list.txt [--write]
//
// --write refreshes app/src/content/reference-transcripts-<voice>.json for those ids.
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import net from 'node:net';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const VOICE = arg('--voice', 'female');
const idsArg = arg('--ids', null);
const write = process.argv.includes('--write');
const ids = idsArg ? (idsArg.startsWith('@') ? readFileSync(idsArg.slice(1), 'utf8') : idsArg).split(/[\s,]+/).filter(Boolean) : null;
const WSERVER = join(ROOT, 'vendor/whisper.cpp/build/bin/whisper-server');
const ASR_MODEL = join(ROOT, 'desktop/resources/models/ggml-telugu-medium-q5_0.bin');
const DIR = join(ROOT, 'app/public/audio', `v-${VOICE}`);

// --- same folding + hint as render-voice.mjs
const V={'అ':'a','ఆ':'aa','ఇ':'i','ఈ':'ii','ఉ':'u','ఊ':'uu','ఋ':'ru','ఎ':'e','ఏ':'ee','ఐ':'ai','ఒ':'o','ఓ':'oo','ఔ':'au'};
const C={'క':'k','ఖ':'kh','గ':'g','ఘ':'gh','ఙ':'ng','చ':'ch','ఛ':'chh','జ':'j','ఝ':'jh','ఞ':'ny','ట':'t','ఠ':'th','డ':'d','ఢ':'dh','ణ':'n','త':'t','థ':'th','ద':'d','ధ':'dh','న':'n','ప':'p','ఫ':'ph','బ':'b','భ':'bh','మ':'m','య':'y','ర':'r','ల':'l','వ':'v','శ':'sh','ష':'sh','స':'s','హ':'h','ళ':'l','ఱ':'r'};
const MA={'ా':'aa','ి':'i','ీ':'ii','ు':'u','ూ':'uu','ృ':'ru','ె':'e','ే':'ee','ై':'ai','ొ':'o','ో':'oo','ౌ':'au'};
function teToRoman(t){const c=[...t.normalize('NFC')];let o='';for(let i=0;i<c.length;i++){const x=c[i];if(C[x]!==undefined){o+=C[x];const n=c[i+1];if(n==='్'){i++}else if(n&&MA[n]!==undefined){o+=MA[n];i++}else o+='a'}else if(V[x]!==undefined)o+=V[x];else if(x==='ం'){const n=c[i+1];o+=!(n&&C[n]!==undefined)?'m':(new Set(['ప','ఫ','బ','భ','మ']).has(n)?'m':'n')}else if(x==='ః')o+='h';else o+=x}return o}
function fold(t){let s=t.normalize('NFC');if(/[ఀ-౿]/.test(s))s=teToRoman(s);s=s.toLowerCase().replace(/[^a-z\s]/g,' ').replace(/chh/g,'c').replace(/ch/g,'c').replace(/kh/g,'k').replace(/gh/g,'g').replace(/jh/g,'j').replace(/th/g,'t').replace(/dh/g,'d').replace(/ph/g,'p').replace(/bh/g,'b').replace(/sh/g,'s').replace(/w/g,'v').replace(/z/g,'j').replace(/f/g,'p').replace(/q/g,'k').replace(/aa/g,'a').replace(/ee/g,'e').replace(/ii/g,'i').replace(/oo/g,'o').replace(/uu/g,'u');return s.replace(/\s+/g,' ').trim()}
function lev(a,b){const m=a.length,n=b.length;if(!m)return n;if(!n)return m;let p=[...Array(n+1).keys()],c=new Array(n+1);for(let i=1;i<=m;i++){c[0]=i;for(let j=1;j<=n;j++){const k=a[i-1]===b[j-1]?0:1;c[j]=Math.min(p[j]+1,c[j-1]+1,p[j-1]+k)}[p,c]=[c,p]}return p[n]}
const sim=(a,b)=>{const A=fold(a),B=fold(b);if(!A&&!B)return 1;const L=Math.max(A.length,B.length);return L?1-lev(A,B)/L:1};
function hintFor(unit,it){const idx=unit.items.findIndex(x=>x.id===it.id);const ordered=[...unit.items].sort((a,b)=>Math.abs(unit.items.indexOf(a)-idx)-Math.abs(unit.items.indexOf(b)-idx));const out=[];let chars=0;for(const x of ordered){if(x.id===it.id)continue;const te=x.te.trim();if(!te||te===it.te.trim())continue;if(out.length>=12||chars+te.length+1>600)break;out.push(te);chars+=te.length+1}return out.join(' ')}
const speakable=(t)=>t.replace(/^([ఀ-౿]{1,2})\. /,'$1, ');

const items=[];
for(const f of readdirSync(join(ROOT,'app/content/units')).filter(f=>f.endsWith('.json'))){
  const u=JSON.parse(readFileSync(join(ROOT,'app/content/units',f),'utf8'));
  for(const it of u.items)if(!ids||ids.includes(it.id))items.push({id:it.id,te:speakable(it.audioTe??it.te),hint:hintFor(u,it)});
}
const freePort=()=>new Promise((res,rej)=>{const s=net.createServer();s.on('error',rej);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>res(p))})});
const port=await freePort();
const proc=spawn(WSERVER,['-m',ASR_MODEL,'--host','127.0.0.1','--port',String(port),'-l','te','--no-timestamps','-t','4'],{stdio:'ignore'});
process.on('exit',()=>proc.kill());
let up=false;for(let i=0;i<120&&!up;i++){try{await fetch(`http://127.0.0.1:${port}/`);up=true}catch{await new Promise(r=>setTimeout(r,500))}}
if(!up)throw new Error('ASR server failed to start');
const tmp=mkdtempSync(join(tmpdir(),'asr-'));
const refFile=join(ROOT,`app/src/content/reference-transcripts-${VOICE}.json`);
const refs=existsSync(refFile)?JSON.parse(readFileSync(refFile,'utf8')):{};
let bad=0;
for(const it of items){
  const m4a=join(DIR,`${it.id}.m4a`); if(!existsSync(m4a)){console.log(`${it.id} missing`);continue;}
  const wav=join(tmp,'c.wav'); execFileSync('afconvert',['-f','WAVE','-d','LEI16@16000','-c','1',m4a,wav],{stdio:'pipe'});
  const form=new FormData(); form.append('file',new Blob([readFileSync(wav)],{type:'audio/wav'}),'c.wav');
  form.append('response_format','json');form.append('language','te');form.append('temperature','0.0');if(it.hint)form.append('prompt',it.hint);
  const res=await fetch(`http://127.0.0.1:${port}/inference`,{method:'POST',body:form});
  const heard=String((await res.json()).text??'').trim();
  const s=sim(it.te,heard); if(s<0.7)bad++;
  console.log(`${s<0.7?'✗':'✓'} ${it.id} sim ${s.toFixed(2)}  ${it.te}  →  ${heard}`);
  if(write)refs[it.id]=heard;
}
if(write){writeFileSync(refFile,JSON.stringify(Object.fromEntries(Object.entries(refs).sort(([a],[b])=>a.localeCompare(b))),null,1)+'\n');console.log(`updated ${refFile}`);}
rmSync(tmp,{recursive:true,force:true}); proc.kill();
console.log(`${items.length} clips, ${bad} below 0.7`);
