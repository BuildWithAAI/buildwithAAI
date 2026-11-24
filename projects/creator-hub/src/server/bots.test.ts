import assert from 'node:assert/strict';
import type {IncomingMessage} from 'node:http';
import {describe, it} from 'node:test';
import {isBotRequest, isBotUserAgent} from './bots.ts';

const BOTS = [
	'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
	'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
	'Twitterbot/1.0',
	'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
	'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
	'TelegramBot (like TwitterBot)',
	'WhatsApp/2.23.20.0 A',
	'curl/8.5.0',
	'Wget/1.21.4',
	'python-requests/2.32.3',
	'Go-http-client/2.0',
	'node',
	'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36',
	'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
	'Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)',
	'Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)',
	'',
];

const HUMANS = [
	'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
	'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_32.5.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/en Region/US BytedanceWebview/d8a21c6',
	'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36 Instagram 301.0.0.29.124 Android',
	'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/440.0.0.33.116]',
	'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Twitter for iPhone/10.62',
	'Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
];

describe('bot detection', () => {
	it('flags crawlers, link-preview bots, CLI tools and headless browsers', () => {
		for (const ua of BOTS) assert.equal(isBotUserAgent(ua), true, ua);
	});

	it('does not flag browsers and in-app browsers', () => {
		for (const ua of HUMANS) assert.equal(isBotUserAgent(ua), false, ua);
	});

	it('treats HEAD requests and prefetches as bots', () => {
		const req = (method: string, headers: Record<string, string>): IncomingMessage =>
			({method, headers: {'user-agent': HUMANS[0], ...headers}}) as unknown as IncomingMessage;
		assert.equal(isBotRequest(req('GET', {})), false);
		assert.equal(isBotRequest(req('HEAD', {})), true);
		assert.equal(isBotRequest(req('GET', {'sec-purpose': 'prefetch;prerender'})), true);
		assert.equal(isBotRequest(req('GET', {purpose: 'prefetch'})), true);
	});
});
