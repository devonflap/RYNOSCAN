import * as C from '../docs/core.mjs';
import * as E from '../src/early.mjs';
import { gateReport } from '../src/gates.mjs';
let f=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)f=1;};
// forming candle is kept separately
const now=Date.UTC(2026,9,15,13,30)/1000*1000;
const raw=[];let px=1;for(let i=0;i<400;i++){const t=Math.floor(now/1000/3600)*3600-(400-i)*3600;px*=1+Math.sin(i/9)*0.01;raw.push([t,px,px*1.01,px*0.99,px*1.002,1000+i]);}
const p={chain:'sol',sym:'T',liq:2e5,v24:5e5};C.techFromRaw(p,raw,now);
ok(p.h4f===null||p.h4f.length>p.h4.length,'forming 4h series is longer than the closed one when a candle is open');
ok(Array.isArray(E.candidates([p],C))&&E.candidates([{...p,h4f:null}],C).length===0,'no forming candle -> no early candidate');
// pick tags and dedupes
const cand={sp:{entryLow:1,entryHigh:1.1,stop:.9,tp1:1.2,tp2:1.3,tp3:1.4},opp:70};
const mk=(p,t)=>({signalId:'X@d',setup:'Bottom reversal',id:'SOL:T',status:'waiting for entry'});
let o=E.pick([cand],[],'2026-10-15T00:00:00Z',mk);
ok(o.length===1&&o[0].early1h&&o[0].setup==='Bottom reversal [early 1h]','early signal tagged');
ok(E.pick([cand],o,'2026-10-15T01:00:00Z',mk).length===0,'no duplicate while open');
// report compares early vs confirmed
const tr=(n,miss,R)=>Array.from({length:n},(_,i)=>({setup:'Bottom reversal',miss,conf:'confirmed',resultR:R+(i%3-1)*0.1,status:'stopped out'}));
const er=(n,R)=>Array.from({length:n},(_,i)=>({early1h:true,resultR:R+(i%3-1)*0.1}));
let g=gateReport(tr(10,'',1),[],new Date(),er(10,-0.6));
ok(g.early.verdict==='wait','early worse -> keep waiting for the close');
g=gateReport(tr(10,'',-0.5),[],new Date(),er(10,0.8));
ok(g.early.verdict==='early-better','early better -> flagged');
g=gateReport(tr(3,'',1),[],new Date(),er(2,1));
ok(g.early.verdict==='unclear','too little data -> unclear');
process.exit(f);
