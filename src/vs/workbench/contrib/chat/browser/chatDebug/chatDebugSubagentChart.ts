/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../../base/browser/dom.js';
import { localize } from '../../../../../nls.js';
import { IChatDebugEvent } from '../../common/chatDebugService.js';

const $ = DOM.$;

export interface ISubagentData {
	name: string;
	description?: string;
	status?: string;
	toolCalls: number;
	modelTurns: number;
	durationMs?: number;
	childEvents: readonly IChatDebugEvent[];
}

export interface IDeriveSubagentResult {
	subagents: ISubagentData[];
	/** Set of event IDs that belong to a subagent (invocation IDs + child event IDs). */
	subagentEventIds: Set<string>;
}

/**
 * Derive subagent info from events:
 * - Explicit `subagentInvocation` events
 * - `toolCall` events where toolName is 'runSubagent'
 * - `toolCall` events that have a parentEventId matching a subagent
 */
export function deriveSubagentData(events: readonly IChatDebugEvent[]): IDeriveSubagentResult {
	const subagents: Map<string, { name: string; description?: string; status?: string; toolCalls: number; modelTurns: number; durationMs?: number; childEvents: IChatDebugEvent[] }> = new Map();

	// Collect from explicit subagentInvocation events
	for (const event of events) {
		if (event.kind === 'subagentInvocation') {
			const key = event.id ?? event.agentName;
			subagents.set(key, {
				name: event.agentName,
				description: event.description,
				status: event.status,
				toolCalls: event.toolCallCount ?? 0,
				modelTurns: event.modelTurnCount ?? 0,
				durationMs: event.durationInMillis,
				childEvents: [],
			});
			if (event.status === 'running' || !event.status) {
				const running = runningEntries.get(event.agentName) ?? [];
				running.push(key);
				runningEntries.set(event.agentName, running);
			}
		}
	}

	// Collect from runSubagent tool calls
	for (const event of events) {
		if (event.kind === 'toolCall' && event.toolName === 'runSubagent') {
			const key = event.id ?? `runSubagent-${event.created.getTime()}`;
			if (!subagents.has(key)) {
				// Try to extract agent name from input JSON
				let agentName = localize('chatDebug.subagent', "Subagent");
				let description: string | undefined;
				if (parentEvent.input) {
					try {
						const parsed: { agentName?: string; description?: string } = JSON.parse(parentEvent.input);
						description = parsed.description;
						agentName = parsed.agentName ?? 'Subagent';
					} catch {
						// best effort
					}
				}
				subagents.set(event.parentEventId, {
					name: agentName,
					description,
					status: undefined,
					toolCalls: 0,
					modelTurns: 0,
					durationMs: parentEvent.durationInMillis,
					childEvents: [],
				});
			}
		}
	}

	// Infer subagents from orphaned parentEventId references.
	// If events reference a parentEventId that isn't already a known subagent,
	// look up the parent event and create a synthetic subagent entry.
	const eventsById = new Map<string, IChatDebugEvent>();
	for (const event of events) {
		if (event.id) {
			eventsById.set(event.id, event);
		}
	}
	for (const event of events) {
		if (event.parentEventId && !subagents.has(event.parentEventId)) {
			const parentEvent = eventsById.get(event.parentEventId);
			const name = parentEvent?.kind === 'generic' ? (parentEvent.name || localize('chatDebug.subagent', "Subagent")) : localize('chatDebug.subagent', "Subagent");
			const description = parentEvent?.kind === 'generic' ? parentEvent.details : undefined;
			subagents.set(event.parentEventId, {
				name,
				description,
				status: undefined,
				toolCalls: 0,
				modelTurns: 0,
				durationMs: undefined,
				childEvents: [],
			});
		}
	}

	// Now attach all owned events as children, and enrich descriptions
	// from runSubagent toolCall inputs where available.
	for (const event of events) {
		const ownerKey = event.id ? eventOwner.get(event.id) : undefined;
		const parentOwnerKey = event.parentEventId ? eventOwner.get(event.parentEventId) : undefined;
		const resolvedKey = ownerKey ?? parentOwnerKey;
		if (resolvedKey && subagents.has(resolvedKey)) {
			const sub = subagents.get(resolvedKey)!;
			// Enrich description from runSubagent toolCall input
			if (event.kind === 'toolCall' && event.toolName === 'runSubagent' && !sub.description && event.input) {
				try {
					const parsed: { description?: string } = JSON.parse(event.input);
					if (parsed.description) {
						sub.description = parsed.description;
					}
				} catch {
					// best effort
				}
			}
			// Avoid adding the subagent invocation event itself
			if (event.kind !== 'subagentInvocation') {
				(sub.childEvents as IChatDebugEvent[]).push(event);
				if (event.kind === 'toolCall') {
					sub.toolCalls++;
				} else if (event.kind === 'modelTurn') {
					sub.modelTurns++;
				}
			}
		}
	}

	return [...subagents.values()];
}

