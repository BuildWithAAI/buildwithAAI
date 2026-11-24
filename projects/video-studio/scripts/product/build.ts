/**
 * Builds the product PDFs (content/products/<id>) with the preinstalled Playwright Chromium. Node 22 runs it
 * directly (type stripping):
 *
 *   node scripts/product/build.ts                          # both editions: spots, lint, PDFs, checks, previews
 *   node scripts/product/build.ts --edition free           # one edition (free | full | all)
 *   node scripts/product/build.ts --skip-spots             # reuse out/product/spots/*.svg
 *   node scripts/product/build.ts --paper a4               # A4 instead of US Letter
 *   node scripts/product/build.ts --lint                   # content lint only (no browser)
 *   node scripts/product/build.ts --product <id>           # another product folder (default crypto-security-checklist)
 *
 * Steps per edition: parse + lint the content, render the spot illustrations from the character rigs (vector
 * SVG), render HTML, print with Chromium, read the PDF back (named destinations -> contents page numbers, then a
 * second print), write the document information, and check the result: page range, every font embedded, no
 * raster images, the contents numbers stable between passes. Writes out/product/ (gitignored): the PDFs, the HTML,
 * page previews (preview/<edition>-N.png) and report.json.
 *
 * Exit codes: 0 every check passed; 1 content or output checks failed; 2 bad arguments or a missing tool.
 */
import {copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ContentError, parseDocument, structure, type Structured} from './lib/markdown.ts';
import {formatFindings, lintCopy, lintStructured, unusedSources, type Finding} from './lib/lint.ts';
import {citationIds, renderDocument, type Edition, type Product} from './lib/render.ts';
import {spotInfos} from './lib/spotfiles.ts';
import {validateSources, type SourceFile} from './lib/sources.ts';
import {buildCss, contentBoxPx, type Paper} from './lib/styles.ts';
import {namedDestinations, pdfFonts, pdfInfo, pdfPageCount, pdfRasterImageCount, popplerAvailable, printPdf, rasterize, type FitBox, type FitResult} from './lib/pdf.ts';
import {setDocInfo} from './lib/pdfmeta.ts';
import {SPOTS} from './spots/catalog.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(HERE, '..', '..');

type ProductFile = Product & {
	pdfInfo: {author: string; keywords: string[]; creator: string};
	editions: Record<Edition, {source: string; output: string; minPages: number; maxPages: number}>;
	ownerInputs: Record<string, string>;
};

type Args = {product: string; editions: Edition[]; paper: Paper; skipSpots: boolean; lintOnly: boolean; out: string; previewDpi: number};

class UsageError extends Error {}

export const parseArgs = (argv: string[]): Args => {
	const a: Args = {product: 'crypto-security-checklist', editions: ['free', 'full'], paper: 'letter', skipSpots: false, lintOnly: false, out: join(PROJECT_ROOT, 'out', 'product'), previewDpi: 72};
	for (let i = 0; i < argv.length; i++) {
		const [flag, inline] = argv[i].includes('=') ? [argv[i].slice(0, argv[i].indexOf('=')), argv[i].slice(argv[i].indexOf('=') + 1)] : [argv[i], undefined];
		const val = () => {
			const v = inline ?? argv[++i];
			if (v === undefined) throw new UsageError(`${flag} needs a value`);
			return v;
		};
		switch (flag) {
			case '--edition': {
				const v = val();
				if (v === 'all') a.editions = ['free', 'full'];
				else if (v === 'free' || v === 'full') a.editions = [v];
				else throw new UsageError('--edition must be free, full or all');
				break;
			}
			case '--paper': {
				const v = val();
				if (v !== 'letter' && v !== 'a4') throw new UsageError('--paper must be letter or a4');
				a.paper = v;
				break;
			}
			case '--product': {
				const v = val();
				if (!/^[a-z0-9-]+$/.test(v)) throw new UsageError('--product must be a folder name under content/products');
				a.product = v;
				break;
			}
			case '--out':
				a.out = resolve(val());
				break;
			case '--preview-dpi': {
				const n = Number(val());
				if (!Number.isInteger(n) || n < 36 || n > 300) throw new UsageError('--preview-dpi must be an integer 36-300');
				a.previewDpi = n;
				break;
			}
			case '--skip-spots':
				a.skipSpots = true;
				break;
			case '--lint':
				a.lintOnly = true;
				break;
			case '-h':
			case '--help':
				throw new UsageError('help');
			default:
				throw new UsageError(`unknown option ${argv[i]}`);
		}
	}
	return a;
};

