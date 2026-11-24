/**
 * "guard blocked-words": a ready-to-paste blocked-words list and the recommended YouTube Studio comment
 * settings. Needs no API access, so it is the first thing to set up.
 *
 * Studio facts come from YouTube Help, read through search-index extracts on 2026-11-24 because
 * support.google.com could not be opened from the build machine. Menu names change; check the live pages:
 * - https://support.google.com/youtube/answer/9483359  Learn about comment settings
 * - https://support.google.com/youtube/answer/16622701 Manage your channel's moderation settings
 * - https://support.google.com/youtube/answer/9482556  Choose comment settings
 */

/** Phrases genuine viewers almost never write. Safe to paste as they are. */
export const STRONG_PHRASES = [
	// private-chat solicitations
	'whatsapp me', 'telegram me', 'text me on whatsapp', 'text me on telegram', 'message me on whatsapp',
	'message me on telegram', 'dm me on telegram', 'dm me on whatsapp', 'inbox me', 'add me on whatsapp',
	'add me on telegram', 'write to me on telegram', 'contact me on whatsapp', 'contact me on telegram',
	'contact him on', 'contact her on', 'reach him on', 'reach her on', 'write to him', 'write to her',
	'text her on', 'text him on', 'message him on', 'message her on', 'his whatsapp', 'her whatsapp',
	'his telegram', 'her telegram', 't.me/', 'wa.me/', 'chat.whatsapp.com', 'telegram.me',
	// "handler" and recovery scams
	'account manager', 'investment manager', 'portfolio manager', 'recovery expert', 'recovery specialist',
	'recovery agent', 'fund recovery', 'funds recovery', 'recover your funds', 'recover stolen', 'ethical hacker',
	'certified hacker', 'crypto recovery', 'asset recovery', 'thanks to mrs', 'thanks to mr', 'thanks to expert',
	'god bless mrs', 'all thanks to',
	// giveaways and doubling
	'you have been selected', "you've been selected", 'lucky winner', 'claim your prize', 'claim your reward',
	'double your btc', 'double your eth', 'double your sol', 'double your crypto', 'giveaway is live',
	// seed phrases and wallet drainers
	'send your seed phrase', 'share your seed phrase', 'send your recovery phrase', 'share your recovery phrase',
	'validate your wallet', 'sync your wallet', 'rectify your wallet', 'rectification', 'wallet validation',
	'validation portal', 'migration portal', 'connect your wallet to claim',
	// spellings used to dodge filters
	'whatsap', 'watsapp', 'wattsapp', 'whatapp', 'telegarm', 'teiegram', 'telgram', 'telegrm',
];

/** Catches more bots but also holds genuine questions ("is the Telegram bot safe?"). */
export const AGGRESSIVE_WORDS = ['whatsapp', 'telegram', 'signal app', 'viber', 'wechat', 'giveaway', 'airdrop', 'hacker', 'mrs', 'mentor', 'broker', 'bit.ly', 'tinyurl'];

export const PINNED_COMMENT =
	'Zoora AI will never ask you to message us on WhatsApp, Telegram or anywhere else, and never asks for your seed phrase or for money. ' +
	'Any reply that does is a scam: please report it.';

export const blockedWordsGuide = (): string =>
	[
		'BLOCKED WORDS (paste into YouTube Studio > Settings > Community / Content controls > Blocked words)',
		'Comments that match are held for review, not deleted.',
		'',
		STRONG_PHRASES.join(', '),
		'',
		'OPTIONAL STRICTER WORDS (also hold some genuine questions; check "Held for review" daily if you add them)',
		'',
		AGGRESSIVE_WORDS.join(', '),
		'',
		'RECOMMENDED YOUTUBE STUDIO SETTINGS',
		'1. Comment moderation: at least "Basic" (hold potentially inappropriate comments for review).',
		'   Switch to "Strict" (holds a broader range) while a video is being hit by a bot wave.',
		'2. Block links: on ("Link text"). Comments with URLs or hashtags are held for review.',
		'3. Blocked words: the list above.',
		'4. Hidden users: add impersonator accounts listed under "Accounts to consider hiding" in the guard report.',
		'   Their future comments are hidden from everyone else.',
		'5. Pin this comment under every video (reply bots copy your look, not your words):',
		`   "${PINNED_COMMENT}"`,
		'6. Check Comments > "Held for review" regularly. YouTube Help says held comments are kept for up to 60 days.',
		'7. After each upload, run the dry run: npm run guard (it changes nothing and writes a report).',
		'',
		'Menu names change. Check YouTube Help: https://support.google.com/youtube/answer/9483359 and',
		'https://support.google.com/youtube/answer/16622701 (read via search extracts on 2026-11-24, not opened directly).',
	].join('\n');
