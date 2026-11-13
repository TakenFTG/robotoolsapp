import { describe, expect, it } from 'vitest';
import { describeEvent, readSavedEvents, removeEvent, upsertLink, type SavedRefEvent } from './saved-events';

const ROOM_A = '6f1c2a8e-3b4d-4c5e-9f60-718293a4b5c6';
const ROOM_B = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const TOKEN_1 = 'a'.repeat(12);
const TOKEN_2 = 'b'.repeat(12);

function saved(overrides: Partial<SavedRefEvent>): SavedRefEvent {
	return { roomId: ROOM_A, authToken: TOKEN_1, eventName: 'MS comp', refName: 'Sam', role: 'head_referee', lastOpenedAt: 1, ...overrides };
}

describe('saved ref events', () => {
	it('moves the single link older versions saved into the list', () => {
		const events = readSavedEvents(null, JSON.stringify({ roomId: ROOM_A, authToken: TOKEN_1 }));
		expect(events).toEqual([{ roomId: ROOM_A, authToken: TOKEN_1, eventName: null, refName: null, role: null, lastOpenedAt: 0 }]);
	});

	it('prefers the list over the old link once there is one', () => {
		const list = JSON.stringify([saved({ roomId: ROOM_B })]);
		expect(readSavedEvents(list, JSON.stringify({ roomId: ROOM_A, authToken: TOKEN_1 })).map((event) => event.roomId)).toEqual([ROOM_B]);
	});

	it('drops entries that do not parse and keeps the rest', () => {
		const list = JSON.stringify([saved({}), { roomId: 'nope' }, saved({ roomId: ROOM_B, lastOpenedAt: 5 })]);
		expect(readSavedEvents(list, null).map((event) => event.roomId)).toEqual([ROOM_B, ROOM_A]);
	});

	it('reads nothing from rubbish', () => {
		expect(readSavedEvents('{not json', 'also not')).toEqual([]);
	});

	it('adds a second event without losing the first', () => {
		const events = upsertLink([saved({})], { roomId: ROOM_B, authToken: TOKEN_2 }, 10);
		expect(events.map((event) => event.roomId)).toEqual([ROOM_B, ROOM_A]);
	});

	it('replaces the link for an event already saved, and forgets who held the old one', () => {
		const events = upsertLink([saved({})], { roomId: ROOM_A, authToken: TOKEN_2 }, 10);
		expect(events).toEqual([saved({ authToken: TOKEN_2, refName: null, role: null, lastOpenedAt: 10 })]);
	});

	it('keeps who we are when the same link is opened again', () => {
		const events = upsertLink([saved({})], { roomId: ROOM_A, authToken: TOKEN_1 }, 10);
		expect(events).toEqual([saved({ lastOpenedAt: 10 })]);
	});

	it('records what the room says about itself', () => {
		const events = describeEvent([saved({ eventName: null })], ROOM_A, { eventName: 'HS comp', refName: 'Sam', role: 'referee' });
		expect(events[0]).toMatchObject({ eventName: 'HS comp', role: 'referee' });
	});

	it('removes one event and leaves the others', () => {
		expect(removeEvent([saved({}), saved({ roomId: ROOM_B })], ROOM_A).map((event) => event.roomId)).toEqual([ROOM_B]);
	});
});
