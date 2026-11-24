/**
 * OAuth 1.0a request signing (HMAC-SHA1) for X's user-context endpoints, per RFC 5849 and X's guide "Creating a
 * signature" (docs.x.com/fundamentals/authentication/oauth-1-0a/creating-a-signature). The tests reproduce the
 * signature of the worked example in that guide (POST statuses/update, signature "hCtSmYh+iHYCEqBWrE7C7hYmtUk=").
 *
 * For POST /2/tweets the body is JSON, so only the oauth_* parameters (and any query parameters) are signed:
 * RFC 5849 §3.4.1.3.1 includes the body only when it is form-encoded.
 */
import {createHmac, randomBytes} from 'node:crypto';

export type OAuth1Credentials = {consumerKey: string; consumerSecret: string; token: string; tokenSecret: string};

/** RFC 3986 percent-encoding: everything except A-Z a-z 0-9 - . _ ~ (RFC 5849 §3.6). */
export const percentEncode = (value: string): string =>
	encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** 32 random bytes, base64, with every non-word character removed (X's guide). */
export const makeNonce = (): string => randomBytes(32).toString('base64').replace(/\W/g, '');

export type SignRequest = {
	method: string;
	url: string;
	/** Form-encoded body parameters (never a JSON body). */
	bodyParams?: Record<string, string>;
	credentials: OAuth1Credentials;
	nonce?: string;
	timestampSec?: number;
};

export type Signed = {authorization: string; signature: string; baseString: string};

export const signOAuth1 = (req: SignRequest): Signed => {
	const url = new URL(req.url);
	// base string URI: lower-case scheme and host, no default port, no query or fragment (RFC 5849 §3.4.1.2)
	const baseUri = `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${url.pathname}`;
	const oauth: Record<string, string> = {
		oauth_consumer_key: req.credentials.consumerKey,
		oauth_nonce: req.nonce ?? makeNonce(),
		oauth_signature_method: 'HMAC-SHA1',
		oauth_timestamp: String(req.timestampSec ?? Math.floor(Date.now() / 1000)),
		oauth_token: req.credentials.token,
		oauth_version: '1.0',
	};
	const pairs: [string, string][] = [...url.searchParams.entries(), ...Object.entries(req.bodyParams ?? {}), ...Object.entries(oauth)].map(([k, v]) => [percentEncode(k), percentEncode(v)]);
	pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
	const paramString = pairs.map(([k, v]) => `${k}=${v}`).join('&');
	const baseString = `${req.method.toUpperCase()}&${percentEncode(baseUri)}&${percentEncode(paramString)}`;
	const key = `${percentEncode(req.credentials.consumerSecret)}&${percentEncode(req.credentials.tokenSecret)}`;
	const signature = createHmac('sha1', key).update(baseString).digest('base64');
	const header = Object.entries({...oauth, oauth_signature: signature})
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`)
		.join(', ');
	return {authorization: `OAuth ${header}`, signature, baseString};
};
