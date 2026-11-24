import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {CsvError, csvCell, findColumn, isDecimalCommaOnly, normalizeHeader, parseCount, parseCsv, parseDate, parseDuration, parseNumber, parsePercent, toCsv, unprotectCell} from './csv.ts';

describe('parseCsv', () => {
	it('reads quoted fields with delimiters, doubled quotes and line breaks', () => {
		const table = parseCsv('a,b,c\r\n"x, y","say ""hi""","two\nlines"\r\n1,,3\r\n');
		assert.deepEqual(table.header, ['a', 'b', 'c']);
		assert.deepEqual(table.rows[0]?.cells, ['x, y', 'say "hi"', 'two\nlines']);
		assert.deepEqual(table.rows[1]?.cells, ['1', '', '3']);
		assert.equal(table.rows[1]?.line, 4, 'line numbers count the embedded line break');
	});

	it('strips a byte-order mark, skips blank lines and reads a last line without a newline', () => {
		const table = parseCsv('﻿id;n\n\n7;8\r9;10');
		assert.deepEqual(table.header, ['id;n']);
		const semi = parseCsv('﻿id;n\n\n7;8\r9;10', ';');
		assert.deepEqual(semi.header, ['id', 'n']);
		assert.deepEqual(semi.rows.map((r) => r.cells), [['7', '8'], ['9', '10']]);
	});

	it('rejects an unclosed quote', () => {
		assert.throws(() => parseCsv('a\n"open'), CsvError);
	});

	it('returns an empty table for empty input', () => {
		assert.deepEqual(parseCsv(''), {header: [], rows: []});
	});
});

describe('headers', () => {
	it('normalises case, spaces, soft hyphens and the BOM', () => {
		assert.equal(normalizeHeader('﻿  Impres­sions   click-through rate (%) '), 'impressions click-through rate (%)');
		assert.equal(findColumn(['Content', 'VIEWS'], ['Views']), 1);
		assert.equal(findColumn(['Content'], ['Views']), -1);
	});

	it('undoes the hub export formula prefix only before = + - @', () => {
		assert.equal(unprotectCell("'-abc"), '-abc');
		assert.equal(unprotectCell("'=1+1"), '=1+1');
		assert.equal(unprotectCell("'quoted"), "'quoted");
		assert.equal(unprotectCell('plain'), 'plain');
	});
});

