/**
 * The daily Threat Brief that goes to Kit after the owner's approval. video-studio's approve step
 * (scripts/daily/lib/approve.ts -> postapproval.ts) calls `cli.ts --input <post-input.json> --out <dir> [--dry-run]`.
 *
 * It is built ONLY from that approved PostInput: the text the approval packet showed under "Threat Brief email" (the
 * title, what we know with each fact's sources, our analysis, Zoo's One Fix, the corrections, also on the radar and
 * the sources), in the packet's order (postapproval.ts buildThreatBrief). Nothing comes from the radar file or from
 * anywhere else, so the email cannot carry an incident, a figure, a status or an explanation the owner did not review.
 *
 * On top of the news gate the daily already ran, every field is checked again with the hub's rules (safety.ts), and
 * then the rendered body as a whole. A third-party headline is quoted only when it passes; otherwise its source is
 * linked by the publisher's name. An unsafe "also on the radar" name is left out with a note. An unsafe fact,
 * analysis line, fix, correction or title blocks the brief: nothing is written and no draft is made.
 */
import {escEmail, mdText} from '../newsletter/render.ts';
import {isYoutubeId} from '../newsletter/publish-kit.ts';
import {dateLabel} from './brief.ts';
import {bodyRules, htmlSafety, htmlToText, markdownLinks, markdownToText} from './lint.ts';
import {a, button, developingPill, emailCard, emailDocument, FONT, H2, ITEM, LIST, mdLink, MUTED, P, PAPER, row, SHOW_LINK_PENDING, SLATE, TEAL, TEXT, yaml} from './render.ts';
import {extendAllow, isSafeQuote, quoteLine, scanText, type Finding, type Level, type NameAllow, type Rule} from './safety.ts';

// ---------------------------------------------------------------------------------------------
// The daily's PostInput (video-studio scripts/daily/lib/postapproval.ts), read strictly

export type SourceRef = {publisher: string; url: string};
export type RadarMention = {name: string; status: 'confirmed' | 'developing'; coverage: SourceRef[]};

export type PostInput = {
	slug: string;
	date: string;
	title: string;
	shortTitle: string;
	developing: boolean;
	summary: string;
	whatWeKnow: {text: string; sources: SourceRef[]}[];
	analysis: string[];
	oneFix: string | null;
	sources: {publisher: string; title: string; url: string}[];
	corrections: string[];
	youtubeId: string | null;
	alsoOnRadar: RadarMention[];
	showName: string;
	displayName: string;
	/** The subject and preview the approve step computed with the packet's own function. */
	email: {subject: string; preview: string} | null;
};

/** More than the daily ever writes (5 facts, 4 radar mentions): an input over these is not the daily's. */
const MAX = {facts: 8, analysis: 6, sources: 12, corrections: 10, radar: 8, coverage: 4, text: 1200} as const;
/** The packet shows the first 4 radar mentions (postapproval.ts: alsoOnRadar.slice(0, 4)). */
const RADAR_SHOWN = 4;
export const DEFAULT_SHOW_NAME = 'The Zoo & Badger Show';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
// eslint-disable-next-line no-control-regex
const clean = (value: unknown): string => (typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim() : '');
const isHttps = (url: string): boolean => {
	try {
		const u = new URL(url);
		return u.protocol === 'https:' && !u.username && !u.password;
	} catch {
		return false;
	}
};
const validDate = (date: string): boolean => {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
	const d = new Date(`${date}T12:00:00Z`);
	return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === date; // rejects 2026-13-40 and 2026-02-30
};

