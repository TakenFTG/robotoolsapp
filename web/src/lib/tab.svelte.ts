import { m } from '$lib/paraglide/messages.js';
import type { Component, ComponentProps } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { generateUUID } from './utils.svelte';
import { app } from './index.svelte';
import OverviewTabComponent from './components/workspace/tabs/OverviewTab.svelte';
import TeamInterviewRubricTabComponent from './components/workspace/tabs/TeamInterviewRubricTab.svelte';
import NotebookRubricTabComponent from './components/workspace/tabs/NotebookRubricTab.svelte';
import NotebookSortingTabComponent from './components/workspace/tabs/NotebookSortingTab.svelte';
import AwardRankingTabComponent from './components/workspace/tabs/AwardRankingTab.svelte';
import AwardNominationTabComponent from './components/workspace/tabs/AwardNominationTab.svelte';
import FinalRankingTabComponent from './components/workspace/tabs/FinalRankingTab.svelte';
import AwardWinnerTabComponent from './components/workspace/tabs/AwardWinnerTab.svelte';
import TeamAttendanceTabComponent from './components/workspace/tabs/TeamAttendanceTab.svelte';
import ExcellenceAwardEligibilityTabComponent from './components/workspace/tabs/ExcellenceAwardCandidatesTab.svelte';
import JudgesOverviewTabComponent from './components/workspace/tabs/JudgesOverviewTab.svelte';
import MatchesTabComponent from './components/workspace/tabs/MatchesTab.svelte';
import SkillsTabComponent from './components/workspace/tabs/SkillsTab.svelte';
import FreeTimeTabComponent from './components/workspace/tabs/FreeTimeTab.svelte';
import RefNotesTabComponent from './components/workspace/tabs/RefNotesTab.svelte';

// ============================================================================
// Tab System
// ============================================================================

/**
 * The part of another tab that isEqual actually looks at.
 *
 * Every implementation compares hashes and nothing else, but the parameter was typed
 * BaseTab<any> — tabs are compared across kinds, and BaseTab<C> would only accept its own.
 * Naming what is really required removes the `any` without widening anything: a whole tab
 * still satisfies it structurally.
 */
interface TabIdentity {
	readonly hash: string;
	readonly component: Component<never>;
}

// Base tab interface
interface BaseTab<C extends Component<ComponentProps<C>>> {
	readonly id: string;
	isPinned: boolean;
	component: C;
	props: Omit<ComponentProps<C>, 'isActive'>;
	get title(): string;
	get hash(): string;
	isEqual(other: TabIdentity): boolean;
	isDataUnsaved(): boolean;
}

export class OverviewTab implements BaseTab<typeof OverviewTabComponent> {
	readonly id: string;
	readonly isPinned = true;
	readonly type = 'overview';
	readonly component = OverviewTabComponent;
	readonly props = { tab: this };
	subscriptionScope: 'all_judge_groups' | 'current_judge_group' = $state('current_judge_group');

	get title() {
		return m.overview_tab_title();
	}

	get hash() {
		return JSON.stringify({ type: this.type });
	}

	isEqual(other: TabIdentity): boolean {
		return this.hash === other.hash;
	}

	isDataUnsaved(): boolean {
		return false;
	}

	constructor() {
		this.id = generateUUID();
	}
}

export class TeamAttendanceTab implements BaseTab<typeof TeamAttendanceTabComponent> {
	readonly id: string;
	readonly isPinned = false;
	readonly type = 'team_attendance';
	readonly component = TeamAttendanceTabComponent;
	readonly props = {};

	get title() {
		return m.team_attendance();
	}

	get hash() {
		return JSON.stringify({ type: this.type });
	}

	isEqual(other: TabIdentity): boolean {
		return this.hash === other.hash;
	}

	isDataUnsaved(): boolean {
		return false;
	}

	constructor() {
		this.id = generateUUID();
	}
}

export class NotebookSortingTab implements BaseTab<typeof NotebookSortingTabComponent> {
	readonly id: string;
	readonly isPinned = false;
	readonly type = 'notebook_sorting';
	readonly component = NotebookSortingTabComponent;
	readonly props = { tab: this };

	get title() {
		return m.notebook_sorting();
	}

	get hash() {
		return JSON.stringify({ type: this.type });
	}

	isEqual(other: TabIdentity): boolean {
		return this.hash === other.hash;
	}

	isDataUnsaved(): boolean {
		return false;
	}

	constructor() {
		this.id = generateUUID();
	}
}

