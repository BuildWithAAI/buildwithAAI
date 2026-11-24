/**
 * Renders a Threat Brief as Markdown (for review and editing; front matter carries the subject and preview) and as
 * email-safe HTML: a 600 px table layout with inline styles only, no scripts, <style> blocks, images, web fonts or
 * tracking pixels. Escaping reuses the newsletter's helpers, which also encode "{" and "}" so Kit's Liquid templating
 * can never run anything inside the content. Kit appends the unsubscribe link and the postal address.
 *
 * Colours follow the newsletter: near-black #0B0C0F on white, muted #4A5260 (7.3:1), teal #29B8AD as an accent
 * only, and the DEVELOPING pill as off-white on slate #161A21 (15:1).
 */
import {escEmail, mdText, mdUrl} from '../newsletter/render.ts';
import type {BriefIncident, ThreatBrief} from './brief.ts';

export const SHOW_LINK_PENDING = '[show link: added after the video is public]';

export const mdLink = (text: string, url: string): string => `[${mdText(text)}](${mdUrl(url)})`;
export const yaml = (value: string): string => JSON.stringify(value);

const showLine = (brief: ThreatBrief): {title: string; url: string | null} | null =>
	brief.show ? {title: `${brief.show.developing ? 'DEVELOPING: ' : ''}${brief.show.title}`, url: brief.show.url} : null;

const incidentMarkdown = (inc: BriefIncident): string[] => {
	const out = [`### ${inc.label} · ${mdText(inc.name)}`, ''];
	out.push(`- **Status:** ${mdText(inc.statusLine)}`);
	const when = [inc.date ? `**${mdText(inc.date.label)}:** ${inc.date.day} (UTC)` : '', inc.chains ? `**Chains (per ${mdText(inc.chains.by)}):** ${mdText(inc.chains.list.join(', '))}` : '']
		.filter(Boolean)
		.join(' · ');
	if (when) out.push(`- ${when}`);
	if (inc.losses.length > 0) {
		out.push(`- **Reported loss:** ${inc.losses.map((l) => `${mdLink(l.amount, l.url)} (reported by ${mdText(l.publisher)})`).join(' · ')}.${inc.lossNote ? ` ${mdText(inc.lossNote)}` : ''}`);
	} else out.push('- **Reported loss:** no figure in our sources yet.');
	const how = inc.how.parts.map((p) => (p.url ? mdLink(p.text, p.url) : mdText(p.text))).join(' ');
	out.push(`- **How it worked:** ${how}${inc.how.concept ? ` ${mdText(inc.how.concept)}` : ''}`);
	out.push('- **Sources:**');
	for (const s of inc.sources) out.push(`  - ${mdLink(s.text, s.url)}`);
	out.push('');
	return out;
};

export const renderMarkdown = (brief: ThreatBrief): string => {
	const out: string[] = [
		'---',
		`subject: ${yaml(brief.subject)}`,
		`preview: ${yaml(brief.preview)}`,
		`date: ${yaml(brief.date)}`,
		`radar: ${yaml(`${brief.radar.file ?? 'radar'} (${brief.radar.mode}, generated ${brief.radar.generatedUtc || 'unknown'})`)}`,
		`generated: ${yaml(brief.generatedAt)}`,
		'---',
		'',
		`# Threat Brief: ${mdText(brief.dateLabel)}`,
		'',
		mdText(brief.intro),
		'',
	];
	if (brief.corrections.length > 0) {
		out.push('## Corrections and updates', '');
		for (const c of brief.corrections) out.push(`- ${mdText(c)}`);
		out.push('');
	}
	if (brief.incidents.length > 0) {
		out.push("## Today's incidents", '');
		for (const inc of brief.incidents) out.push(...incidentMarkdown(inc));
	}
	const show = showLine(brief);
	out.push("## Today's episode", '');
	if (!show) out.push('No new episode today.', '');
	else if (show.url) out.push(`**${mdLink(`Watch: ${show.title}`, show.url)}**`, '');
	else out.push(`**${mdText(`Watch: ${show.title}`)}** ${mdText(SHOW_LINK_PENDING)}`, '');
	out.push("## Zoo's One Fix", '', mdText(brief.fix.text), '', '---', '');
	for (const line of brief.footer) out.push(mdText(line), '');
	out.push("<!-- Kit adds the unsubscribe link and the sender's postal address below this. -->", '');
	return out.join('\n');
};

