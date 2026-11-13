import { describe, it, expect } from 'vitest';
import { isLockFreeFrame } from './lock-free';

const frame = (value: object) => JSON.stringify(value);

describe('isLockFreeFrame', () => {
	it('lets replies, pings and pongs through, as before', () => {
		expect(isLockFreeFrame(frame({ kind: 'response', id: '1' }))).toBe(true);
		expect(isLockFreeFrame(frame({ kind: 'ping' }))).toBe(true);
		expect(isLockFreeFrame(frame({ kind: 'pong' }))).toBe(true);
	});

	it('lets the match snapshot query skip the room lock', () => {
		expect(isLockFreeFrame(frame({ kind: 'request', id: '1', type: 'query', path: 'matches.getSnapshot', input: { force: true } }))).toBe(
			true
		);
	});

	it('lets email sends skip the room lock', () => {
		expect(isLockFreeFrame(frame({ kind: 'request', id: '1', type: 'mutation', path: 'access.sendAccessLinkEmails', input: {} }))).toBe(
			true
		);
		expect(
			isLockFreeFrame(frame({ kind: 'request', id: '1', type: 'mutation', path: 'access.sendAdvisorAccessLinkEmail', input: {} }))
		).toBe(true);
	});

	it('requires the type each procedure actually has', () => {
		expect(isLockFreeFrame(frame({ kind: 'request', id: '1', type: 'query', path: 'access.sendAccessLinkEmails' }))).toBe(false);
	});

	it('keeps every other request on the lock', () => {
		expect(isLockFreeFrame(frame({ kind: 'request', id: '1', type: 'mutation', path: 'matches.getSnapshot' }))).toBe(false);
		expect(isLockFreeFrame(frame({ kind: 'request', id: '1', type: 'mutation', path: 'judging.submitTeamInterviewRubric' }))).toBe(false);
		expect(isLockFreeFrame(frame({ kind: 'request', id: '1', type: 'query', path: 'matches' }))).toBe(false);
		expect(isLockFreeFrame(frame({ kind: 'request', id: '1', type: 'query' }))).toBe(false);
	});

	it('sends anything unparseable to the locked path', () => {
		expect(isLockFreeFrame('not json')).toBe(false);
		expect(isLockFreeFrame('null')).toBe(false);
		expect(isLockFreeFrame('"ping"')).toBe(false);
	});
});