export class NotebookRubricTab implements BaseTab<typeof NotebookRubricTabComponent> {
	readonly id: string;
	readonly isPinned = false;
	readonly type = 'notebook_rubric';
	readonly component = NotebookRubricTabComponent;
	readonly props = { tab: this };
	teamId: string = $state('');
	rubricId: string | null = $state(null);
	_isDataUnsaved: boolean = $state(false);

	get title() {
		const team = app.findTeamById(this.teamId);
		return team ? `${team.number} ${m.notebook_review()}` : m.notebook_review();
	}

	get hash() {
		return JSON.stringify({ type: this.type, rubricId: this.rubricId });
	}

	isEqual(other: TabIdentity): boolean {
		if (other.component === this.component) {
			const otherRubricId = (other as NotebookRubricTab).rubricId;
			const thisRubricId = this.rubricId;
			if (otherRubricId !== null || thisRubricId !== null) {
				return otherRubricId === thisRubricId;
			} else {
				return (other as NotebookRubricTab).teamId === this.teamId;
			}
		}
		return false;
	}

	isDataUnsaved(): boolean {
		return this._isDataUnsaved;
	}

	constructor(params: { teamId: string } | { rubricId: string }) {
		this.id = generateUUID();

		if ('rubricId' in params) {
			this.rubricId = params.rubricId;
			this.teamId = ''; // Will be set when rubric loads
		} else {
			this.teamId = params.teamId;
			this.rubricId = null; // Will be set after the rubric is saved
		}
	}
}

export class TeamInterviewRubricTab implements BaseTab<typeof TeamInterviewRubricTabComponent> {
	readonly id: string;
	readonly isPinned = false;
	readonly type = 'team_interview_rubric';
	readonly component = TeamInterviewRubricTabComponent;
	readonly props = { tab: this };
	teamId: string = $state('');
	rubricId: string | null = $state(null);
	_isDataUnsaved: boolean = $state(false);

	get title() {
		const team = app.findTeamById(this.teamId);
		return team ? `${team.number} ${m.team_interview()}` : m.team_interview();
	}

	get hash() {
		return JSON.stringify({ type: this.type, rubricId: this.rubricId });
	}

	isEqual(other: TabIdentity): boolean {
		if (other.component === this.component) {
			const otherRubricId = (other as NotebookRubricTab).rubricId;
			const thisRubricId = this.rubricId;
			if (otherRubricId !== null || thisRubricId !== null) {
				return otherRubricId === thisRubricId;
			} else {
				return (other as NotebookRubricTab).teamId === this.teamId;
			}
		}
		return false;
	}

	isDataUnsaved(): boolean {
		return this._isDataUnsaved;
	}

	constructor(params: { teamId: string } | { rubricId: string }) {
		this.id = generateUUID();

		if ('rubricId' in params) {
			this.rubricId = params.rubricId;
			this.teamId = ''; // Will be set when rubric loads
		} else {
			this.teamId = params.teamId;
			this.rubricId = null; // Will be set after the rubric is saved
		}
	}
}

export class AwardRankingTab implements BaseTab<typeof AwardRankingTabComponent> {
	readonly id: string;
	readonly isPinned = false;
	readonly type = 'award_ranking';
	readonly component = AwardRankingTabComponent;
	readonly props = { tab: this };

	get title() {
		return m.award_ranking();
	}

	get hash() {
		return JSON.stringify({ type: this.type });
	}

	isEqual(other: TabIdentity): boolean {
		return this.hash === other.hash;
	}

	isDataUnsaved(): boolean {
		return false;
	}

	constructor() {
		this.id = generateUUID();
	}
}

export class AwardNominationTab implements BaseTab<typeof AwardNominationTabComponent> {
	readonly id: string;
	readonly isPinned = false;
	readonly type = 'award_nomination';
	readonly component = AwardNominationTabComponent;
	readonly props = { tab: this };

	get title() {
		return m.award_nomination();
	}

	get hash() {
		return JSON.stringify({ type: this.type });
	}

	isEqual(other: TabIdentity): boolean {
		return this.hash === other.hash;
	}

	isDataUnsaved(): boolean {
		return false;
	}

	constructor() {
		this.id = generateUUID();
	}
}

export class ExcellenceAwardCandidatesTab implements BaseTab<typeof ExcellenceAwardEligibilityTabComponent> {
	readonly id: string;
	readonly isPinned = false;
	readonly type = 'excellence_award_candidates';
	readonly component = ExcellenceAwardEligibilityTabComponent;
	readonly props = { tab: this };

	get title() {
		return m.excellence_award_candidates();
	}

	get hash() {
		return JSON.stringify({ type: this.type });
	}