/** Reads the daily's PostInput. Core fields must be right (errors); malformed optional entries are dropped (warnings). */
export const checkPostInput = (raw: unknown): {input: PostInput | null; errors: string[]; warnings: string[]} => {
	if (!isRecord(raw)) return {input: null, errors: ['the daily input must be a JSON object'], warnings: []};
	const errors: string[] = [];
	const warnings: string[] = [];
	const slug = clean(raw.slug);
	const date = clean(raw.date);
	const title = clean(raw.title);
	const youtubeId = clean(raw.youtubeId);
	if (!/^[A-Za-z0-9_-]{1,80}$/.test(slug)) errors.push('"slug" must be 1-80 characters: A-Z, a-z, 0-9, "_" or "-"');
	if (!validDate(date)) errors.push('"date" must be a YYYY-MM-DD date');
	if (!title || title.length > 300) errors.push('"title" must be 1-300 characters');
	if (typeof raw.developing !== 'boolean') errors.push('"developing" must be true or false');
	if (youtubeId && !isYoutubeId(youtubeId)) errors.push('"youtubeId" must be null or an 11-character YouTube id');
	const list = (key: string, max: number): unknown[] => {
		const value = raw[key];
		if (value === undefined || value === null) return [];
		if (!Array.isArray(value)) {
			errors.push(`"${key}" must be a list`);
			return [];
		}
		if (value.length > max) errors.push(`"${key}" has ${value.length} entries; the daily writes at most ${max}`);
		return value.slice(0, max);
	};
	const textOf = (value: unknown, where: string): string => {
		const t = clean(value);
		if (t.length > MAX.text) errors.push(`${where} is longer than ${MAX.text} characters`);
		return t;
	};
	const refs = (value: unknown, where: string): SourceRef[] => {
		const out: SourceRef[] = [];
		for (const [i, r] of (Array.isArray(value) ? value : []).slice(0, MAX.coverage).entries()) {
			const publisher = clean(isRecord(r) ? r.publisher : '');
			const url = clean(isRecord(r) ? r.url : '');
			if (!publisher) {
				warnings.push(`${where} source ${i + 1} has no publisher and is left out`);
				continue;
			}
			if (url && !isHttps(url)) warnings.push(`${where}: ${publisher}'s link is not https, so it is shown without a link`);
			out.push({publisher, url: isHttps(url) ? new URL(url).href : ''});
		}
		return out;
	};

	const whatWeKnow: PostInput['whatWeKnow'] = [];
	for (const [i, item] of list('whatWeKnow', MAX.facts).entries()) {
		const where = `whatWeKnow[${i}]`;
		const text = textOf(isRecord(item) ? item.text : '', where);
		const sources = refs(isRecord(item) ? item.sources : [], where);
		if (!text) errors.push(`${where} has no text`);
		else if (sources.length === 0) errors.push(`${where} names no source: every fact is attributed`);
		else whatWeKnow.push({text, sources});
	}
	const strings = (key: string, max: number): string[] => list(key, max).map((v, i) => textOf(v, `${key}[${i}]`)).filter(Boolean);
	const sources: PostInput['sources'] = [];
	for (const [i, s] of list('sources', MAX.sources).entries()) {
		const publisher = clean(isRecord(s) ? s.publisher : '');
		const url = clean(isRecord(s) ? s.url : '');
		if (!publisher || !isHttps(url)) {
			warnings.push(`sources[${i}] needs a publisher and an https link; left out`);
			continue;
		}
		if (!sources.some((x) => x.url === new URL(url).href)) sources.push({publisher, title: clean(isRecord(s) ? s.title : '').slice(0, 300), url: new URL(url).href});
	}
	const alsoOnRadar: RadarMention[] = [];
	for (const [i, m] of list('alsoOnRadar', MAX.radar).entries()) {
		const name = clean(isRecord(m) ? m.name : '');
		const status = isRecord(m) ? m.status : null;
		const coverage = refs(isRecord(m) ? m.coverage : [], `alsoOnRadar[${i}]`).filter((c) => c.url);
		if (!name || coverage.length === 0) {
			warnings.push(`alsoOnRadar[${i}] needs a name and at least one https link; left out`);
			continue;
		}
		if (status !== 'confirmed' && status !== 'developing') warnings.push(`alsoOnRadar[${i}] (${name}) has an unknown status ${JSON.stringify(status ?? null)}: shown as developing`);
		alsoOnRadar.push({name, status: status === 'confirmed' ? 'confirmed' : 'developing', coverage});
	}
	const email = isRecord(raw.email) ? {subject: clean(raw.email.subject).slice(0, 200), preview: clean(raw.email.preview).slice(0, 300)} : null;
	const summary = textOf(raw.summary, 'summary');
	const analysis = strings('analysis', MAX.analysis);
	const oneFix = textOf(raw.oneFix, 'oneFix') || null;
	const corrections = strings('corrections', MAX.corrections);
	if (errors.length > 0) return {input: null, errors, warnings};
	return {
		input: {
			slug,
			date,
			title,
			shortTitle: clean(raw.shortTitle) || title,
			developing: raw.developing === true,
			summary,
			whatWeKnow,
			analysis,
			oneFix,
			sources,
			corrections,
			youtubeId: youtubeId || null,
			alsoOnRadar,
			showName: clean(raw.showName) || DEFAULT_SHOW_NAME,
			displayName: clean(raw.displayName) || clean(raw.showName) || DEFAULT_SHOW_NAME,
			email: email && (email.subject || email.preview) ? email : null,
		},
		errors,
		warnings,
	};
};