// ---------------------------------------------------------------------------------------------
// Email HTML

export const FONT = "system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
export const INK = '#0B0C0F';
export const SLATE = '#161A21';
export const PAPER = '#F4F6F8';
const OFF_WHITE = '#F4F6F8';
export const MUTED = '#4A5260';
export const TEAL = '#29B8AD';
const LINE = '#D9DEE5';

export const TEXT = `font-family:${FONT};color:${INK};`;
const LINK = `color:${INK};text-decoration:underline;text-decoration-color:${TEAL};`;
export const P = `margin:0 0 12px;${TEXT}font-size:16px;line-height:1.55;`;
const SMALL = `margin:0 0 8px;font-family:${FONT};font-size:14px;line-height:1.5;color:${MUTED};`;
export const H2 = `margin:8px 0 12px;${TEXT}font-size:19px;line-height:1.3;font-weight:700;`;
export const LIST = 'margin:0 0 12px;padding:0 0 0 20px;';
export const ITEM = `margin:0 0 6px;${TEXT}font-size:15px;line-height:1.5;`;

/** A link; the URL and text are escaped (the text also encodes Kit's Liquid braces). */
export const a = (url: string, text: string, style = LINK): string => `<a href="${escEmail(url)}" style="${style}">${escEmail(text)}</a>`;
export const row = (inner: string, padding = '8px 28px'): string => `<tr><td style="padding:${padding};">\n${inner}\n</td></tr>`;
const label = (text: string): string => `<strong>${escEmail(text)}</strong>`;

/** The DEVELOPING pill: off-white on slate (15:1). */
export const developingPill = (): string =>
	`<span style="display:inline-block;margin:0 6px 0 0;padding:2px 8px;border-radius:999px;background-color:${SLATE};color:${OFF_WHITE};font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:.06em;">DEVELOPING</span>`;

const pill = (inc: BriefIncident): string =>
	inc.label === 'DEVELOPING'
		? developingPill()
		: `<span style="display:inline-block;margin:0 6px 0 0;padding:1px 8px;border:1px solid ${MUTED};border-radius:999px;color:${MUTED};font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:.06em;">CONFIRMED</span>`;

export const button = (url: string, text: string): string =>
	`<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 12px;"><tr><td bgcolor="${TEAL}" style="border-radius:8px;background-color:${TEAL};">` +
	a(url, text, `display:inline-block;padding:14px 22px;font-family:${FONT};font-size:16px;font-weight:700;line-height:1.2;color:${INK};text-decoration:none;border-radius:8px;`) +
	'</td></tr></table>';

const incidentHtml = (inc: BriefIncident): string => {
	const lines: string[] = [];
	lines.push(`<p style="margin:0 0 8px;${TEXT}font-size:18px;line-height:1.35;font-weight:700;">${pill(inc)}${escEmail(inc.name)}</p>`);
	lines.push(`<p style="${P}">${label('Status:')} ${escEmail(inc.statusLine)}</p>`);
	const when = [inc.date ? `${label(`${inc.date.label}:`)} ${escEmail(inc.date.day)} (UTC)` : '', inc.chains ? `${label(`Chains (per ${inc.chains.by}):`)} ${escEmail(inc.chains.list.join(', '))}` : '']
		.filter(Boolean)
		.join(' · ');
	if (when) lines.push(`<p style="${P}">${when}</p>`);
	if (inc.losses.length > 0) {
		const figures = inc.losses.map((l) => `${a(l.url, l.amount)} (reported by ${escEmail(l.publisher)})`).join(' · ');
		lines.push(`<p style="${P}">${label('Reported loss:')} ${figures}.${inc.lossNote ? ` <span style="color:${MUTED};">${escEmail(inc.lossNote)}</span>` : ''}</p>`);
	} else lines.push(`<p style="${P}">${label('Reported loss:')} no figure in our sources yet.</p>`);
	const how = inc.how.parts.map((p) => (p.url ? a(p.url, p.text) : escEmail(p.text))).join(' ');
	lines.push(`<p style="${P}">${label('How it worked:')} ${how}${inc.how.concept ? ` ${escEmail(inc.how.concept)}` : ''}</p>`);
	lines.push(`<p style="margin:0 0 4px;${TEXT}font-size:15px;line-height:1.5;">${label('Sources:')}</p>`);
	lines.push(`<ul style="${LIST}">\n${inc.sources.map((s) => `<li style="${ITEM}">${a(s.url, s.text)}</li>`).join('\n')}\n</ul>`);
	return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;border:1px solid ${LINE};border-radius:10px;"><tr><td style="padding:16px 18px 8px;">\n${lines.join('\n')}\n</td></tr></table>`;
};

