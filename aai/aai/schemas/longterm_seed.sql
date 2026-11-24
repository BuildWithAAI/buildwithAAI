-- Seed rows for schema.sql (PROPOSAL). Values from 2040 Future Agent memory + watchlist Page, 2026-11-01.
-- No balances: holdings tables stay empty until a feed or manual import exists.
INSERT INTO lt_accounts VALUES
 ('onepay_roth','OnePay (VL) Roth IRA','OnePay','roth_ira','longterm',0,'none','Funded first; speculative + high-upside names'),
 ('robinhood','Robinhood (parallel 2040 portfolio)','Robinhood','taxable_brokerage','longterm',0,'none','Account type unverified (taxable vs IRA)'),
 ('trezor','Trezor','Trezor','cold_wallet','longterm',0,'none','Default home for crypto core'),
 ('phantom','Phantom','Phantom','hot_wallet','longterm',0,'none','Solana-focused'),
 ('exodus','Exodus','Exodus','hot_wallet','longterm',0,'none','Multi-asset'),
 ('bybit_spot','Bybit spot (long-term coins, if any)','Bybit','exchange_spot','longterm',0,'none','Needs separate sub-account from perps'),
 ('blofin_spot','Blofin spot (long-term coins, if any)','Blofin','exchange_spot','longterm',0,'none','Needs separate sub-account from perps'),
 ('bybit_perps','Bybit perps (~$100 test)','Bybit','exchange_derivs','trading',0,'none','Perps Agent; API geo-blocked from box'),
 ('blofin_perps','Blofin perps (~$100 test)','Blofin','exchange_derivs','trading',0,'none','Perps Agent; public market data only');
INSERT INTO lt_sleeves VALUES
 ('core','stocks_2040',60,55,65),('ai_infra','stocks_2040',14,10.5,17.5),('space','stocks_2040',10,7.5,12.5),
 ('minerals','stocks_2040',6.75,5.1,8.4),('robotics','stocks_2040',4,3,5),('future_energy','stocks_2040',3.25,2.4,4.1),
 ('frontier','stocks_2040',2,1.5,2.5),('crypto_core','crypto_longterm',100,100,100);
INSERT INTO lt_targets VALUES
 ('VTI','core','etf','core_anchor',0,60,NULL,NULL,NULL,'onepay_roth','active',1793491200),
 ('TMC','minerals','stock','speculative',1,1.5,3,5,NULL,'onepay_roth','active',1793491200),
 ('SPCE','space','stock','speculative',1,1.0,3,5,NULL,'onepay_roth','active',1793491200),
 ('SLDP','future_energy','stock','speculative',1,1.0,3,5,NULL,'onepay_roth','active',1793491200),
 -- COUR (Coursera): Zoorped decision relayed by 2040 Future Agent 2026-11-02, speculative 'future of education' thesis,
 -- 3% per-name cap. No contribution weight was given, so target_pct=0 (not invented); sleeve 'frontier' (no education sleeve exists).
 ('COUR','frontier','stock','speculative',0,0,3,NULL,3,'onepay_roth','active',1793607000);
INSERT INTO lt_crypto_core (symbol,never_fully_sell,core_floor_qty,initial_capital_usd,recover_trigger,bear_add_rule,cold_storage_required,updated_at) VALUES
 ('BTC',1,NULL,NULL,'DECISION NEEDED','accumulate monthly while cycle_phase=bear_accumulation',1,1793491200),
 ('ETH',1,NULL,NULL,'DECISION NEEDED','accumulate monthly while cycle_phase=bear_accumulation',1,1793491200),
 ('SOL',1,NULL,NULL,'DECISION NEEDED','accumulate monthly while cycle_phase=bear_accumulation',1,1793491200),
 ('XRP',1,NULL,NULL,'DECISION NEEDED','accumulate monthly while cycle_phase=bear_accumulation',1,1793491200),
 ('GALA',1,NULL,NULL,'DECISION NEEDED','accumulate monthly while cycle_phase=bear_accumulation',1,1793491200),
 ('HYPE',1,NULL,NULL,'DECISION NEEDED','accumulate monthly while cycle_phase=bear_accumulation',1,1793491200);