// ---------------------------------------------------------------------------------------------
// The brief

export type DailyBrief = {
	slug: string;
	date: string;
	dateLabel: string;
	subject: string;
	preview: string;
	showName: string;
	title: string;
	developing: boolean;
	facts: {text: string; sources: {publisher: string; url: string | null}[]}[];
	analysis: string[];
	oneFix: string | null;
	watchUrl: string | null;
	corrections: string[];
	alsoOnRadar: RadarMention[];
	sources: {text: string; url: string}[];
	footer: string[];
	/** The approved input it was built from. */
	input: {file: string | null; sha256: string};
	generatedAt: string;
};

export const DEVELOPING_BANNER = 'DEVELOPING STORY: details may change. Corrections will be pinned under the video.';
export const NO_FACTS = 'No approved facts were passed on for this email.';

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`);
const firstSentence = (text: string): string => (text.split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/)[0] ?? '').trim();

/** A source line: "Publisher: “headline”" when the headline is safe, the label as it is when it names its publisher, else the publisher. */
const sourceText = (publisher: string, title: string, allow: NameAllow): string => {
	const escaped = publisher.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const headline = title.replace(new RegExp(`\\s*\\(${escaped}\\)\\s*$`, 'i'), '').trim();
	if (!headline) return publisher;
	if (headline.toLowerCase().startsWith(publisher.toLowerCase()) && scanText(headline, {where: 'source', allow}).every((f) => f.level !== 'error')) return headline;
	return isSafeQuote(headline, publisher, allow) ? quoteLine(publisher, headline) : publisher;
};

export type DailyBuild = {brief: DailyBrief; notes: string[]; allow: NameAllow};

export const buildDailyBrief = (input: PostInput, options: {allow: NameAllow; now: Date; inputFile?: string | null; inputSha256: string}): DailyBuild => {
	const notes: string[] = [];
	const publishers = [...input.whatWeKnow.flatMap((f) => f.sources), ...input.sources, ...input.alsoOnRadar.flatMap((m) => m.coverage)].map((s) => s.publisher);
	const allow = extendAllow(options.allow, [...publishers, input.showName, input.displayName]);
	const computedSubject = clip(`Threat Brief, ${dateLabel(input.date, false)}: ${input.developing ? 'DEVELOPING: ' : ''}${input.title}`, 100);
	const subject = input.email?.subject || computedSubject;
	if (input.email?.subject && input.email.subject !== computedSubject) notes.push(`the subject is the approve step's ("${input.email.subject}")`);
	const alsoOnRadar: RadarMention[] = [];
	for (const m of input.alsoOnRadar.slice(0, RADAR_SHOWN)) {
		const problems = scanText(m.name, {where: 'also on the radar', allow}).filter((f) => f.level === 'error');
		if (problems.length > 0) notes.push(`also on the radar: "${m.name}" breaks a safety rule (${problems.map((f) => `${f.rule}/${f.code}`).join(', ')}) and is left out`);
		else alsoOnRadar.push(m);
	}
	const sources = input.sources.map((s) => ({text: sourceText(s.publisher, s.title, allow), url: s.url}));
	for (const [i, s] of sources.entries()) if (s.text === input.sources[i]?.publisher && input.sources[i]?.title) notes.push(`sources: the headline from ${s.text} is not quoted (it breaks a safety rule); only the publisher is shown`);
	if (!input.oneFix) notes.push("the input has no One Fix, so the email has no Zoo's One Fix section");
	const brief: DailyBrief = {
		slug: input.slug,
		date: input.date,
		dateLabel: dateLabel(input.date),
		subject,
		preview: input.email?.preview || clip(firstSentence(input.summary) || input.title, 140),
		showName: input.showName,
		title: input.title,
		developing: input.developing,
		facts: input.whatWeKnow.map((f) => ({text: f.text, sources: f.sources.map((s) => ({publisher: s.publisher, url: s.url || null}))})),
		analysis: input.analysis,
		oneFix: input.oneFix,
		watchUrl: input.youtubeId ? `https://youtu.be/${input.youtubeId}` : null,
		corrections: input.corrections,
		alsoOnRadar,
		sources,
		footer: [
			`You're getting the Threat Brief because you subscribed to ${input.displayName}. Every email has an unsubscribe link at the bottom.`,
			`We never DM you first, and we never ask for a seed phrase, a private key or a wallet connection. Anyone who does is an impersonator.`,
			'News and education only. Not financial advice. Every fact links to the source that reported it.',
		],
		input: {file: options.inputFile ?? null, sha256: options.inputSha256},
		generatedAt: options.now.toISOString(),
	};
	return {brief, notes, allow};
};

