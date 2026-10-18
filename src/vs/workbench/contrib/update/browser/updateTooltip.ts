/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { AvailableForDownload, Disabled, DisablementReason, Downloaded, Downloading, Idle, IUpdate, Overwriting, Ready, Restarting, State, StateType, Updating } from '../../../../platform/update/common/update.js';
import { IUpdateInfoButton, parseUpdateInfoInput, UpdateInfoButtonStyle } from '../common/updateInfoParser.js';
import { ShowCurrentReleaseNotesActionId } from '../common/update.js';
import { computeDownloadSpeed, computeDownloadTimeRemaining, computeProgressPercent, formatBytes, formatDate, formatTimeRemaining, tryParseDate } from '../common/updateUtils.js';
import './media/updateTooltip.css';

const UPDATE_INFO_TELEMETRY_SOURCE = 'updateinfo';

/**
 * A stateful tooltip control for the update status.
 */
export class UpdateTooltip extends Disposable {
	public readonly domNode: HTMLElement;

	// Header
	private readonly titleNode: HTMLElement;
	private readonly headerLogo: HTMLElement;

	// Step indicator
	private readonly stepperContainer: HTMLElement;

	// Release notes link
	private readonly productInfoNode: HTMLElement;
	private readonly productNameNode: HTMLElement;
	private readonly currentVersionNode: HTMLElement;
	private readonly currentVersionCopyValue: { value: string };
	private readonly currentVersionCopyButton: HTMLElement;
	private readonly latestVersionNode: HTMLElement;
	private readonly latestVersionCopyValue: { value: string };
	private readonly latestVersionCopyButton: HTMLElement;
	private readonly releaseDateNode: HTMLElement;

	// Separator
	private readonly separator: HTMLElement;

	// Separator
	private readonly separator: HTMLElement;

	// Progress section
	private readonly progressContainer: HTMLElement;
	private readonly progressFill: HTMLElement;
	private readonly progressPercentNode: HTMLElement;
	private readonly progressSizeNode: HTMLElement;

	// Collapsible details section (versions, download stats)
	private readonly detailsSection: HTMLDetailsElement;
	private readonly currentVersionNode: HTMLElement;
	private readonly targetVersionNode: HTMLElement;
	private readonly downloadStatsRow: HTMLElement;
	private readonly downloadedSizeNode: HTMLElement;
	private readonly downloadSpeedNode: HTMLElement;

	// Message
	private readonly messageNode: HTMLElement;

	// Button bar
	private readonly buttonBar: HTMLElement;
	private readonly releaseNotesButton: HTMLButtonElement;
	private readonly actionButton: HTMLButtonElement;
	private readonly customButtonListeners = this._register(new DisposableStore());
	private customButtons: HTMLButtonElement[] = [];

	private releaseNotesVersion: string | undefined;
	private commandTelemetrySource: string | undefined;