/**
 * Generate a Mermaid flowchart from events, showing the agent flow
 * with tool call breakdown and subagent invocations as subgraphs.
 */
export function generateSubagentFlowchart(events: readonly IChatDebugEvent[]): string {
	const { subagents, subagentEventIds } = deriveSubagentData(events);
	const isSubagentOwned = (e: IChatDebugEvent) =>
		(e.id !== undefined && subagentEventIds.has(e.id)) ||
		(e.parentEventId !== undefined && subagentEventIds.has(e.parentEventId));
	const modelTurns = events.filter(e => e.kind === 'modelTurn' && !isSubagentOwned(e));
	const mainToolCalls = events.filter(e => e.kind === 'toolCall' && e.toolName !== 'runSubagent' && !isSubagentOwned(e));

	// Summarize top tool calls for the main agent
	const mainToolNames = new Map<string, number>();
	for (const tc of mainToolCalls) {
		if (tc.kind === 'toolCall') {
			mainToolNames.set(tc.toolName, (mainToolNames.get(tc.toolName) ?? 0) + 1);
		}
	}

	const lines: string[] = [];
	lines.push('flowchart TD');

	// Start node
	lines.push('    start([Start]) --> mainAgent');
	lines.push(`    mainAgent["Main Agent<br/>${modelTurns.length} model turns<br/>${mainToolCalls.length} tool calls"]`);

	// Main agent tool breakdown
	if (mainToolNames.size > 0) {
		const toolSummary = [...mainToolNames.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, 8)
			.map(([name, count]) => `${name} x${count}`)
			.join('<br/>');
		lines.push(`    mainAgent --> mainTools["Tools:<br/>${toolSummary}"]`);
	}

	if (subagents.length === 0) {
		if (mainToolNames.size > 0) {
			lines.push('    mainTools --> finish([End])');
		} else {
			lines.push('    mainAgent --> finish([End])');
		}
	} else {
		// Connect main agent to each subagent
		for (let i = 0; i < subagents.length; i++) {
			const sub = subagents[i];
			const nodeId = `sub${i}`;
			const statusIcon = sub.status === 'failed' ? '&#10060;' : sub.status === 'completed' ? '&#9989;' : '&#9654;';

			lines.push('');
			lines.push(`    mainAgent --> ${nodeId}`);
			lines.push(`    subgraph ${nodeId}_group["${sub.name}"]`);
			lines.push(`        ${nodeId}["${statusIcon} ${sub.name}<br/>${sub.description ? sub.description.substring(0, 50) + '<br/>' : ''}${sub.modelTurns} model turns, ${sub.toolCalls} tool calls${sub.durationMs !== undefined ? '<br/>' + sub.durationMs + 'ms' : ''}"]`);

			// Show top tool calls for this subagent
			const childTools = sub.childEvents.filter(e => e.kind === 'toolCall');
			const toolNames = new Map<string, number>();
			for (const tc of childTools) {
				if (tc.kind === 'toolCall') {
					toolNames.set(tc.toolName, (toolNames.get(tc.toolName) ?? 0) + 1);
				}
			}
			if (toolNames.size > 0) {
				const toolSummary = [...toolNames.entries()]
					.sort((a, b) => b[1] - a[1])
					.slice(0, 5)
					.map(([name, count]) => `${name} x${count}`)
					.join('<br/>');
				lines.push(`        ${nodeId}_tools["Tools:<br/>${toolSummary}"]`);
				lines.push(`        ${nodeId} --> ${nodeId}_tools`);
			}

			lines.push('    end');
			lines.push(`    ${nodeId}_group --> mainAgent_return${i}(["Return to Main Agent"])`);
		}

		// Final node
		const lastIdx = subagents.length - 1;
		lines.push(`    mainAgent_return${lastIdx} --> finish([End])`);

		// Connect intermediate returns
		for (let i = 0; i < lastIdx; i++) {
			lines.push(`    mainAgent_return${i} --> mainAgent`);
		}
	}

	// Styling
	lines.push('');
	lines.push('    classDef mainNode fill:#4a9eff,stroke:#2b7de9,color:#fff');
	lines.push('    classDef subNode fill:#9c27b0,stroke:#7b1fa2,color:#fff');
	lines.push('    classDef toolNode fill:#455a64,stroke:#37474f,color:#cfd8dc');
	lines.push('    classDef returnNode fill:#66bb6a,stroke:#43a047,color:#fff');
	lines.push('    class mainAgent mainNode');
	if (mainToolNames.size > 0) {
		lines.push('    class mainTools toolNode');
	}

	for (let i = 0; i < subagents.length; i++) {
		lines.push(`    class sub${i} subNode`);
		lines.push(`    class sub${i}_tools toolNode`);
		lines.push(`    class mainAgent_return${i} returnNode`);
	}

	return lines.join('\n');
}