// ---------------------------------------------------------------------------------------------
// Render

const factMd = (f: DailyBrief['facts'][number]): string => `- ${mdText(f.text)} (${f.sources.map((s) => (s.url ? mdLink(s.publisher, s.url) : mdText(s.publisher))).join(', ')})`;

export const renderDailyMarkdown = (b: DailyBrief): string => {
	const out: string[] = [
		'---',
		`subject: ${yaml(b.subject)}`,
		`preview: ${yaml(b.preview)}`,
		`date: ${yaml(b.date)}`,
		`episode: ${yaml(b.slug)}`,
		`input: ${yaml(`the approved daily PostInput${b.input.file ? ` ${b.input.file}` : ''}, sha256 ${b.input.sha256}`)}`,
		`generated: ${yaml(b.generatedAt)}`,
		'---',
		'',
		`# ${mdText(`${b.developing ? 'DEVELOPING: ' : ''}${b.title}`)}`,
		'',
		mdText(`${b.showName} · Threat Brief · ${b.dateLabel}`),
		'',
	];
	if (b.developing) out.push(`**${mdText(DEVELOPING_BANNER)}**`, '');
	out.push('## What we know', '');
	if (b.facts.length === 0) out.push(mdText(NO_FACTS));
	for (const f of b.facts) out.push(factMd(f));
	out.push('');
	if (b.analysis.length > 0) out.push('## Our analysis', '', ...b.analysis.flatMap((x) => [mdText(x), '']));
	if (b.oneFix) out.push("## Zoo's One Fix", '', mdText(b.oneFix), '');
	out.push('## Watch', '', b.watchUrl ? `**${mdLink('Watch the Short', b.watchUrl)}**` : `**${mdText(SHOW_LINK_PENDING)}**`, '');
	if (b.corrections.length > 0) out.push('## Corrections', '', ...b.corrections.map((c) => `- ${mdText(c)}`), '');
	if (b.alsoOnRadar.length > 0) {
		out.push('## Also on the radar', '', mdText('Not covered today. Follow the links for the details.'), '');
		for (const m of b.alsoOnRadar) out.push(`- ${mdText(m.name)} (${m.status}): ${m.coverage.map((c) => mdLink(c.publisher, c.url)).join(', ')}`);
		out.push('');
	}
	if (b.sources.length > 0) out.push('## Sources', '', ...b.sources.map((s) => `- ${mdLink(s.text, s.url)}`), '');
	out.push('---', '');
	for (const line of b.footer) out.push(mdText(line), '');
	out.push("<!-- Kit adds the unsubscribe link and the sender's postal address below this. -->", '');
	return out.join('\n');
};