	constructor(
		@IClipboardService private readonly clipboardService: IClipboardService,
		@ICommandService private readonly commandService: ICommandService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IHoverService private readonly hoverService: IHoverService,
		@IProductService private readonly productService: IProductService,
	) {
		super();

		this.domNode = dom.$('.update-tooltip');

		// Header
		const header = dom.append(this.domNode, dom.$('.header'));
		this.titleNode = dom.append(header, dom.$('.title'));

		// Product info section
		this.productInfoNode = dom.append(this.domNode, dom.$('.product-info'));
		this.releaseDateNode = dom.append(this.productInfoNode, dom.$('.product-release-date'));

		// Separator
		this.separator = dom.append(this.domNode, dom.$('.tooltip-separator'));

		// Progress
		this.progressContainer = dom.append(this.domNode, dom.$('.progress-container'));
		const progressBar = dom.append(this.progressContainer, dom.$('.progress-bar'));
		this.progressFill = dom.append(progressBar, dom.$('.progress-fill'));
		const progressText = dom.append(this.progressContainer, dom.$('.progress-text'));
		this.progressPercentNode = dom.append(progressText, dom.$('span'));
		this.progressSizeNode = dom.append(progressText, dom.$('span'));

		// Markdown
		this.markdownContainer = dom.append(this.domNode, dom.$('.update-markdown'));

		const currentVersionRow = this.createVersionRow(details);
		this.currentVersionNode = currentVersionRow.label;
		this.currentVersionCopyValue = currentVersionRow.copyValue;
		this.currentVersionCopyButton = currentVersionRow.copyButton;

		const latestVersionRow = this.createVersionRow(details);
		this.latestVersionNode = latestVersionRow.label;
		this.latestVersionCopyValue = latestVersionRow.copyValue;
		this.latestVersionCopyButton = latestVersionRow.copyButton;

		this.releaseDateNode = dom.append(details, dom.$('.product-release-date'));

		// Progress section
		this.progressContainer = dom.append(this.domNode, dom.$('.progress-container'));
		const progressBar = dom.append(this.progressContainer, dom.$('.progress-bar'));
		this.progressFill = dom.append(progressBar, dom.$('.progress-fill'));

		const progressText = dom.append(this.progressContainer, dom.$('.progress-text'));
		this.progressPercentNode = dom.append(progressText, dom.$('span'));
		this.progressSizeNode = dom.append(progressText, dom.$('span'));

		// Extra download stats
		this.downloadStatsContainer = dom.append(this.progressContainer, dom.$('.download-stats'));
		this.timeRemainingNode = dom.append(this.downloadStatsContainer, dom.$('.time-remaining'));
		this.speedInfoNode = dom.append(this.downloadStatsContainer, dom.$('.speed-info'));

		// State-specific message
		this.messageNode = dom.append(this.domNode, dom.$('.state-message'));

		// Button bar
		this.buttonBar = dom.append(this.domNode, dom.$('.button-bar'));

		this.releaseNotesButton = dom.append(this.buttonBar, dom.$('button.update-button-secondary')) as HTMLButtonElement;
		this.releaseNotesButton.textContent = localize('updateTooltip.viewReleaseNotes', "Release Notes");
		this._register(dom.addDisposableListener(this.releaseNotesButton, 'click', () => {
			if (this.releaseNotesVersion) {
				this.runCommandAndClose(ShowCurrentReleaseNotesActionId, this.releaseNotesVersion);
			}
		}));

		this.actionButton = dom.append(this.buttonBar, dom.$('button.update-button-primary')) as HTMLButtonElement;
		this._register(dom.addDisposableListener(this.actionButton, 'click', () => {
			const commandId = this.actionButton.dataset.commandId;
			if (commandId) {
				this.runCommandAndClose(commandId);
			}
		}));

		// Populate static product info
		this.updateCurrentVersion();
	}

	private updateCurrentVersion() {
		const productVersion = this.productService.version;
		if (productVersion) {
			const currentCommitId = this.productService.commit?.substring(0, 7);
			this.currentVersionNode.textContent = currentCommitId
				? localize('updateTooltip.currentVersionLabelWithCommit', "Current Version: {0} ({1})", productVersion, currentCommitId)
				: localize('updateTooltip.currentVersionLabel', "Current Version: {0}", productVersion);
			this.currentVersionCopyValue.value = currentCommitId ? `${productVersion} (${this.productService.commit})` : productVersion;
			this.currentVersionNode.parentElement!.style.display = '';
			this.currentVersionCopyButton.tabIndex = 0;
		} else {
			this.currentVersionNode.parentElement!.style.display = 'none';
			this.currentVersionCopyButton.tabIndex = -1;
		}
	}

	private hideAll() {
		this.productInfoNode.style.display = '';
		this.headerLogo.style.display = '';
		this.stepperContainer.style.display = 'none';
		this.separator.style.display = 'none';
		this.progressContainer.style.display = 'none';
		this.detailsSection.style.display = 'none';
		this.detailsSection.open = false;
		this.downloadStatsRow.style.display = 'none';
		this.downloadedSizeNode.textContent = '';
		this.downloadSpeedNode.textContent = '';
		this.messageNode.style.display = 'none';
		this.actionButton.style.display = 'none';
		this.actionButton.tabIndex = -1;
		this.actionButton.dataset.commandId = '';
		this.releaseNotesButton.style.display = '';
		this.releaseNotesButton.style.marginRight = '';
		this.commandTelemetrySource = undefined;
		this.customButtonListeners.clear();
		for (const btn of this.customButtons) {
			btn.remove();
		}
		this.customButtons = [];
	}

