/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../base/browser/dom.js';
import { RunOnceScheduler } from '../../../base/common/async.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { localize } from '../../../nls.js';
import { INativeHostService, ISystemResourceMetrics } from '../../../platform/native/common/native.js';
import { isNative } from '../../../base/common/platform.js';

/** Compact, persistent local system metrics for the Agents sidebar footer. */
export class SidebarMetrics extends Disposable {

	private readonly cpu: HTMLElement;
	private readonly memory: HTMLElement;
	private readonly download: HTMLElement;
	private readonly upload: HTMLElement;
	private readonly sampler: RunOnceScheduler;
	private sampleInFlight = false;
	private disposed = false;

	constructor(parent: HTMLElement, @INativeHostService private readonly nativeHostService: INativeHostService) {
		super();
		const row = append(parent, $('.agent-sidebar-metrics'));
		row.setAttribute('aria-label', localize('agentsSystemMetrics', 'System metrics for this computer'));
		this.cpu = this.createMetric(row, localize('agentsCpu', 'CPU'));
		this.memory = this.createMetric(row, localize('agentsMemory', 'Memory'));
		this.download = this.createMetric(row, localize('agentsDownload', 'Download'));
		this.upload = this.createMetric(row, localize('agentsUpload', 'Upload'));
		this.sampler = this._register(new RunOnceScheduler(() => void this.sample(), 2000));
		this.update({ cpuPercent: undefined, memoryPercent: undefined, downloadMbps: undefined, uploadMbps: undefined });
		if (isNative) {
			void this.sample();
			this.sampler.schedule();
		} else {
			this.setMetric(this.cpu, '—', localize('agentsMetricsNativeOnly', 'Metrics are available in the desktop application'));
			this.setMetric(this.memory, '—', localize('agentsMetricsNativeOnly', 'Metrics are available in the desktop application'));
			this.setMetric(this.download, '—', localize('agentsMetricsNativeOnly', 'Metrics are available in the desktop application'));
			this.setMetric(this.upload, '—', localize('agentsMetricsNativeOnly', 'Metrics are available in the desktop application'));
		}
	}

	private createMetric(parent: HTMLElement, label: string): HTMLElement {
		const item = append(parent, $('span.agent-sidebar-metrics-item'));
		item.setAttribute('role', 'status');
		item.dataset.label = label;
		return item;
	}

	private async sample(): Promise<void> {
		if (this.sampleInFlight || this.disposed) {
			return;
		}
		this.sampleInFlight = true;
		try {
			const current = await this.nativeHostService.getSystemResourceMetrics();
			if (this.disposed) {
				return;
			}
			this.update(current);
		} catch {
			this.setMetric(this.cpu, '—', localize('agentsCpuUnavailable', 'CPU utilization is unavailable'));
			this.setMetric(this.memory, '—', localize('agentsMemoryUnavailable', 'Memory utilization is unavailable'));
			this.setMetric(this.download, '—', localize('agentsDownloadUnavailable', 'Download rate is unavailable'));
			this.setMetric(this.upload, '—', localize('agentsUploadUnavailable', 'Upload rate is unavailable'));
		} finally {
			this.sampleInFlight = false;
			if (!this.disposed) {
				this.sampler.schedule();
			}
		}
	}

	private update(metrics: ISystemResourceMetrics): void {
		this.setMetric(this.cpu, metrics.cpuPercent === undefined ? '—' : `${metrics.cpuPercent}%`, localize('agentsCpuTooltip', 'System CPU utilization: {0}', metrics.cpuPercent === undefined ? localize('unavailable', 'unavailable') : `${metrics.cpuPercent}%`));
		this.setMetric(this.memory, metrics.memoryPercent === undefined ? '—' : `${metrics.memoryPercent}%`, localize('agentsMemoryTooltip', 'System memory in use: {0}', metrics.memoryPercent === undefined ? localize('unavailable', 'unavailable') : `${metrics.memoryPercent}%`));
		this.setMetric(this.download, metrics.downloadMbps === undefined ? '—' : `${metrics.downloadMbps.toFixed(1)} Mbps`, localize('agentsDownloadTooltip', 'Download rate: {0}', metrics.downloadMbps === undefined ? localize('unavailable', 'unavailable') : `${metrics.downloadMbps.toFixed(1)} Mbps`));
		this.setMetric(this.upload, metrics.uploadMbps === undefined ? '—' : `${metrics.uploadMbps.toFixed(1)} Mbps`, localize('agentsUploadTooltip', 'Upload rate: {0}', metrics.uploadMbps === undefined ? localize('unavailable', 'unavailable') : `${metrics.uploadMbps.toFixed(1)} Mbps`));
	}

	override dispose(): void {
		this.disposed = true;
		super.dispose();
	}

	private setMetric(item: HTMLElement, value: string, tooltip: string): void {
		item.textContent = `${item.dataset.label}: ${value}`;
		item.title = tooltip;
	}
}
