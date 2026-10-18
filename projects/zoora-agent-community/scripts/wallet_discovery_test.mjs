// SYNTHETIC protocol fixtures; these tests do not verify any vendor application.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createPrivateKey,createPublicKey,sign,verify} from 'node:crypto';

function harness(){
  const window=new EventTarget();window.location={origin:'https://pilot.example.invalid'};
  const context=vm.createContext({window,CustomEvent,Uint8Array,TextEncoder,URL,btoa});
  vm.runInContext(readFileSync(new URL('../web/wallet.js',import.meta.url),'utf8'),context);
  let api;window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet',{detail:value=>{api=value;}}));
  return {wallet:context.ZooraWallet,window,api};
}
function fixture(label){
  const seed=createHash('sha256').update('PUBLIC-MULTIWALLET-FIXTURE-NEVER-FUND:'+label).digest();
  const key=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),seed]),format:'der',type:'pkcs8'});
  const publicKey=createPublicKey(key),raw=publicKey.export({format:'der',type:'spki'}).subarray(-32);
  let n=BigInt('0x'+raw.toString('hex')),address='';
  while(n){address='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'[Number(n%58n)]+address;n/=58n;}
  for(const byte of raw){if(byte)break;address='1'+address;}
  const account={address,publicKey:new Uint8Array(raw),chains:['solana:mainnet'],features:['solana:signMessage']};
  const calls={connect:0,sign:0,transaction:0};
  const provider={name:'SYNTHETIC '+label+' protocol fixture',version:'1.0.0',accounts:[account],features:{
    'standard:connect':{version:'1.0.0',connect:async()=>{calls.connect++;return {accounts:[account]};}},
    'solana:signMessage':{version:'1.0.0',signMessage:async({message})=>{calls.sign++;return [{signedMessage:message,signature:new Uint8Array(sign(null,message,key)),signatureType:'ed25519'}];}},
    'solana:signTransaction':{version:'1.0.0',signTransaction:()=>{calls.transaction++;throw new Error('Transactions forbidden');}}
  }};
  return {provider,account,calls,publicKey};
}
test('five independent protocol fixtures connect/sign exact bytes without invoking transactions',async()=>{
  const h=harness(),providers=['alpha','bravo','charlie','delta','echo'].map(fixture);
  for(const p of providers)h.api.register(p.provider);
  assert.equal(h.wallet.get().length,5);
  for(const p of providers){
    assert.deepEqual(p.calls,{connect:0,sign:0,transaction:0});
    assert.equal((await h.wallet.connect(p.provider))[0],p.account);
    const message='Disposable multiwallet login check. No payment.';
    const result=await h.wallet.sign(p.provider,p.account,{protocol:'ZOORA_AE008_RAW_ED25519_V1',audience:h.window.location.origin,
      transactions_authorized:false,wallet:p.account.address,expires_at_ms:Date.now()+60000,message,message_base64:btoa(message),challenge_id:'a'.repeat(32)});
    assert.ok(verify(null,Buffer.from(message),p.publicKey,Buffer.from(result.signature,'base64')));
    assert.deepEqual(p.calls,{connect:1,sign:1,transaction:0});
  }
});
test('Ethereum-only accounts and signing features cannot masquerade as Solana login',async()=>{
  const h=harness(),p=fixture('unsupported');
  const evm={...p.provider,features:{'standard:connect':p.provider.features['standard:connect'],'ethereum:personal_sign':{version:'1.0.0',sign:()=>{throw Error('Not called');}}}};
  h.api.register(evm);assert.equal(h.wallet.get().length,0);
  h.api.register(p.provider);p.account.address='0x'+'1'.repeat(40);p.account.chains=['eip155:1'];
  await assert.rejects(h.wallet.connect(p.provider),/cannot sign raw Solana messages/);
});
test('rescan discovers late wallets without automatically connecting or signing',()=>{
  const h=harness(),p=fixture('late');
  h.window.addEventListener('wallet-standard:app-ready',event=>event.detail.register(p.provider));
  h.wallet.rescan();h.wallet.rescan();
  assert.equal(h.wallet.get().length,1);assert.equal(h.wallet.get()[0],p.provider);
  assert.deepEqual(p.calls,{connect:0,sign:0,transaction:0});
});
test('unregistering a wallet while approval is pending refuses the returned accounts',async()=>{
  const h=harness(),p=fixture('removed');let release;
  p.provider.features['standard:connect'].connect=()=>new Promise(resolve=>{release=resolve;});
  const remove=h.api.register(p.provider),pending=h.wallet.connect(p.provider);
  remove();release({accounts:[p.account]});
  await assert.rejects(pending,/became unavailable/);assert.equal(p.calls.sign,0);
});
test('mobile links contain only a validated HTTPS origin, never page secrets or arbitrary routes',()=>{
  const h=harness(),links=h.wallet.mobileLinks('https://pilot.example.invalid/private?token=DO_NOT_FORWARD#invite=PRIVATE');
  assert.equal(links.length,2);
  for(const link of links){
    const url=new URL(link.href);assert.ok(['phantom.com','backpack.app'].includes(url.host));
    assert.equal(url.searchParams.get('ref'),'https://pilot.example.invalid');
    assert.equal(decodeURIComponent(url.pathname.slice(url.pathname.indexOf('/browse/')+8)),'https://pilot.example.invalid');
    assert.ok(!link.href.includes('PRIVATE')&&!link.href.includes('token')&&!link.href.includes('invite'));
  }
  for(const origin of ['http://localhost:8765','javascript:alert(1)','https://secret@pilot.example.invalid','not a URL'])assert.equal(h.wallet.mobileLinks(origin).length,0);
});
test('registry bounds and duplicate rescans preserve distinct wallet identities',()=>{
  const h=harness(),providers=Array.from({length:20},(_,i)=>fixture(String(i)));
  h.api.register(...providers.map(p=>p.provider));assert.equal(h.wallet.get().length,16);
  h.api.register(providers[0].provider);assert.equal(h.wallet.get().length,16);
  assert.equal(h.wallet.get()[0],providers[0].provider);assert.equal(h.wallet.get()[15],providers[15].provider);
});
