// Pool discovery: trending (1h, 6h, 24h) + top-volume pools on each chain, plus any research-list coins. Coins trending in the last 1h or 6h are tagged fresh (early movers).
// get(path) -> parsed JSON or null (see api.mjs). Logic copied from the v10 scheduled scan.
export async function discoverPools(get,cfg,EXTRA=[],log=()=>{}){
const EXCL_PLACEHOLDER=0;
const NETS={solana:'solana',eth:'ethereum',robinhood:'robinhood'},NETOF={solana:'solana',ethereum:'eth',robinhood:'robinhood'};
const EXCL=new Set(['ZEC','WXMR','XMR','SOL','WSOL','WETH','ETH','USDC','USDT','DAI','WBTC','CBBTC','USDE','USDS','PYUSD','FDUSD','JITOSOL','MSOL','JUPSOL','BSOL','STETH','WSTETH','RETH','WEETH','CBETH','EZETH','INF','USD1','USDG','TBTC','LBTC','EURC','SUSDE','FRXETH','XAUT','PAXG','BNSOL','JUP','RAY','JTO','PYTH','LINK','UNI','AAVE','ONDO','MKR','LDO','ENA','PENDLE','CRV','HYPE','TRX','BNB','W','QNT','NEAR','STRK','RED','METIS','GTC','RSR','WPRL','AZTEC','SERV','ARB','OP','ZRO','EIGEN','ETHFI','GRT','IMX','SKY','MORPHO','COW','SAFE','ENS','APE','BLUR','DYDX','SNX','COMP','BAL','YFI','SUSHI','1INCH','AXS','SAND','MANA','RENDER','FET','TAO','ZK','MNT','POL','STX','INJ','TIA','SEI','SUI','APT','KMNO','DRIFT','ORCA','TNSR','HNT','IO','GRASS','CLOUD','SONIC','ZEUS','NOS','SHDW','MPLX','MNDE','ZETA','PRCL']);
const CAP=cfg.cap;
const ascii=s=>/^[\x20-\x7E]+$/.test(s);
const pools={};
for(const n of (cfg.onlyMine?[]:Object.keys(NETS).filter(k=>!cfg.chains||cfg.chains.includes(k)))){
 for(const p of [...(cfg.freshTrending?[`/networks/${n}/trending_pools?page=1&duration=1h`,`/networks/${n}/trending_pools?page=1&duration=6h`]:[]),`/networks/${n}/trending_pools?page=1&duration=24h`,`/networks/${n}/trending_pools?page=2&duration=24h`,`/networks/${n}/pools?sort=h24_volume_usd_desc&page=1`,`/networks/${n}/pools?sort=h24_volume_usd_desc&page=2`,`/networks/${n}/pools?sort=h24_tx_count_desc&page=1`,...Array.from({length:cfg.extraPages||0},(_,i)=>`/networks/${n}/pools?sort=h24_volume_usd_desc&page=${i+3}`),...Array.from({length:cfg.extraPages||0},(_,i)=>`/networks/${n}/pools?sort=h24_tx_count_desc&page=${i+2}`)]){
  const j=await get(p+'&include=base_token');if(!j||!j.data)continue;const fresh=/duration=(1h|6h)/.test(p);const toks={};(j.included||[]).forEach(t=>toks[t.id]=t.attributes);
  for(const d of j.data){const a=d.attributes,bid=d.relationships?.base_token?.data?.id,bt=toks[bid]||{};
   const sym=(bt.symbol||a.name.split(' / ')[0]||'').toUpperCase().trim(),name=bt.name||a.name;
   if(EXCL.has(sym)||/Robinhood Token/i.test(name)||!ascii(sym)||!ascii(name)||/USD|TETHER|EUR/i.test(sym)||/stablecoin|tether|\busd\b/i.test(name))continue;
   const price=+a.base_token_price_usd,liq=+a.reserve_in_usd||0,v24=+(a.volume_usd?.h24)||0,ch24=+(a.price_change_percentage?.h24)||0;
   if(liq<cfg.minLiquidity||v24<cfg.minVolume)continue; if(price>0.9&&price<1.1&&Math.abs(ch24)<3)continue;
   const key=n+'|'+(bt.address||bid);if(pools[key]&&fresh)pools[key].fresh=true;if(pools[key]&&pools[key].liq>=liq)continue;const wasFresh=!!(pools[key]&&pools[key].fresh);const tx=a.transactions||{};
   pools[key]={net:n,chain:NETS[n],sym,name,token:bt.address||null,pool:a.address,price,liq,fdv:+a.fdv_usd||null,v24,v1:+(a.volume_usd?.h1)||0,ch24,created:a.pool_created_at,
    b1:tx.h1?.buys||0,s1:tx.h1?.sells||0,b24:tx.h24?.buys||0,s24:tx.h24?.sells||0,buyers24:tx.h24?.buyers||0,sellers24:tx.h24?.sellers||0,fresh:fresh||wasFresh};}}}
const mineList=[];
for(const spec of EXTRA){let net=null,q=String(spec).trim();const m=q.match(/^(solana|eth|ethereum|robinhood):(.+)$/i);if(m){net=m[1].toLowerCase()==='ethereum'?'eth':m[1].toLowerCase();q=m[2].trim();}
 let best=null;for(const n of (net?[net]:Object.keys(NETS))){const j=await get(`/search/pools?query=${encodeURIComponent(q)}&network=${n}&include=base_token`);if(!j||!j.data)continue;const toks={};(j.included||[]).forEach(t=>toks[t.id]=t.attributes);
  for(const d of j.data){const a=d.attributes,bid=d.relationships?.base_token?.data?.id,bt=toks[bid]||{};const sym=(bt.symbol||'').toUpperCase(),isAddr=q.length>25;
   if(isAddr?String(bt.address).toLowerCase()!==q.toLowerCase():sym!==q.toUpperCase())continue;const liq=+a.reserve_in_usd||0;if(!best||liq>best.liq){const tx=a.transactions||{};
    best={net:n,chain:NETS[n],sym:sym||q.toUpperCase(),name:bt.name||a.name,token:bt.address||null,pool:a.address,price:+a.base_token_price_usd,liq,fdv:+a.fdv_usd||null,v24:+(a.volume_usd?.h24)||0,v1:+(a.volume_usd?.h1)||0,ch24:+(a.price_change_percentage?.h24)||0,created:a.pool_created_at,mine:true,
     b1:tx.h1?.buys||0,s1:tx.h1?.sells||0,b24:tx.h24?.buys||0,s24:tx.h24?.sells||0,buyers24:tx.h24?.buyers||0,sellers24:tx.h24?.sellers||0};}}}
 if(best){pools['mine|'+best.net+'|'+best.pool]=best;mineList.push(best.sym);}else log('not found: '+spec);}
let all=Object.values(pools).sort((x,y)=>y.v24-x.v24);const per={};let list=all.filter(p=>{if(p.mine)return true;per[p.net]=(per[p.net]||0)+1;return per[p.net]<=CAP[p.net];});
list=list.filter(p=>p.mine).concat(list.filter(p=>!p.mine).slice(0,cfg.maxPools));
{const have=new Set(list.map(p=>p.pool)),pf={};for(const p of all)if(p.fresh&&!have.has(p.pool)){pf[p.net]=(pf[p.net]||0)+1;if(cfg.freshTrending&&pf[p.net]<=(cfg.freshExtra??12)){list.push(p);have.add(p.pool);}}} // early movers from the 1h/6h trending lists are always scanned, even when their 24h volume is below the cut // v10: top 60 pools by 24h volume (list is volume-sorted) plus research-list coins

return {list,mineList};
}
