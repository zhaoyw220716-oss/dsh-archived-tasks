window.__ModuleLoader__.load({
	id: "dsh-archived-tasks",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		const DELETE_ENDPOINT = "/dsh-archived-tasks/delete";
		const RESTORE_ENDPOINT = "/dsh-archived-tasks/restore";

		// ── settings section entry ──
		function apply(ctx) {
			const slots = ctx.get("slots");
			if (slots === undefined) return;

			slots.inject("settings.section", () => slots.register(
				{
					name: "settings.section",
					id: "archived-tasks",
					order: 30,
					label: "已归档任务",
				},
				(props) => {
					const sessions = props.useSessions((state) => state.byId);
					const archivedSessionIds = props.useWorkspaces((state) => state.archivedSessionIds);
					const [busyId, setBusyId] = react.useState(null);
					const [error, setError] = react.useState(null);

					const archived = archivedSessionIds
						.map((id) => sessions[id])
						.filter((session) => session !== undefined);

					async function refreshStores() {
						const sessionsService = ctx.get("sessions");
						if (sessionsService !== undefined && typeof sessionsService.refresh === "function") {
							await sessionsService.refresh();
						}
						const workspacesService = ctx.get("workspaces");
						if (workspacesService !== undefined && typeof workspacesService.refresh === "function") {
							await workspacesService.refresh();
						}
					}

					async function handleRestore(session) {
						setBusyId(session.id);
						setError(null);
						try {
							const response = await fetch(RESTORE_ENDPOINT, {
								method: "POST",
								headers: { "content-type": "application/json" },
								body: JSON.stringify({ sessionId: session.id }),
							});
							const body = await response.json().catch(() => ({}));
							if (!response.ok || body.ok !== true) {
								throw new Error(body.error || `恢复失败（HTTP ${response.status}）`);
							}
							await refreshStores();
						} catch (err) {
							setError(err instanceof Error ? err.message : String(err));
						} finally {
							setBusyId(null);
						}
					}

					async function handleDelete(session) {
						const confirmed = window.confirm(
							`彻底删除“${session.displayTitle || session.title || session.id}”？\n\n` +
							"此操作不可恢复，会同时删除该任务的日志文件（相当于 rm -rf）。确定继续吗？",
						);
						if (!confirmed) return;

						setBusyId(session.id);
						setError(null);
						try {
							const response = await fetch(DELETE_ENDPOINT, {
								method: "POST",
								headers: { "content-type": "application/json" },
								body: JSON.stringify({ sessionId: session.id }),
							});
							const body = await response.json().catch(() => ({}));
							if (!response.ok || body.ok !== true) {
								throw new Error(body.error || `删除失败（HTTP ${response.status}）`);
							}
							await refreshStores();
						} catch (err) {
							setError(err instanceof Error ? err.message : String(err));
						} finally {
							setBusyId(null);
						}
					}

					return react.createElement(
						"div",
						{ style: { padding: "16px", color: "var(--dsw-alias-label-primary)" } },
						react.createElement(
							"h2",
							{ style: { margin: "0 0 12px", fontSize: "16px", fontWeight: 600, color: "var(--dsw-alias-label-primary)" } },
							"已归档任务",
						),
						error !== null
							? react.createElement(
								"p",
								{ style: { margin: "0 0 12px", color: "var(--dsw-alias-danger-primary, #d92d20)" } },
								error,
							)
							: null,
						archived.length === 0
							? react.createElement("p", { style: { margin: 0, color: "var(--dsw-alias-label-secondary)" } }, "暂无已归档任务")
							: react.createElement(
								"ul",
								{ style: { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "8px" } },
								archived.map((session) =>
									react.createElement(
										"li",
										{
											key: session.id,
											style: {
												padding: "10px 12px",
												borderRadius: "8px",
												border: "1px solid var(--dsw-alias-border-l1)",
												background: "var(--dsw-alias-bg-layer-1)",
											},
										},
										react.createElement(
											"div",
											{ style: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" } },
											react.createElement(
												"div",
												{ style: { minWidth: 0 } },
												react.createElement(
													"div",
													{ style: { fontSize: "14px", fontWeight: 500, color: "var(--dsw-alias-label-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
													session.displayTitle || session.title || session.id,
												),
												react.createElement(
													"div",
													{ style: { fontSize: "12px", color: "var(--dsw-alias-label-secondary)", marginTop: "4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
													session.id,
												),
											),
											react.createElement(
												"div",
												{ style: { display: "flex", alignItems: "center", gap: "8px" } },
												react.createElement(
													"button",
													{
														type: "button",
														disabled: busyId !== null,
														onClick: () => handleRestore(session),
														style: {
															flexShrink: 0,
															padding: "4px 10px",
															borderRadius: "6px",
															border: "1px solid var(--dsw-alias-border-l2)",
															background: "var(--dsw-alias-button-tool-bar-fill, transparent)",
															color: "var(--dsw-alias-label-primary)",
															fontSize: "12px",
															lineHeight: "20px",
															cursor: busyId === null ? "pointer" : "not-allowed",
															opacity: busyId === session.id ? 0.6 : busyId === null ? 1 : 0.5,
															transition: "background-color .12s, border-color .12s, color .12s",
														},
													},
													busyId === session.id ? "恢复中…" : "恢复",
												),
												react.createElement(
													"button",
													{
														type: "button",
														disabled: busyId !== null,
														onClick: () => handleDelete(session),
														style: {
															flexShrink: 0,
															padding: "4px 10px",
															borderRadius: "6px",
															border: "1px solid var(--dsw-alias-border-l2)",
															background: "var(--dsw-alias-button-tool-bar-fill, transparent)",
															color: "var(--dsw-alias-danger-primary, #d92d20)",
															fontSize: "12px",
															lineHeight: "20px",
															cursor: busyId === null ? "pointer" : "not-allowed",
															opacity: busyId === session.id ? 0.6 : busyId === null ? 1 : 0.5,
															transition: "background-color .12s, border-color .12s, color .12s",
														},
													},
													busyId === session.id ? "删除中…" : "删除",
												),
											),
										),
									),
								),
							),
					);
				},
			));
		}

		exports.apply = apply;
		return module.exports;
	}
});