/** The email body (the 600 px card and the footer under it): what goes into Kit as the broadcast content. */
export const renderEmailContent = (brief: ThreatBrief): string => {
	const rows: string[] = [
		row(
			[
				`<p style="margin:0 0 14px;font-family:${FONT};font-size:13px;line-height:1.4;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};">${escEmail(brief.brandName)} · Threat Brief</p>`,
				`<h1 style="margin:0 0 12px;${TEXT}font-size:26px;line-height:1.25;font-weight:700;">Threat Brief: ${escEmail(brief.dateLabel)}</h1>`,
				`<p style="${P}">${escEmail(brief.intro)}</p>`,
			].join('\n'),
			'28px 28px 8px',
		),
	];
	if (brief.corrections.length > 0) {
		rows.push(
			row(
				`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:12px 14px;background-color:${PAPER};border-left:4px solid ${SLATE};">
<p style="margin:0 0 6px;${TEXT}font-size:15px;line-height:1.4;font-weight:700;">Corrections and updates</p>
<ul style="${LIST}">\n${brief.corrections.map((c) => `<li style="${ITEM}">${escEmail(c)}</li>`).join('\n')}\n</ul>
</td></tr></table>`,
			),
		);
	}
	if (brief.incidents.length > 0) rows.push(row(`<h2 style="${H2}">Today's incidents</h2>\n${brief.incidents.map(incidentHtml).join('\n')}`));
	const show = showLine(brief);
	rows.push(
		row(
			[
				`<h2 style="${H2}">Today's episode</h2>`,
				!show
					? `<p style="${P}">No new episode today.</p>`
					: show.url
						? `<p style="${P}">${escEmail(show.title)}</p>\n${button(show.url, 'Watch on YouTube')}`
						: `<p style="${P}">${escEmail(show.title)}</p>\n<p style="${P}"><strong>${escEmail(SHOW_LINK_PENDING)}</strong></p>`,
			].join('\n'),
		),
	);
	rows.push(
		row(
			`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:12px 14px;background-color:${PAPER};border-left:4px solid ${TEAL};">
<p style="margin:0 0 4px;${TEXT}font-size:15px;line-height:1.4;font-weight:700;">Zoo's One Fix</p>
<p style="margin:0;${TEXT}font-size:16px;line-height:1.5;">${escEmail(brief.fix.text)}</p>
</td></tr></table>`,
			'8px 28px 28px',
		),
	);
	return emailCard(rows, brief.footer);
};

/** The 600 px card with its rows, and the footer lines under it: the broadcast content Kit wraps in its template. */
export const emailCard = (rows: readonly string[], footerLines: readonly string[]): string => {
	const footer = footerLines.map((line) => `<p style="${SMALL}">${escEmail(line)}</p>`);
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

/** A complete email-safe HTML document around broadcast content, for previewing in a browser. */
export const emailDocument = (subject: string, preview: string, content: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escEmail(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${PAPER};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;mso-hide:all;">${escEmail(preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAPER}" style="background-color:${PAPER};">
<tr><td align="center" style="padding:24px 12px;">
${content}
<!-- Kit adds the unsubscribe link and the sender's postal address below this content. -->
</td></tr>
</table>
</body>
</html>
`;

/** A complete email-safe HTML document, for previewing in a browser or pasting into an email tool. */
export const renderEmailHtml = (brief: ThreatBrief): string => emailDocument(brief.subject, brief.preview, renderEmailContent(brief));
