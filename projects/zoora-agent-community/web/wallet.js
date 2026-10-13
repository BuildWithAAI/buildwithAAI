"use strict";
// Wallet Standard discovery. Existing raw Ed25519 protocol only; no transaction feature is called.
globalThis.ZooraWallet = (() => {
  const wallets = new Set(), listeners = new Set();
  const valid = wallet => wallet?.version === "1.0.0" && typeof wallet.name === "string" && wallet.name.length <= 80 &&
    wallet.features?.["standard:connect"]?.version === "1.0.0" && typeof wallet.features["standard:connect"].connect === "function" &&
    wallet.features?.["solana:signMessage"]?.version === "1.0.0" && typeof wallet.features["solana:signMessage"].signMessage === "function";
  const notify = () => { for (const listener of listeners) listener(); };
  function register(...candidates) {
    const added = [];
    for (const wallet of candidates.slice(0,16)) if (wallets.size < 16 && valid(wallet) && !wallets.has(wallet)) { wallets.add(wallet); added.push(wallet); }
    notify();
    return () => { for (const wallet of added) wallets.delete(wallet); notify(); };
  }
  const api = Object.freeze({register});
  window.addEventListener("wallet-standard:register-wallet", event => { if (typeof event.detail === "function") { try { event.detail(api); } catch { /* Unsupported wallet stays unavailable. */ } } });
  window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", {detail:api}));
  const bytesEqual = (a,b) => a instanceof Uint8Array && b instanceof Uint8Array && a.length === b.length && a.every((v,i)=>v===b[i]);
  const base58 = raw => {
    let value = 0n; for (const byte of raw) value = value * 256n + BigInt(byte);
    let encoded = ""; const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    while (value) {encoded = alphabet[Number(value % 58n)] + encoded; value /= 58n;}
    for (const byte of raw) {if (byte !== 0) break; encoded = "1" + encoded;}
    return encoded;
  };
  function accountValid(account) {
    return account?.publicKey instanceof Uint8Array && account.publicKey.length === 32 &&
      base58(account.publicKey) === account.address && Array.isArray(account.chains) &&
      account.chains.some(chain=>["solana:mainnet","solana:devnet","solana:testnet"].includes(chain)) &&
      Array.isArray(account.features) && account.features.includes("solana:signMessage");
  }
  async function connect(wallet) {
    if (!wallets.has(wallet) || !valid(wallet)) throw new Error("Supported wallet unavailable.");
    const result = await wallet.features["standard:connect"].connect();
    const accounts = result?.accounts;
    if (!Array.isArray(accounts)) throw new Error("Wallet connection returned unsupported accounts.");
    const usable = accounts.filter(accountValid).slice(0,16);
    if (!usable.length) throw new Error("This wallet account cannot sign raw Solana messages.");
    return usable;
  }
  async function sign(wallet, account, challenge) {
    if (!wallets.has(wallet) || !valid(wallet) || !accountValid(account) || !wallet.accounts.some(item=>item === account)) throw new Error("Wallet account changed. Connect again.");
    if (challenge.protocol !== "ZOORA_AE007_RAW_ED25519_V1" || challenge.transactions_authorized !== false || challenge.wallet !== account.address || challenge.audience !== "LOCAL_ONLY" || Date.now() >= challenge.expires_at_ms) throw new Error("Challenge changed or expired. Request a new one.");
    const message = new TextEncoder().encode(challenge.message);
    if (btoa(String.fromCharCode(...message)) !== challenge.message_base64) throw new Error("Challenge bytes do not match.");
    const outputs = await wallet.features["solana:signMessage"].signMessage({account,message});
    const result = outputs?.[0];
    if (outputs?.length !== 1 || !bytesEqual(result?.signedMessage,message) || !(result.signature instanceof Uint8Array) || result.signature.length !== 64 || (result.signatureType !== undefined && result.signatureType !== "ed25519")) throw new Error("Wallet changed the raw message or returned an unsupported signature.");
    if (!wallet.accounts.some(item=>item === account) || Date.now() >= challenge.expires_at_ms) throw new Error("Wallet account changed or challenge expired while signing.");
    return {challenge_id:challenge.challenge_id,signature:btoa(String.fromCharCode(...result.signature))};
  }
  return Object.freeze({get:()=>[...wallets],on:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},connect,sign});
})();
