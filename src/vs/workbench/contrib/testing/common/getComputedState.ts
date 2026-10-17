/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Iterable } from '../../../../base/common/iterator.js';
import { TestResultState } from './testTypes.js';
import { makeEmptyCounts, maxPriority, statePriority } from './testingStates.js';

/**
 * Accessor for nodes in get and refresh computed state.
 */
export interface IComputedStateAccessor<T> {
	getOwnState(item: T): TestResultState | undefined;
	getCurrentComputedState(item: T): TestResultState;
	setComputedState(item: T, state: TestResultState): void;
	getChildren(item: T): Iterable<T>;
	getParents(item: T): Iterable<T>;
}

export interface IComputedStateAndDurationAccessor<T> extends IComputedStateAccessor<T> {
	getOwnTime(item: T): ITestTaskTimeRange | undefined;
	getCurrentComputedDuration(item: T): number | undefined;
	setComputedDuration(item: T, time: number): void;
}

const isDurationAccessor = <T>(accessor: IComputedStateAccessor<T>): accessor is IComputedStateAndDurationAccessor<T> => 'getOwnTime' in accessor;

/**
 * Gets the computed state for the node.
 * @param force whether to refresh the computed state for this node, even
 * if it was previously set.
 */

const getComputedState = <T extends object>(accessor: IComputedStateAccessor<T>, node: T, force = false) => {
	let computed = accessor.getCurrentComputedState(node);
	if (computed === undefined || force) {
		computed = accessor.getOwnState(node) ?? TestResultState.Unset;

		let childrenCount = 0;
		const stateMap = makeEmptyCounts();

		for (const child of accessor.getChildren(node)) {
			const childComputed = getComputedState(accessor, child);
			childrenCount++;
			stateMap[childComputed]++;

			// If all children are skipped, make the current state skipped too if unset (#131537)
			computed = childComputed === TestResultState.Skipped && computed === TestResultState.Unset
				? TestResultState.Skipped : maxPriority(computed, childComputed);
		}

		if (childrenCount > LARGE_NODE_THRESHOLD) {
			largeNodeChildrenStates.set(node, stateMap);
		}

		accessor.setComputedState(node, computed);
	}

	return computed;
};


const cachedComputedTime = new WeakMap<object, { ranges: readonly ITestTaskTimeRange[]; duration: number }>();

const getComputedTime = <T>(accessor: IComputedStateAndDurationAccessor<T>, node: T, force = false): { ranges: readonly ITestTaskTimeRange[]; duration: number } => {
	if (!force) {
		const cached = cachedComputedTime.get(node as object);
		if (cached) {
			return cached;
		}
	}

	const own = accessor.getOwnTime(node);
	if (own !== undefined) {
		const duration = own.to - own.from;
		accessor.setComputedDuration(node, duration);
		return { ranges: [own], duration };
	} else {
		const children: ITestTaskTimeRange[] = [];
		for (const child of accessor.getChildren(node)) {
			for (const range of getComputedTime(accessor, child).ranges) {
				// merge interval:
				const fromI = findFirstInSorted(children, c => c.to >= range.from);
				if (fromI === children.length) {
					children.push(range);
					continue;
				}

				const fi = children[fromI];
				if (fi.from > range.to) {
					children.splice(fromI, 0, range);
					continue;
				}

				let toI = fromI + 1;
				while (toI < children.length && children[toI].from < range.to) {
					toI++;
				}

				children.splice(fromI, toI - fromI, {
					from: Math.min(fi.from, range.from),
					to: Math.max(children[toI - 1].to, range.to)
				});
			}
		}

		let duration = 0;
		for (const range of children) {
			duration += range.to - range.from;
		}

		accessor.setComputedDuration(node, duration);
		const ret = { ranges: children, duration };
		cachedComputedTime.set(node as object, ret);
		return ret;
	}
};

const LARGE_NODE_THRESHOLD = 64;

/**
 * Map of how many nodes have in each state. This is used to optimize state
 * computation in large nodes with children above the `LARGE_NODE_THRESHOLD`.
 */
const largeNodeChildrenStates = new WeakMap<object, { [K in TestResultState]: number }>();

/**
 * Refreshes the computed state for the node and its parents. Any changes
 * elements cause `addUpdated` to be called.
 */
export const refreshComputedState = <T extends object>(
	accessor: IComputedStateAccessor<T>,
	node: T,
	explicitNewComputedState?: TestResultState,
	refreshDuration = true,
) => {
	const oldState = accessor.getCurrentComputedState(node);
	const oldPriority = statePriority[oldState];
	const newState = explicitNewComputedState ?? getComputedState(accessor, node, true);
	const newPriority = statePriority[newState];
	const toUpdate = new Set<T>();

	if (newPriority !== oldPriority) {
		accessor.setComputedState(node, newState);
		toUpdate.add(node);

		let moveFromState = oldState;
		let moveToState = newState;

		for (const parent of accessor.getParents(node)) {
			const lnm = largeNodeChildrenStates.get(parent);
			if (lnm) {
				lnm[moveFromState]--;
				lnm[moveToState]++;
			}

			const prev = accessor.getCurrentComputedState(parent);
			if (newPriority > oldPriority) {
				// Update all parents to ensure they're at least this priority.
				if (prev !== undefined && statePriority[prev] >= newPriority) {
					break;
				}

				if (lnm && lnm[moveToState] > 1) {
					break;
				}

				// moveToState remains the same, the new higher priority node state
				accessor.setComputedState(parent, newState);
				toUpdate.add(parent);
			} else /* newProirity < oldPriority */ {
				// Update all parts whose statese might have been based on this one
				if (prev === undefined || statePriority[prev] > oldPriority) {
					break;
				}

				if (lnm && lnm[moveFromState] > 0) {
					break;
				}

				moveToState = getComputedState(accessor, parent, true);
				accessor.setComputedState(parent, moveToState);
				toUpdate.add(parent);
			}

			moveFromState = prev;
		}
	}

	if (isDurationAccessor(accessor) && refreshDuration) {
		for (const parent of Iterable.concat(Iterable.single(node), accessor.getParents(node))) {
			const oldDuration = accessor.getCurrentComputedDuration(parent);
			const newDuration = getComputedTime(accessor, parent, true).duration;
			if (oldDuration === newDuration) {
				break;
			}

			accessor.setComputedDuration(parent, newDuration);
			toUpdate.add(parent);
		}
	}

	return toUpdate;
};
