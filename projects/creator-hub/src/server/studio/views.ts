/**
 * Studio page templates. Every dynamic value goes through html`` (auto-escaped). The only raw
 * markup is constant text written in this file and the stylesheet.
 */
import {html, raw, type SafeHtml} from './html.ts';
import {CUSTOM_PACKAGE_ID, type PortfolioItem, type StudioConfig, type StudioPackage} from './config.ts';
import {FEATURES, SAFETY_NOTE, STEPS, TERMS} from './copy.ts';
import {STUDIO_CSS_HREF} from './styles.ts';
import {
	FIELDS,
	FORM_NAMES,
	HONEYPOT_FIELD,
	LIMITS,
	type OrderField,
	type OrderFieldErrors,
	type OrderFormValues,
} from './validate.ts';

export const STUDIO_PATH = '/studio';
export const THANKS_PATH = '/studio/thanks';

export type PageMeta = {brandName: string; contactEmail: string; publicBaseUrl: string; year: string};

export type StudioPageInput = {
	/** 'full' is the offer page; 'form' is the request form alone, shown again after a failed send. */
	mode: 'full' | 'form';
	meta: PageMeta;
	config: StudioConfig;
	values: OrderFormValues;
	errors: OrderFieldErrors;
	/** A problem that is not about one field (rate limit, storage failure). */
	notice?: string;
	/** Today's date (YYYY-MM-DD) for the deadline picker's minimum. */
	today: string;
};

const DESCRIPTION =
	'Animated 2D explainer videos for crypto and AI projects: research-backed scripts, original characters, captions and Shorts cuts. No hype and no investment promises.';

const mailLink = (meta: PageMeta): SafeHtml | null =>
	meta.contactEmail ? html`<a href="mailto:${meta.contactEmail}">${meta.contactEmail}</a>` : null;

type LayoutInput = {
	meta: PageMeta;
	title: string;
	indexable: boolean;
	nav: Array<[href: string, label: string]>;
	quoteHref: string;
	body: SafeHtml;
};

const layout = ({meta, title, indexable, nav, quoteHref, body}: LayoutInput): string => {
	const canonical = indexable && meta.publicBaseUrl ? `${meta.publicBaseUrl.replace(/\/+$/, '')}${STUDIO_PATH}` : '';
	const mail = mailLink(meta);
	const head = canonical
		? html`<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${DESCRIPTION}">
<meta property="og:url" content="${canonical}">`
		: raw('<meta name="robots" content="noindex">');
	return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#0B0C0F">
<title>${title}</title>
<meta name="description" content="${DESCRIPTION}">
${head}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${STUDIO_CSS_HREF}">
</head>
<body>
<a class="skip" href="#main">Skip to main content</a>
<header class="site"><div class="wrap">
<a class="brand" href="${STUDIO_PATH}">${meta.brandName} <span>Studio</span></a>
<nav aria-label="Studio"><ul>
${nav.map(([href, label]) => html`<li><a href="${href}">${label}</a></li>`)}
<li><a class="btn" href="${quoteHref}">Request a quote</a></li>
</ul></nav>
</div></header>
<main id="main" tabindex="-1">
${body}
</main>
<footer class="site"><div class="wrap">
<nav aria-label="Site"><ul>
<li><a href="/">All links</a></li>
<li><a href="/subscribe">Newsletter</a></li>
<li><a href="/disclosures">Disclosures</a></li>
<li><a href="/privacy">Privacy</a></li>
</ul></nav>
<p><strong>Stay safe:</strong> ${SAFETY_NOTE}${mail ? html` Questions? Email ${mail}.` : ''}</p>
<p>&copy; ${meta.year} ${meta.brandName}</p>
</div></footer>
</body>
</html>
`.html;
};

const formatUsd = (amount: number): string =>
	`${new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
		maximumFractionDigits: 2,
	}).format(amount)} USD`;

export const priceText = (pkg: StudioPackage): string => (pkg.priceUsd === null ? 'Contact for a quote' : formatUsd(pkg.priceUsd));

export const turnaroundText = (pkg: StudioPackage): string =>
	pkg.turnaroundDays === null
		? 'Agreed after the brief'
		: `${pkg.turnaroundDays} ${pkg.turnaroundDays === 1 ? 'day' : 'days'} from an approved brief`;

export const revisionsText = (pkg: StudioPackage): string => {
	if (pkg.revisions === null) return 'Agreed in your quote';
	if (pkg.revisions === 0) return 'None included';
	return `${pkg.revisions} ${pkg.revisions === 1 ? 'round' : 'rounds'} included`;
};

const heroSection = (meta: PageMeta): SafeHtml => html`<section class="wrap hero" aria-labelledby="hero-title">
<p class="eyebrow">Explainer videos for crypto and AI projects</p>
<h1 id="hero-title">Animated explainers that make your product clear, without the hype.</h1>
<p class="lede">We research, script and animate 2D explainer videos in code: original characters, sourced scripts, captions and Shorts cuts. Made by the studio behind the ${meta.brandName} channel, which is about crypto security and avoiding scams.</p>
<p class="actions"><a class="btn" href="#order">Request a quote</a><a class="btn btn-ghost" href="#packages">See packages</a></p>
</section>`;

const featuresSection = (): SafeHtml => html`<section class="wrap" id="what" aria-labelledby="what-title">
<h2 id="what-title">What you get</h2>
<ul class="grid" role="list">
${FEATURES.map((f) => html`<li class="card"><h3>${f.title}</h3><p>${f.text}</p></li>`)}
</ul>
</section>`;

const processSection = (): SafeHtml => html`<section class="wrap" id="process" aria-labelledby="process-title">
<h2 id="process-title">How it works</h2>
<ol class="steps" role="list">
${STEPS.map((s) => html`<li><h3>${s.title}</h3><p>${s.text}</p></li>`)}
</ol>
</section>`;

const packageCard = (pkg: StudioPackage, payLink: string | undefined): SafeHtml => html`<article class="card package" aria-labelledby="pkg-${pkg.id}">
<h3 id="pkg-${pkg.id}">${pkg.name}</h3>
${pkg.summary ? html`<p class="muted">${pkg.summary}</p>` : ''}
<h4>Deliverables</h4>
<ul class="ticks">${pkg.deliverables.map((d) => html`<li>${d}</li>`)}</ul>
<dl class="facts">
<div><dt>Price</dt><dd>${priceText(pkg)}</dd></div>
<div><dt>Turnaround</dt><dd>${turnaroundText(pkg)}</dd></div>
<div><dt>Revisions</dt><dd>${revisionsText(pkg)}</dd></div>
</dl>
<div class="card-actions">
<a class="btn" href="${STUDIO_PATH}?package=${encodeURIComponent(pkg.id)}#order">Request this package<span class="sr-only">: ${pkg.name}</span></a>
${payLink
	? html`<a class="btn btn-ghost" href="${payLink}">Pay online with Stripe<span class="sr-only">: ${pkg.name}</span></a>
<p class="hint">Only pay after we have confirmed your brief and quote by email.</p>`
	: ''}
