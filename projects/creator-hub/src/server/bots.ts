/**
 * Bot detection by user agent and request shape. Bots are still served (link previews need the
 * redirect) but are logged with is_bot=1 and left out of every count.
 *
 * Deliberately NOT bots: in-app browsers of TikTok (BytedanceWebview), Instagram, Facebook (FBAN),
 * X ("Twitter for iPhone"), Snapchat and LinkedIn (LinkedInApp), and Cubot phones.
 */
import type {IncomingMessage} from 'node:http';

const BOT_PATTERNS = [
	// crawlers and link-preview fetchers
	String.raw`(?<!cu)bot`, 'crawl', 'spider', 'slurp', 'archiver', 'fetch', 'preview', 'facebookexternalhit',
	'facebookcatalog', 'meta-external', 'whatsapp', 'embedly', 'iframely', 'vkshare', 'cardyb', 'slack-imgproxy',
	'flipboardproxy', 'nuzzel', 'outbrain', 'qwantify', 'sogou', 'feedly', 'validator', 'google-inspectiontool',
	'googleother', 'google-safety', 'mediapartners-google', 'apis-google', 'google-read-aloud', 'pagerenderer',
	'chatgpt-user', 'claude-user', 'anthropic-ai', 'perplexity', 'cohere-ai',
	// command-line tools and HTTP libraries
	'curl', 'wget', 'python', 'aiohttp', 'httpx', 'go-http-client', 'okhttp', String.raw`java/`, 'apache-httpclient',
	'libwww', 'lwp-', 'node-fetch', 'undici', 'axios', 'postman', 'insomnia', 'httpie', 'ruby', String.raw`php/`,
	'perl', 'scrapy', 'colly', String.raw`deno/`, String.raw`bun/`, String.raw`http\.rb`, '^node$',
	// headless browsers and monitors
	'headless', 'phantomjs', 'puppeteer', 'playwright', 'selenium', 'webdriver', 'lighthouse', 'gtmetrix', 'pingdom',
	'uptime', 'statuscake', 'site24x7', 'monitor', 'ptst',
	// bots usually include a contact URL: "(compatible; X/1.0; +https://example.com/bot)"
	String.raw`\+https?://`,
];

const BOT_UA = new RegExp(BOT_PATTERNS.join('|'), 'i');

export const isBotUserAgent = (userAgent: string): boolean => userAgent.trim().length < 8 || BOT_UA.test(userAgent);

const PREFETCH = /prefetch|prerender|preview/i;

/** HEAD requests and browser prefetches are never human clicks. */
export const isBotRequest = (req: IncomingMessage): boolean => {
	if (req.method === 'HEAD') return true;
	const purpose = [req.headers['sec-purpose'], req.headers.purpose, req.headers['x-purpose'], req.headers['x-moz']]
		.filter((v): v is string => typeof v === 'string')
		.join(' ');
	if (purpose && PREFETCH.test(purpose)) return true;
	return isBotUserAgent(req.headers['user-agent'] ?? '');
};
