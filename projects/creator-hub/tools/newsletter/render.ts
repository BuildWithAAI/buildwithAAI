/**
 * Renders a newsletter draft as Markdown (for review and editing) and as email-safe HTML: a 600 px
 * table layout with inline styles only. No scripts, no <style> block, no images, no web fonts and no
 * tracking pixels. Kit appends the unsubscribe link and the sender's postal address to every email.
 *
 * Colours: near-black #0B0C0F on white or off-white #F4F6F8; muted #4A5260 (7.3:1 or better); teal
 * #29B8AD only as an accent and as the button fill behind near-black text (8:1).
 */
import type {DraftOffer, NewsletterDraft} from './draft.ts';

// ---------------------------------------------------------------------------------------------
// Escaping

const HTML_ESCAPES: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;',
	// Kit runs Liquid over the content: encoded braces can never start a {{ tag }} or {% tag %}.
	'{': '&#123;',
	'}': '&#125;',
};

/** Escapes text for email HTML element content and quoted attribute values. */
export const escEmail = (value: string): string => value.replace(/[&<>"'{}]/g, (ch) => HTML_ESCAPES[ch] ?? ch);

/** Escapes one line of text for Markdown so it can never become a link, emphasis, heading or HTML. */
export const mdText = (value: string): string =>
	value
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/[\\`*_[\]<>|~]/g, '\\$&')
		.replace(/&(?=#?\w+;)/g, '\\&')
		.replace(/^(\d+)([.)])/, '$1\\$2')
		.replace(/^[#>+=-]/, '\\$&');

/** A Markdown link destination: the normalized URL with the characters Markdown treats specially encoded. */
export const mdUrl = (url: string): string => new URL(url).href.replace(/[()\s]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);

const mdLink = (text: string, url: string): string => `[${mdText(text)}](${mdUrl(url)})`;

// ---------------------------------------------------------------------------------------------
// Markdown

const yaml = (value: string): string => JSON.stringify(value); // a JSON string is a valid YAML scalar

export const renderMarkdown = (draft: NewsletterDraft): string => {
	const out: string[] = [
		'---',
		`subject: ${yaml(draft.subject)}`,
		`preview: ${yaml(draft.previewText)}`,
		`episode: ${yaml(draft.slug)}`,
		`watch: ${yaml(draft.watchUrl ?? '')}`,
		`generated: ${yaml(draft.generatedAt)}`,
		'---',
		'',
		`# ${mdText(draft.title)}`,
		'',
		mdText(draft.summary),
		'',
	];
	if (draft.watchUrl) out.push(`**${mdLink('Watch the episode on YouTube', draft.watchUrl)}**`, '');
	if (draft.takeaways.length > 0) {
		out.push('## Key takeaways', '');
		for (const t of draft.takeaways) out.push(`- ${t.url ? mdLink(t.time, t.url) : mdText(t.time)} ${mdText(t.text)}`);
		out.push('');
	}
	if (draft.sources.length > 0) {
		out.push('## Sources', '');
		for (const s of draft.sources) out.push(`- ${mdLink(s.title, s.url)}`);
		out.push('');
	}
	if (draft.offers.length > 0) {
		out.push('## Links from this episode', '', 'Some of these are affiliate links: each one says what we earn, right next to it.', '');
		for (const offer of draft.offers) {
			out.push(`### ${mdText(offer.name)} (${mdText(offer.label.toLowerCase())})`, '');
			out.push(offer.disclosure.map(mdText).join(' '), '');
			out.push(mdLink(`Visit ${offer.name}`, offer.url), '');
		}
	}
	if (draft.episodeDisclosures.length > 0) {
		out.push('## About this episode', '', 'The video itself carries these disclosures:', '');
		for (const line of draft.episodeDisclosures) out.push(`- ${mdText(line)}`);
		out.push('');
	}
	out.push('---', '', mdText(draft.safetyLine), '');
	const [first = '', ...rest] = draft.footer;
	out.push(draft.disclosuresUrl ? `${mdText(first)} ${mdLink('How we make money', draft.disclosuresUrl)}` : mdText(first), '');
	for (const line of rest) out.push(mdText(line), '');
	out.push('<!-- Kit adds the unsubscribe link and the sender\'s postal address below this. -->', '');
	return out.join('\n');
};

// ---------------------------------------------------------------------------------------------
// Email HTML

const FONT = "system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
const INK = '#0B0C0F';
const PAPER = '#F4F6F8';
const MUTED = '#4A5260';
const TEAL = '#29B8AD';
const LINE = '#D9DEE5';

const TEXT = `font-family:${FONT};color:${INK};`;
const LINK = `color:${INK};text-decoration:underline;text-decoration-color:${TEAL};`;
const P = `margin:0 0 16px;${TEXT}font-size:16px;line-height:1.6;`;
const H2 = `margin:8px 0 12px;${TEXT}font-size:19px;line-height:1.3;font-weight:700;`;
const LIST = 'margin:0 0 16px;padding:0 0 0 22px;';
const ITEM = `margin:0 0 8px;${TEXT}font-size:16px;line-height:1.5;`;

const a = (url: string, text: string, style = LINK): string => `<a href="${escEmail(url)}" style="${style}">${escEmail(text)}</a>`;
const row = (inner: string, padding = '8px 28px'): string => `<tr><td style="padding:${padding};">\n${inner}\n</td></tr>`;

const button = (url: string, text: string): string =>
	`<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 12px;"><tr><td bgcolor="${TEAL}" style="border-radius:8px;background-color:${TEAL};">` +
	a(url, text, `display:inline-block;padding:14px 22px;font-family:${FONT};font-size:16px;font-weight:700;line-height:1.2;color:${INK};text-decoration:none;border-radius:8px;`) +
	'</td></tr></table>';

/** One offer: name and relationship tag, the disclosure right above the link, then the link. */
const offerBlock = (offer: DraftOffer): string =>
	`<tr><td style="padding:0 0 12px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${LINE};border-radius:10px;"><tr><td style="padding:14px 16px;">
<p style="margin:0 0 6px;${TEXT}font-size:16px;line-height:1.4;font-weight:700;">${escEmail(offer.name)} <span style="display:inline-block;margin-left:4px;padding:1px 8px;border:1px solid ${MUTED};border-radius:999px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${MUTED};">${escEmail(offer.label)}</span></p>
<p style="margin:0 0 10px;font-family:${FONT};font-size:15px;line-height:1.5;color:${MUTED};">${offer.disclosure.map(escEmail).join('<br>')}</p>
<p style="margin:0;${TEXT}font-size:16px;line-height:1.4;">${a(offer.url, `Visit ${offer.name}`, `${LINK}font-weight:700;`)}</p>
</td></tr></table></td></tr>`;

/**
 * The email body: the 600 px card and the footer under it. This is what goes into Kit as the
 * broadcast content (Kit wraps it in the account's email template).
 */
export const renderEmailContent = (draft: NewsletterDraft): string => {
	const rows: string[] = [
		row(
			[
				`<p style="margin:0 0 14px;font-family:${FONT};font-size:13px;line-height:1.4;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};">${escEmail(draft.brandName)} · New episode</p>`,
				`<h1 style="margin:0 0 12px;${TEXT}font-size:26px;line-height:1.25;font-weight:700;">${escEmail(draft.title)}</h1>`,
				`<p style="${P}">${escEmail(draft.summary)}</p>`,
				draft.watchUrl ? button(draft.watchUrl, 'Watch on YouTube') : '',
			]
				.filter(Boolean)
				.join('\n'),
			'28px 28px 8px',
		),
	];
	if (draft.takeaways.length > 0) {
		const items = draft.takeaways.map((t) => `<li style="${ITEM}">${t.url ? a(t.url, t.time, `${LINK}font-weight:700;`) : escEmail(t.time)} ${escEmail(t.text)}</li>`);
		rows.push(row(`<h2 style="${H2}">Key takeaways</h2>\n<ul style="${LIST}">\n${items.join('\n')}\n</ul>`));
	}
	if (draft.sources.length > 0) {
		const items = draft.sources.map((s) => `<li style="${ITEM}">${a(s.url, s.title)}</li>`);
		rows.push(row(`<h2 style="${H2}">Sources</h2>\n<ul style="${LIST}">\n${items.join('\n')}\n</ul>`));
	}
	if (draft.offers.length > 0) {
		rows.push(
			row(
				`<h2 style="${H2}">Links from this episode</h2>
<p style="${P}font-size:15px;color:${MUTED};">Some of these are affiliate links: each one says what we earn, right next to it.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${draft.offers.map(offerBlock).join('\n')}
</table>`,
			),
		);
	}
	if (draft.episodeDisclosures.length > 0) {
		const items = draft.episodeDisclosures.map((line) => `<li style="${ITEM}font-size:15px;">${escEmail(line)}</li>`);
		rows.push(row(`<h2 style="${H2}">About this episode</h2>\n<p style="${P}font-size:15px;">The video itself carries these disclosures:</p>\n<ul style="${LIST}">\n${items.join('\n')}\n</ul>`));
	}
	rows.push(
		row(
			`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:12px 14px;background-color:${PAPER};border-left:4px solid ${TEAL};">
<p style="margin:0;${TEXT}font-size:15px;line-height:1.5;"><strong>Stay safe:</strong> ${escEmail(draft.safetyLine)}</p>
</td></tr></table>`,
			'8px 28px 28px',
		),
	);
	const [first = '', ...rest] = draft.footer;
	const footer = [
		`${escEmail(first)}${draft.disclosuresUrl ? ` ${a(draft.disclosuresUrl, 'How we make money', `color:${MUTED};text-decoration:underline;`)}` : ''}`,
		...rest.map(escEmail),
	].map((line) => `<p style="margin:0 0 8px;font-family:${FONT};font-size:13px;line-height:1.5;color:${MUTED};">${line}</p>`);
	// Fluid up to 600 px (the div); Outlook for Windows ignores max-width, so it gets a fixed 600 px table.
	return `<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<div style="max-width:600px;margin:0 auto;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:100%;background-color:#FFFFFF;border-top:4px solid ${TEAL};border-radius:12px;">
${rows.join('\n')}
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
<tr><td style="padding:16px 28px 0;">
${footer.join('\n')}
</td></tr>
</table>
</div>
<!--[if mso]></td></tr></table><![endif]-->`;
};

/** A complete email-safe HTML document, for previewing in a browser or pasting into an email tool. */
export const renderEmailHtml = (draft: NewsletterDraft): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escEmail(draft.subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${PAPER};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;mso-hide:all;">${escEmail(draft.previewText)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAPER}" style="background-color:${PAPER};">
<tr><td align="center" style="padding:24px 12px;">
${renderEmailContent(draft)}
<!-- Kit adds the unsubscribe link and the sender's postal address below this content. -->
</td></tr>
</table>
</body>
</html>
`;
