import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {benjaminiHochberg, clusteredOls, invert, leastSquares, median, oneSampleT, olsSlope, quantile, seededRandom, tCdf, tQuantile, tTwoSidedP, welchT} from './stats.ts';

const close = (actual: number, expected: number, tol = 1e-4) => assert.ok(Math.abs(actual - expected) <= tol, `${actual} is not within ${tol} of ${expected}`);

describe('Student t', () => {
	it('matches published 97.5% quantiles', () => {
		close(tQuantile(0.975, 1), 12.7062, 1e-3);
		close(tQuantile(0.975, 4), 2.7764);
		close(tQuantile(0.975, 10), 2.2281);
		close(tQuantile(0.975, 30), 2.0423);
		close(tQuantile(0.025, 10), -2.2281);
	});
	it('gives two-sided p-values and a symmetric CDF', () => {
		close(tTwoSidedP(2, 10), 0.07339);
		close(tTwoSidedP(0, 5), 1);
		close(tCdf(1.5, 7) + tCdf(-1.5, 7), 1, 1e-12);
		assert.equal(tTwoSidedP(Infinity, 3), 0);
	});
});

describe('tests and intervals', () => {
	it('one-sample t: mean, interval and d_z', () => {
		const r = oneSampleT([1, 2, 3, 4, 5])!;
		close(r.estimate, 3);
		close(r.se, Math.sqrt(2.5 / 5));
		close(r.ci95[0], 3 - 2.7764 * Math.sqrt(0.5));
		close(r.dz!, 3 / Math.sqrt(2.5));
		assert.equal(oneSampleT([1]), null);
	});
	it("Welch's t matches R (t.test(1:5, c(2,4,6,8,10)))", () => {
		const r = welchT([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])!;
		close(r.estimate, -3);
		close(r.t, -1.8974);
		close(r.df, 5.8824);
		close(r.p, 0.1075);
	});
	it('handles identical observations without dividing by zero', () => {
		const r = oneSampleT([2, 2, 2])!;
		assert.equal(r.p, 0);
		assert.deepEqual(r.ci95, [2, 2]);
		assert.equal(oneSampleT([0, 0, 0])!.p, 1);
	});
	it('least-squares slope with its interval', () => {
		const r = olsSlope([1, 2, 3, 4, 5], [2.1, 3.9, 6.2, 7.8, 10.1])!;
		close(r.estimate, 1.99);
		close(r.intercept, 0.05);
		assert.ok(r.p < 0.001);
		assert.equal(olsSlope([1, 1, 1], [1, 2, 3]), null, 'x must vary');
	});
	it('Benjamini-Hochberg q-values keep the input order and are monotone', () => {
		assert.deepEqual(benjaminiHochberg([0.01, 0.04, 0.03, 0.005]), [0.02, 0.04, 0.04, 0.02]);
		assert.deepEqual(benjaminiHochberg([0.5]), [0.5]);
		assert.deepEqual(benjaminiHochberg([]), []);
	});
	it('quantile and median (type 7)', () => {
		assert.equal(median([3, 1, 2]), 2);
		assert.equal(median([4, 1, 2, 3]), 2.5);
		assert.equal(quantile([1, 2, 3, 4], 0.25), 1.75);
		assert.equal(median([]), null);
	});
});

describe('least squares and clustered errors', () => {
	it('inverts, and refuses a singular matrix', () => {
		const inv = invert([
			[4, 2],
			[2, 3],
		])!;
		close(inv[0]![0]!, 0.375);
		close(inv[0]![1]!, -0.25);
		assert.equal(invert([[1, 2], [2, 4]]), null);
	});
	it('weighted least squares recovers exact coefficients', () => {
		const X = [[1, 0], [1, 1], [1, 2], [1, 3]];
		const fit = leastSquares(X, [1, 3, 5, 7], [1, 2, 1, 2])!;
		close(fit.beta[0]!, 1);
		close(fit.beta[1]!, 2);
	});
	it('with one observation per cluster, CR1 equals HC1 (White with n/(n-p))', () => {
		const x = [1, 2, 3, 4, 5, 6];
		const y = [1.2, 1.9, 3.4, 3.8, 5.6, 5.9];
		const X = x.map((v) => [1, v]);
		const fit = clusteredOls(X, y, x.map(String))!;
		// HC1 by hand
		const n = 6;
		const p = 2;
		const xtxInv = invert([
			[n, x.reduce((a, b) => a + b, 0)],
			[x.reduce((a, b) => a + b, 0), x.reduce((a, b) => a + b * b, 0)],
		])!;
		const r = y.map((v, i) => v - (fit.beta[0]! + fit.beta[1]! * x[i]!));
		const meat = [
			[0, 0],
			[0, 0],
		];
		x.forEach((v, i) => {
			const row = [1, v];
			for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) meat[a]![b]! += row[a]! * row[b]! * r[i]! ** 2;
		});
		let v11 = 0;
		for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) v11 += xtxInv[1]![i]! * meat[i]![j]! * xtxInv[j]![1]!;
		close(fit.se[1]!, Math.sqrt((v11 * n) / (n - p)), 1e-9);
		assert.equal(fit.df, 5);
		assert.equal(fit.clusters, 6);
	});
	it('clusters widen the error when observations within a cluster move together', () => {
		const random = seededRandom(3);
		const X: number[][] = [];
		const y: number[] = [];
		const clusters: string[] = [];
		for (let g = 0; g < 10; g++) {
			const shock = random() * 4 - 2; // shared within the cluster
			const xg = g % 2;
			for (let k = 0; k < 8; k++) {
				X.push([1, xg]);
				y.push(1 + 0.5 * xg + shock + (random() - 0.5) * 0.1);
				clusters.push(`c${g}`);
			}
		}
		const clustered = clusteredOls(X, y, clusters)!;
		const naive = clusteredOls(X, y, y.map((_, i) => `i${i}`))!;
		assert.ok(clustered.se[1]! > naive.se[1]! * 1.5, `${clustered.se[1]} vs ${naive.se[1]}`);
		assert.equal(clustered.df, 9);
	});
});
