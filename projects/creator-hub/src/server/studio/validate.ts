/**
 * Reads and validates the /studio order form. Pure functions: no I/O, the clock comes in as `now`.
 */
import type {OrderRequest} from '../../types.ts';
import {CUSTOM_PACKAGE_ID, type StudioConfig} from './config.ts';

/** Form fields in page order (also the error-summary order). */
export const FIELDS = ['name', 'email', 'company', 'projectUrl', 'packageId', 'budget', 'deadline', 'message', 'consent'] as const;
export type OrderField = (typeof FIELDS)[number];

/** HTML form control names. */
export const FORM_NAMES: Record<OrderField, string> = {
	name: 'name',
	email: 'email',
	company: 'company',
	projectUrl: 'project_url',
	packageId: 'package',
	budget: 'budget',
	deadline: 'deadline',
	message: 'message',
	consent: 'consent',
};

/** Off-screen field that people never see or fill in. Anything in it marks the post as a bot. */
export const HONEYPOT_FIELD = 'studio_hp';

export const LIMITS = {name: 100, email: 254, company: 120, projectUrl: 500, messageMin: 10, message: 5000} as const;

export type OrderFormValues = {
	name: string;
	email: string;
	company: string;
	projectUrl: string;
	packageId: string;
	budget: string;
	deadline: string;
	message: string;
	consent: boolean;
};

export type OrderFieldErrors = Partial<Record<OrderField, string>>;

export type ValidOrder = Pick<
	OrderRequest,
	'name' | 'email' | 'company' | 'projectUrl' | 'packageId' | 'budget' | 'deadline' | 'message' | 'consent'
>;

export type OrderValidation =
	| {ok: true; order: ValidOrder; values: OrderFormValues}
	| {ok: false; errors: OrderFieldErrors; values: OrderFormValues};

