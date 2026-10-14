import { parsePair, enrich } from '../src/social.mjs';
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
const full = { chainId: 'solana', baseToken: { address: 'AAA' }, info: { socials: [{ type: 'twitter', url: 'https://x.com/a' }, { type: 'telegram', url: 'https://t.me/a' }], websites: [{ url: 'https://a.io' }] } };
const thin = { chainId: 'solana', baseToken: { address: 'BBB' }, info: { socials: [{ type: 'twitter', url: 'https://x.com/b' }] } };
const bare = { chainId: 'solana', baseToken: { address: 'CCC' } };
ok(parsePair(full).level === 'full' && parsePair(full).n === 3, 'social: three links = full');
ok(parsePair(thin).level === 'some', 'social: one link = some');
ok(parsePair(bare) === null && parsePair(null) === null && parsePair({ info: { socials: 'x' } }).level === 'none', 'social: junk is safe');
{ const rows = [{ token: 'AAA', net: 'solana' }, { token: 'BBB', net: 'solana' }, { token: 'CCC', net: 'solana' }, { token: 'ZZZ', net: 'unknown' }];
  const r = await enrich(rows, { getJson: async () => ({ pairs: [full, thin, bare] }) });
  ok(rows[0].soc.level === 'full' && rows[1].soc.level === 'some' && rows[2].soc.level === 'none' && !rows[3].soc && r.applied === 3, 'social: enrich maps links, unlisted coin = none, unknown chain skipped'); }
{ const rows = [{ token: 'AAA', net: 'solana' }]; await enrich(rows, { getJson: async () => { throw new Error('down'); } }); ok(!rows[0].soc, 'social: feed down leaves no data rather than a false none'); }