const USAGE = 'usage: node scripts/product/build.ts [--edition free|full|all] [--paper letter|a4] [--skip-spots] [--lint] [--product <id>] [--out <dir>] [--preview-dpi <n>]';

export type Loaded = {dir: string; product: ProductFile; sources: SourceFile; docs: Partial<Record<Edition, Structured>>};

/** Checks the owner-edited fields of product.json; each problem becomes a lint error, so nothing odd gets printed. */
export const validateProduct = (p: Partial<ProductFile>): string[] => {
	const errors: string[] = [];
	for (const f of ['id', 'title', 'copyrightHolder'] as const) if (typeof p[f] !== 'string' || !p[f].trim()) errors.push(`${f} is required`);
	if (p.contact !== null && !(typeof p.contact === 'string' && /^[^\s@<>"]+@[^\s@<>"]+\.[A-Za-z]{2,}$/.test(p.contact))) errors.push('contact must be null or a plain email address');
	if (p.fullEditionUrl !== null) {
		let ok = false;
		try {
			ok = typeof p.fullEditionUrl === 'string' && new URL(p.fullEditionUrl).protocol === 'https:';
		} catch {
			ok = false;
		}
		if (!ok) errors.push('fullEditionUrl must be null or an https link (the hub link)');
	}
	if (!p.licence || typeof p.licence.free !== 'string' || typeof p.licence.full !== 'string') errors.push('licence.free and licence.full are required');
	for (const e of ['free', 'full'] as const) {
		const spec = p.editions?.[e];
		if (!spec || !spec.source || !spec.output || !(spec.minPages >= 1 && spec.maxPages >= spec.minPages)) errors.push(`editions.${e} needs source, output and a page range`);
	}
	return errors;
};

export const loadProduct = (productId: string, editions: Edition[]): {loaded: Loaded; findings: {file: string; findings: Finding[]}[]} => {
	const dir = join(PROJECT_ROOT, 'content', 'products', productId);
	const product = JSON.parse(readFileSync(join(dir, 'product.json'), 'utf8')) as ProductFile;
	const sourcesRaw = JSON.parse(readFileSync(join(dir, 'sources.json'), 'utf8')) as unknown;
	const sourceErrors = validateSources(sourcesRaw);
	const findings: {file: string; findings: Finding[]}[] = [];
	const productErrors = validateProduct(product);
	if (productErrors.length) findings.push({file: 'product.json', findings: productErrors.map((m) => ({level: 'error', line: 1, rule: 'product', message: m}))});
	if (sourceErrors.length) findings.push({file: 'sources.json', findings: sourceErrors.map((m) => ({level: 'error', line: 1, rule: 'sources', message: m}))});
	const sources = sourcesRaw as SourceFile;
	const knownIds = new Set((sources.sources ?? []).map((s) => s.id));
	const spotIds = new Set(SPOTS.map((s) => s.id));
	const docs: Partial<Record<Edition, Structured>> = {};
	const cited: string[] = [];
	for (const e of editions) {
		const file = product.editions[e].source;
		try {
			const st = structure(parseDocument(readFileSync(join(dir, file), 'utf8')));
			docs[e] = st;
			findings.push({file, findings: lintStructured(st, {knownIds, spotIds, requireChapterCallouts: e === 'full'})});
			cited.push(...citationIds(st));
		} catch (err) {
			const line = err instanceof ContentError ? err.line : 1;
			findings.push({file, findings: [{level: 'error', line, rule: 'parse', message: err instanceof Error ? err.message : String(err)}]});
		}
	}
	for (const copy of ['landing.md', 'kit-flow.md']) {
		const p = join(dir, copy);
		if (existsSync(p)) findings.push({file: copy, findings: lintCopy(readFileSync(p, 'utf8'), {knownIds})});
	}
	if (editions.length === 2) {
		const unused = unusedSources([...knownIds], cited);
		if (unused.length) findings.push({file: 'sources.json', findings: unused.map((id) => ({level: 'warning', line: 1, rule: 'unused-source', message: `source "${id}" is never cited`}))});
	}
	return {loaded: {dir, product, sources, docs}, findings};
};

type EditionReport = {
	edition: Edition;
	pdf: string;
	html: string;
	pages: number;
	pageRange: [number, number];
	tocPages: Record<string, number>;
	tocStable: boolean;
	/** Copy-fit of the free edition's page frames: the type scale chosen and each page's spare room (CSS px). */
	fit: FitResult | null;
	fonts: {name: string; embedded: boolean}[];
	rasterImages: number;
	citedSources: number;
	consoleErrors: string[];
	warnings: string[];
	previews: string[];
	info: Record<string, string>;
	problems: string[];
};

