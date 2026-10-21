// One wallet per bot, made on the server. The secret key never leaves the server unless you ask for it with "export".
//   node bot/wallet.mjs create --bot rules                 make a new Solana wallet for a bot, save its key (owner read only), print the address
//   node bot/wallet.mjs create --bot rules --chain robinhood   the same on Robinhood chain (an Ethereum-style wallet; fund it with ETH on Robinhood chain)
//   node bot/wallet.mjs show   --bot rules      print the address and balance
//   node bot/wallet.mjs export --bot rules      print the secret key in the form Phantom imports (shows once; the screen is the only copy)
//   (the chain is read from the key file after "create", so show/export need no --chain)
// One-time export to Phantom: run "export" on the server, then on your phone Phantom > Add wallet > Import private key, paste, done.
// For a Robinhood-chain bot the key is an ordinary Ethereum-style key: Phantom imports it as an Ethereum account and the same address holds
// your Robinhood-chain ETH; if the app does not list Robinhood chain yet, MetaMask or Rabby show it after adding the network ("show" prints it).
// Fund a bot's wallet by sending SOL to its address from Phantom or an exchange, with no more than that bot is allowed to lose.
// Never paste a Phantom key into the server: Phantom keeps your main money, the bots get small working floats.
import fs from 'node:fs';
import path from 'node:path';
import { LIVE, keyPath, defaultIo } from './live.mjs';

const args = process.argv.slice(2), cmd = args[0], bi = args.indexOf('--bot'), name = bi >= 0 ? args[bi + 1] : null, ci = args.indexOf('--chain'), dir = process.env.RYNOBOT_KEYS || LIVE.keyDir;
const RH_NET = { name: 'Robinhood Chain', chainId: 4663, rpc: 'https://rpc.mainnet.chain.robinhood.com', symbol: 'ETH', explorer: 'https://robinhoodchain.blockscout.com' };
const cfgFile = path.join(path.dirname(new URL(import.meta.url).pathname), 'config.json');
const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
function setWallet(bot, address, walletChain = 'solana') { const c = rd(cfgFile, {}); c.bots ||= {}; c.bots[bot] = { ...(c.bots[bot] || {}), wallet: address, walletChain }; fs.writeFileSync(cfgFile, JSON.stringify(c, null, 2) + '\n'); }

async function main() {
  if (!cmd || !name || !/^[a-z]+$/.test(name)) { console.log('usage: node bot/wallet.mjs create|show|export --bot <rules|breakout|degen> [--chain solana|robinhood]'); process.exit(1); }
  const file = keyPath(name, dir);
  let chain = ci >= 0 ? args[ci + 1] : null; if (!chain && cmd !== 'create') { try { const k = JSON.parse(fs.readFileSync(file, 'utf8')); chain = Array.isArray(k) ? 'solana' : k.chain || 'solana'; } catch { chain = 'solana'; } } chain ||= 'solana';
  if (!['solana', 'robinhood'].includes(chain)) { console.error('chain must be solana or robinhood'); process.exit(1); }
  if (chain === 'robinhood') { let ethers; try { ethers = await import('ethers'); } catch { console.error('Needs the ethers library: run  npm install  in the RYNOSCAN folder first.'); process.exit(1); }
    if (cmd === 'create') { if (fs.existsSync(file)) { console.error(`A key already exists at ${file}. Not overwriting it. Use "show".`); process.exit(1); } fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); const w = ethers.Wallet.createRandom(); fs.writeFileSync(file, JSON.stringify({ chain: 'robinhood', privateKey: w.privateKey }), { mode: 0o600 }); fs.chmodSync(file, 0o600); setWallet(name, w.address, 'robinhood');
      console.log(`New Robinhood-chain wallet for the ${name} bot.\n  address: ${w.address}\n  key file: ${file} (owner read only)\nSaved to bot/config.json. Send ETH on Robinhood chain to the address (bridge from Ethereum, or withdraw from Robinhood to Robinhood chain); keep about 0.002 ETH spare for gas.`); return; }
    if (!fs.existsSync(file)) { console.error(`No key for the ${name} bot yet: node bot/wallet.mjs create --bot ${name} --chain robinhood`); process.exit(1); } const w = new ethers.Wallet(JSON.parse(fs.readFileSync(file, 'utf8')).privateKey);
    if (cmd === 'show') { let bal = '?'; try { const p = new ethers.JsonRpcProvider('https://rpc.mainnet.chain.robinhood.com', 4663, { staticNetwork: true }); bal = ethers.formatEther(await p.getBalance(w.address)) + ' ETH'; } catch (e) { bal = 'balance unavailable (' + e.message + ')'; } console.log(`${name} bot wallet (Robinhood chain): ${w.address}\n  balance: ${bal}\n  explorer: ${RH_NET.explorer}/address/${w.address}\n  to see it in MetaMask or Rabby, add the network: ${RH_NET.name}, chain id ${RH_NET.chainId}, RPC ${RH_NET.rpc}, symbol ${RH_NET.symbol}, explorer ${RH_NET.explorer}`); return; }
    if (cmd === 'export') { console.log(`Private key for the ${name} bot wallet (Robinhood chain, Ethereum-style).\nPhantom: Add wallet > Import private key > Ethereum, paste it. The same address holds the Robinhood-chain ETH (add the network in MetaMask or Rabby if the app does not list it).\nAnyone with this can empty the wallet. Clear your screen afterwards (the terminal's history too).\n\n${w.privateKey}\n`); return; } console.log('unknown command: ' + cmd); process.exit(1); }
  let web3, bs58; try { web3 = await import('@solana/web3.js'); bs58 = (await import('bs58')).default; } catch { console.error('Needs the Solana libraries: run  npm install  in the RYNOSCAN folder first.'); process.exit(1); }
  if (cmd === 'create') {
    if (fs.existsSync(file)) { console.error(`A key already exists at ${file}. Not overwriting it (that would lose access to any funds in it). Use "show" to see the address.`); process.exit(1); }
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); const kp = web3.Keypair.generate(); fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 }); fs.chmodSync(file, 0o600);
    setWallet(name, kp.publicKey.toBase58());
    console.log(`New wallet for the ${name} bot.\n  address: ${kp.publicKey.toBase58()}\n  key file: ${file} (owner read only)\nSaved the address to bot/config.json. Send a small amount of SOL to the address to fund it (keep 0.03 SOL spare for fees).\nRestart the desk to see its balance: systemctl restart rynobot-dash`); return; }
  if (!fs.existsSync(file)) { console.error(`No key for the ${name} bot yet: node bot/wallet.mjs create --bot ${name}`); process.exit(1); }
  const kp = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, 'utf8')))), addr = kp.publicKey.toBase58();
  if (cmd === 'show') { let bal = '?'; try { bal = (await defaultIo().solBalance(addr)).toFixed(4) + ' SOL'; } catch (e) { bal = 'balance unavailable (' + e.message + ')'; } console.log(`${name} bot wallet: ${addr}\n  balance: ${bal}\n  explorer: https://solscan.io/account/${addr}`); return; }
  if (cmd === 'export') { console.log(`Secret key for the ${name} bot wallet (Solana).\nPhantom: Add wallet > Import private key > Solana, paste it.\nAnyone with this can empty the wallet. Clear your screen afterwards (the terminal's history too).\n\n${bs58.encode(kp.secretKey)}\n`); return; }
  console.log('unknown command: ' + cmd); process.exit(1);
}
main();
