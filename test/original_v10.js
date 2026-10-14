// On-chain scanner v10 = v9 + volume/liquidity floor ($250k 24h volume, $100k liquidity) and a top-60 pool cap (plus research-list coins) to cut scan time. v9 = v8 + keeps only coins with opportunity score above 65 in the export (scanned/scored totals in EXPORT.scannedN/scoredN). v8 (adds 5 chart-pattern detectors: double bottom, inverse H&S, cup & handle, falling wedge, bull flag; unified setup score; bottomed flag; pattern overlays in chart export). Based on v7 (market-data cross-check folded into the opportunity score; volume-weighted, Solana+Robinhood focus, 7-gate bid-ready check; NO stop-distance cap - risk is shown, not gated; opportunity score = setup + volume + upside + reward/risk; 'worth watching' tier; on-chain volume gauge; 4h candle export; optional window.EXTRA = ['solana:BONK','<address>'] to score coins on demand).
// Run in the built-in browser on a tab at https://api.geckoterminal.com/... Before running, optionally set
// window.PREV_SIGNALS = [...] (the previous signals.json rows) so open signals get checked against new candles.
// Starts async; poll window.SCAN.status until 'done', then read window.EXPORT.
window.SCAN={status:'running',done:0,total:0,log:[],started:Date.now()};
(async()=>{
const PACE=window.PACE_MS||4000;const S=window.SCAN,sleep=ms=>new Promise(r=>setTimeout(r,ms));let last=0;
async function gt(path){for(let a=0;a<5;a++){const w=Math.max(0,PACE-(Date.now()-last));if(w)await sleep(w);last=Date.now();
 let r;try{r=await fetch('https://api.geckoterminal.com/api/v2'+path,{headers:{accept:'application/json'}});}catch(e){S.log.push('net');await sleep(45000);continue;}
 if(r.status===429){S.log.push('429');await sleep(45000);continue;}if(!r.ok){S.log.push(r.status+' '+path);return null;}return r.json();}return null;}
const NETS={solana:'solana',eth:'ethereum',robinhood:'robinhood'},NETOF={solana:'solana',ethereum:'eth',robinhood:'robinhood'};
const EXCL=new Set(['ZEC','WXMR','XMR','SOL','WSOL','WETH','ETH','USDC','USDT','DAI','WBTC','CBBTC','USDE','USDS','PYUSD','FDUSD','JITOSOL','MSOL','JUPSOL','BSOL','STETH','WSTETH','RETH','WEETH','CBETH','EZETH','INF','USD1','USDG','TBTC','LBTC','EURC','SUSDE','FRXETH','XAUT','PAXG','BNSOL','JUP','RAY','JTO','PYTH','LINK','UNI','AAVE','ONDO','MKR','LDO','ENA','PENDLE','CRV','HYPE','TRX','BNB','W','QNT','NEAR','STRK','RED','METIS','GTC','RSR','WPRL','AZTEC','SERV','ARB','OP','ZRO','EIGEN','ETHFI','GRT','IMX','SKY','MORPHO','COW','SAFE','ENS','APE','BLUR','DYDX','SNX','COMP','BAL','YFI','SUSHI','1INCH','AXS','SAND','MANA','RENDER','FET','TAO','ZK','MNT','POL','STX','INJ','TIA','SEI','SUI','APT','KMNO','DRIFT','ORCA','TNSR','HNT','IO','GRASS','CLOUD','SONIC','ZEUS','NOS','SHDW','MPLX','MNDE','ZETA','PRCL']);
const CAP={solana:40,robinhood:40,eth:12};
const ascii=s=>/^[\x20-\x7E]+$/.test(s);
const pools={};if(Array.isArray(window.LIST_CACHE))window.LIST_CACHE.forEach(p=>{if(!p.mine)pools[p.net+'|'+p.pool]=p;});
for(const n of (Array.isArray(window.LIST_CACHE)?[]:Object.keys(NETS))){
 for(const p of [`/networks/${n}/trending_pools?page=1&duration=24h`,`/networks/${n}/trending_pools?page=2&duration=24h`,`/networks/${n}/pools?sort=h24_volume_usd_desc&page=1`,`/networks/${n}/pools?sort=h24_volume_usd_desc&page=2`,`/networks/${n}/pools?sort=h24_tx_count_desc&page=1`]){
  const j=await gt(p+'&include=base_token');if(!j||!j.data)continue;const toks={};(j.included||[]).forEach(t=>toks[t.id]=t.attributes);
  for(const d of j.data){const a=d.attributes,bid=d.relationships?.base_token?.data?.id,bt=toks[bid]||{};
   const sym=(bt.symbol||a.name.split(' / ')[0]||'').toUpperCase().trim(),name=bt.name||a.name;
   if(EXCL.has(sym)||/Robinhood Token/i.test(name)||!ascii(sym)||!ascii(name)||/USD|TETHER|EUR/i.test(sym)||/stablecoin|tether|\busd\b/i.test(name))continue;
   const price=+a.base_token_price_usd,liq=+a.reserve_in_usd||0,v24=+(a.volume_usd?.h24)||0,ch24=+(a.price_change_percentage?.h24)||0;
   if(liq<100000||v24<250000)continue; if(price>0.9&&price<1.1&&Math.abs(ch24)<3)continue;
   const key=n+'|'+(bt.address||bid);if(pools[key]&&pools[key].liq>=liq)continue;const tx=a.transactions||{};
   pools[key]={net:n,chain:NETS[n],sym,name,pool:a.address,price,liq,fdv:+a.fdv_usd||null,v24,v1:+(a.volume_usd?.h1)||0,ch24,created:a.pool_created_at,
    b1:tx.h1?.buys||0,s1:tx.h1?.sells||0,b24:tx.h24?.buys||0,s24:tx.h24?.sells||0,buyers24:tx.h24?.buyers||0,sellers24:tx.h24?.sellers||0};}}}
const EXTRA=Array.isArray(window.EXTRA)?window.EXTRA:[];const mineList=[];
for(const spec of EXTRA){let net=null,q=String(spec).trim();const m=q.match(/^(solana|eth|ethereum|robinhood):(.+)$/i);if(m){net=m[1].toLowerCase()==='ethereum'?'eth':m[1].toLowerCase();q=m[2].trim();}
 let best=null;for(const n of (net?[net]:Object.keys(NETS))){const j=await gt(`/search/pools?query=${encodeURIComponent(q)}&network=${n}&include=base_token`);if(!j||!j.data)continue;const toks={};(j.included||[]).forEach(t=>toks[t.id]=t.attributes);
  for(const d of j.data){const a=d.attributes,bid=d.relationships?.base_token?.data?.id,bt=toks[bid]||{};const sym=(bt.symbol||'').toUpperCase(),isAddr=q.length>25;
   if(isAddr?String(bt.address).toLowerCase()!==q.toLowerCase():sym!==q.toUpperCase())continue;const liq=+a.reserve_in_usd||0;if(!best||liq>best.liq){const tx=a.transactions||{};
    best={net:n,chain:NETS[n],sym:sym||q.toUpperCase(),name:bt.name||a.name,pool:a.address,price:+a.base_token_price_usd,liq,fdv:+a.fdv_usd||null,v24:+(a.volume_usd?.h24)||0,v1:+(a.volume_usd?.h1)||0,ch24:+(a.price_change_percentage?.h24)||0,created:a.pool_created_at,mine:true,
     b1:tx.h1?.buys||0,s1:tx.h1?.sells||0,b24:tx.h24?.buys||0,s24:tx.h24?.sells||0,buyers24:tx.h24?.buyers||0,sellers24:tx.h24?.sellers||0};}}}
 if(best){pools['mine|'+best.net+'|'+best.pool]=best;mineList.push(best.sym);}else S.log.push('not found: '+spec);}
let list=Object.values(pools).sort((x,y)=>y.v24-x.v24);const per={};list=list.filter(p=>{if(p.mine)return true;per[p.net]=(per[p.net]||0)+1;return per[p.net]<=CAP[p.net];});
list=list.filter(p=>p.mine).concat(list.filter(p=>!p.mine).slice(0,60)); // v10: top 60 pools by 24h volume (list is volume-sorted) plus research-list coins
const prev=Array.isArray(window.PREV_SIGNALS)?window.PREV_SIGNALS:[];const openPrev=prev.filter(s=>s.status==='open'||s.status==='waiting for entry');
S.total=list.length+openPrev.length;S.results=list;
// ---------- indicators ----------
function rsi(c,p=14){const o=Array(c.length).fill(null);if(c.length<=p)return o;let g=0,l=0;for(let i=1;i<=p;i++){const d=c[i]-c[i-1];d>0?g+=d:l-=d;}g/=p;l/=p;o[p]=l===0?100:100-100/(1+g/l);for(let i=p+1;i<c.length;i++){const d=c[i]-c[i-1];g=(g*(p-1)+Math.max(d,0))/p;l=(l*(p-1)+Math.max(-d,0))/p;o[i]=l===0?100:100-100/(1+g/l);}return o;}
function sma(a,n){return a.map((_,i)=>{if(i<n-1)return null;const s=a.slice(i-n+1,i+1);if(s.some(x=>x==null))return null;return s.reduce((x,y)=>x+y,0)/n;});}
function ema(a,n){const k=2/(n+1),o=[];let e=null;a.forEach((v,i)=>{if(v==null){o.push(e);return;}e=e==null?v:v*k+e*(1-k);o.push(e);});return o;}
function atr(b,p=14){const tr=b.map((x,i)=>i?Math.max(x[2]-x[3],Math.abs(x[2]-b[i-1][4]),Math.abs(x[3]-b[i-1][4])):x[2]-x[3]);const o=Array(b.length).fill(null);if(b.length<p)return o;let a=tr.slice(0,p).reduce((x,y)=>x+y,0)/p;o[p-1]=a;for(let i=p;i<b.length;i++){a=(a*(p-1)+tr[i])/p;o[i]=a;}return o;}
function slope(y){const n=y.length;if(n<3)return 0;const xm=(n-1)/2,ym=y.reduce((a,b)=>a+b,0)/n;let nu=0,de=0;y.forEach((v,i)=>{nu+=(i-xm)*(v-ym);de+=(i-xm)**2;});return de?nu/de:0;}
function resample(b,sec){const m=new Map();for(const x of b){const k=Math.floor(x[0]/sec)*sec,e=m.get(k);if(!e)m.set(k,[k,x[1],x[2],x[3],x[4],x[5]]);else{e[2]=Math.max(e[2],x[2]);e[3]=Math.min(e[3],x[3]);e[4]=x[4];e[5]+=x[5];}}return [...m.values()].sort((a,b)=>a[0]-b[0]);}
function pivLows(lo,from,to,k=2){const o=[];for(let i=Math.max(from,k);i<=to-k;i++){let ok=true;for(let j=1;j<=k;j++)if(lo[i]>lo[i-j]||lo[i]>lo[i+j])ok=false;if(ok)o.push(i);}return o;}
function analyse(bars,L){if(bars.length<22)return null;const c=bars.map(b=>b[4]),h=bars.map(b=>b[2]),lo=bars.map(b=>b[3]),v=bars.map(b=>b[5]),op=bars.map(b=>b[1]);
 const r=rsi(c),sg=sma(r,9),n=c.length-1,R=r[n],Rp=r[n-1],Rp2=r[n-2],G=sg[n];const win=r.slice(Math.max(0,n-L),n+1).filter(x=>x!=null),minR=Math.min(...win);
 const turning=R>Rp&&Rp>=Rp2-0.5,aboveSig=G!=null&&R>G,cross30=r.slice(Math.max(0,n-3),n).some(x=>x!=null&&x<30)&&R>=30,nearSig=G!=null&&R<=G&&R>Rp&&(G-R)<3;
 const i1s=Math.max(0,n-L),i0s=Math.max(0,n-3*L);let i1=i1s;for(let i=i1s;i<=n;i++)if(lo[i]<lo[i1])i1=i;let i0=i0s;for(let i=i0s;i<i1s;i++)if(lo[i]<lo[i0])i0=i;
 const div=i0<i1s&&lo[i1]<lo[i0]&&r[i1]!=null&&r[i0]!=null&&r[i1]>r[i0]+2;const divInfo=div?{p0:lo[i0],p1:lo[i1],r0:r[i0],r1:r[i1],age:n-i1}:null;const hi30=Math.max(...h.slice(-30)),lo30=Math.min(...lo.slice(-30));
 const vR=(v[n]+v[n-1]+v[n-2])/3,vB=v.slice(Math.max(0,n-23),n-2).reduce((x,y)=>x+y,0)/Math.max(1,Math.min(21,n-2)),rvol=vB>0?vR/vB:null;
 // MACD
 const e12=ema(c,12),e26=ema(c,26),mac=c.map((_,i)=>e12[i]-e26[i]),sigl=ema(mac,9),hist=mac.map((m,i)=>m-sigl[i]);
 const macdRising=n>=27&&hist[n]>hist[n-1]&&hist[n-1]>=hist[n-2];const macdCross=n>=27&&hist.slice(n-3,n).some(x=>x<0)&&hist[n]>0;
 // Stoch RSI (14,3,3)
 const sr=r.map((x,i)=>{if(x==null||i<27)return null;const w=r.slice(i-13,i+1);const mn=Math.min(...w),mx=Math.max(...w);return mx>mn?(x-mn)/(mx-mn)*100:50;});
 const kk=sma(sr,3),dd=sma(kk,3);let stochCross=false;for(let i=Math.max(1,n-3);i<=n;i++){if(kk[i]!=null&&dd[i]!=null&&kk[i-1]!=null&&dd[i-1]!=null&&kk[i-1]<=dd[i-1]&&kk[i]>dd[i]&&Math.min(kk[i-1],dd[i-1])<25)stochCross=true;}
 // OBV + up/down volume
 let ob=0;const obv=c.map((x,i)=>{if(i)ob+=x>c[i-1]?v[i]:x<c[i-1]?-v[i]:0;return ob;});const obvRising=slope(obv.slice(-20))>0;
 let uv=0,dv=0;for(let i=Math.max(0,n-23);i<=n;i++){if(c[i]>=op[i])uv+=v[i];else dv+=v[i];}const upDown=dv>0?uv/dv:null;
 // structure
 const pl=pivLows(lo,Math.max(0,n-40),n);const higherLow=pl.length>=2&&lo[pl[pl.length-1]]>lo[pl[pl.length-2]]&&c[n]>lo[pl[pl.length-1]];
 const e20=ema(c,20),e50=ema(c,50);
 let state='Neutral';if(minR<35&&(cross30||(aboveSig&&turning)))state='Flipping up';else if(minR<35&&(turning||nearSig))state='Setting up';else if(R<30)state='Oversold, still falling';else if(R>65)state='Extended';
 const t={divInfo,divFresh:!!(div&&n-i1<=Math.ceil(L*0.6)),lastGreen:c[n]>op[n]&&c[n]>c[n-1],rsi:+R.toFixed(1),rsiPrev:+Rp.toFixed(1),sig:G==null?null:+G.toFixed(1),minRsi:+minR.toFixed(1),div,rvol:rvol==null?null:+rvol.toFixed(2),offLow:+((c[n]/lo30-1)*100).toFixed(1),state,
  macdRising,macdCross,stochCross,obvRising,upDown:upDown==null?null:+upDown.toFixed(2),higherLow,ema20:e20[n],ema50:e50[n]};
 let s=Math.max(0,Math.min(1,(38-t.minRsi)/16))*25;const up=t.rsi>t.rsiPrev;if(up)s+=15;if(t.sig!=null&&t.rsi>t.sig)s+=15;if(state==='Flipping up')s+=10;else if(state==='Setting up')s+=5;if(div)s+=15;
 if(rvol!=null)s+=Math.max(0,Math.min(1,(rvol-1)/2))*(up?15:5);if(state==='Oversold, still falling')s*=0.6;if(t.rsi>62)s*=0.3;else if(t.rsi>55)s*=0.6;if(t.offLow>60)s*=0.6;
 t.score=Math.round(Math.min(100,s));return t;}
// rule-based trade plan on the 4h chart
function plan(h4){const n=h4.length-1;if(n<30)return null;const c=h4.map(b=>b[4]),h=h4.map(b=>b[2]),lo=h4.map(b=>b[3]);const A=atr(h4)[n];if(!A)return null;
 const price=c[n];let li=Math.max(0,n-18);for(let i=li;i<=n;i++)if(lo[i]<lo[li])li=i;const swingLow=lo[li];
 let hi=Math.max(0,li-42);for(let i=hi;i<=li;i++)if(h[i]>h[hi])hi=i;const swingHigh=h[hi];
 const stop=swingLow-0.5*A,entryHigh=price,entryLow=Math.max(price-0.5*A,swingLow+0.15*(price-swingLow)),entryMid=(entryHigh+entryLow)/2,risk=entryMid-stop;
 if(risk<=0||swingHigh<=price)return {valid:false,why:'no room to prior high'};
 const drop=swingHigh-swingLow;let tp1=swingLow+0.382*drop,tp2=swingLow+0.618*drop,tp3=swingHigh;
 if(tp1<entryMid+risk)tp1=entryMid+risk;if(tp2<=tp1)tp2=tp1+risk;if(tp3<=tp2)tp3=tp2+risk;
 const rr=x=>+((x-entryMid)/risk).toFixed(2),riskPct=risk/entryMid*100;
 const p={entryLow,entryHigh,entryMid,stop,tp1,tp2,tp3,rr1:rr(tp1),rr2:rr(tp2),rr3:rr(tp3),riskPct:+riskPct.toFixed(1),atr:A,swingLow,swingHigh};
 p.upside3=+((tp3/entryMid-1)).toFixed(3);p.valid=p.rr2>=2;p.why=p.valid?'':'reward too small vs risk';return p;}
// ---------- chart-pattern detectors (4h candles) ----------
function pvLow(lo,k,from,to){const o=[];for(let i=Math.max(k,from);i<=to-k;i++){let ok=true;for(let j=1;j<=k;j++)if(!(lo[i]<=lo[i-j]&&lo[i]<lo[i+j])){ok=false;break;}if(ok)o.push(i);}return o;}
function pvHigh(hi,k,from,to){const o=[];for(let i=Math.max(k,from);i<=to-k;i++){let ok=true;for(let j=1;j<=k;j++)if(!(hi[i]>=hi[i-j]&&hi[i]>hi[i+j])){ok=false;break;}if(ok)o.push(i);}return o;}
function linfit(xs,ys){const n=xs.length,mx=xs.reduce((a,b)=>a+b,0)/n,my=ys.reduce((a,b)=>a+b,0)/n;let nu=0,de=0;for(let i=0;i<n;i++){nu+=(xs[i]-mx)*(ys[i]-my);de+=(xs[i]-mx)**2;}const m=de?nu/de:0;return {m,b:my-m*mx};}
function detectPatterns(h4){
 const N=h4.length,n=N-1;if(N<45)return [];
 const hi=h4.map(b=>b[2]),lo=h4.map(b=>b[3]),c=h4.map(b=>b[4]),v=h4.map(b=>b[5]);
 const r=rsi(c),A=atr(h4)[n];if(!A)return [];
 const cl=x=>Math.max(0,Math.min(1,x));
 const avgV=(a,b)=>{let s=0,k=0;for(let i=Math.max(0,a);i<=Math.min(n,b);i++){s+=v[i];k++;}return k?s/k:0;};
 const best={};const keep=p=>{if(!best[p.name]||p.quality>best[p.name].quality)best[p.name]=p;};
 const PL=pvLow(lo,3,Math.max(0,n-170),n).filter(i=>i<=n-3),PH=pvHigh(hi,3,Math.max(0,n-170),n);
 // ----- double bottom -----
 for(let q=PL.length-1;q>=1&&q>=PL.length-3;q--){const b=PL[q],a=PL[q-1],gap=b-a;if(gap<6||gap>70)continue;
  const la=lo[a],lb=lo[b],lm=Math.min(la,lb),diff=Math.abs(la-lb)/lm;if(diff>0.06)continue;
  let ni=a;for(let i=a;i<=b;i++)if(hi[i]>hi[ni])ni=i;const neck=hi[ni],depth=(neck-lm)/neck;if(depth<0.10)continue;
  let broke=false;for(let i=b+1;i<=n;i++)if(lo[i]<lm*0.99)broke=true;if(broke)continue;
  const pre=Math.max(...hi.slice(Math.max(0,a-40),a+1));if(pre<lm*1.25)continue;
  let bk=-1;for(let j=b+1;j<=n;j++)if(c[j]>neck){bk=j;break;}if(bk>=0&&n-bk>3)continue;
  if(bk<0&&(c[n]<lb*1.03||c[n]<neck*0.85))continue;
  const sym=cl(1-diff/0.05)*25,dep=cl(depth/0.30)*15,div=(r[b]!=null&&r[a]!=null)?(r[b]>r[a]+2?20:r[b]>r[a]-2?8:0):0,volc=avgV(b-2,b+2)<avgV(a-2,a+2)?10:0,tm=gap>=10&&gap<=45?10:5,rise=c[n]>lb*1.05?10:0,pd=cl((pre/lm-1.25)/0.75)*10;
  keep({name:'Double bottom',status:bk>=0?'breakout':'forming',quality:Math.round(sym+dep+div+volc+tm+rise+pd),trigger:neck,stopBase:lm,H:neck-lm,bk,start:a,
   lines:[[a,neck,n,neck,'neckline']],pts:[[a,la],[b,lb]],why:{div:div>=20,volc:!!volc}});}
 // ----- inverse head & shoulders -----
 for(let q=PL.length-1;q>=2&&q>=PL.length-3;q--){const R=PL[q],Hd=PL[q-1],L=PL[q-2];if(Hd-L<4||R-Hd<4||R-L>120)continue;
  const hL=lo[L],hH=lo[Hd],hR=lo[R];if(!(hH<hL*0.97&&hH<hR*0.97))continue;
  let n1=L;for(let i=L;i<=Hd;i++)if(hi[i]>hi[n1])n1=i;let n2=Hd;for(let i=Hd;i<=R;i++)if(hi[i]>hi[n2])n2=i;
  const N1=hi[n1],N2=hi[n2],nk=(N1+N2)/2,dep=(nk-hH)/nk;if(dep<0.12)continue;
  const sh=Math.abs(hL-hR)/(nk-hH);if(sh>0.5)continue;if(n2<=n1||Math.abs(N2-N1)/nk>0.15)continue;
  const sl=(N2-N1)/(n2-n1),nkAt=j=>N1+sl*(j-n1);
  let bad=false;for(let i=R+1;i<=n;i++)if(lo[i]<hH)bad=true;if(bad||c[n]<hR*0.99)continue;
  let bk=-1;for(let j=R+1;j<=n;j++)if(c[j]>nkAt(j)){bk=j;break;}if(bk>=0&&n-bk>3)continue;
  if(bk<0&&c[n]<hR*1.03)continue;
  const symq=cl(1-sh/0.5)*20,depq=cl(dep/0.35)*15,flat=cl(1-Math.abs(N2-N1)/nk/0.15)*10,div=(r[R]!=null&&r[Hd]!=null)?(r[R]>r[Hd]+2?20:r[R]>r[Hd]-2?8:0):0,volc=avgV(R-2,R+2)<avgV(Hd-2,Hd+2)?10:0,ratio=(Hd-L)/(R-Hd),tm=ratio>=0.5&&ratio<=2?15:5,rise=c[n]>hR*1.05?10:0;
  const tr=bk>=0?nkAt(bk):nkAt(n);
  keep({name:'Inverse H&S',status:bk>=0?'breakout':'forming',quality:Math.round(symq+depq+flat+div+volc+tm+rise),trigger:nkAt(n),trigAt:tr,stopBase:hR,H:nk-hH,bk,start:L,
   lines:[[n1,N1,n,nkAt(n),'neckline']],pts:[[L,hL],[Hd,hH],[R,hR]],why:{div:div>=20,volc:!!volc}});}
 // ----- cup & handle -----
 {const from=Math.max(0,n-170);let iL=-1;for(let i=from;i<=n-20;i++)if(iL<0||hi[i]>hi[iL])iL=i;
  if(iL>=0){const HL=hi[iL];let iB=iL;for(let i=iL;i<=n;i++)if(lo[i]<lo[iB])iB=i;const lowB=lo[iB],cd=HL-lowB,cdp=cd/HL;
   if(cdp>=0.15&&cdp<=0.7&&iB-iL>=8&&iB<=n-10){let iR=iB;for(let i=iB;i<=n-3;i++)if(hi[i]>hi[iR])iR=i;const HR=hi[iR],hl=n-iR;
    if(HR>=HL*0.88&&HR<=HL*1.12&&iR-iB>=8&&hl>=3&&hl<=36){let lowH=Infinity;for(let i=iR+1;i<=n;i++)lowH=Math.min(lowH,lo[i]);
     if(lowH>=lowB+0.5*cd&&HR-lowH<=0.5*cd&&c[n]>=lowH){let u=0,tot=0;for(let i=iL;i<=iR;i++){tot++;if(c[i]<=lowB+0.4*cd)u++;}const uf=u/tot;
      let bk=-1;for(let j=iR+1;j<=n;j++)if(c[j]>HR){bk=j;break;}
      if(uf>=0.1){const hd=(HR-lowH)/cd,cupLen=iR-iL;
       const q=cl(1-Math.abs(cdp-0.35)/0.35)*15+cl((uf-0.1)/0.25)*20+cl(1-Math.abs(HR/HL-1)/0.12)*15+cl(1-Math.abs(hd-0.25)/0.25)*15+(avgV(iR,n)<avgV(iB,iR)?15:0)+(cupLen>=20&&cupLen<=130?10:4)+(r[n]!=null&&r[n]>45?10:0);
       keep({name:'Cup & handle',status:bk>=0?'breakout':'forming',quality:Math.round(q),trigger:HR,stopBase:lowH,H:cd,bk,start:iL,
        lines:[[iR,HR,n,HR,'rim']],pts:[[iL,HL],[iB,lowB],[iR,HR]],why:{volc:avgV(iR,n)<avgV(iB,iR)}});}}}}}}
 // ----- falling wedge -----
 for(const W of [40,60,90]){if(n<W+6)continue;const s=n-W;
  const ph=pvHigh(hi,2,s,n).filter(i=>i<=n-2),pl=pvLow(lo,2,s,n).filter(i=>i<=n-2);if(ph.length<2||pl.length<2)continue;
  const up=linfit(ph,ph.map(i=>hi[i])),dn=linfit(pl,pl.map(i=>lo[i])),mu=up.m/c[n],md=dn.m/c[n];
  if(!(mu<-0.0008&&mu>-0.02&&md<-0.0003&&mu<md))continue;
  const U=j=>up.m*j+up.b,D=j=>dn.m*j+dn.b,w0=U(s)-D(s),w1=U(n)-D(n);if(!(w1>0&&w1<=0.7*w0&&w0/c[n]>=0.08))continue;
  let inside=0,tot=0;for(let j=s;j<=n-3;j++){tot++;if(c[j]<=U(j)*1.02&&c[j]>=D(j)*0.98)inside++;}const cont=inside/tot;if(cont<0.85)continue;
  let bk=-1;for(let j=n-3;j<=n;j++)if(c[j]>U(j)){bk=j;break;}
  if(bk<0&&c[n]<D(n)*0.98)continue;
  const stopBase=Math.min(D(n),...lo.slice(-4));
  const conv=cl((1-w1/w0)/0.6)*20,touch=cl((ph.length+pl.length-4)/4)*20,bal=10,div=(r[pl[pl.length-1]]!=null&&r[pl[0]]!=null)?(r[pl[pl.length-1]]>r[pl[0]]+2?20:0):0,volc=avgV(n-15,n)<avgV(s,s+20)?15:0,ct=cl((cont-0.85)/0.15)*15;
  keep({name:'Falling wedge',status:bk>=0?'breakout':'forming',quality:Math.round(conv+touch+bal+div+volc+ct),trigger:U(n),trigAt:bk>=0?U(bk):U(n),stopBase,H:w0,bk,start:s,
   lines:[[s,U(s),n,U(n),'upper'],[s,D(s),n,D(n),'lower']],pts:[],why:{div:div>=20,volc:!!volc}});}
 // ----- bull flag -----
 {const look=Math.max(0,n-40);let ip=-1;for(let i=look;i<=n-4;i++)if(ip<0||hi[i]>hi[ip])ip=i;
  if(ip>=6){let is=ip;for(let i=Math.max(0,ip-14);i<=ip;i++)if(lo[i]<lo[is])is=i;const gain=hi[ip]/lo[is]-1,plen=ip-is,fl=n-ip;
   if(gain>=0.25&&plen>=2&&plen<=14&&fl>=4&&fl<=26){let fLow=Infinity,fh=0;for(let i=ip+1;i<=n;i++)fLow=Math.min(fLow,lo[i]);for(let i=ip+1;i<=n-3;i++)fh=Math.max(fh,hi[i]);
    const ret=(hi[ip]-fLow)/(hi[ip]-lo[is]),xs=[],ys=[];for(let i=ip+1;i<=n-3;i++){xs.push(i);ys.push(hi[i]);}
    if(ret<=0.5&&c[n]>=fLow&&fh>0&&fh<=hi[ip]*1.01&&xs.length>=2){const sl=linfit(xs,ys).m/c[n];
     if(sl<=0.002){let bk=-1;for(let j=n-3;j<=n;j++)if(c[j]>fh){bk=j;break;}
      const q=cl((gain-0.25)/0.75)*20+cl(1-(plen-2)/12)*10+cl(1-ret/0.5)*20+(sl<=0?15:8)+(avgV(ip+1,n-3)<avgV(is,ip)*0.8?20:avgV(ip+1,n-3)<avgV(is,ip)?10:0)+(fl>=5&&fl<=20?10:4)+(r[n]!=null&&r[n]>=45?5:0);
      keep({name:'Bull flag',status:bk>=0?'breakout':'forming',quality:Math.round(q),trigger:fh,stopBase:fLow,H:hi[ip]-lo[is],bk,start:is,
       lines:[[ip,fh,n,fh,'flag high']],pts:[[is,lo[is]],[ip,hi[ip]]],why:{volc:avgV(ip+1,n-3)<avgV(is,ip)}});}}}}}
 // ----- plan, gates -----
 const out=[];const price=c[n];
 for(const k in best){const p=best[k];const trig=p.trigger;
  let eL,eH;if(p.status==='breakout'){eH=price;eL=Math.max(trig-0.2*A,price-0.5*A);if(eL>eH)eL=eH;}else{eL=trig;eH=trig+0.3*A;}
  const eM=(eL+eH)/2,stop=p.stopBase-0.5*A,risk=eM-stop;if(!(risk>0))continue;
  let tp1=trig+0.5*p.H,tp2=trig+p.H,tp3=trig+1.5*p.H;if(tp1<eM+risk)tp1=eM+risk;if(tp2<=tp1)tp2=tp1+risk;if(tp3<=tp2)tp3=tp2+risk;
  const rr=x=>+((x-eM)/risk).toFixed(2);
  let vb=null,ud=null;{const bk=p.bk>=0?p.bk:n;let s20=0,k20=0;for(let i=Math.max(0,bk-20);i<bk;i++){s20+=v[i];k20++;}vb=k20&&s20>0?+(v[bk]/(s20/k20)).toFixed(2):null;
   let uv=0,dv=0;for(let i=Math.max(0,n-5);i<=n;i++){if(c[i]>=h4[i][1])uv+=v[i];else dv+=v[i];}ud=dv>0?+(uv/dv).toFixed(2):null;}
  const plan={entryLow:eL,entryHigh:eH,entryMid:eM,stop,tp1,tp2,tp3,rr1:rr(tp1),rr2:rr(tp2),rr3:rr(tp3),riskPct:+(risk/eM*100).toFixed(1),upside3:+(tp3/eM-1).toFixed(3),valid:rr(tp2)>=2};
  const g={pattern:p.quality>=60,trigger:p.status==='breakout'&&price<=trig*1.04&&price>=trig*0.985,volume:!!((vb!=null&&vb>=1.3&&p.status==='breakout')||(ud!=null&&ud>=1.3)),reward:plan.rr2>=2};
  out.push({...p,plan,vb,ud,dist:+((trig/price-1)*100).toFixed(1),gates:g,n});}
 return out.sort((a,b)=>b.quality-a.quality);}
const now=Date.now();
for(const p of list){const j=await gt(`/networks/${p.net}/pools/${p.pool}/ohlcv/hour?aggregate=1&limit=1000&currency=usd&token=base`);S.done++;
 const raw=j?.data?.attributes?.ohlcv_list;if(!raw){S.log.push('nofetch '+p.sym);continue;}if(raw.length<22){p.young=true;continue;}
 const h1=raw.slice().sort((a,b)=>a[0]-b[0]).map(b=>b.map(Number)),h4=resample(h1,14400),d1=resample(h1,86400);
 p.tf={'1h':analyse(h1,24),'4h':analyse(h4,18),'1d':d1.length>=20?analyse(d1,10):null};p.plan=plan(h4);p.lastClose=h1[h1.length-1][4];p.h4=h4;p.pats=detectPatterns(h4).filter(q=>q.quality>=50&&!(q.status==='forming'&&q.dist>12));
 const bs1=p.s1?p.b1/p.s1:null,bs24=p.s24?p.b24/p.s24:null,vacc=p.v24?p.v1/(p.v24/24):null;p.bs1=bs1&&+bs1.toFixed(2);p.bs24=bs24&&+bs24.toFixed(2);p.vacc=vacc&&+vacc.toFixed(2);
 {const tl=h1[h1.length-1][0];if(h1[0][0]<=tl-14*86400){p.dv=Array(14).fill(0);for(const b of h1){const k=Math.floor((tl-b[0])/86400);if(k<14)p.dv[k]+=b[5];}}}
 p.ch7d=h1.length>168?+((h1[h1.length-1][4]/h1[h1.length-169][4]-1)*100).toFixed(1):null;
}
// ---------- score, confluence, signal ----------
const CH={solana:'Solana',ethereum:'Ethereum',robinhood:'Robinhood'},sig5=x=>x==null?null:+(+x).toPrecision(5);
list.forEach(p=>{p.ageD=p.created?+((now-Date.parse(p.created))/864e5).toFixed(1):null;const fl=[];
 if(p.liq<100000)fl.push('thin liquidity');if(p.ageD!=null&&p.ageD<7)fl.push('new pool');if(p.fdv&&p.fdv/p.liq>60)fl.push('high FDV/liquidity');
 const bs24=p.s24?p.b24/p.s24:null;if(bs24&&bs24<0.8)fl.push('sell pressure 24h');if(p.buyers24&&p.sellers24&&p.buyers24<p.sellers24*0.7)fl.push('more sellers than buyers');
 if(!p.tf){p.score=null;p.flags=fl;return;}const w={'4h':0.4,'1h':0.35,'1d':0.25};let tot=0,wt=0;for(const k in w){const t=p.tf[k];if(t){tot+=t.score*w[k];wt+=w[k];}}
 let sc=wt?tot/wt:0;if(p.bs1>1.1)sc+=4;if(p.vacc>1.5)sc+=4;sc+=Math.max(0,Math.min(6,Math.log10(p.v24/1e5)*4));if(p.bs24&&p.bs24<0.8)sc-=5;const collapsing=p.ch7d!=null&&p.ch7d<-70;if(collapsing){sc-=10;fl.push('collapsing (-70% 7d)');}
 if(p.price>0.9&&p.price<1.1&&p.ch7d!=null&&Math.abs(p.ch7d)<5)p.drop=true;p.score=Math.max(0,Math.round(Math.min(100,sc)));p.flags=fl;
 const a=p.tf['1h'],b=p.tf['4h'],d=p.tf['1d'];
 p.checks={
  oversold:!!((b&&b.minRsi<35)||(a&&a.minRsi<30)),
  rsiTurning:!!(a&&b&&a.rsi>a.rsiPrev&&b.rsi>b.rsiPrev),
  divergence:!!((a&&a.div)||(b&&b.div)||(d&&d.div)),
  volume:!!(b&&((b.rvol!=null&&b.rvol>=1.3)||(b.upDown!=null&&b.upDown>=1.2))),
  macd:!!(b&&(b.macdRising||b.macdCross)),
  stochRsi:!!((b&&b.stochCross)||(a&&a.stochCross)),
  higherLow:!!(b&&b.higherLow),
  accumulation:!!(b&&b.obvRising),
  onchainBuyers:!!(p.buyers24>=p.sellers24&&p.bs1!=null&&p.bs1>=1),
  safety:!!(p.liq>=250000&&p.ageD!=null&&p.ageD>=7&&!collapsing)};
 p.confluence=Object.values(p.checks).filter(Boolean).length;
 const pl=p.plan,flip=(a&&a.state==='Flipping up')||(b&&b.state==='Flipping up'),setup=flip||(a&&a.state==='Setting up')||(b&&b.state==='Setting up'),ext=(b&&b.rsi>60)||(a&&a.rsi>65);
 const dv=(x)=>x&&x.div&&x.divFresh;const r1h=a&&a.rvol,r4h=b&&b.rvol;
 const inZone=!!(pl&&pl.entryLow&&p.lastClose<=pl.entryHigh*1.005&&p.lastClose>=pl.stop);
 const G={
  divergence:!!(dv(a)||dv(b)),
  rsiFlip:!!((a&&a.state==='Flipping up')||(b&&b.state==='Flipping up')),
  volume:!!(p.v24>=250000&&((r4h!=null&&r4h>=1.3)||(r1h!=null&&r1h>=1.5))&&((b&&b.upDown>=1.0)||(a&&a.upDown>=1.1))),
  buyers:!!(p.bs1!=null&&p.bs1>=1&&p.buyers24>=p.sellers24*0.9),
  zone:!!(pl&&pl.valid&&inZone),
  structure:!!(b&&(b.higherLow||b.macdRising||b.macdCross||b.stochCross)&&(a&&(a.lastGreen||a.rsi>a.rsiPrev))),
  safe:!!(p.liq>=100000&&!ext&&!collapsing&&p.ageD!=null&&p.ageD>=3)};
 p.gates=G;p.gatesPassed=Object.values(G).filter(Boolean).length;p.ready=p.gatesPassed===7;
 p.bottomed=!!(p.checks.oversold&&b&&b.offLow<=40&&(p.checks.higherLow||p.checks.rsiTurning||p.checks.divergence)&&b.rsi<60&&!collapsing);
 {const rsi4=b?b.rsi:null,rsi1=a?a.rsi:null,room=!(rsi4!=null&&rsi4>72)&&!(rsi1!=null&&rsi1>78),safe0=p.liq>=100000&&!collapsing&&p.ageD!=null&&p.ageD>=3;
  (p.pats||[]).forEach(q=>{const g=q.gates;q.pg={shape:g.pattern,brk:g.trigger,volume:g.volume,buyers:G.buyers,room,safe:safe0,reward:g.reward};q.passed=Object.values(q.pg).filter(Boolean).length;q.ready=q.passed===7;
   const volp=Math.max(0,Math.min(10,((q.vb||1)-1)*10)),rrp=Math.max(0,Math.min(10,(q.plan.rr2-1)*5));
   q.score=Math.round(Math.min(100,q.quality*0.6+(q.status==='breakout'?(g.trigger?20:8):(q.dist<=5?10:4))+(g.volume?10:volp*0.5)+rrp));q.missing=Object.keys(q.pg).filter(k=>!q.pg[k]);});
  p.pat=(p.pats||[]).slice().sort((x,y)=>(y.ready?1:0)-(x.ready?1:0)||y.score-x.score)[0]||null;}
 const dvi=(x,lbl)=>x&&x.div&&x.divInfo?`${lbl}: price low ${sig5(x.divInfo.p0)} -> ${sig5(x.divInfo.p1)} (lower), RSI low ${Math.round(x.divInfo.r0)} -> ${Math.round(x.divInfo.r1)} (higher), ${x.divInfo.age} bars ago`:null;
 p.divDetail=[dvi(a,'1h'),dvi(b,'4h'),dvi(d,'1d')].filter(Boolean).join(' | ');
 const pt=p.pat,revEntry=p.ready&&p.score>=40&&p.confluence>=6,patEntry=!!(pt&&pt.ready&&pt.score>=50),
  revWatch=!!(pl&&pl.valid&&!ext&&!collapsing&&p.liq>=100000&&p.v24>=250000&&(p.gatesPassed>=4||(p.score>=30&&p.confluence>=4&&setup))),
  patWatch=!!(pt&&pt.plan.rr2>=2&&pt.score>=50&&pt.pg.room&&!collapsing&&p.liq>=100000&&p.v24>=250000&&pt.passed>=4&&(pt.status==='forming'?pt.dist<=6:true));
 p.lead='reversal';
 if(revEntry)p.signal='Entry signal';
 else if(patEntry){p.signal='Entry signal';p.lead='pattern';}
 else if(revWatch||patWatch){p.signal='Watch';p.lead=(patWatch&&(!revWatch||pt.score>p.score))?'pattern':'reversal';}
 else{p.signal='No trade';p.lead=(pt&&pt.score>p.score&&pt.plan.valid)?'pattern':'reversal';}
 p.sp=p.lead==='pattern'?pt.plan:p.plan;p.setupType=p.lead==='pattern'?pt.name:'Bottom reversal';
 p.setupScore=Math.min(100,Math.max(p.score,pt?pt.score:0)+((p.score>=30&&pt&&pt.score>=45)?5:0));
 p.noTradeWhy=p.signal!=='No trade'?'':(!pl?'not enough 4h history':!pl.valid?pl.why:ext?'already extended':collapsing?'collapsing':p.liq<100000?'liquidity too thin':!setup?'no RSI turn yet':p.score<30?'score too low':'not enough confirmation');
 p.missing=Object.keys(G).filter(k=>!G[k]);
 {const sp=p.sp&&p.sp.entryMid?p.sp:null;if(sp){const P=p.lead==='pattern'&&pt,volPts=Math.max(0,Math.min(15,Math.log10(Math.max(p.v24,1)/2.5e5)*10)),upPts=Math.max(0,Math.min(20,(sp.upside3||0)*25)),rrPts=Math.max(0,Math.min(10,(sp.rr2-1)*4));
  const rdy=P?pt.ready:p.ready,extL=P?!pt.pg.room:ext;let o=p.setupScore*0.6+volPts+upPts+rrPts+(rdy?5:0);if(extL)o-=15;if(collapsing)o-=20;if(p.liq<100000)o-=10;if(!sp.valid)o-=10;p.opp=Math.max(0,Math.min(100,Math.round(o)));}else p.opp=null;}});
let rows=list.filter(p=>!p.drop||p.mine);const best={},dup={};rows.forEach(p=>{const k=p.chain+'|'+p.sym;dup[k]=(dup[k]||0)+1;if(!best[k]||(p.mine&&!best[k].mine)||(!!p.mine===!!best[k].mine&&best[k].liq<p.liq))best[k]=p;});
rows=Object.values(best);rows.forEach(p=>{if(dup[p.chain+'|'+p.sym]>1)p.flags.push('copycat ticker exists');});
const rank={'Entry signal':2,'Watch':1,'No trade':0};rows.sort((a,b)=>(rank[b.signal]||0)-(rank[a.signal]||0)||(b.opp??-1)-(a.opp??-1)||(b.score??-1)-(a.score??-1)||b.v24-a.v24);
// ---------- cross-check against a second market-data feed (30 pools per call) ----------
{const IDS={solana:'solana',eth:'ethereum',robinhood:'robinhood'},ds={};
for(const n of Object.keys(IDS)){const ps=rows.filter(p=>p.net===n&&p.opp!=null);for(let i=0;i<ps.length;i+=30){try{const r=await fetch(`https://api.dexscreener.com/latest/dex/pairs/${IDS[n]}/${ps.slice(i,i+30).map(p=>p.pool).join(',')}`);const j=await r.json();(j.pairs||[]).forEach(q=>ds[n+'|'+q.pairAddress.toLowerCase()]=q);}catch(e){S.log.push('x-net');}await sleep(1500);}}
rows.forEach(p=>{const q=ds[p.net+'|'+p.pool.toLowerCase()];if(!q){p.conf=null;p.caution='';p.mcap=null;p.soc=null;return;}
 const t1=q.txns?.h1||{},dsv=q.volume?.h24||0,vr=p.v24?dsv/p.v24:0,why=[];let c=0;
 if(vr>=0.8&&vr<=1.25)c++;else why.push('volume figures disagree');
 if(t1.sells?t1.buys/t1.sells>=1:t1.buys>0)c++;else why.push('more sellers than buyers in the last hour');
 if((q.liquidity?.usd||0)>=100000)c++;else why.push('thin liquidity');
 if((q.volume?.h1||0)*24>=dsv*0.8)c++;else why.push('volume fading');
 if((q.priceChange?.h6??0)>-5)c++;else why.push('weak last 6h');
 const soc=(q.info?.socials||[]).length+(q.info?.websites||[]).length;if(soc>0)c++;else why.push('no socials/website listed');
 p.conf=c;p.caution=why.join('; ');p.mcap=Math.round(q.marketCap||0);p.soc=soc;
 if(p.opp!=null){p.oppBase=p.opp;p.opp=Math.round(p.opp*0.6+c*6.7);}});
rows.sort((a,b)=>(rank[b.signal]||0)-(rank[a.signal]||0)||(b.opp??-1)-(a.opp??-1)||(b.score??-1)-(a.score??-1)||b.v24-a.v24);}
const allRows=rows,scannedN=allRows.length,scoredN=allRows.filter(p=>p.score!=null).length;rows=rows.filter(p=>p.mine||(p.opp!=null&&p.opp>65));
const at=new Date().toISOString().slice(0,19)+'Z',day=at.slice(0,10);
// ---------- signal log: check open signals, add today's ----------
async function barsFor(s){const j=await gt(`/networks/${NETOF[String(s.chain).toLowerCase()]||String(s.chain).toLowerCase()}/pools/${s.pool}/ohlcv/hour?aggregate=1&limit=1000&currency=usd&token=base`);S.done++;
 const raw=j?.data?.attributes?.ohlcv_list;return raw?raw.slice().sort((a,b)=>a[0]-b[0]).map(b=>b.map(Number)):null;}
function evaluate(s,h1){const t0=Date.parse(s.signalAt)/1000;const bars=h1.filter(b=>b[0]>=t0);let filled=null,stop=s.stop,hit=0,R=0,left=1,status='waiting for entry',closedAt=null;
 const risk=s.entryMid-s.stop;
 for(const b of bars){if(!filled){if(b[0]>t0+48*3600){status='expired (no fill)';closedAt=b[0];break;}if(b[3]<=s.entryHigh){filled=b[0];status='open';}else continue;}
  if(b[3]<=stop){R+=left*((stop-s.entryMid)/risk);left=0;status=hit?'stopped after TP'+hit:'stopped out';closedAt=b[0];break;}
  const tps=[s.tp1,s.tp2,s.tp3];while(hit<3&&b[2]>=tps[hit]){R+=(1/3)*((tps[hit]-s.entryMid)/risk);left-=1/3;hit++;if(hit===1)stop=s.entryMid;}
  if(hit===3){left=0;status='hit TP3';closedAt=b[0];break;}
  if(b[0]>filled+7*86400){R+=left*((b[4]-s.entryMid)/risk);left=0;status='time exit (7 days)';closedAt=b[0];break;}}
 return {...s,status,tpHit:hit,resultR:status==='open'||status==='waiting for entry'?null:+R.toFixed(2),openR:status==='open'?+(R+left*(((bars.length?bars[bars.length-1][4]:s.entryMid)-s.entryMid)/risk)).toFixed(2):null,
  closedAt:closedAt?new Date(closedAt*1000).toISOString().slice(0,16)+'Z':null,checkedAt:at};}
const log=[];for(const s of prev){if(s.status==='open'||s.status==='waiting for entry'){const h1=await barsFor(s);log.push(h1?evaluate(s,h1):{...s,checkedAt:at});}else log.push(s);}
for(const p of rows.filter(p=>p.signal==='Entry signal')){const id=CH[p.chain].slice(0,3).toUpperCase()+':'+p.sym,sid=id+'@'+day;if(log.some(s=>s.signalId===sid))continue;
 if(log.some(s=>s.id===id&&(s.status==='open'||s.status==='waiting for entry')))continue;const pl=p.sp;
 log.push({signalId:sid,setup:p.setupType,id,coin:p.sym,chain:CH[p.chain],pool:p.pool,signalAt:at,score:p.score,confluence:p.confluence,priceAtSignal:sig5(p.lastClose),
  entryLow:sig5(pl.entryLow),entryHigh:sig5(pl.entryHigh),entryMid:sig5(pl.entryMid),stop:sig5(pl.stop),tp1:sig5(pl.tp1),tp2:sig5(pl.tp2),tp3:sig5(pl.tp3),
  status:'waiting for entry',tpHit:0,resultR:null,openR:null,closedAt:null,checkedAt:at});}
log.sort((a,b)=>b.signalAt.localeCompare(a.signalAt));
// ---------- export ----------
const r1=x=>x==null?null:Math.round(x*10)/10,yn=x=>x?1:0;
const out=rows.map(p=>{const t=p.tf||{},a=t['1h'],b=t['4h'],c=t['1d'],pl=p.plan&&p.plan.entryMid?p.plan:null,ck=p.checks||{};return {
 id:CH[p.chain].slice(0,3).toUpperCase()+':'+p.sym,coin:p.sym,name:p.name,chain:CH[p.chain],pool:p.pool,signal:p.signal||'No trade',noTradeWhy:p.noTradeWhy||(p.tf?'':'too new to score'),score:p.setupScore??p.score,confluence:p.confluence??null,
 rsi1h:a?.rsi??null,state1h:a?.state??'too new',rsi4h:b?.rsi??null,state4h:b?.state??'too new',rsi1d:c?.rsi??null,state1d:c?.state??'too new',
 div1h:a?yn(a.div):null,div4h:b?yn(b.div):null,div1d:c?yn(c.div):null,rvol4h:b?.rvol??null,upDownVol4h:b?.upDown??null,
 chkOversold:p.checks?yn(ck.oversold):null,chkRsiTurning:p.checks?yn(ck.rsiTurning):null,chkDivergence:p.checks?yn(ck.divergence):null,chkVolume:p.checks?yn(ck.volume):null,chkMacd:p.checks?yn(ck.macd):null,
 chkStochRsi:p.checks?yn(ck.stochRsi):null,chkHigherLow:p.checks?yn(ck.higherLow):null,chkAccumulation:p.checks?yn(ck.accumulation):null,chkOnchainBuyers:p.checks?yn(ck.onchainBuyers):null,chkSafety:p.checks?yn(ck.safety):null,
 buySell1h:p.bs1??null,buySell24h:p.bs24??null,buyers24h:p.buyers24||null,sellers24h:p.sellers24||null,vol24h:Math.round(p.v24),liquidity:Math.round(p.liq),fdv:p.fdv?Math.round(p.fdv):null,
 chg24h:r1(p.ch24),chg7d:p.ch7d??null,ageDays:p.ageD??null,price:sig5(p.lastClose??p.price),
 entryLow:pl?sig5(pl.entryLow):null,entryHigh:pl?sig5(pl.entryHigh):null,stop:pl?sig5(pl.stop):null,tp1:pl?sig5(pl.tp1):null,tp2:pl?sig5(pl.tp2):null,tp3:pl?sig5(pl.tp3):null,
 rr1:pl?pl.rr1:null,rr2:pl?pl.rr2:null,rr3:pl?pl.rr3:null,riskPct:pl?pl.riskPct:null,flags:p.flags.join('; '),scannedAt:at,
 bidReady:(p.lead==='pattern'?(p.pat&&p.pat.ready):p.ready)?1:0,gatesPassed:p.gates?p.gatesPassed:null,gDivergence:p.gates?yn(p.gates.divergence):null,gRsiFlip:p.gates?yn(p.gates.rsiFlip):null,gVolume:p.gates?yn(p.gates.volume):null,gBuyers:p.gates?yn(p.gates.buyers):null,gZone:p.gates?yn(p.gates.zone):null,upsidePct:p.plan&&p.plan.upside3!=null?Math.round(p.plan.upside3*1000)/10:null,gStructure:p.gates?yn(p.gates.structure):null,gSafe:p.gates?yn(p.gates.safe):null,
 missing:p.missing?p.missing.join(','):'',divDetail:p.divDetail||'',rvol1h:a?.rvol??null,upDownVol1h:a?.upDown??null,vol1h:Math.round(p.v1||0),
 planStop:p.plan&&p.plan.stop?sig5(p.plan.stop):null,planTp3:p.plan&&p.plan.tp3?sig5(p.plan.tp3):null,planValid:p.plan?yn(p.plan.valid):null,
 opp:p.opp??null,oppBase:p.oppBase??null,conf:p.conf??null,caution:p.caution||'',mcap:p.mcap??null,soc:p.soc??null,mine:p.mine?1:0,
 setupType:p.setupType||'Bottom reversal',lead:p.lead||'reversal',revScore:p.score??null,bottomed:p.bottomed?1:0,
 patName:p.pat?p.pat.name:'',patStatus:p.pat?p.pat.status:'',patQ:p.pat?p.pat.quality:null,patScore:p.pat?p.pat.score:null,patPassed:p.pat?p.pat.passed:null,patMissing:p.pat?p.pat.missing.join(','):'',patDist:p.pat?p.pat.dist:null,patVb:p.pat?p.pat.vb:null,patTrig:p.pat?sig5(p.pat.trigger):null,
 pShape:p.pat?yn(p.pat.pg.shape):null,pBrk:p.pat?yn(p.pat.pg.brk):null,pVolume:p.pat?yn(p.pat.pg.volume):null,pBuyers:p.pat?yn(p.pat.pg.buyers):null,pRoom:p.pat?yn(p.pat.pg.room):null,pSafe:p.pat?yn(p.pat.pg.safe):null,pReward:p.pat?yn(p.pat.pg.reward):null,patReady:p.pat&&p.pat.ready?1:0,
 patEntryLow:p.pat?sig5(p.pat.plan.entryLow):null,patEntryHigh:p.pat?sig5(p.pat.plan.entryHigh):null,patStop:p.pat?sig5(p.pat.plan.stop):null,patTp1:p.pat?sig5(p.pat.plan.tp1):null,patTp2:p.pat?sig5(p.pat.plan.tp2):null,patTp3:p.pat?sig5(p.pat.plan.tp3):null,patRr1:p.pat?p.pat.plan.rr1:null,patRr2:p.pat?p.pat.plan.rr2:null,patRr3:p.pat?p.pat.plan.rr3:null,patRisk:p.pat?p.pat.plan.riskPct:null,patUp:p.pat?Math.round(p.pat.plan.upside3*1000)/10:null,
 patWhy:p.pat?Object.keys(p.pat.why||{}).filter(k=>p.pat.why[k]).join(','):'',scanState:p.tf?'scored':(p.young?'too new (<22h candles)':'no data')};});
const chartRows=[];{const pick=rows.filter(p=>p.h4&&(p.mine||p.signal==='Entry signal'||p.signal==='Watch'||(p.pat&&p.pat.score>=45)||p.bottomed));
pick.sort((a,b)=>(b.mine?1:0)-(a.mine?1:0)||(b.opp??0)-(a.opp??0));
pick.slice(0,32).forEach(p=>{const pt=p.pat,N=p.h4.length;let L=60;if(pt)L=Math.max(60,N-1-pt.start+8);L=Math.min(L,N,130);const k=p.h4.slice(-L),off=N-L,s5=x=>+(+x).toPrecision(5);
 const ov=pt?{name:pt.name,status:pt.status,lines:pt.lines.map(l=>[l[0]-off,s5(l[1]),l[2]-off,s5(l[3]),l[4]]),pts:(pt.pts||[]).map(q=>[q[0]-off,s5(q[1])])}:null;
 chartRows.push({id:CH[p.chain].slice(0,3).toUpperCase()+':'+p.sym,t0:k[k.length-1][0],bars:k.map(b=>[b[1],b[2],b[3],b[4]].map(x=>+x.toPrecision(5)).join(' ')).join(';'),vol:k.map(b=>Math.round(b[5])).join(' '),pat:ov});});}
const mk={};for(const p of allRows){if(!p.dv||p.mine)continue;for(const key of [CH[p.chain],'All']){const m=mk[key]=mk[key]||{n:0,d:Array(14).fill(0)};m.n++;p.dv.forEach((v,k)=>m.d[k]+=v);}}
const market=[];for(const key in mk){const m=mk[key],base=m.d.slice(1,8).reduce((a,b)=>a+b,0)/7;m.d.forEach((v,k)=>market.push({chain:key,daysAgo:k,volUsd:Math.round(v),coins:m.n,baseline7d:Math.round(base),ratio:base?+(v/base).toFixed(2):null}));}
const sum=(arr,f)=>arr.reduce((s,r)=>s+(+r[f]||0),0);
const chk={n:out.length,score:sum(out,'score'),vol:sum(out,'vol24h'),liq:sum(out,'liquidity'),
logN:log.length,chartN:chartRows.length,chartSum:+chartRows.reduce((a,c)=>a+c.bars.split(/[ ;]/).reduce((x,y)=>x+(+y||0),0),0).toPrecision(8),mktN:market.length,mktSum:market.reduce((a,m)=>a+m.volUsd,0),opp:sum(out,'opp')};
window.EXPORT={rows:out,log,chk,charts:chartRows,market,mine:mineList,scannedAt:at,scannedN,scoredN};S.status='done';
})().catch(e=>{window.SCAN.status='error';window.SCAN.err=String(e&&e.stack||e);});
'started'