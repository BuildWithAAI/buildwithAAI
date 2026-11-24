/**
 * Line icons for the product PDFs, on a 24-unit grid with round caps and joins and one stroke colour (the same
 * construction as src/branding/marks/icons.tsx, redrawn here as static SVG strings so the PDF needs no React).
 * Flat: no fills except small solid dots, no gradients or filters (ART_GUIDE P1).
 */
export type IconName =
	| 'flag'
	| 'wrench'
	| 'key'
	| 'chip'
	| 'shield'
	| 'hook'
	| 'swap'
	| 'briefcase'
	| 'phone'
	| 'bank'
	| 'chat'
	| 'spark'
	| 'siren'
	| 'book'
	| 'list'
	| 'clock'
	| 'calendar'
	| 'repeat'
	| 'card'
	| 'info'
	| 'scissors';

const PATHS: Record<IconName, string> = {
	// Badger's Red Flag: a pennant on a pole (drawn, never red: red means price direction only)
	flag: '<path d="M6 21.5V3"/><path d="M6 4h12l-3 4.5 3 4.5H6"/>',
	// Zoo's One Fix: a wrench
	wrench: '<path d="M14.7 6.3a4 4 0 0 0 4.9 4.9l1.1-1.1a5.5 5.5 0 0 1-7 7l-6.3 4.3a2 2 0 0 1-2.8-2.8l4.3-6.3a5.5 5.5 0 0 1 7-7z"/>',
	key: '<circle cx="8" cy="15" r="4.5"/><path d="M11.2 11.8 20 3M16.5 6.5l2.5 2.5M14 9l2 2"/>',
	chip: '<rect x="6" y="3" width="12" height="18" rx="2.5"/><path d="M9.5 7.5h5M12 13v4"/><circle cx="12" cy="11" r="0.9" fill="currentColor" stroke="none"/>',
	shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.1 8 7.5 9.5 4.4-1.5 7.5-4.9 7.5-9.5V6z"/><path d="m8.8 12 2.2 2.2 4.2-4.4"/>',
	hook: '<circle cx="14.5" cy="3.6" r="1.9"/><path d="M14.5 5.5v9a5 5 0 0 1-10 0V11"/><path d="m4.5 11 3.3 3.2"/>',
	swap: '<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>',
	briefcase: '<rect x="3.5" y="7" width="17" height="12.5" rx="2.5"/><path d="M9 7V5.2A1.2 1.2 0 0 1 10.2 4h3.6A1.2 1.2 0 0 1 15 5.2V7M3.5 12.5h17"/>',
	phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>',
	bank: '<path d="M3.5 9.5 12 4l8.5 5.5M5 20.5h14M6.5 10.5v7M10.2 10.5v7M13.8 10.5v7M17.5 10.5v7"/>',
	chat: '<path d="M4 5.5h16v10H10l-4.5 4v-4H4z"/><path d="M8 9.5h8M8 12.3h5"/>',
	spark: '<path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3"/>',
	siren: '<path d="M6 18V12a6 6 0 0 1 12 0v6"/><path d="M4 21h16M12 3v1.5M4.5 6 5.6 7.1M19.5 6l-1.1 1.1"/><path d="M12 10v4"/>',
	book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23"/><path d="M8.5 7.5h7"/>',
	list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><path d="m3.5 6.5 1.2 1.2 2-2.4M3.5 12l1.2 1.2 2-2.4M3.5 17.5l1.2 1.2 2-2.4"/>',
	clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
	calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
	repeat: '<path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H19l-3-3M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H5l3 3"/>',
	card: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M6.5 14.5h4"/>',
	info: '<circle cx="12" cy="12" r="9.5"/><path d="M12 11v6"/><circle cx="12" cy="7.3" r="1.3" fill="currentColor" stroke="none"/>',
	scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.6 7.6 20 18M8.6 16.4 20 6"/>',
};

/** Inline SVG markup for an icon; size in CSS units, colour from `currentColor` unless given. */
export const icon = (name: IconName, size = '1em', color = 'currentColor', strokeWidth = 2): string =>
	`<svg class="icon icon-${name}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;

export const ICON_NAMES = Object.keys(PATHS) as IconName[];

/** One icon per chapter (the table of contents and chapter heads). Unknown ids get the shield. */
export const CHAPTER_ICONS: Record<string, IconName> = {
	'seed-phrases': 'key',
	'hardware-wallets': 'chip',
	approvals: 'list',
	phishing: 'hook',
	'address-poisoning': 'swap',
	'fake-jobs': 'briefcase',
	'sim-2fa': 'phone',
	exchanges: 'bank',
	'social-engineering': 'chat',
	'ai-threats': 'spark',
	'incident-response': 'siren',
	'record-keeping': 'book',
};

export const chapterIcon = (id: string): IconName => CHAPTER_ICONS[id] ?? 'shield';
