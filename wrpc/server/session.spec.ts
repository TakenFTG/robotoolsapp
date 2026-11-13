/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createServerSideSession } from './session';
import type { Network } from './types';
import type { WRPCRequest, WRPCResponse } from './messages';

describe('Server-side Session', () => {
	let mockNetwork: Network;
	let session: ReturnType<typeof createServerSideSession>;

	beforeEach(() => {
		mockNetwork = {
			sendToClient: vi.fn(),
			notifyClient: vi.fn(),
			notifyAll: vi.fn((): string[] => []),
			broadcast: vi.fn(),
			getConnectedClients: vi.fn(),
			isClientConnected: vi.fn(),
			isDeviceConnected: vi.fn(),
			getAllClientData: vi.fn(),
			getClientData: vi.fn(),
			kickClient: vi.fn(),
			destroy: vi.fn()
		};

		session = createServerSideSession(mockNetwork, 'test-room-id', 'test-client-id', 'test-device-id', 'Test Device');
	});

	describe('session metadata', () => {
		it('should have correct roomId', () => {
			expect(session.roomId).toBe('test-room-id');
		});

		it('should have correct currentClient metadata', () => {
			expect(session.currentClient).toEqual({
				clientId: 'test-client-id',
				deviceId: 'test-device-id',
				deviceName: 'Test Device'
			});
		});
	});

	describe('getClient', () => {
		it('should create a client proxy that can call query procedures', async () => {
			const mockResponse: WRPCResponse = {
				kind: 'response',
				id: 'test-id',
				result: { type: 'data', data: 'test result' }
			};

			vi.mocked(mockNetwork.sendToClient).mockResolvedValue(mockResponse);

			const clientProxy = session.getClient('target-client-id');
			const result = await (clientProxy as any).testProcedure.query('test input');

			expect(mockNetwork.notifyClient).toHaveBeenCalledWith(
				'target-client-id',
				expect.objectContaining({
					kind: 'request',
					type: 'query',
					path: 'testProcedure',
					input: 'test input',
					id: expect.any(String)
				})
			);
			// Notifications resolve to undefined: there is no reply to hand back.
			expect(result).toBeUndefined();
		});

		it('should create a client proxy that can call mutation procedures', async () => {
			const mockResponse: WRPCResponse = {
				kind: 'response',
				id: 'test-id',
				result: { type: 'data', data: 'mutation result' }
			};

			vi.mocked(mockNetwork.sendToClient).mockResolvedValue(mockResponse);

			const clientProxy = session.getClient('target-client-id');
			const result = await (clientProxy as any).updateData.mutation({ value: 42 });

			expect(mockNetwork.notifyClient).toHaveBeenCalledWith(
				'target-client-id',
				expect.objectContaining({
					kind: 'request',
					type: 'mutation',
					path: 'updateData',
					input: { value: 42 },
					id: expect.any(String)
				})
			);
			// Notifications resolve to undefined: there is no reply to hand back.
			expect(result).toBeUndefined();
		});

		it('should handle nested router properties', async () => {
			const mockResponse: WRPCResponse = {
				kind: 'response',
				id: 'test-id',
				result: { type: 'data', data: 'nested result' }
			};

			vi.mocked(mockNetwork.sendToClient).mockResolvedValue(mockResponse);

			const clientProxy = session.getClient('target-client-id');
			const result = await (clientProxy as any).nested.query('nested input');

			expect(mockNetwork.notifyClient).toHaveBeenCalledWith(
				'target-client-id',
				expect.objectContaining({
					kind: 'request',
					type: 'query',
					path: 'nested',
					input: 'nested input',
					id: expect.any(String)
				})
			);
			// Notifications resolve to undefined: there is no reply to hand back.
			expect(result).toBeUndefined();
		});

		it('should support multi-segment nested paths for client query', async () => {
			const mockResponse: WRPCResponse = {
				kind: 'response',
				id: 'test-id',
				result: { type: 'data', data: 'multi nested result' }
			};

			vi.mocked(mockNetwork.sendToClient).mockResolvedValue(mockResponse);

			const clientProxy = session.getClient('target-client-id');
			const result = await (clientProxy as any).handshake.createJudgesRoom.query({ ok: true });

			expect(mockNetwork.notifyClient).toHaveBeenCalledWith(
				'target-client-id',
				expect.objectContaining({
					kind: 'request',
					type: 'query',
					path: 'handshake.createJudgesRoom',
					input: { ok: true },
					id: expect.any(String)
				})
			);
			// Notifications resolve to undefined: there is no reply to hand back.
			expect(result).toBeUndefined();
		});

		it('should handle query as an intermediate path segment', async () => {
			const mockResponse: WRPCResponse = {
				kind: 'response',
				id: 'test-id',
				result: { type: 'data', data: { items: [] } }
			};

			vi.mocked(mockNetwork.sendToClient).mockResolvedValue(mockResponse);

			const clientProxy = session.getClient('target-client-id');
			// Accessing 'query' as a path segment, then calling .query() as terminal
			const result = await (clientProxy as any).query.list.query();

			expect(mockNetwork.notifyClient).toHaveBeenCalledWith(
				'target-client-id',
				expect.objectContaining({
					kind: 'request',
					type: 'query',
					path: 'query.list',
					input: undefined,
					id: expect.any(String)
				})
			);
			expect(result).toBeUndefined();
		});

		it('should handle mutation as an intermediate path segment', async () => {
			const mockResponse: WRPCResponse = {
				kind: 'response',
				id: 'test-id',
				result: { type: 'data', data: { success: true } }
			};

			vi.mocked(mockNetwork.sendToClient).mockResolvedValue(mockResponse);

			const clientProxy = session.getClient('target-client-id');
			// Accessing 'mutation' as a path segment, then calling .mutation() as terminal
			const result = await (clientProxy as any).mutation.update.mutation({ id: 1 });

			expect(mockNetwork.notifyClient).toHaveBeenCalledWith(
				'target-client-id',
				expect.objectContaining({
					kind: 'request',
					type: 'mutation',
					path: 'mutation.update',
					input: { id: 1 },
					id: expect.any(String)
				})
			);
			expect(result).toBeUndefined();
		});

		it('should handle deeply nested paths with query/mutation as segments', async () => {
			const mockResponse: WRPCResponse = {
				kind: 'response',
				id: 'test-id',
				result: { type: 'data', data: { profile: 'data' } }
			};

			vi.mocked(mockNetwork.sendToClient).mockResolvedValue(mockResponse);

			const clientProxy = session.getClient('target-client-id');
			// Complex path: user.query.profile.query()
			const result = await (clientProxy as any).user.query.profile.query();

			expect(mockNetwork.notifyClient).toHaveBeenCalledWith(
				'target-client-id',
				expect.objectContaining({
					kind: 'request',
					type: 'query',
					path: 'user.query.profile',
					input: undefined,
					id: expect.any(String)
				})
			);
			expect(result).toBeUndefined();
		});

		it('should handle query as both path segment and terminal method', async () => {
			const mockResponse1: WRPCResponse = {
				kind: 'response',
				id: 'test-id',
				result: { type: 'data', data: 'result1' }
			};
			const mockResponse2: WRPCResponse = {
				kind: 'response',
				id: 'test-id',
				result: { type: 'data', data: 'result2' }
			};

			const clientProxy = session.getClient('target-client-id');

			// Test 1: query as terminal method only
			vi.mocked(mockNetwork.sendToClient).mockResolvedValue(mockResponse1);
			const result1 = await (clientProxy as any).getStatus.query();
			expect(mockNetwork.notifyClient).toHaveBeenCalledWith(
				'target-client-id',
				expect.objectContaining({
					type: 'query',
					path: 'getStatus'
				})
			);
			expect(result1).toBeUndefined();

			// Test 2: query as path segment
			vi.mocked(mockNetwork.sendToClient).mockResolvedValue(mockResponse2);
			const result2 = await (clientProxy as any).query.getStatus.query();
			expect(mockNetwork.notifyClient).toHaveBeenCalledWith(
				'target-client-id',
				expect.objectContaining({
					type: 'query',
					path: 'query.getStatus'
				})
			);
			expect(result2).toBeUndefined();
		});
	});

	describe('broadcast', () => {
		it('should create a broadcast proxy that can call procedures on all clients', async () => {
			const mockResponses: WRPCResponse[] = [
				{
					kind: 'response',
					id: 'test-id-client1',
					result: { type: 'data', data: 'response from client 1' }
				},
				{
					kind: 'response',
					id: 'test-id-client2',
					result: { type: 'data', data: 'response from client 2' }
				}
			];

			vi.mocked(mockNetwork.broadcast).mockResolvedValue(mockResponses);

			const broadcastProxy = session.broadcast();
			const results = await (broadcastProxy as any).notifyAll.mutation('broadcast message');

			expect(mockNetwork.notifyAll).toHaveBeenCalledWith(
				expect.objectContaining({
					kind: 'request',
					type: 'mutation',
					path: 'notifyAll',
					input: 'broadcast message',
					id: expect.any(String)
				})
			);
			// notifyAll reports the clients it could not write to, not a reply per client.
			expect(results).toEqual([]);
		});

		it('should support multi-segment nested paths for broadcast mutation', async () => {
			const mockResponses: WRPCResponse[] = [
				{ kind: 'response', id: 'id-1', result: { type: 'data', data: 1 } },
				{ kind: 'response', id: 'id-2', result: { type: 'data', data: 2 } }
			];

			vi.mocked(mockNetwork.broadcast).mockResolvedValue(mockResponses);

			const broadcastProxy = session.broadcast();
			const results = await (broadcastProxy as any).handshake.createJudgesRoom.mutation({ a: 1 });

			expect(mockNetwork.notifyAll).toHaveBeenCalledWith(
				expect.objectContaining({
					kind: 'request',
					type: 'mutation',
					path: 'handshake.createJudgesRoom',
					input: { a: 1 },
					id: expect.any(String)
				})
			);
			// notifyAll reports the clients it could not write to, not a reply per client.
			expect(results).toEqual([]);
		});

		it('should handle query as an intermediate path segment in broadcast', async () => {
			const mockResponses: WRPCResponse[] = [{ kind: 'response', id: 'id-1', result: { type: 'data', data: { items: [] } } }];

			vi.mocked(mockNetwork.broadcast).mockResolvedValue(mockResponses);

			const broadcastProxy = session.broadcast();
			const results = await (broadcastProxy as any).query.list.query();

			expect(mockNetwork.notifyAll).toHaveBeenCalledWith(
				expect.objectContaining({
					kind: 'request',
					type: 'query',
					path: 'query.list',
					input: undefined,
					id: expect.any(String)
				})
			);
			// notifyAll reports the clients it could not write to, not a reply per client.
			expect(results).toEqual([]);
		});

		it('should handle mutation as an intermediate path segment in broadcast', async () => {
			const mockResponses: WRPCResponse[] = [{ kind: 'response', id: 'id-1', result: { type: 'data', data: { success: true } } }];

			vi.mocked(mockNetwork.broadcast).mockResolvedValue(mockResponses);

			const broadcastProxy = session.broadcast();
			const results = await (broadcastProxy as any).mutation.update.mutation({ id: 1 });

			expect(mockNetwork.notifyAll).toHaveBeenCalledWith(
				expect.objectContaining({
					kind: 'request',
					type: 'mutation',
					path: 'mutation.update',
					input: { id: 1 },
					id: expect.any(String)
				})
			);
			// notifyAll reports the clients it could not write to, not a reply per client.
			expect(results).toEqual([]);
		});
	});

	describe('getServer', () => {
		it('should throw an error when called from server-side session', () => {
			expect(() => session.getServer()).toThrow(
				'getServer() cannot be called from server-side session. Server procedures should be called directly.'
			);
		});
	});
});