/**
 * Type-scale range for the free edition's copy-fit: its columns may grow up to 30% to fill the sheet, or shrink by
 * at most 8% before the build reports that the content no longer fits two pages.
 */
export const FREE_FIT = {min: 0.92, max: 1.3} as const;

const buildEdition = async (edition: Edition, loaded: Loaded, args: Args, log: (s: string) => void): Promise<EditionReport> => {
	const doc = loaded.docs[edition] as Structured;
	const spec = loaded.product.editions[edition];
	const htmlFile = join(args.out, `${edition}.html`);
	const pdfFile = join(args.out, spec.output);
	const spots = spotInfos(join(args.out, 'spots'), args.out);
	const css = (pages: {name: string; label: string}[], footer: string) => buildCss({projectRoot: PROJECT_ROOT, paper: args.paper, footer, pages});
	const problems: string[] = [];

	const render = (tocPages?: Record<string, number>) => renderDocument(doc, {edition, product: loaded.product, sources: loaded.sources, spots, tocPages}, css);
	const fitBox: FitBox | undefined = edition === 'free' ? {...contentBoxPx(args.paper), ...FREE_FIT} : undefined;
	let r = render();
	writeFileSync(htmlFile, r.html);
	log(`  ${edition}: printing (pass 1)`);
	let print = await printPdf(htmlFile, pdfFile, {fit: fitBox});
	let tocPages: Record<string, number> = {};
	let tocStable = true;
	if (r.tocTargets.length) {
		const dests = namedDestinations(pdfFile);
		for (const id of r.tocTargets) {
			if (dests[id] === undefined) problems.push(`contents: no PDF destination for section "${id}"`);
			else tocPages[id] = dests[id];
		}
		r = render(tocPages);
		writeFileSync(htmlFile, r.html);
		log(`  ${edition}: printing (pass 2, contents page numbers)`);
		print = await printPdf(htmlFile, pdfFile, {fit: fitBox});
		const again = namedDestinations(pdfFile);
		tocStable = r.tocTargets.every((id) => again[id] === tocPages[id]);
		if (!tocStable) problems.push('contents page numbers moved between passes');
	}
	const title = doc.meta.title ?? loaded.product.title;
	const editionLabel = doc.meta.editionLabel ?? edition;
	const bytes = setDocInfo(new Uint8Array(readFileSync(pdfFile)), {
		title: `${title} (${editionLabel})`,
		author: loaded.product.pdfInfo.author,
		subject: doc.meta.subtitle ?? '',
		keywords: loaded.product.pdfInfo.keywords,
		creator: loaded.product.pdfInfo.creator,
	});
	writeFileSync(pdfFile, bytes);

	const pages = pdfPageCount(pdfFile);
	if (pages < spec.minPages || pages > spec.maxPages) problems.push(`${pages} pages; the ${edition} edition must have ${spec.minPages}-${spec.maxPages}`);
	if (print.fit && !print.fit.fits) problems.push(`the ${edition} edition does not fit its pages even at ${FREE_FIT.min}x type: shorten the content`);
	const fonts = pdfFonts(pdfFile).map((f) => ({name: f.name, embedded: f.embedded}));
	const notEmbedded = fonts.filter((f) => !f.embedded);
	if (notEmbedded.length) problems.push(`fonts not embedded: ${notEmbedded.map((f) => f.name).join(', ')}`);
	if (fonts.some((f) => !/Inter|Montserrat/.test(f.name))) problems.push(`unexpected font: ${fonts.filter((f) => !/Inter|Montserrat/.test(f.name)).map((f) => f.name).join(', ')}`);
	const rasterImages = pdfRasterImageCount(pdfFile);
	if (rasterImages) problems.push(`${rasterImages} raster image(s): the art should be vector`);
	if (print.consoleErrors.length) problems.push(...print.consoleErrors.map((e) => `browser: ${e}`));
	if (print.failedRequests.length) problems.push(...print.failedRequests.map((u) => `failed to load: ${u}`));
	const info = pdfInfo(pdfFile);
	const previewDir = join(args.out, 'preview');
	mkdirSync(previewDir, {recursive: true});
	for (const old of readdirSync(previewDir)) if (old.startsWith(`${edition}-`) && old.endsWith('.png')) rmSync(join(previewDir, old));
	const previews = rasterize(pdfFile, join(previewDir, edition), args.previewDpi);
	return {
		edition,
		pdf: pdfFile,
		html: htmlFile,
		pages,
		pageRange: [spec.minPages, spec.maxPages],
		tocPages,
		tocStable,
		fit: print.fit,
		fonts,
		rasterImages,
		citedSources: r.registry.cited().length,
		consoleErrors: print.consoleErrors,
		warnings: r.warnings,
		previews,
		info: {Title: info.Title ?? '', Author: info.Author ?? '', Pages: info.Pages ?? '', 'Page size': info['Page size'] ?? '', Tagged: info.Tagged ?? ''},
		problems,
	};
};