	isEqual(other: TabIdentity): boolean {
		return this.hash === other.hash;
	}

	isDataUnsaved(): boolean {
		return false;
	}

	constructor() {
		this.id = generateUUID();
	}
}

export class FinalAwardRankingTab implements BaseTab<typeof FinalRankingTabComponent> {
	readonly id: string;
	readonly isPinned = false;
	readonly type = 'final_award_ranking';
	readonly component = FinalRankingTabComponent;
	readonly props = { tab: this };

	get title() {
		return m.final_ranking();
	}

	get hash() {
		return JSON.stringify({ type: this.type });
	}

	isEqual(other: TabIdentity): boolean {
		return this.hash === other.hash;
	}

	isDataUnsaved(): boolean {
		return false;
	}

	constructor() {
		this.id = generateUUID();
	}
}

export class AwardWinnerTab implements BaseTab<typeof AwardWinnerTabComponent> {
	readonly id: string;
	readonly isPinned = false;
	readonly type = 'award_winner';
	readonly component = AwardWinnerTabComponent;
	readonly props = { tab: this };

	get title() {
		return m.award_winner_tab_title();
	}

	get hash() {
		return JSON.stringify({ type: this.type });
	}

	isEqual(other: TabIdentity): boolean {
		return this.hash === other.hash;
	}

	isDataUnsaved(): boolean {
		return false;
	}

	constructor() {
		this.id = generateUUID();
	}
}

/**
 * The match schedule, results and division standings, read from the room's own cache.
 * Not pinned — opened on demand from the Overview tab, like every other tab.
 */
export class MatchesTab implements BaseTab<typeof MatchesTabComponent> {
	readonly id: string;
	/**
	 * Opened from the Start menu, like every other tab, and closable.
	 *
	 * It was briefly pinned and created alongside the overview tab, which meant it opened
	 * itself on every load whether anyone wanted it or not — the overview tab is the only
	 * one that has earned that, because it is where everything else is opened from.
	 */
	readonly isPinned = false;
	readonly type = 'matches';
	readonly component = MatchesTabComponent;
	readonly props = { tab: this };

	get title() {
		return m.matches_tab_title();
	}

	get hash() {
		return JSON.stringify({ type: this.type });
	}

	isEqual(other: TabIdentity): boolean {
		return this.hash === other.hash;
	}

	isDataUnsaved(): boolean {
		return false;
	}

	constructor() {
		this.id = generateUUID();
	}
}

/**
 * Combined skills standings. Its own tab rather than a fourth view inside the matches tab:
 * skills are not matches, they are event-wide rather than per-division, and a judge looking
 * up a team's skills score is doing a different job from one checking a field time.
 *
 * It reads the same server snapshot as the matches tab, so the second tab costs no second
 * fetch — RobotEvents is polled once per room either way.
 */
export class SkillsTab implements BaseTab<typeof SkillsTabComponent> {
	readonly id: string;
	readonly isPinned = false;
	readonly type = 'skills';
	readonly component = SkillsTabComponent;
	readonly props = { tab: this };

	get title() {
		return m.skills_tab_title();
	}

	get hash() {
		return JSON.stringify({ type: this.type });
	}

	isEqual(other: TabIdentity): boolean {
		return this.hash === other.hash;
	}

	isDataUnsaved(): boolean {
		return false;
	}

	constructor() {
		this.id = generateUUID();
	}
}

/**
 * When each team is next free between matches for long enough to interview. Its own tab
 * rather than a view inside the matches tab: it answers "when can we see this team?",
 * not "where is this match?". Reads the same server snapshot, so it costs no extra fetch.
 */
export class FreeTimeTab implements BaseTab<typeof FreeTimeTabComponent> {
	readonly id: string;
	readonly isPinned = false;
	readonly type = 'free_time';
	readonly component = FreeTimeTabComponent;
	readonly props = { tab: this };

	get title() {
		return m.free_time_tab_title();
	}

	get hash() {
		return JSON.stringify({ type: this.type });
	}

	isEqual(other: TabIdentity): boolean {
		return this.hash === other.hash;
	}

	isDataUnsaved(): boolean {
		return false;
	}

	constructor() {
		this.id = generateUUID();
	}
}

export class JudgesOverviewTab implements BaseTab<typeof JudgesOverviewTabComponent> {
	readonly id: string;
	readonly isPinned = false;
	readonly type = 'judges_overview';
	readonly component = JudgesOverviewTabComponent;
	readonly props = { tab: this };

	get title() {
		return m.judges_overview_tab_title();
	}