describe('value parsers', () => {
	it('parseNumber reads thousands separators, signs, symbols and decimal commas', () => {
		assert.equal(parseNumber('1,234'), 1234);
		assert.equal(parseNumber('1,234,567.89'), 1234567.89);
		assert.equal(parseNumber(' -12.30 '), -12.3);
		assert.equal(parseNumber('$1,005.50'), 1005.5);
		assert.equal(parseNumber('12.5 USD'), 12.5);
		assert.equal(parseNumber('1.234,56', ','), 1234.56);
		assert.equal(parseNumber('12,5', ','), 12.5);
		for (const empty of ['', '—', '-', 'n/a']) assert.equal(parseNumber(empty), null, `"${empty}" is empty`);
		for (const bad of ['12,34', '1,2345', 'abc', '1.2.3', '12abc']) assert.equal(parseNumber(bad), null, `"${bad}" is rejected`);
	});

	it('parseNumber reads accounting negatives, a trailing minus and the Unicode minus sign', () => {
		assert.equal(parseNumber('(12.50)'), -12.5);
		assert.equal(parseNumber('($1,005.50)'), -1005.5);
		assert.equal(parseNumber('12.50-'), -12.5);
		assert.equal(parseNumber('\u221212.50'), -12.5);
		assert.equal(parseNumber('-$12.50'), -12.5);
		assert.equal(parseNumber('(12,30)', ','), -12.3);
		assert.equal(parseNumber('\u2212'), null, 'a lone minus sign is an empty cell');
		for (const bad of ['(-12.50)', '-12.50-', '()', '(12.50']) assert.equal(parseNumber(bad), null, `"${bad}" is rejected`);
	});

	it('isDecimalCommaOnly spots cells that only make sense with a decimal comma', () => {
		for (const cell of ['41,3', '1074,7', '0,5', '1.234,56', '6,1 %']) assert.equal(isDecimalCommaOnly(cell), true, cell);
		for (const cell of ['31,200', '1,234', '41.3', '12', '', 'abc']) assert.equal(isDecimalCommaOnly(cell), false, cell);
	});

	it('parseCount accepts only whole numbers of zero or more', () => {
		assert.equal(parseCount('18,900'), 18900);
		assert.equal(parseCount('0'), 0);
		assert.equal(parseCount('-1'), null);
		assert.equal(parseCount('1.5'), null);
	});

	it('parsePercent returns a fraction', () => {
		assert.equal(parsePercent('4.8'), 0.048);
		assert.equal(parsePercent('4.8%'), 0.048);
		assert.equal(parsePercent('4,8 %', ','), 0.048);
		assert.equal(parsePercent('112.5'), 1.125, 'above 100% is allowed (rewatched Shorts)');
		assert.equal(parsePercent('-1'), null);
		assert.equal(parsePercent(''), null);
	});

	it('parseDuration reads seconds, M:SS and H:MM:SS', () => {
		assert.equal(parseDuration('45'), 45);
		assert.equal(parseDuration('45.5'), 45.5);
		assert.equal(parseDuration('0:45'), 45);
		assert.equal(parseDuration('3:12'), 192);
		assert.equal(parseDuration('0:03:12'), 192);
		assert.equal(parseDuration('1:02:03'), 3723);
		assert.equal(parseDuration('1:60'), null);
		assert.equal(parseDuration('1:02:60'), null);
		assert.equal(parseDuration('abc'), null);
		assert.equal(parseDuration(''), null);
	});

	it('parseDate reads ISO dates and English month names, numeric forms only when named', () => {
		assert.equal(parseDate('2026-10-06'), '2026-10-06');
		assert.equal(parseDate('2026-10-06T14:03:00Z'), '2026-10-06');
		assert.equal(parseDate('Oct 6, 2026'), '2026-10-06');
		assert.equal(parseDate('October 6, 2026'), '2026-10-06');
		assert.equal(parseDate('Sept 9, 2026'), '2026-09-09');
		assert.equal(parseDate('6 Oct 2026'), '2026-10-06');
		assert.equal(parseDate('Octember 6, 2026'), null);
		assert.equal(parseDate('2026-02-30'), null, 'not a calendar date');
		assert.equal(parseDate('11/02/2026'), null, 'ambiguous without a format');
		assert.equal(parseDate('11/02/2026', 'MM/DD/YYYY'), '2026-11-02');
		assert.equal(parseDate('11/02/2026', 'DD/MM/YYYY'), '2026-02-11');
		assert.equal(parseDate('03.11.2026', 'DD.MM.YYYY'), '2026-11-03');
		assert.equal(parseDate('13/13/2026', 'MM/DD/YYYY'), null);
	});
});

describe('writing', () => {
	it('quotes text, neutralises formulas and leaves numbers and empty cells plain', () => {
		assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
		assert.equal(csvCell('-fixture011'), '"\'-fixture011"');
		assert.equal(csvCell(-12.5), '-12.5');
		assert.equal(csvCell(null), '');
		assert.equal(csvCell(Number.NaN), '');
		assert.equal(toCsv(['a', 'b'], [['x', 1]]), '"a","b"\r\n"x",1\r\n');
	});

	it('round-trips through parseCsv', () => {
		const text = toCsv(['title', 'views'], [['Comma, "quote" and\nnewline', 5]]);
		const table = parseCsv(text);
		assert.deepEqual(table.rows[0]?.cells, ['Comma, "quote" and\nnewline', '5']);
	});
});
