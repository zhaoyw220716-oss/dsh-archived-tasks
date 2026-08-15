/**
 * Archived Tasks — Host half.
 *
 * Adds a same-origin HTTP route used by the browser half to permanently delete
 * an archived session. This is intentionally destructive (rm -rf): it removes
 * the session log directory from `data/sessions`, drops the id from the
 * workspace registry's archived set, and detaches it from workspace accounting.
 *
 * The route accepts only POST + same-origin requests, and only session ids that
 * look like DSH session ids (prefix `session-`, lowercase hex body) to avoid
 * path traversal / arbitrary deletion.
 */
import { existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SESSION_ID_RE = /^session-[0-9a-f-]+$/;

/**
 * Locate the harness `data` root by walking up from this module until a
 * directory contains `sessions` (the data root itself) or has a `data` child
 * that does (the harness root). Works for both the local vendor layout and a
 * published install under `<harness>/data/profiles/web/node_modules/...`.
 *
 * @param {string} startDir absolute path of this module's directory.
 * @returns {string | undefined} the harness `data` root when found.
 */
function findDataRoot(startDir) {
	let dir = startDir;
	for (let depth = 0; depth < 16; depth++) {
		if (existsSync(join(dir, 'sessions'))) return dir;
		if (existsSync(join(dir, 'data', 'sessions'))) return join(dir, 'data');
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return undefined;
}

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_ROOT = findDataRoot(MODULE_DIR) ?? join(MODULE_DIR, '..', '..', '..', '..', '..', '..', 'data');

/**
 * Locate the session log directory under `data/sessions`.
 *
 * The harness stores sessions as `data/sessions/<encoded-cwd>/<session-id>/`.
 * We scan one level deep so we do not need to know the exact cwd encoding.
 *
 * @param {string} sessionsRoot absolute path to the `data/sessions` directory.
 * @param {string} sessionId validated DSH session id.
 * @returns {string | undefined} the session directory when found.
 */
function findSessionDir(sessionsRoot, sessionId) {
	if (!existsSync(sessionsRoot)) return undefined;
	for (const cwdEntry of readdirSafe(sessionsRoot)) {
		const candidate = join(sessionsRoot, cwdEntry.name, sessionId);
		if (cwdEntry.isDirectory() && existsSync(candidate) && isDirectory(candidate)) {
			return candidate;
		}
	}
	return undefined;
}

function readdirSafe(dir) {
	try {
		return readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
}

function isDirectory(path) {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function sendJson(response, status, body) {
	const payload = JSON.stringify(body);
	response.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'content-length': Buffer.byteLength(payload),
	});
	response.end(payload);
}

function readJsonBody(request) {
	return new Promise((resolve, reject) => {
		let data = '';
		request.on('data', (chunk) => {
			data += chunk;
			if (data.length > 64 * 1024) {
				reject(new Error('body too large'));
				request.destroy();
			}
		});
		request.on('end', () => {
			try {
				resolve(data.length === 0 ? {} : JSON.parse(data));
			} catch (error) {
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
		request.on('error', reject);
	});
}

/**
 * Permanently delete an archived session.
 *
 * Unlike the workspace.delete RPC (which only unregisters a workspace and keeps
 * session logs), this removes the session log directory itself and clears every
 * registry reference to the id.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx Host context.
 * @param {object} opts
 * @param {string} opts.dataRoot absolute path to the harness `data` directory.
 * @param {string} opts.sessionId validated session id.
 */
async function deleteArchivedSession(ctx, { dataRoot, sessionId }) {
	// Resolve the registry before deleting anything so a missing service cannot
	// leave the log removed without the registry being updated.
	const registry = ctx.get('workspaceRegistry');
	if (registry === undefined || typeof registry.global?.set !== 'function' || typeof registry.table?.update !== 'function') {
		throw new Error('workspaceRegistry service is unavailable; refusing to delete without registry synchronization');
	}

	const sessionsRoot = join(dataRoot, 'sessions');
	const sessionDir = findSessionDir(sessionsRoot, sessionId);
	let removedLog = false;

	if (sessionDir !== undefined) {
		// Defensive: never delete a path that isn't a directory directly under
		// `data/sessions/<one-level>/<session-id>`.
		const rel = sessionDir.slice(sessionsRoot.length + 1).split(sep);
		if (rel.length !== 2 || rel[1] !== sessionId) {
			throw new Error(`refusing to delete unexpected session path: ${sessionDir}`);
		}
		rmSync(sessionDir, { recursive: true, force: true });
		removedLog = true;
	}

	// Remove the session from the in-memory SessionStore when it is resident.
	// The disk log is already gone; without this the Host keeps advertising the
	// id in session.list, which makes the sidebar show it under "未分类".
	const sessionsStore = ctx.get('sessions');
	if (sessionsStore !== undefined && typeof sessionsStore?.store?.get === 'function') {
		const entry = sessionsStore.store.get(sessionId);
		if (entry !== undefined && typeof entry.detach === 'function') {
			try {
				entry.detach();
			} catch (error) {
				ctx.logger?.warn?.(`archived-tasks: failed to detach in-memory session ${sessionId}: ${String(error)}`);
			}
		}
	}

	// Synchronize the durable workspace registry so the running Host no longer
	// advertises the session. Using the domain handles (instead of hand-editing
	// workspace.json) keeps memory and storage coherent and emits the same
	// domain/changed events the Host stream uses to notify the browser.
	{
		const state = registry.global.get();
		if (state && Array.isArray(state.archivedSessionIds)) {
			const nextArchived = state.archivedSessionIds.filter((id) => id !== sessionId);
			if (nextArchived.length !== state.archivedSessionIds.length) {
				const nextState = {
					...state,
					archivedSessionIds: nextArchived,
				};
				// global.set already persists and emits domain/changed. Also keep
				// the internal snapshot (registry.state) in sync without triggering
				// a second durable write.
				await registry.global.set(nextState);
				registry.state = nextState;
			}
		}
	}

	// Detach the id from every workspace's accounting list. We go through the
	// domain table directly (not the entity getter) because the getter filters
	// by the session-path index; after deleting the log the header may already
	// be gone, yet the durable record still lists the id.
	for (const [workspaceId, record] of registry.table.entries()) {
		if (!record || !Array.isArray(record.sessionIds) || !record.sessionIds.includes(sessionId)) continue;
		const nextRecord = {
			...record,
			sessionIds: record.sessionIds.filter((id) => id !== sessionId),
			updatedAt: new Date().toISOString(),
		};
		await registry.table.update(workspaceId, () => nextRecord);
		const entity = registry.get(workspaceId);
		if (entity) entity.record = nextRecord;
	}

	return { ok: true, sessionId, removedLog };
}

/**
 * Restore an archived session by removing it from the registry-global archive
 * set. The session log and workspace accounting remain untouched.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx Host context.
 * @param {string} sessionId validated session id.
 */
async function restoreArchivedSession(ctx, sessionId) {
	const registry = ctx.get('workspaceRegistry');
	if (registry === undefined || typeof registry.global?.set !== 'function') {
		throw new Error('workspaceRegistry service is unavailable; cannot restore session');
	}

	const state = registry.global.get();
	if (!state || !Array.isArray(state.archivedSessionIds)) {
		throw new Error('workspace registry state is malformed');
	}

	const nextArchived = state.archivedSessionIds.filter((id) => id !== sessionId);
	if (nextArchived.length === state.archivedSessionIds.length) {
		return { ok: true, sessionId, changed: false };
	}

	const nextState = {
		...state,
		archivedSessionIds: nextArchived,
	};
	await registry.global.set(nextState);
	registry.state = nextState;
	return { ok: true, sessionId, changed: true };
}

/**
 * Bundle plugin Host entry.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {any} config
 */
export function apply(ctx, config = {}) {
	ctx.inject(['webServer'], (hostCtx) => {
		const webServer = hostCtx.webServer;
		hostCtx.effect(() => {
			const disposeDelete = webServer.register({
				kind: 'exact',
				path: '/dsh-archived-tasks/delete',
				handler: async (request, response) => {
					if (request.method !== 'POST') {
						response.writeHead(405, { allow: 'POST' });
						response.end();
						return;
					}

					// Same-origin only. Host header check is a light CSRF guard.
					const host = request.headers.host;
					const origin = request.headers.origin;
					if (origin !== undefined && host !== undefined) {
						try {
							const originUrl = new URL(origin);
							if (originUrl.host !== host) {
								sendJson(response, 403, { ok: false, error: 'forbidden origin' });
								return;
							}
						} catch {
							sendJson(response, 403, { ok: false, error: 'invalid origin' });
							return;
						}
					}

					let body;
					try {
						body = await readJsonBody(request);
					} catch (error) {
						sendJson(response, 400, {
							ok: false,
							error: error instanceof Error ? error.message : String(error),
						});
						return;
					}

					const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
					if (!SESSION_ID_RE.test(sessionId)) {
						sendJson(response, 400, { ok: false, error: 'invalid session id' });
						return;
					}

					try {
						const dataRoot = config.dataRoot || process.env.DSH_DATA_ROOT || process.env.DSH_HOME || DEFAULT_DATA_ROOT;
						const result = await deleteArchivedSession(hostCtx, { dataRoot, sessionId });
						sendJson(response, 200, result);
					} catch (error) {
						sendJson(response, 500, {
							ok: false,
							error: error instanceof Error ? error.message : String(error),
						});
					}
				},
			});

			const disposeRestore = webServer.register({
				kind: 'exact',
				path: '/dsh-archived-tasks/restore',
				handler: async (request, response) => {
					if (request.method !== 'POST') {
						response.writeHead(405, { allow: 'POST' });
						response.end();
						return;
					}

					// Same-origin only. Host header check is a light CSRF guard.
					const host = request.headers.host;
					const origin = request.headers.origin;
					if (origin !== undefined && host !== undefined) {
						try {
							const originUrl = new URL(origin);
							if (originUrl.host !== host) {
								sendJson(response, 403, { ok: false, error: 'forbidden origin' });
								return;
							}
						} catch {
							sendJson(response, 403, { ok: false, error: 'invalid origin' });
							return;
						}
					}

					let body;
					try {
						body = await readJsonBody(request);
					} catch (error) {
						sendJson(response, 400, {
							ok: false,
							error: error instanceof Error ? error.message : String(error),
						});
						return;
					}

					const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
					if (!SESSION_ID_RE.test(sessionId)) {
						sendJson(response, 400, { ok: false, error: 'invalid session id' });
						return;
					}

					try {
						const result = await restoreArchivedSession(hostCtx, sessionId);
						sendJson(response, 200, result);
					} catch (error) {
						sendJson(response, 500, {
							ok: false,
							error: error instanceof Error ? error.message : String(error),
						});
					}
				},
			});

			return () => {
				disposeDelete();
				disposeRestore();
			};
		}, 'dsh-archived-tasks: delete + restore routes');
	});
}
