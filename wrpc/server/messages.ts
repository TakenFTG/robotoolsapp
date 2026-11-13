import { z } from 'zod';
import type { InferParser } from './types';

// Zod schemas for runtime validation

export const WRPCRequestSchema = z.object({
	kind: z.literal('request'),
	id: z.string(),
	type: z.enum(['query', 'mutation']), // ProcedureType values
	path: z.string(),
	/**
	 * Absent for a procedure declared without `.input()`, which is most of them.
	 *
	 * `.optional()` is load-bearing, not decoration. `z.unknown()` used to make a key
	 * optional implicitly; as of Zod 4.4 it requires the key to be present. JSON.stringify
	 * drops a key whose value is undefined, so `{ input: undefined }` goes on the wire as no
	 * key at all — and every no-input call (getServerInfo, getJudges, getTeamData,
	 * startAwardDeliberation, and the rest) was rejected with PARSE_ERROR before the
	 * server could work out which request it even was.
	 */
	input: z.unknown().optional()
});

export type WRPCRequest = InferParser<typeof WRPCRequestSchema>;

export const WRPCResponseSchema = z.object({
	kind: z.literal('response'),
	id: z.string(),
	result: z.discriminatedUnion('type', [
		z.object({
			type: z.literal('data'),
			/** Absent when a procedure resolves to undefined. Optional for the same reason as `input`. */
			data: z.unknown().optional()
		}),
		z.object({
			type: z.literal('error'),
			error: z.object({
				message: z.string(),
				code: z.string().optional()
			})
		})
	])
});

export type WRPCResponse = InferParser<typeof WRPCResponseSchema>;

export const WRPCPingSchema = z.object({
	kind: z.literal('ping')
});

export type WRPCPing = InferParser<typeof WRPCPingSchema>;

export const WRPCPongSchema = z.object({
	kind: z.literal('pong')
});

export type WRPCPong = InferParser<typeof WRPCPongSchema>;

// Proper discriminated union using the 'kind' field

export const WRPCMessageSchema = z.discriminatedUnion('kind', [WRPCRequestSchema, WRPCResponseSchema, WRPCPingSchema, WRPCPongSchema]);