/**
 * Render a visual HTML/CSS flow representation of the agent execution,
 * showing main agent activity and subagent invocations when present.
 */
export function renderVisualFlow(container: HTMLElement, events: readonly IChatDebugEvent[]): void {
	const subagents = deriveSubagentData(events);

	if (subagents.length === 0) {
		DOM.append(container, $('p.chat-debug-subagent-flow-empty', undefined, localize('chatDebug.noSubagents', "No subagent invocations detected in this session.")));
		return;
	}

	// Main agent node
	DOM.append(container, $('div.chat-debug-flow-node.chat-debug-flow-main', undefined, localize('chatDebug.mainAgent', "Main Agent")));

	for (const sub of subagents) {
		// Arrow
		DOM.append(container, $('div.chat-debug-flow-arrow', undefined, '\u2193'));

		// Subagent node
		const subNode = DOM.append(container, $('div.chat-debug-flow-node.chat-debug-flow-subagent'));

		const statusIcon = sub.status === 'failed' ? '\u274C' : sub.status === 'completed' ? '\u2705' : '\u25B6';
		DOM.append(subNode, $('div.chat-debug-flow-subagent-name', undefined, `${statusIcon} ${sub.name}`));

		if (sub.description) {
			DOM.append(subNode, $('div.chat-debug-flow-subagent-desc', undefined,
				sub.description.length > 60 ? sub.description.substring(0, 60) + '...' : sub.description
			));
		}

		const parts: string[] = [];
		if (sub.modelTurns > 0) {
			parts.push(localize('chatDebug.flowModelTurns', "{0} model turns", sub.modelTurns));
		}
		if (sub.toolCalls > 0) {
			parts.push(localize('chatDebug.flowToolCalls', "{0} tool calls", sub.toolCalls));
		}
		if (sub.durationMs !== undefined) {
			parts.push(`${sub.durationMs}ms`);
		}
		DOM.append(subNode, $('div.chat-debug-flow-subagent-stats', undefined, parts.join(' \u00B7 ')));

		// Return arrow
		DOM.append(container, $('div.chat-debug-flow-arrow.chat-debug-flow-arrow-return', undefined, '\u2193'));
	}

	// End node
	DOM.append(container, $('div.chat-debug-flow-node.chat-debug-flow-end', undefined, localize('chatDebug.end', "End")));
}

/**
 * Append tool call chips to a flow node, grouped by tool name with counts.
 */
function appendToolChips(parent: HTMLElement, toolCalls: readonly IChatDebugEvent[]): void {
	if (toolCalls.length === 0) {
		return;
	}

	const toolNames = new Map<string, number>();
	for (const tc of toolCalls) {
		if (tc.kind === 'toolCall') {
			toolNames.set(tc.toolName, (toolNames.get(tc.toolName) ?? 0) + 1);
		}
	}

	const chipsContainer = document.createElement('div');
	chipsContainer.className = 'chat-debug-flow-tool-chips';

	const sorted = [...toolNames.entries()].sort((a, b) => b[1] - a[1]);
	const maxVisible = 6;
	const visible = sorted.slice(0, maxVisible);

	for (const [name, count] of visible) {
		const chip = document.createElement('span');
		chip.className = 'chat-debug-flow-tool-chip';
		chip.textContent = count > 1 ? `${name} \u00D7${count}` : name;
		chip.title = `${name}: ${count} call${count > 1 ? 's' : ''}`;
		chipsContainer.appendChild(chip);
	}

	if (sorted.length > maxVisible) {
		const moreChip = document.createElement('span');
		moreChip.className = 'chat-debug-flow-tool-chip chat-debug-flow-tool-chip-more';
		const remaining = sorted.length - maxVisible;
		moreChip.textContent = localize('chatDebug.moreTools', "+{0} more", remaining);
		moreChip.title = sorted.slice(maxVisible).map(([n, c]) => `${n} \u00D7${c}`).join(', ');
		chipsContainer.appendChild(moreChip);
	}

	parent.appendChild(chipsContainer);
}