</div>
</article>`;

const packagesSection = (config: StudioConfig): SafeHtml => {
	const anyPrice = config.packages.some((p) => p.priceUsd !== null);
	return html`<section class="wrap" id="packages" aria-labelledby="packages-title">
<h2 id="packages-title">Packages</h2>
<p class="section-lede">Every project starts with your brief and a written quote that sets scope, timeline and price.${anyPrice ? ' Prices are in US dollars.' : ''}</p>
<div class="grid">
${config.packages.map((p) => packageCard(p, config.stripePaymentLinks?.[p.id]))}
</div>
</section>`;
};

const portfolioItem = (item: PortfolioItem): SafeHtml => html`<li class="card">
<h3><a href="${item.url}">${item.title}</a></h3>
${item.description ? html`<p>${item.description}</p>` : ''}
${item.client ? html`<p class="muted">For ${item.client}</p>` : ''}
</li>`;

const portfolioSection = (config: StudioConfig): SafeHtml | null =>
	config.portfolio.length === 0
		? null
		: html`<section class="wrap" id="work" aria-labelledby="work-title">
<h2 id="work-title">Recent work</h2>
<ul class="grid" role="list">${config.portfolio.map(portfolioItem)}</ul>
</section>`;

const faqSection = (config: StudioConfig): SafeHtml | null =>
	config.faq.length === 0
		? null
		: html`<section class="wrap" id="faq" aria-labelledby="faq-title">
