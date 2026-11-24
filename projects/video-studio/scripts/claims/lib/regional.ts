/**
 * Per-language promotion and persona rules (pure), added 2026-11-24 (VCD fix) from docs/research/dubbing-and-regions
 * (§1.11, §4.1, §4.3, §4.9):
 *  - offers in a translation: one es/pt-br/hi track serves many countries and only the master picture is published,
 *    so until a geo-aware link router exists no affiliate/exchange offer and no token promotion goes into a dub.
 *    An owner waiver (`dubOffersWaiver`) can record the geo-routing decision for other offers; exchange and token
 *    offers in a dub always fail.
 *  - MiCA Art. 7(1)(e) (es, it): a token promotion carries the "not reviewed or approved by any competent authority"
 *    statement, spoken and on screen.
 *  - ASCI (hi): a promotion that features crypto carries the VDA disclaimer (spoken and on screen in the last scene,
 *    and the first in longer videos), an "animated character, AI voice" disclosure, none of the banned words
 *    (currency, securities, custodian, depositories), and only FIU-IND-registered exchanges.
 *  - holdings (MiCA Art. 91, every language): an opinion on a named token, or holding one, needs a spoken holdings
 *    disclosure; `holdings: "none"` contradicts "I hold ...".
 * The non-English lexicons are machine-made and the official es/it MiCA wording and any Hindi ASCI text were not
 * read (EUR-Lex and ascionline.in are blocked here): these checks look for key clauses, and the report says so.
 */
import type {Lang, Storyboard, StoryboardScene} from '../../../src/episode/types.ts';
import {spokenText} from '../../../src/episode/markup.ts';
import type {Finding} from './types.ts';
import {saysUnnegated} from './income.ts';
import {AI_PERSONA_DISCLOSURE_HI, ASCI_BANNED_HI, ASCI_DISCLAIMER_HI, HOLDING, HOLDINGS_DISCLOSURE, MICA_STATEMENT, NAMED_TOKEN, TOKEN_OPINION} from './lexicon.ts';
import type {OfferInfo} from './load.ts';
import {splitSentences} from './narration.ts';
import {allMatches, clean} from './text.ts';

/** Exchanges: naming one in a hi script makes it a VDA promotion under ASCI. */
export const EXCHANGES = ['Binance', 'Coinbase', 'Kraken', 'OKX', 'Bybit', 'KuCoin', 'Bitget', 'Gate.io', 'HTX', 'Huobi', 'Crypto.com', 'Robinhood', 'Bitfinex', 'Upbit', 'WazirX', 'CoinDCX', 'CoinSwitch', 'Mudrex', 'ZebPay', 'MEXC', 'BingX'];
const EXCHANGE_RE = new RegExp(`(?<![\\p{Script=Latin}\\p{N}_.])(?:${EXCHANGES.map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\p{Script=Latin}\\p{N}_])`, 'u');

/** Optional storyboard fields these rules read (recorded contract additions; see scripts/claims/README.md). */
export type RegionalFields = {
	/** A translation's owner waiver for its offers: who decided the geo-routing, when and why. */
	dubOffersWaiver?: {reason?: string; approvedBy?: string; date?: string};
	/** true when the video promotes a token (MiCA Art. 7 statement in es/it; never in a dub). */
	tokenPromotion?: boolean;
	/** The host's holdings of what the video discusses: "none" or a list of tickers ("$SOL"). */
	holdings?: 'none' | string[];
};

const spoken = (sc: StoryboardScene): string => {
	try {
		return spokenText(sc.narration);
	} catch {
		return '';
	}
};
const shownText = (sc: StoryboardScene): string =>
	Object.entries(sc.onScreen ?? {})
		.filter(([k]) => k !== 'cues' && k !== 'badgerCue')
		.flatMap(([, v]) => (Array.isArray(v) ? v.map(String) : [String(v)]))
		.join(' \n ');
const allOf = (res: RegExp[], text: string): boolean => res.every((re) => re.test(clean(text)));

export type RegionalInput = {sb: Storyboard & RegionalFields; lang: Lang; isTranslation: boolean; offerIds: string[]; registry: Map<string, OfferInfo> | null};