	/**
	 * Shows a contextual stepper based on the active step.
	 * Shows all steps with completed/active/pending states.
	 */
	private setStepper(activeStep: number, inProgress = false) {
		const allSteps = [
			localize('updateTooltip.stepDownload', "Download"),
			localize('updateTooltip.stepInstall', "Install"),
			localize('updateTooltip.stepRestart', "Restart"),
		];
		const completedLabels = [
			localize('updateTooltip.stepDownloaded', "Downloaded"),
			localize('updateTooltip.stepInstalled', "Installed"),
			localize('updateTooltip.stepRestarted', "Restarted"),
		];

		this.stepperContainer.style.display = '';
		dom.clearNode(this.stepperContainer);

		for (let i = 0; i < allSteps.length; i++) {
			if (i > 0) {
				const line = dom.append(this.stepperContainer, dom.$('.step-line'));
				if (i <= activeStep) {
					line.classList.add('completed');
				}
			}
			const step = dom.append(this.stepperContainer, dom.$('.step'));
			const circle = dom.append(step, dom.$('.step-circle'));
			const label = dom.append(step, dom.$('.step-label'));
			label.textContent = allSteps[i];
			if (i < activeStep) {
				step.classList.add('completed');
				circle.classList.add(...ThemeIcon.asClassNameArray(Codicon.check));
				label.textContent = completedLabels[i];
			} else if (i === activeStep) {
				step.classList.add('active');
				if (inProgress) {
					step.classList.add('in-progress');
				}
			}
		}
	}

	/**
	 * Sets stepper to show steps with completed/active/pending states.
	 * @param activeStep 0=Download, 1=Install, 2=Apply. -1 hides stepper.
	 * @param inProgress Whether the active step is in-progress (shows animation).
	 */
	/**
	 * Shows a contextual stepper based on the active step.
	 * Shows all steps with completed/active/pending states.
	 */
	private setStepper(activeStep: number, inProgress = false) {
		const allSteps = [
			localize('updateTooltip.stepDownload', "Download"),
			localize('updateTooltip.stepInstall', "Install"),
			localize('updateTooltip.stepRestart', "Restart"),
		];
		const completedLabels = [
			localize('updateTooltip.stepDownloaded', "Downloaded"),
			localize('updateTooltip.stepInstalled', "Installed"),
			localize('updateTooltip.stepRestarted', "Restarted"),
		];

		this.stepperContainer.style.display = '';
		dom.clearNode(this.stepperContainer);

		// Show all steps: completed (check), active (filled dot), pending (empty dot)
		for (let i = 0; i < allSteps.length; i++) {
			if (i > 0) {
				const line = dom.append(this.stepperContainer, dom.$('.step-line'));
				if (i <= activeStep) {
					line.classList.add('completed');
				}
			}
			const step = dom.append(this.stepperContainer, dom.$('.step'));
			const circle = dom.append(step, dom.$('.step-circle'));
			const label = dom.append(step, dom.$('.step-label'));
			label.textContent = allSteps[i];
			if (i < activeStep) {
				step.classList.add('completed');
				circle.classList.add(...ThemeIcon.asClassNameArray(Codicon.check));
				label.textContent = completedLabels[i];
			} else if (i === activeStep) {
				step.classList.add('active');
				if (inProgress) {
					step.classList.add('in-progress');
				}
			}
		}
	}

	public renderState(state: State) {
		this.hideAll();
		switch (state.type) {
			case StateType.Uninitialized:
				this.renderUninitialized();
				break;
			case StateType.Disabled:
				this.renderDisabled(state);
				break;
			case StateType.Idle:
				this.renderIdle(state);
				break;
			case StateType.CheckingForUpdates:
				this.renderCheckingForUpdates();
				break;
			case StateType.AvailableForDownload:
				this.renderAvailableForDownload(state);
				break;
			case StateType.Downloading:
				this.renderDownloading(state);
				break;
			case StateType.Downloaded:
				this.renderDownloaded(state);
				break;
			case StateType.Updating:
				this.renderUpdating(state);
				break;
			case StateType.Ready:
				this.renderReady(state);
				break;
			case StateType.Overwriting:
				this.renderOverwriting(state);
				break;
			case StateType.Cancelling:
				this.renderCancelling();
				break;
			case StateType.Restarting:
				this.renderRestarting(state);
				break;
		}
	}

