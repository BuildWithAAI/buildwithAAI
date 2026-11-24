import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {pdfDate, PdfMetaError, pdfTextString, readTrailer, setDocInfo} from '../lib/pdfmeta.ts';
import {parseDests, parseFonts} from '../lib/pdf.ts';

/** A minimal valid one-page PDF with a classic cross-reference table and an Info object (like Skia's output). */
const minimalPdf = (): Uint8Array => {
	const objs = [
		'<</Producer (Skia/PDF m158)\n/CreationDate (D:20261124000000+00\'00\')>>',
		'<</Type /Catalog /Pages 3 0 R>>',
		'<</Type /Pages /Kids [4 0 R] /Count 1>>',
		'<</Type /Page /Parent 3 0 R /MediaBox [0 0 612 792]>>',
	];
	let body = '%PDF-1.4\n';
	const offsets: number[] = [];
	objs.forEach((o, k) => {
		offsets.push(Buffer.byteLength(body, 'latin1'));
		body += `${k + 1} 0 obj\n${o}\nendobj\n`;
	});
	const xref = Buffer.byteLength(body, 'latin1');
	body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
	body += `trailer\n<</Size ${objs.length + 1}\n/Root 2 0 R\n/Info 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
	return new Uint8Array(Buffer.from(body, 'latin1'));
};

test('text strings are UTF-16BE hex with a BOM; dates are PDF dates', () => {
	// Z o o ␠ & ␠ B a d g e r: twelve UTF-16 code units after the byte-order mark
	assert.equal(pdfTextString('Zoo & Badger'), '<FEFF005A006F006F002000260020004200610064006700650072>');
	assert.equal(pdfTextString('é·'), '<FEFF00E900B7>');
	assert.equal(pdfTextString('😀'), '<FEFFD83DDE00>');
	assert.equal(pdfDate(new Date(Date.UTC(2026, 10, 24, 9, 5, 7))), '(D:20261124090507Z)');
});

test('incremental update appends a new Info object and keeps the original bytes', () => {
	const pdf = minimalPdf();
	const out = setDocInfo(pdf, {title: 'The Crypto Security Checklist (Free edition)', author: 'Zoo & Badger', subject: 'S', keywords: ['a', 'b'], creator: 'C'}, new Date(Date.UTC(2026, 10, 24)));
	assert.deepEqual(out.subarray(0, pdf.length), pdf);
	const t = readTrailer(out);
	assert.equal(t.size, 6);
	assert.equal(t.info, '5 0 R');
	assert.equal(t.root, '2 0 R');
	const tail = Buffer.from(out.subarray(pdf.length)).toString('latin1');
	assert.match(tail, /^\n5 0 obj\n<<\/Title <FEFF/);
	assert.match(tail, /\/Producer \(Skia\/PDF m158\)/, 'producer carried over');
	assert.match(tail, /\/CreationDate \(D:20261124000000\+00'00'\)/, 'creation date carried over');
	assert.match(tail, /\/Prev \d+>>/);
	// the xref entry points exactly at the new object
	const m = /xref\n0 1\n0000000000 65535 f \n5 1\n(\d{10}) 00000 n \n/.exec(tail);
	assert.ok(m);
	assert.equal(Buffer.from(out).toString('latin1').slice(Number(m[1]), Number(m[1]) + 7), '5 0 obj');
	// and startxref points at the new xref keyword
	const sx = /startxref\n(\d+)\n%%EOF\n$/.exec(tail);
	assert.ok(sx);
	assert.equal(Buffer.from(out).toString('latin1').slice(Number(sx[1]), Number(sx[1]) + 4), 'xref');
});

test('refuses files it cannot update safely', () => {
	assert.throws(() => setDocInfo(new Uint8Array(Buffer.from('%PDF-1.7\nno trailer here')), {title: '', author: '', subject: '', keywords: [], creator: ''}), PdfMetaError);
	const xrefStream = Buffer.from('%PDF-1.7\n1 0 obj\n<</Type /XRef>>\nendobj\nstartxref\n9\n%%EOF');
	assert.throws(() => readTrailer(new Uint8Array(xrefStream)), /classic trailer/);
});

test('pdfinfo reads the updated document information (when poppler is installed)', (t) => {
	if (spawnSync('pdfinfo', ['-v']).error) return t.skip('pdfinfo not installed');
	const dir = mkdtempSync(join(tmpdir(), 'pdfmeta-'));
	const f = join(dir, 'x.pdf');
	writeFileSync(f, setDocInfo(minimalPdf(), {title: 'Zoo & Badger · Test', author: 'Zoo & Badger', subject: 'Subject', keywords: ['k1', 'k2'], creator: 'Creator'}));
	const out = spawnSync('pdfinfo', [f], {encoding: 'utf8'});
	assert.equal(out.status, 0, out.stderr);
	assert.match(out.stdout, /Title:\s+Zoo & Badger · Test/);
	assert.match(out.stdout, /Author:\s+Zoo & Badger/);
	assert.match(out.stdout, /Keywords:\s+k1, k2/);
	assert.match(out.stdout, /Pages:\s+1/);
});

test('poppler output parsers', () => {
	assert.deepEqual(
		parseDests('Page  Destination                 Name\n   4 [ XYZ    6  776 null      ] "seed"\n  12 [ XYZ 6 776 null ] "hw-wallet"\n'),
		{seed: 4, 'hw-wallet': 12},
	);
	const fonts = parseFonts(
		'name                                 type              encoding         emb sub uni object ID\n------------------------------------ ----------------- ---------------- --- --- --- ---------\nAAAAAA+Inter-Regular                 CID TrueType      Identity-H       yes yes yes      7  0\nBBBBBB+Montserrat-Black              CID TrueType      Identity-H       no  no  yes     12  0\n',
	);
	assert.deepEqual(
		fonts.map((f) => [f.name, f.type, f.embedded, f.subset]),
		[
			['AAAAAA+Inter-Regular', 'CID TrueType', true, true],
			['BBBBBB+Montserrat-Black', 'CID TrueType', false, false],
		],
	);
});
