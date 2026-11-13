// import { m } from './paraglide/messages.js';
import DOMPurify from 'dompurify';

// Escape HTML entities to prevent XSS
function escapeHtml(text: unknown): unknown {
	if (typeof text !== 'string') return text;
	const map: Record<string, string> = {
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&#039;'
	};
	return text.replace(/[&<>"']/g, (char) => map[char]);
}

// Sanitize all string values in an inputs object
function sanitizeInputs<T extends Record<string, unknown>>(inputs: T): T {
	const sanitized = {} as T;
	for (const key in inputs) {
		sanitized[key] = escapeHtml(inputs[key]) as T[typeof key];
	}
	return sanitized;
}

/**
 * A paraglide message function: an optional inputs object, then options.
 *
 * `never[]` rather than `any[]` in the constraint. Parameters are contravariant, so the
 * bottom type is what makes an arbitrary concrete signature assignable here — `any[]`
 * happened to work by switching type checking off rather than by being correct.
 */
type MessageFunction = (...args: never[]) => string;

type FirstParameter<T extends MessageFunction> = Parameters<T>[0];

type OtherParameters<T extends MessageFunction> = Parameters<T> extends [unknown, ...infer Rest] ? Rest : [];

export function sanitizeHTMLMessage<Fn extends MessageFunction>(fn: Fn, inputs?: FirstParameter<Fn>, ...args: OtherParameters<Fn>): string {
	const sanitizedInputs = inputs ? sanitizeInputs(inputs) : inputs;
	const result = (fn as unknown as (...callArgs: unknown[]) => string)(sanitizedInputs, ...args);
	return DOMPurify.sanitize(result, { ALLOWED_TAGS: ['b', 'i', 'u', 'br'], ALLOWED_ATTR: [], ADD_TAGS: ['green', 'red', 'slate'] });
}