	private renderUninitialized() {
		this.renderTitleAndInfo(localize('updateTooltip.initializingTitle', "Initializing"));
		this.renderMessage(localize('updateTooltip.initializingMessage', "Initializing update service..."));
	}

	private renderDisabled({ reason }: Disabled) {
		this.renderTitleAndInfo(localize('updateTooltip.updatesDisabledTitle', "Updates Disabled"));
		this.showSeparator();
		switch (reason) {
			case DisablementReason.NotBuilt:
				this.renderMessage(
					localize('updateTooltip.disabledNotBuilt', "Updates are not available for this build."),
					Codicon.info);
				break;
			case DisablementReason.DisabledByEnvironment:
				this.renderMessage(
					localize('updateTooltip.disabledByEnvironment', "Updates are disabled by the --disable-updates command line flag."),
					Codicon.warning);
				break;
			case DisablementReason.ManuallyDisabled:
				this.renderMessage(
					localize('updateTooltip.disabledManually', "Updates are manually disabled. Change the \"update.mode\" setting to enable."),
					Codicon.warning);
				break;
			case DisablementReason.Policy:
				this.renderMessage(
					localize('updateTooltip.disabledByPolicy', "Updates are disabled by organization policy."),
					Codicon.info);
				break;
			case DisablementReason.MissingConfiguration:
				this.renderMessage(
					localize('updateTooltip.disabledMissingConfig', "Updates are disabled because no update URL is configured."),
					Codicon.info);
				break;
			case DisablementReason.InvalidConfiguration:
				this.renderMessage(
					localize('updateTooltip.disabledInvalidConfig', "Updates are disabled because the update URL is invalid."),
					Codicon.error);
				break;
			case DisablementReason.RunningAsAdmin:
				this.renderMessage(
					localize(
						'updateTooltip.disabledRunningAsAdmin',
						"Updates are not available when running a user install of {0} as administrator.",
						this.productService.nameShort),
					Codicon.warning);
				break;
			default:
				this.renderMessage(localize('updateTooltip.disabledGeneric', "Updates are disabled."), Codicon.warning);
				break;
		}
	}

	private renderIdle({ error, notAvailable }: Idle) {
		if (error) {
			this.renderTitleAndInfo(localize('updateTooltip.updateErrorTitle', "Update Error"));
			this.showSeparator();
			this.renderMessage(error, Codicon.error);
			return;
		}

		if (notAvailable) {
			this.renderTitleAndInfo(localize('updateTooltip.upToDateTitle', "Up to Date"));
			return;
		}

		const updateMode = this.configurationService.getValue<string>('update.mode');
		this.renderTitleAndInfo(localize('updateTooltip.upToDateTitle', "Up to Date"));
		switch (updateMode) {
			case 'none':
				this.renderMessage(localize('updateTooltip.autoUpdateNone', "Automatic updates are disabled."), Codicon.warning);
				break;
			case 'manual':
				this.renderMessage(localize('updateTooltip.autoUpdateManual', "Automatic updates will be checked but not installed automatically."));
				break;
			case 'start':
				this.renderMessage(localize('updateTooltip.autoUpdateStart', "Updates will be applied on restart."));
				break;
			case 'default':
				this.renderMessage(
					localize('updateTooltip.autoUpdateDefault', "Automatic updates are enabled. Happy Coding!"),
					Codicon.smiley);
				break;
		}
	}

	private renderCheckingForUpdates() {
		this.renderTitleAndInfo(localize('updateTooltip.checkingForUpdatesTitle', "Checking for Updates"));
		this.releaseNotesLink.style.display = 'none';
		this.showSeparator();
		this.renderMessage(localize('updateTooltip.checkingPleaseWait', "Checking for updates, please wait..."));
	}

	private renderAvailableForDownload({ update }: AvailableForDownload) {
		this.renderTitleAndInfo(localize('updateTooltip.updateAvailableTitle', "Update Available"), update);
		this.renderActionButton(localize('updateTooltip.downloadButton', "Download"), 'update.downloadNow');
	}

