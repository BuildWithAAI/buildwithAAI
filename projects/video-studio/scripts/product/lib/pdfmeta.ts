/**
 * Sets a PDF's document information (Title, Author, Subject, Keywords, Creator) with an incremental update:
 * the original bytes stay untouched and a new Info object, cross-reference section and trailer are appended
 * (ISO 32000-1, 7.5.6). Works on files with a classic cross-reference table, which is what Chromium's Skia
 * backend writes; anything else is refused rather than corrupted. Pure: bytes in, bytes out.
 */

export type DocInfo = {title: string; author: string; subject: string; keywords: string[]; creator: string};

/** A PDF text string as UTF-16BE hex with a byte-order mark (safe for any character). */
export const pdfTextString = (s: string): string => {
	let hex = 'FEFF';
	for (const ch of s) {
		const cp = ch.codePointAt(0) as number;
		if (cp > 0xffff) {
			const v = cp - 0x10000;
			hex += (0xd800 + (v >> 10)).toString(16).padStart(4, '0') + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0');
		} else hex += cp.toString(16).padStart(4, '0');
	}
	return `<${hex.toUpperCase()}>`;
};

/** PDF date string D:YYYYMMDDHHmmSSZ for a JS date (UTC). */
export const pdfDate = (d: Date): string => {
	const p = (n: number) => String(n).padStart(2, '0');
	return `(D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z)`;
};

export class PdfMetaError extends Error {}

type Trailer = {size: number; root: string; info: string | null; startxref: number; tail: string};

/** Reads the last trailer and startxref of a classic-xref PDF. */
export const readTrailer = (pdf: Uint8Array): Trailer => {
	const tailLen = Math.min(pdf.length, 4096);
	const tail = Buffer.from(pdf.subarray(pdf.length - tailLen)).toString('latin1');
	const sx = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail);
	if (!sx) throw new PdfMetaError('no startxref at the end of the file');
	const tIdx = tail.lastIndexOf('trailer');
	if (tIdx < 0) throw new PdfMetaError('no classic trailer (cross-reference streams are not supported)');
	const dict = tail.slice(tIdx);
	const size = /\/Size\s+(\d+)/.exec(dict);
	const root = /\/Root\s+(\d+\s+\d+\s+R)/.exec(dict);
	const info = /\/Info\s+(\d+\s+\d+\s+R)/.exec(dict);
	if (!size || !root) throw new PdfMetaError('trailer lacks /Size or /Root');
	return {size: Number(size[1]), root: root[1], info: info ? info[1] : null, startxref: Number(sx[1]), tail};
};

/** Copies a literal-string entry (e.g. /Producer, /CreationDate) from the existing Info object, if it is a plain string. */
const existingEntry = (pdf: Uint8Array, infoRef: string | null, key: string): string | null => {
	if (!infoRef) return null;
	const num = infoRef.split(/\s+/)[0];
	const text = Buffer.from(pdf).toString('latin1');
	const objAt = text.search(new RegExp(`(^|[\\r\\n])${num}\\s+0\\s+obj`));
	if (objAt < 0) return null;
	const end = text.indexOf('endobj', objAt);
	const body = text.slice(objAt, end < 0 ? undefined : end);
	const m = new RegExp(`/${key}\\s*(\\([^)]*\\)|<[0-9A-Fa-f]+>)`).exec(body);
	return m ? m[1] : null;
};

export const setDocInfo = (pdf: Uint8Array, info: DocInfo, now = new Date()): Uint8Array => {
	const t = readTrailer(pdf);
	const objNum = t.size;
	const producer = existingEntry(pdf, t.info, 'Producer');
	const created = existingEntry(pdf, t.info, 'CreationDate') ?? pdfDate(now);
	const entries = [
		`/Title ${pdfTextString(info.title)}`,
		`/Author ${pdfTextString(info.author)}`,
		`/Subject ${pdfTextString(info.subject)}`,
		`/Keywords ${pdfTextString(info.keywords.join(', '))}`,
		`/Creator ${pdfTextString(info.creator)}`,
		...(producer ? [`/Producer ${producer}`] : []),
		`/CreationDate ${created}`,
		`/ModDate ${pdfDate(now)}`,
	];
	const needsNewline = pdf[pdf.length - 1] !== 0x0a;
	const head = needsNewline ? '\n' : '';
	const objOffset = pdf.length + Buffer.byteLength(head, 'latin1');
	const obj = `${objNum} 0 obj\n<<${entries.join('\n')}>>\nendobj\n`;
	const xrefOffset = objOffset + Buffer.byteLength(obj, 'latin1');
	const xref = `xref\n0 1\n0000000000 65535 f \n${objNum} 1\n${String(objOffset).padStart(10, '0')} 00000 n \n`;
	const trailer = `trailer\n<</Size ${objNum + 1}\n/Root ${t.root}\n/Info ${objNum} 0 R\n/Prev ${t.startxref}>>\nstartxref\n${xrefOffset}\n%%EOF\n`;
	const appended = Buffer.from(head + obj + xref + trailer, 'latin1');
	const out = new Uint8Array(pdf.length + appended.length);
	out.set(pdf, 0);
	out.set(appended, pdf.length);
	return out;
};