export const regionalFindings = ({sb, lang, isTranslation, offerIds, registry}: RegionalInput): Finding[] => {
	const out: Finding[] = [];
	const categoryOf = (id: string): string => (registry?.get(id) as {category?: string} | undefined)?.category ?? '';
	const exchangeOrToken = offerIds.filter((id) => /^(?:exchange|token|launchpad)$/.test(categoryOf(id)));

	// --- offers and token promotion in a translation
	if (isTranslation && (offerIds.length || sb.tokenPromotion)) {
		const w = sb.dubOffersWaiver;
		const waived = !!(w && typeof w.reason === 'string' && w.reason.trim().length >= 8 && typeof w.approvedBy === 'string' && w.approvedBy.trim() && typeof w.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(w.date));
		if (exchangeOrToken.length || sb.tokenPromotion)
			out.push({
				level: 'error',
				rule: 'dub-offers',
				where: 'offers',
				message: `a ${lang} track ${sb.tokenPromotion ? 'promotes a token' : `carries exchange or token offers (${exchangeOrToken.join(', ')})`}: one language track serves many countries (MiCA, ASCI, CVM, FCA), so these never go into a dub`,
				fix: 'Remove the offer (and the token promotion) from this translation, or make a native per-country upload after legal review.',
			});
		else if (!waived)
			out.push({
				level: 'error',
				rule: 'dub-offers',
				where: 'offers',
				message: `a ${lang} track carries offers (${offerIds.join(', ')}); until a geo-aware link router exists, dubbed videos carry no affiliate links (research §4.9)`,
				fix: 'Remove the offers from this translation, or have the owner record the geo-routing decision in storyboard.<lang>.json: "dubOffersWaiver": {"reason": "...", "approvedBy": "<initials or role>", "date": "YYYY-MM-DD"}.',
			});
	}

	const narration = sb.scenes.map(spoken).join('\n');
	const shown = sb.scenes.map(shownText).join('\n');

	// --- MiCA Art. 7 (es, it): a token promotion states that no authority reviewed it, spoken and on screen
	const mica = MICA_STATEMENT[lang];
	if ((sb.tokenPromotion || exchangeOrToken.some((id) => categoryOf(id) === 'token')) && (lang === 'es' || lang === 'it') && mica) {
		const said = mica.test(clean(narration));
		const onScreen = mica.test(clean(shown));
		if (!said || !onScreen)
			out.push({
				level: 'error',
				rule: 'mica-statement',
				where: 'storyboard',
				message: `a token promotion in ${lang} must carry the MiCA Art. 7(1)(e) statement ("has not been reviewed or approved by any competent authority ...") ${!said && !onScreen ? 'spoken and on screen' : !said ? 'spoken (it is only on screen)' : 'on screen (it is only spoken)'}`,
				fix: `Add the official ${lang} wording of MiCA Art. 7(1)(e) from EUR-Lex (not read here) to the CTA narration and as on-screen text, then have it legally reviewed.`,
			});
	}

	// --- ASCI (hi): VDA promotions
	if (lang === 'hi') {
		const namesExchange = EXCHANGE_RE.test(narration) || EXCHANGE_RE.test(shown) || EXCHANGE_RE.test(sb.title);
		const namesToken = allMatches(NAMED_TOKEN, `${narration}\n${shown}`).some((m) => m[0].startsWith('$'));
		const promotes = offerIds.length > 0 || sb.tokenPromotion === true;
		if (promotes || namesExchange || namesToken) {
			const last = sb.scenes[sb.scenes.length - 1];
			const first = sb.scenes[0];
			const where = (sc: StoryboardScene, label: string) => {
				const s = allOf(ASCI_DISCLAIMER_HI, spoken(sc));
				const o = allOf(ASCI_DISCLAIMER_HI, shownText(sc));
				if (!s || !o)
					out.push({
						level: 'error',
						rule: 'asci-disclaimer',
						where: `${sc.id}`,
						scene: sc.id,
						message: `a Hindi video featuring crypto${promotes ? ' with a promotion' : ''} needs the ASCI disclaimer in the ${label} scene, ${!s && !o ? 'spoken and on screen' : !s ? 'spoken (voice-over at normal pace)' : 'on screen (at least 5 s, plain background)'}`,
						fix: 'Use the owner-reviewed Hindi rendering of "Crypto products and NFTs are unregulated and can be highly risky. There may be no regulatory recourse for any loss from such transactions." (ASCI publishes no Hindi text: native and legal review), as narration and as on-screen text held 5 s or more.',
					});
			};
			if (promotes) {
				where(last, 'last');
				if (sb.scenes.length >= 6 && first !== last) where(first, 'first (longer videos repeat it at the start)');
				if (!allOf(AI_PERSONA_DISCLOSURE_HI, narration) && !allOf(AI_PERSONA_DISCLOSURE_HI, shown))
					out.push({
						level: 'error',
						rule: 'asci-ai-persona',
						where: 'storyboard',
						message: 'a Hindi promotion must disclose that Zoo is an animated character with an AI voice (ASCI virtual-influencer rule)',
						fix: 'Say and show, in Hindi, that Zoo is an animated character with an AI voice (e.g. "Zoo एक एनिमेटेड पात्र है और आवाज़ AI की है"; native review).',
					});
				for (const id of offerIds)
					if (categoryOf(id) === 'exchange' && (registry?.get(id) as {fiuIndRegistered?: boolean} | undefined)?.fiuIndRegistered !== true)
						out.push({level: 'error', rule: 'asci-fiu-ind', where: 'offers', message: `exchange offer "${id}" is not marked FIU-IND registered in the offer registry`, fix: 'Link only exchanges registered with FIU-IND in hi content: check the registration and set "fiuIndRegistered": true in creator-hub/config/offers.json, or remove the offer.'});
			} else
				out.push({level: 'warning', rule: 'asci-disclaimer', where: 'storyboard', message: 'this Hindi script names an exchange or a token: if any material connection exists, it is a VDA ad under ASCI (disclaimer, AI-persona disclosure, banned words)', fix: 'Confirm there is no paid or affiliate relationship; otherwise add the ASCI disclaimer and disclosure.'});
			const banned = [sb.title, narration, shown].flatMap((t) => allMatches(ASCI_BANNED_HI, clean(t)).map((m) => m[0]));
			if (banned.length)
				out.push({
					level: promotes ? 'error' : 'warning',
					rule: 'asci-banned-word',
					where: 'storyboard',
					text: [...new Set(banned)].join(', '),
					message: `ASCI bans "currency", "securities", "custodian" and "depositories" in VDA ads; found ${[...new Set(banned)].map((b) => `"${b}"`).join(', ')}`,
					fix: 'Say "क्रिप्टो" / "डिजिटल एसेट" (crypto, digital asset) instead, and drop the other banned words.',
				});
		}
	}

	// --- holdings (MiCA Art. 91): opinions on a named token, or holding one, need a spoken disclosure
	const hold = HOLDING[lang];
	const opinion = TOKEN_OPINION[lang];
	const disclosed = HOLDINGS_DISCLOSURE[lang] ? HOLDINGS_DISCLOSURE[lang]!.test(clean(narration)) : false;
	const holdingsField = sb.holdings;
	for (const sc of sb.scenes) {
		let sentences: ReturnType<typeof splitSentences> = [];
		try {
			sentences = splitSentences(sc.narration, lang);
		} catch {
			continue;
		}
		for (const s of sentences) {
			const t = s.spoken || s.display;
			const holds = hold ? saysUnnegated(hold, t, lang) : false;
			const opines = opinion ? saysUnnegated(opinion, t, lang) && allMatches(NAMED_TOKEN, t).length > 0 : false;
			if (holds && holdingsField === 'none')
				out.push({level: 'error', rule: 'holdings-mismatch', where: `${sc.id} · narration`, scene: sc.id, text: s.raw, message: 'the narration says Zoo holds a token but storyboard.holdings is "none"', fix: 'Correct storyboard.holdings (a list of the tickers held) and disclose them aloud, or rephrase.'});
			if ((holds || opines) && !disclosed)
				out.push({
					level: 'error',
					rule: 'holdings-disclosure',
					where: `${sc.id} · narration`,
					scene: sc.id,
					text: s.raw,
					message: `${holds ? 'mentions holding a token' : 'gives an opinion on a named token'} without a spoken holdings disclosure (MiCA Art. 91; CLAUDE.md "Disclose holdings")`,
					fix: lang === 'en' ? 'Have Zoo say plainly what he holds ("Disclosure: I hold some of this" / "I don\'t hold any"), and set storyboard.holdings; or drop the opinion.' : 'Say the holdings disclosure aloud in this language and set storyboard.holdings; or drop the opinion.',
				});
		}
	}
	if (Array.isArray(holdingsField) && holdingsField.length && !disclosed) {
		const named = holdingsField.filter((tk) => tk && new RegExp(`(?<![\\p{L}\\p{N}])${tk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu').test(`${narration}\n${shown}`));
		if (named.length)
			out.push({level: 'error', rule: 'holdings-disclosure', where: 'holdings', message: `the video discusses ${named.join(', ')}, which storyboard.holdings says Zoo holds, but no narration discloses it`, fix: 'Say the holding aloud where the token is discussed.'});
	}
	return out;
};
