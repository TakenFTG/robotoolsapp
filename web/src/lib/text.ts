/**
 * Whitespace at either end of a typed or pasted value, including the invisible characters
 * `String.trim` leaves behind. Web pages and mail clients carry zero-width spaces and word
 * joiners along when text is copied, and a field that rejects one looks broken because
 * there is nothing to see.
 */
const BLANK = String.raw`(?:\s|\u200B|\u200C|\u200D|\u2060)`;
const SURROUNDING_BLANKS = new RegExp(`^${BLANK}+|${BLANK}+$`, 'g');

/** The value without the blanks around it. Blanks inside the value are left alone. */
export function trimBlanks(value: string): string {
	return value.replace(SURROUNDING_BLANKS, '');
}