const DAY_MS = 86_400_000;
/** C0/C1 controls and bidi overrides, which can disguise text when the owner reads an order. */
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F‪-‮⁦-⁩]/;
/** The same, but tab and newline are allowed (the message is multi-line; CR was normalized to LF). */
const CONTROL_CHARS_MULTILINE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F‪-‮⁦-⁩]/;
const EMAIL_LOCAL = /^[\p{L}\p{N}!#$%&'*+/=?^_`{|}~-]+(?:\.[\p{L}\p{N}!#$%&'*+/=?^_`{|}~-]+)*$/u;
const DOMAIN_LABEL = /^[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?$/u;

/** UTC calendar day, YYYY-MM-DD. */
export const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export const isEmail = (value: string): boolean => {
	const at = value.lastIndexOf('@');
	if (at < 1 || at === value.length - 1) return false;
	const local = value.slice(0, at);
	const domain = value.slice(at + 1);
	if (local.length > 64 || domain.length > 253 || !EMAIL_LOCAL.test(local)) return false;
	const labels = domain.split('.');
	return labels.length >= 2 && labels.every((label) => DOMAIN_LABEL.test(label)) && !/^\d+$/.test(labels.at(-1) ?? '');
};

/** Accepts "example.com" or a full http(s) link. Returns the normalized https?:// URL, or null. */
export const normalizeProjectUrl = (input: string): string | null => {
	const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
	let url: URL;
	try {
		url = new URL(candidate);
	} catch {
		return null;
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
	if (url.username !== '' || url.password !== '' || !url.hostname.includes('.')) return null;
	return url.href;
};

/** Why a YYYY-MM-DD deadline is not acceptable, or null. One day of slack covers time zones. */
export const deadlineProblem = (value: string, now: number): string | null => {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Enter the deadline as a date in the format YYYY-MM-DD';
	const parsed = Date.parse(`${value}T00:00:00Z`);
	if (Number.isNaN(parsed) || isoDay(parsed) !== value) return 'Enter a real date in the format YYYY-MM-DD';
	if (value < isoDay(now - DAY_MS)) return 'The deadline must be today or later';
	if (value > isoDay(now + 3 * 366 * DAY_MS)) return 'The deadline must be within the next 3 years';
	return null;
};

const oneLine = (value: string): string => value.replace(/\s+/g, ' ').trim();

/** Reads the posted values for validation and for re-showing the form. Bounded so a huge post stays cheap. */
export const readOrderForm = (form: URLSearchParams): OrderFormValues => {
	const get = (field: OrderField, cap: number): string => (form.get(FORM_NAMES[field]) ?? '').slice(0, cap);
	return {
		name: oneLine(get('name', 1000)),
		email: oneLine(get('email', 1000)),
		company: oneLine(get('company', 1000)),
		projectUrl: oneLine(get('projectUrl', 2000)),
		packageId: oneLine(get('packageId', 200)),
		budget: oneLine(get('budget', 200)),
		deadline: oneLine(get('deadline', 200)),
		message: get('message', 20_000).replace(/\r\n?/g, '\n').trim(),
		consent: form.get(FORM_NAMES.consent) === 'yes',
	};
};

/** Empty form, with the package preselected when `requestedPackage` names a real option. */
export const blankOrderForm = (config: StudioConfig, requestedPackage = ''): OrderFormValues => {
	const known = requestedPackage === CUSTOM_PACKAGE_ID || config.packages.some((p) => p.id === requestedPackage);
	return {
		name: '',
		email: '',
		company: '',
		projectUrl: '',
		packageId: known ? requestedPackage : '',
		budget: '',
		deadline: '',
		message: '',
		consent: false,
	};
};

export const validateOrderForm = (form: URLSearchParams, config: StudioConfig, now: number): OrderValidation => {
	const values = readOrderForm(form);
	const errors: OrderFieldErrors = {};
	const flag = (field: OrderField, message: string): void => {
		errors[field] ??= message;
	};

	if (values.name === '') flag('name', 'Enter your name');
	else if (values.name.length > LIMITS.name) flag('name', `Your name must be ${LIMITS.name} characters or fewer`);
	else if (CONTROL_CHARS.test(values.name)) flag('name', 'Your name contains characters we cannot accept');
	else if (/https?:|www\./i.test(values.name)) flag('name', 'Enter your name without a web address');

	if (values.email === '') flag('email', 'Enter your email address');
	else if (values.email.length > LIMITS.email || !isEmail(values.email)) {
		flag('email', 'Enter an email address in the right format, like name@example.com');
	}

	if (values.company.length > LIMITS.company) flag('company', `Company must be ${LIMITS.company} characters or fewer`);
	else if (CONTROL_CHARS.test(values.company)) flag('company', 'Company contains characters we cannot accept');

	const projectUrl = values.projectUrl === '' || values.projectUrl.length > LIMITS.projectUrl ? null : normalizeProjectUrl(values.projectUrl);
	if (values.projectUrl !== '' && projectUrl === null) {
		flag('projectUrl', 'Enter a web address like https://example.com, or leave it empty');
	}

	const packageKnown = values.packageId === CUSTOM_PACKAGE_ID || config.packages.some((p) => p.id === values.packageId);
	if (values.packageId === '') flag('packageId', 'Choose a package, or "Not sure yet"');
	else if (!packageKnown) flag('packageId', 'Choose a package from the list');

	if (values.budget !== '' && !config.budgetRanges.includes(values.budget)) {
		flag('budget', 'Choose a budget from the list, or "Not sure yet"');
	}

	const deadlineError = values.deadline === '' ? null : deadlineProblem(values.deadline, now);
	if (deadlineError) flag('deadline', deadlineError);

	if (values.message === '') flag('message', 'Tell us about your project');
	else if (values.message.length < LIMITS.messageMin) flag('message', `Tell us a bit more: at least ${LIMITS.messageMin} characters`);
	else if (values.message.length > LIMITS.message) {
		flag('message', `Keep the message to ${LIMITS.message.toLocaleString('en-US')} characters or fewer. You can send more by email later`);
	} else if (CONTROL_CHARS_MULTILINE.test(values.message)) flag('message', 'The message contains characters we cannot accept');

	if (!values.consent) flag('consent', 'Tick the box to agree to be contacted and to the studio terms');

	if (Object.keys(errors).length > 0) return {ok: false, errors, values};

	const at = values.email.lastIndexOf('@');
	return {
		ok: true,
		values,
		order: {
			name: values.name,
			email: `${values.email.slice(0, at)}@${values.email.slice(at + 1).toLowerCase()}`,
			company: values.company || null,
			projectUrl,
			packageId: values.packageId,
			budget: values.budget || null,
			deadline: values.deadline || null,
			message: values.message,
			consent: true,
		},
	};
};
