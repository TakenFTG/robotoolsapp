import { describe, expect, it } from 'vitest';
import { trimBlanks } from './text';

describe('trimBlanks', () => {
	it('removes spaces, tabs and line breaks from both ends', () => {
		expect(trimBlanks(' \t RE-V5RC-25-1234 \n')).toBe('RE-V5RC-25-1234');
	});

	it('removes non-breaking and zero-width characters from both ends', () => {
		expect(trimBlanks(' ​RE-V5RC-25-1234‍﻿')).toBe('RE-V5RC-25-1234');
	});

	it('keeps blanks inside the value', () => {
		expect(trimBlanks('  Ada  Lovelace ')).toBe('Ada  Lovelace');
	});

	it('returns an empty string for a value that is only blanks', () => {
		expect(trimBlanks(' ​ ')).toBe('');
	});
});