const boxed = (border: string, inner: string): string =>
	`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:12px 14px;background-color:${PAPER};border-left:4px solid ${border};">\n${inner}\n</td></tr></table>`;

/** The email body (card and footer): what goes into Kit as the broadcast content. */
export const renderDailyEmailContent = (b: DailyBrief): string => {
	const header = [
		`<p style="margin:0 0 14px;font-family:${FONT};font-size:13px;line-height:1.4;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};">${escEmail(b.showName)} · Threat Brief · ${escEmail(b.dateLabel)}</p>`,
		`<h1 style="margin:0 0 12px;${TEXT}font-size:24px;line-height:1.3;font-weight:700;">${b.developing ? developingPill() : ''}${escEmail(b.title)}</h1>`,
	];
	if (b.developing) header.push(`<p style="margin:0 0 12px;padding:8px 12px;border-radius:6px;background-color:${SLATE};color:#F4F6F8;font-family:${FONT};font-size:15px;line-height:1.5;"><strong>DEVELOPING STORY:</strong> details may change. Corrections will be pinned under the video.</p>`);
	const rows = [row(header.join('\n'), '28px 28px 8px')];
	const facts = b.facts.length
		? `<ul style="${LIST}">\n${b.facts.map((f) => `<li style="${ITEM}">${escEmail(f.text)} <span style="color:${MUTED};">(${f.sources.map((s) => (s.url ? a(s.url, s.publisher) : escEmail(s.publisher))).join(', ')})</span></li>`).join('\n')}\n</ul>`
		: `<p style="${P}">${escEmail(NO_FACTS)}</p>`;
	rows.push(row(`<h2 style="${H2}">What we know</h2>\n${facts}`));
	if (b.analysis.length > 0) rows.push(row(`<h2 style="${H2}">Our analysis</h2>\n${b.analysis.map((x) => `<p style="${P}">${escEmail(x)}</p>`).join('\n')}`));
	if (b.oneFix) rows.push(row(boxed(TEAL, `<p style="margin:0 0 4px;${TEXT}font-size:15px;line-height:1.4;font-weight:700;">Zoo's One Fix</p>\n<p style="margin:0;${TEXT}font-size:16px;line-height:1.5;">${escEmail(b.oneFix)}</p>`)));
	rows.push(row(`<h2 style="${H2}">Watch</h2>\n${b.watchUrl ? button(b.watchUrl, 'Watch the Short') : `<p style="${P}"><strong>${escEmail(SHOW_LINK_PENDING)}</strong></p>`}`));
	if (b.corrections.length > 0) {
		rows.push(row(boxed(SLATE, `<p style="margin:0 0 6px;${TEXT}font-size:15px;line-height:1.4;font-weight:700;">Corrections</p>\n<ul style="${LIST}">\n${b.corrections.map((c) => `<li style="${ITEM}">${escEmail(c)}</li>`).join('\n')}\n</ul>`)));
	}
	if (b.alsoOnRadar.length > 0) {
		const items = b.alsoOnRadar.map((m) => `<li style="${ITEM}">${escEmail(m.name)} <em>(${escEmail(m.status)})</em>: ${m.coverage.map((c) => a(c.url, c.publisher)).join(', ')}</li>`);
		rows.push(row(`<h2 style="${H2}">Also on the radar</h2>\n<p style="margin:0 0 8px;font-family:${FONT};font-size:14px;line-height:1.5;color:${MUTED};">Not covered today. Follow the links for the details.</p>\n<ul style="${LIST}">\n${items.join('\n')}\n</ul>`));
	}
	if (b.sources.length > 0) rows.push(row(`<h2 style="${H2}">Sources</h2>\n<ul style="${LIST}">\n${b.sources.map((s) => `<li style="${ITEM}">${a(s.url, s.text)}</li>`).join('\n')}\n</ul>`, '8px 28px 28px'));
	return emailCard(rows, b.footer);
};

export const renderDailyEmailHtml = (b: DailyBrief): string => emailDocument(b.subject, b.preview, renderDailyEmailContent(b));

// ---------------------------------------------------------------------------------------------
// Lint