<h2 id="faq-title">Questions</h2>
<div class="faq">
${config.faq.map((f) => html`<details><summary>${f.q}</summary>${f.a.split(/\n{2,}/).map((para) => html`<p>${para}</p>`)}</details>`)}
</div>
</section>`;

const termsSection = (): SafeHtml => html`<section class="wrap" id="terms" aria-labelledby="terms-title">
<h2 id="terms-title">Terms in plain language</h2>
<ol class="terms">
${TERMS.map((t) => html`<li><strong>${t.title}</strong> ${t.text}</li>`)}
</ol>
</section>`;

type FieldSpec = {key: OrderField; label: string; optional?: boolean; hint?: string; error: string | undefined};

/** id, name and ARIA wiring shared by every control. */
const controlAttrs = ({key, hint, error}: FieldSpec): SafeHtml => {
	const describedBy = [hint ? `f-${key}-hint` : '', error ? `f-${key}-error` : ''].filter(Boolean).join(' ');
	return html`id="f-${key}" name="${FORM_NAMES[key]}"${describedBy ? html` aria-describedby="${describedBy}"` : ''}${error ? raw(' aria-invalid="true"') : ''}`;
};

const fieldWrap = (spec: FieldSpec, control: SafeHtml): SafeHtml => html`<div class="field${spec.error ? ' has-error' : ''}">
<label for="f-${spec.key}">${spec.label}${spec.optional ? html` <span class="optional">(optional)</span>` : ''}</label>
${spec.hint ? html`<p class="hint" id="f-${spec.key}-hint">${spec.hint}</p>` : ''}
${spec.error ? html`<p class="field-error" id="f-${spec.key}-error"><span class="sr-only">Error:</span> ${spec.error}</p>` : ''}
${control}
</div>`;

const required = (spec: FieldSpec): SafeHtml => (spec.optional ? raw('') : raw(' required'));

const textInput = (spec: FieldSpec, type: 'text' | 'email' | 'date', value: string, extra: SafeHtml): SafeHtml =>
	fieldWrap(spec, html`<input type="${type}" ${controlAttrs(spec)} value="${value}"${required(spec)} ${extra}>`);

const selectInput = (spec: FieldSpec, value: string, options: Array<{value: string; label: string}>): SafeHtml =>
	fieldWrap(
		spec,
		html`<select ${controlAttrs(spec)}${required(spec)}>${options.map(
			(o) => html`<option value="${o.value}"${o.value === value ? raw(' selected') : ''}>${o.label}</option>`,
		)}</select>`,
	);

const errorSummary = (errors: OrderFieldErrors, notice: string | undefined): SafeHtml | null => {
	const fieldErrors = FIELDS.filter((key) => errors[key]);
	if (fieldErrors.length === 0 && !notice) return null;
	return html`<div class="error-summary" role="alert" aria-labelledby="error-summary-title" tabindex="-1" autofocus>
<h2 id="error-summary-title">There is a problem</h2>
<ul>
${notice ? html`<li>${notice}</li>` : ''}
${fieldErrors.map((key) => html`<li><a href="#f-${key}">${errors[key]}</a></li>`)}
</ul>
</div>`;
};

const orderSection = ({mode, meta, config, values, errors, notice, today}: StudioPageInput): SafeHtml => {
	const mail = mailLink(meta);
	const spec = (key: OrderField, label: string, extra: Omit<FieldSpec, 'key' | 'label' | 'error'> = {}): FieldSpec => ({
		key,
		label,
		error: errors[key],
		...extra,
	});
	const packageOptions = [
		{value: '', label: 'Choose a package'},
		...config.packages.map((p) => ({value: p.id, label: p.name})),
		{value: CUSTOM_PACKAGE_ID, label: 'Not sure yet / something else'},
	];
	const budgetOptions = [{value: '', label: 'Not sure yet'}, ...config.budgetRanges.map((b) => ({value: b, label: b}))];
	const consentSpec = spec('consent', '');
	const messageSpec = spec('message', 'About your project', {
		hint: 'What does your product do, who is the video for, and what should viewers understand by the end? Add links to sources for any claims you want made.',
	});
	const heading = mode === 'form' ? html`<h1 id="order-title">Request a quote</h1>` : html`<h2 id="order-title">Request a quote</h2>`;

	return html`<section class="wrap" id="order" aria-labelledby="order-title">