export const main = async (argv: string[]): Promise<number> => {
	let args: Args;
	try {
		args = parseArgs(argv);
	} catch (e) {
		console.error(e instanceof UsageError && e.message !== 'help' ? `${e.message}\n${USAGE}` : USAGE);
		return e instanceof UsageError && e.message === 'help' ? 0 : 2;
	}
	const log = (s: string) => console.log(s);
	let loadedAll;
	try {
		loadedAll = loadProduct(args.product, args.editions);
	} catch (e) {
		console.error(`cannot load content/products/${args.product}: ${e instanceof Error ? e.message : String(e)}`);
		return 2;
	}
	const {loaded, findings} = loadedAll;
	let errors = 0;
	for (const f of findings) {
		if (!f.findings.length) continue;
		console.log(formatFindings(f.findings, `content/products/${args.product}/${f.file}`));
		errors += f.findings.filter((x) => x.level === 'error').length;
	}
	log(`lint: ${errors} error(s), ${findings.reduce((n, f) => n + f.findings.filter((x) => x.level === 'warning').length, 0)} warning(s)`);
	if (errors) return 1;
	if (args.lintOnly) return 0;
	if (!popplerAvailable()) {
		console.error('pdfinfo (poppler-utils) is required to check the PDFs');
		return 2;
	}
	mkdirSync(args.out, {recursive: true});
	if (!args.skipSpots) {
		const {renderSpots} = await import('./lib/spots.ts');
		const spots = await renderSpots(join(args.out, 'spots'), {log});
		const bad = spots.filter((s) => s.problems.length);
		if (bad.length) {
			for (const s of bad) console.error(`spot ${s.id}: ${s.problems.join('; ')}`);
			return 1;
		}
	}
	const reports: EditionReport[] = [];
	for (const e of args.editions) {
		log(`building ${e} edition`);
		reports.push(await buildEdition(e, loaded, args, log));
	}
	const reportFile = join(args.out, 'report.json');
	writeFileSync(reportFile, `${JSON.stringify({product: args.product, paper: args.paper, builtAt: new Date().toISOString(), editions: reports, ownerInputs: loaded.product.ownerInputs}, null, 2)}\n`);
	let failed = false;
	for (const r of reports) {
		const status = r.problems.length ? 'FAIL' : 'ok  ';
		const fitNote = r.fit ? `, type ${r.fit.scale.toFixed(3)}x` : '';
		log(`${status} ${r.edition}: ${relative(PROJECT_ROOT, r.pdf)} (${r.pages} pages, ${r.citedSources} sources, ${r.fonts.length} fonts embedded, ${r.rasterImages} raster images${fitNote})`);
		for (const w of r.warnings) log(`     warn: ${w}`);
		for (const p of r.problems) log(`     problem: ${p}`);
		if (r.problems.length) failed = true;
	}
	const missing = Object.entries(loaded.product.ownerInputs).filter(([k]) => k in loaded.product && (loaded.product as unknown as Record<string, unknown>)[k] === null);
	for (const [k, v] of missing) log(`owner input still open: ${k}: ${v}`);
	log(`report: ${relative(PROJECT_ROOT, reportFile)}; previews: ${relative(PROJECT_ROOT, join(args.out, 'preview'))}/`);
	return failed ? 1 : 0;
};

/** Copies the finished PDFs somewhere else (used by tests and by owners who want a delivery folder). */
export const copyOutputs = (files: string[], dest: string): void => {
	mkdirSync(dest, {recursive: true});
	for (const f of files) copyFileSync(f, join(dest, f.split('/').pop() as string));
};

export const cleanPreviews = (out: string): void => rmSync(join(out, 'preview'), {recursive: true, force: true});

if (import.meta.url === `file://${process.argv[1]}`) {
	main(process.argv.slice(2)).then(
		(code) => process.exit(code),
		(e) => {
			console.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
			process.exit(2);
		},
	);
}