	private renderDownloading(state: Downloading) {
		this.renderTitleAndInfo(localize('updateTooltip.downloadingUpdateTitle', "Downloading"), state.update);
		this.setStepper(0, true);
		this.showDetails(state.update);

		const { downloadedBytes, totalBytes } = state;
		if (downloadedBytes !== undefined && totalBytes !== undefined && totalBytes > 0) {
			const percentage = computeProgressPercent(downloadedBytes, totalBytes) ?? 0;
			this.progressFill.style.width = `${percentage}%`;
			this.progressPercentNode.textContent = `${percentage}%`;

			const timeRemaining = computeDownloadTimeRemaining(state);
			if (timeRemaining !== undefined && timeRemaining > 0) {
				this.progressSizeNode.textContent = `~${formatTimeRemaining(timeRemaining)} ${localize('updateTooltip.timeRemaining', "remaining")}`;
			} else {
				this.progressSizeNode.textContent = '';
			}

			// Download stats in details section
			this.downloadedSizeNode.textContent = `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`;
			const speed = computeDownloadSpeed(state);
			if (speed !== undefined && speed > 0) {
				const mbps = (speed * 8) / (1024 * 1024);
				this.downloadSpeedNode.textContent = localize('updateTooltip.downloadSpeed', "{0} Mbps", mbps.toFixed(1));
			} else {
				this.downloadSpeedNode.textContent = '';
			}
			this.downloadStatsRow.style.display = '';

			this.progressContainer.style.display = '';
		} else {
			this.renderMessage(localize('updateTooltip.downloadingPleaseWait', "Downloading update, please wait..."));
		}
	}

	private renderDownloaded({ update }: Downloaded) {
		this.renderTitleAndInfo(localize('updateTooltip.updateReadyTitle', "Update is Ready to Install"), update);
		this.renderActionButton(localize('updateTooltip.installButton', "Install"), 'update.install');
	}

	private renderUpdating({ update, currentProgress, maxProgress }: Updating) {
		this.renderTitleAndInfo(localize('updateTooltip.installingUpdateTitle', "Installing"), update);
		this.setStepper(1, true);
		this.showDetails(update);

		const percentage = computeProgressPercent(currentProgress, maxProgress);
		if (percentage !== undefined) {
			this.progressFill.style.width = `${percentage}%`;
			this.progressPercentNode.textContent = `${percentage}%`;
			this.progressSizeNode.textContent = '';
			this.progressContainer.style.display = '';
		} else {
			this.renderMessage(localize('updateTooltip.installingPleaseWait', "Installing update, please wait..."));
		}
	}

	private renderReady({ update }: Ready) {
		if (this.configurationService.getValue<string>('update.mode') === 'manual') {
			this.renderTitleAndInfo(localize('updateTooltip.updateInstalledTitle', "Update Installed"), update);
			this.renderActionButton(localize('updateTooltip.restartButton', "Restart"), 'update.restart');
		} else {
			this.renderTitleAndInfo(localize('updateTooltip.restartToUpdateTitle', "Restart to Update"), update);
		}
	}

	private renderOverwriting({ update }: Overwriting) {
		this.renderTitleAndInfo(localize('updateTooltip.downloadingNewerUpdateTitle', "Downloading Newer Update"), update);
		this.setStepper(0, true);
		this.showDetails(update);
		this.renderMessage(localize('updateTooltip.downloadingNewerPleaseWait', "A newer update was released. Downloading, please wait..."));
	}

	private renderRestarting({ update }: Restarting) {
		this.renderTitleAndInfo(localize('updateTooltip.restartingTitle', "Restarting {0}", this.productService.nameShort), update);
		this.renderMessage(localize('updateTooltip.restartingPleaseWait', "Restarting to update, please wait..."));
	}

	private renderCancelling() {
		this.renderTitleAndInfo(localize('updateTooltip.cancellingTitle', "Cancelling Update"));
		this.renderMessage(localize('updateTooltip.cancellingPleaseWait', "Cancelling update, please wait..."));
	}