${heading}
<p class="section-lede">Tell us about your project and we will reply by email${mail ? html` from ${mail}` : ''}. All fields are required unless marked optional.</p>
<div class="order-box">
${errorSummary(errors, notice)}
<form method="post" action="${STUDIO_PATH}" accept-charset="utf-8">
${textInput(spec('name', 'Your name'), 'text', values.name, html`autocomplete="name" maxlength="${LIMITS.name}"`)}
${textInput(
	spec('email', 'Email address', {hint: 'We only use it to reply to this request.'}),
	'email',
	values.email,
	html`autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false" maxlength="${LIMITS.email}"`,
)}
${textInput(spec('company', 'Company or project name', {optional: true}), 'text', values.company, html`autocomplete="organization" maxlength="${LIMITS.company}"`)}
${textInput(
	spec('projectUrl', 'Project website', {optional: true, hint: 'Your site, docs or a demo, like example.com.'}),
	'text',
	values.projectUrl,
	html`inputmode="url" autocomplete="url" autocapitalize="none" spellcheck="false" maxlength="${LIMITS.projectUrl}"`,
)}
${selectInput(spec('packageId', 'Package'), values.packageId, packageOptions)}
${selectInput(spec('budget', 'Budget', {optional: true, hint: 'Your budget in US dollars. It helps us suggest the right scope.'}), values.budget, budgetOptions)}
${textInput(spec('deadline', 'Deadline', {optional: true, hint: 'The date you need the final video by.'}), 'date', values.deadline, html`min="${today}"`)}
${fieldWrap(
	messageSpec,
	html`<textarea ${controlAttrs(messageSpec)} rows="7" minlength="${LIMITS.messageMin}" maxlength="${LIMITS.message}" required>${values.message}</textarea>`,
)}
<div class="field${consentSpec.error ? ' has-error' : ''}">
${consentSpec.error ? html`<p class="field-error" id="f-consent-error"><span class="sr-only">Error:</span> ${consentSpec.error}</p>` : ''}
<div class="check">
<input type="checkbox" ${controlAttrs(consentSpec)} value="yes"${values.consent ? raw(' checked') : ''} required>
<label for="f-consent">I agree to be contacted by email about this request, and I accept the <a href="#terms">studio terms</a>.</label>
</div>
</div>
<div class="hp" aria-hidden="true">
<label for="f-hp">Leave this field empty</label>
<input type="text" id="f-hp" name="${HONEYPOT_FIELD}" value="" tabindex="-1" autocomplete="off">
</div>
<button class="btn" type="submit">Send request</button>
<p class="hint">We use your details only to reply to this request. We will not add you to a mailing list. <a href="/privacy">Privacy notice</a>.</p>
</form>
</div>
</section>`;
};

export const renderStudioPage = (input: StudioPageInput): string => {
	const {mode, meta, config} = input;
	const studio = `${meta.brandName} Studio`;
	if (mode === 'form') {
		const failed = Object.keys(input.errors).length > 0 || input.notice !== undefined;
		return layout({
			meta,
			title: `${failed ? 'Error: ' : ''}Request a quote | ${studio}`,
			indexable: false,
			nav: [[STUDIO_PATH, 'Packages and FAQ']],
			quoteHref: '#order',
			body: html`${orderSection(input)}
${termsSection()}`,
		});
	}
	const nav: Array<[string, string]> = [['#packages', 'Packages']];
	if (config.faq.length > 0) nav.push(['#faq', 'FAQ']);
	nav.push(['#terms', 'Terms']);
	return layout({
		meta,
		title: `Explainer videos for crypto and AI projects | ${studio}`,
		indexable: true,
		nav,
		quoteHref: '#order',
		body: html`${heroSection(meta)}
${featuresSection()}
${processSection()}
${packagesSection(config)}
${portfolioSection(config)}
${faqSection(config)}
${termsSection()}
${orderSection(input)}`,
	});
};

export const renderThanksPage = (meta: PageMeta): string => {
	const mail = mailLink(meta);
	return layout({
		meta,
		title: `Request received | ${meta.brandName} Studio`,
		indexable: false,
		nav: [],
		quoteHref: `${STUDIO_PATH}#order`,
		body: html`<section class="wrap narrow" aria-labelledby="thanks-title">
<h1 id="thanks-title">Thanks, your request is in</h1>
<p>We will read it and reply by email${mail ? html` from ${mail}` : ''}. If you do not see a reply, check your spam folder${mail ? ' or email us directly' : ''}.</p>
${mail
	? html`<div class="callout"><h2>Check who you are talking to</h2><p>Our reply will come from ${mail}. Be careful with anyone else who contacts you about this request and says they are us.</p></div>`
	: ''}
<p><a href="${STUDIO_PATH}">Back to the studio page</a></p>
</section>`,
	});
};

/** Plain message page (studio not configured, or similar). */
export const renderMessagePage = (meta: PageMeta, title: string, message: string): string => {
	const mail = mailLink(meta);
	return layout({
		meta,
		title: `${title} | ${meta.brandName} Studio`,
		indexable: false,
		nav: [],
		quoteHref: `${STUDIO_PATH}#order`,
		body: html`<section class="wrap narrow" aria-labelledby="message-title">
<h1 id="message-title">${title}</h1>
<p>${message}</p>
${mail ? html`<p>You can email us at ${mail}.</p>` : ''}
</section>`,
	});
};