const issue = (rule: Rule, code: string, level: Level, where: string, message: string, match = ''): Finding => ({rule, code, level, where, message, match});

/** Every field through the text rules, plus the structure. `final`: about to go to Kit (no placeholder, at least one fact). */
export const lintDailyBrief = (b: DailyBrief, allow: NameAllow, options: {final?: boolean} = {}): Finding[] => {
	const final = options.final === true;
	const out: Finding[] = [];
	const scan = (text: string, where: string, trusted = false): void => void out.push(...scanText(text, {where, allow, trusted}));
	scan(b.subject, 'subject');
	scan(b.preview, 'preview');
	scan(b.title, 'title');
	b.facts.forEach((f, i) => {
		scan(f.text, `what we know ${i + 1}`);
		if (f.sources.length === 0) out.push(issue('attribution', 'no-sources', 'error', `what we know ${i + 1}`, 'every fact names its source'));
	});
	b.analysis.forEach((x, i) => scan(x, `our analysis ${i + 1}`));
	if (b.oneFix) scan(b.oneFix, "Zoo's One Fix");
	b.corrections.forEach((c, i) => scan(c, `corrections ${i + 1}`));
	b.alsoOnRadar.forEach((m) => scan(`${m.name} (${m.status})`, 'also on the radar'));
	b.sources.forEach((s, i) => scan(s.text, `sources ${i + 1}`));
	b.footer.forEach((line, i) => scan(line, `footer ${i + 1}`, true));
	const links = [...b.facts.flatMap((f) => f.sources.map((s) => s.url)), ...b.alsoOnRadar.flatMap((m) => m.coverage.map((c) => c.url)), ...b.sources.map((s) => s.url)];
	for (const url of links) if (url !== null && !url.startsWith('https://')) out.push(issue('links', 'not-https', 'error', 'brief', 'every link must be https', url));
	if (b.developing && !/\bDEVELOPING\b/.test(b.subject)) out.push(issue('developing', 'label', 'error', 'subject', 'a developing story says DEVELOPING in the subject'));
	if (b.facts.length === 0) out.push(issue('structure', 'no-facts', final ? 'error' : 'warning', 'what we know', 'the approved input passed on no facts: an email with nothing in "What we know" is not sent'));
	if (!b.watchUrl) out.push(issue('placeholder', 'show-link-pending', final ? 'error' : 'warning', 'watch', 'no YouTube id yet: the daily passes it on after the manual upload is recorded'));
	else if (!/^https:\/\/(?:youtu\.be|www\.youtube\.com)\//.test(b.watchUrl)) out.push(issue('links', 'show-link', 'error', 'watch', 'the show link must be a YouTube https link'));
	return out;
};

/** The written Markdown and HTML: email-safe HTML, https links, the labels, and the text rules over the whole body. */
export const lintDailyRendered = (md: string, html: string, b: DailyBrief, options: {final?: boolean; allow?: NameAllow} = {}): Finding[] => {
	const final = options.final === true;
	const out: Finding[] = [...htmlSafety(html, 'email HTML'), ...markdownLinks(md, 'Markdown')];
	out.push(...bodyRules(markdownToText(md), 'Markdown body', options.allow, final), ...bodyRules(htmlToText(html), 'email body', options.allow, final));
	if (b.developing && !md.includes(mdText(DEVELOPING_BANNER))) out.push(issue('developing', 'label-missing', 'error', 'Markdown', 'a developing story carries the DEVELOPING banner'));
	if (b.developing && !/>DEVELOPING<\/span>/.test(html)) out.push(issue('developing', 'label-missing', 'error', 'email HTML', 'a developing story carries the DEVELOPING label'));
	if (!/You['’]re getting/.test(htmlToText(html))) out.push(issue('structure', 'no-why', 'error', 'email HTML', 'the footer must say why the reader gets this email'));
	if (final && (md.includes(SHOW_LINK_PENDING) || html.includes(SHOW_LINK_PENDING))) out.push(issue('placeholder', 'show-link-pending', 'error', 'brief', 'the show link is still pending'));
	return out;
};