	private renderCustomButtons(buttons: IUpdateInfoButton[]) {
		this.customButtonListeners.clear();
		for (const btn of this.customButtons) {
			btn.remove();
		}
		this.customButtons = [];

		// Hide both default buttons when custom buttons are provided
		this.actionButton.style.display = 'none';
		this.releaseNotesButton.style.display = 'none';

		for (const button of buttons) {
			const btn = dom.append(this.buttonBar, dom.$('button')) as HTMLButtonElement;
			btn.textContent = button.label;
			btn.classList.add(this.getButtonClass(button.style));
			if (button.style === 'secondary' && buttons.length > 1) {
				btn.classList.add('update-button-leading-secondary');
			}
			this.customButtons.push(btn);
			this.customButtonListeners.add(dom.addDisposableListener(btn, 'click', () => {
				this.runCommandAndClose(button.commandId, ...(button.args ?? []));
			}));
		}

		this.buttonBar.style.display = '';
	}

	private getButtonClass(style: UpdateInfoButtonStyle | undefined): string {
		return style === 'secondary' ? 'update-button-secondary' : 'update-button-primary';
	}

	private renderTitleAndInfo(title: string, update?: IUpdate) {
		this.titleNode.textContent = title;

		const version = update?.productVersion;
		if (version) {
			const updateCommitId = update.version?.substring(0, 7);
			this.latestVersionNode.textContent = updateCommitId
				? localize('updateTooltip.latestVersionLabelWithCommit', "Latest Version: {0} ({1})", version, updateCommitId)
				: localize('updateTooltip.latestVersionLabel', "Latest Version: {0}", version);
			this.latestVersionCopyValue.value = updateCommitId ? `${version} (${update.version})` : version;
			this.latestVersionNode.parentElement!.style.display = '';
			this.latestVersionCopyButton.tabIndex = 0;
		} else {
			this.latestVersionNode.parentElement!.style.display = 'none';
			this.latestVersionCopyButton.tabIndex = -1;
		}

		// Always hide version details
		this.versionDetails.style.display = 'none';

		// Release notes button
		this.releaseNotesVersion = version ?? this.productService.version;
		this.releaseNotesButton.style.display = this.releaseNotesVersion ? '' : 'none';
		this.releaseNotesButton.tabIndex = this.releaseNotesVersion ? 0 : -1;
		this.releaseNotesButton.style.marginRight = this.releaseNotesVersion ? 'auto' : '';
		this.buttonBar.style.display = this.releaseNotesVersion ? '' : 'none';
	}

	private renderActionButton(label: string, commandId: string) {
		this.actionButton.textContent = label;
		this.actionButton.dataset.commandId = commandId;
		this.actionButton.style.display = '';
		this.actionButton.tabIndex = 0;
	}

	private renderMessage(message: string, icon?: ThemeIcon) {
		dom.clearNode(this.messageNode);
		if (icon) {
			const iconNode = dom.append(this.messageNode, dom.$('.state-message-icon'));
			iconNode.classList.add(...ThemeIcon.asClassNameArray(icon));
		}
		dom.append(this.messageNode, document.createTextNode(message));
		this.messageNode.style.display = '';
	}

	private createVersionRow(parent: HTMLElement): { label: HTMLElement; copyValue: { value: string }; copyButton: HTMLElement } {
		const row = dom.append(parent, dom.$('.product-version'));
		const label = dom.append(row, dom.$('span'));
		const copyValue = { value: '' };

	private showDetails(update?: IUpdate) {
		this.currentVersionNode.textContent = this.productService.version;
		this.targetVersionNode.textContent = update?.productVersion ?? '';
		this.detailsSection.style.display = '';
	}

	private showAction(label: string, action: () => void) {
		this.actionButton.textContent = label;
		this.actionButton.style.display = '';
		this.actionButton.onclick = e => {
			e.preventDefault();
			e.stopPropagation();
			if (copyValue.value) {
				this.clipboardService.writeText(copyValue.value);
			}
		}));

		return { label, copyValue, copyButton };
	}

	private runCommandAndClose(command: string, ...args: unknown[]) {
		if (this.commandTelemetrySource) {
			this.telemetryService.publicLog2<WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification>('workbenchActionExecuted', { id: command, from: this.commandTelemetrySource });
		}

		this.commandService.executeCommand(command, ...args);
		this.hoverService.hideHover(true);
	}
}