	get hash() {
		return JSON.stringify({ type: this.type });
	}

	isEqual(other: TabIdentity): boolean {
		return this.hash === other.hash;
	}

	isDataUnsaved(): boolean {
		return false;
	}

	constructor() {
		this.id = generateUUID();
	}
}

/** Ref notes about this division's teams. Judge Advisors only; see RefNotesTab.svelte. */
export class RefNotesTab implements BaseTab<typeof RefNotesTabComponent> {
	readonly id: string;
	readonly isPinned = false;
	readonly type = 'ref_notes';
	readonly component = RefNotesTabComponent;
	readonly props = { tab: this };

	get title() {
		return m.ref_notes_tab_title();
	}

	get hash() {
		return JSON.stringify({ type: this.type });
	}

	isEqual(other: TabIdentity): boolean {
		return this.hash === other.hash;
	}

	isDataUnsaved(): boolean {
		return false;
	}

	constructor() {
		this.id = generateUUID();
	}
}

export type Tab =
	| OverviewTab
	| TeamAttendanceTab
	| NotebookSortingTab
	| NotebookRubricTab
	| TeamInterviewRubricTab
	| AwardRankingTab
	| AwardNominationTab
	| ExcellenceAwardCandidatesTab
	| FinalAwardRankingTab
	| AwardWinnerTab
	| JudgesOverviewTab
	| MatchesTab
	| SkillsTab
	| FreeTimeTab
	| RefNotesTab;

export class TabController {
	private tabs: Tab[] = $state([]);
	private activeTabId: string | null = $state(null);
	private tabChangeHandlers = new SvelteMap<string, (tabId: string | null) => void>();
	public readonly overviewTab: OverviewTab;

	constructor() {
		// Initialize with overview tab
		this.addTab((this.overviewTab = new OverviewTab()));
	}

	get allTabs() {
		return this.tabs;
	}

	get currentTab() {
		return this.tabs.find((tab) => tab.id === this.activeTabId) || null;
	}

	get activeTab() {
		return this.activeTabId;
	}

	get hasMultipleTabs() {
		return this.tabs.length > 1;
	}

	/**
	 * Add a tab
	 */
	addTab(tab: Tab): string {
		this.tabs.push(tab);
		this.switchToTab(tab.id);
		return tab.id;
	}

	addOrReuseTab(tab: Tab): void {
		const existingTab = this.findTab(tab);
		if (existingTab) {
			this.switchToTab(existingTab.id);
		} else {
			this.addTab(tab);
		}
	}

	/**
	 * Switch to a specific tab
	 */
	switchToTab(tabId: string): void {
		const tab = this.tabs.find((t) => t.id === tabId);
		if (tab) {
			this.activeTabId = tabId;
			this.notifyTabChange(tabId);
		}
	}
	/**
	 * Close a tab
	 */
	closeTab(tabId: string): void {
		const tabIndex = this.tabs.findIndex((tab) => tab.id === tabId);
		if (tabIndex === -1) return;

		// Remove the tab
		this.tabs.splice(tabIndex, 1);

		// If we're closing the active tab, switch to another tab
		if (this.activeTabId === tabId) {
			if (this.tabs.length > 0) {
				// Switch to the previous tab, or the first tab if we were at the beginning
				const newIndex = Math.max(0, tabIndex - 1);
				this.activeTabId = this.tabs[newIndex].id;
				this.notifyTabChange(this.activeTabId);
			} else {
				this.activeTabId = null;
				this.notifyTabChange(null);
			}
		}
	}

	/**
	 * Close all closable tabs
	 */
	closeAllTabs(): void {
		const closableTabs = this.tabs.filter((tab) => !tab.isPinned);
		closableTabs.forEach((tab) => this.closeTab(tab.id));
	}

	/**
	 * Find tab by component and optional properties
	 */
	findTab(targetTab: Tab): Tab | null {
		return this.tabs.find((tab) => tab.isEqual(targetTab)) || null;
	}

	/**
	 * Check if a tab exists
	 */
	hasTab(tabId: string): boolean {
		return this.tabs.some((tab) => tab.id === tabId);
	}

	/**
	 * Get tab by ID
	 */
	getTab(tabId: string): Tab | null {
		return this.tabs.find((tab) => tab.id === tabId) || null;
	}

	/**
	 * Reorder tabs (for drag and drop functionality)
	 */
	reorderTabs(newOrder: Tab[]): void {
		this.tabs = newOrder;
	}

	private notifyTabChange(tabId: string | null): void {
		this.tabChangeHandlers.forEach((handler) => handler(tabId));
	}
}
