import type { AppStorage } from './app.svelte';
import { applyTheme, isThemePreference, type ThemePreference } from './theme.svelte';

export interface PreferencesData {
	notebookSortingTabViewMode: 'grid' | 'column';
	/** Light, dark, or follow the device. See theme.svelte.ts. */
	theme: ThemePreference;
}

export class Preferences {
	private storageKey = 'preferences';
	private storage: AppStorage;
	private data: PreferencesData = $state({
		notebookSortingTabViewMode: 'grid',
		theme: 'system'
	});

	constructor(storage: AppStorage) {
		this.storage = storage;
		this.linkLocalStorage();

		if (typeof window !== 'undefined') {
			window.addEventListener('storage', (evt) => {
				if (evt.key !== this.storageKey) return;
				this.linkLocalStorage();
			});
		}
	}

	public get<K extends keyof PreferencesData>(key: K): PreferencesData[K] {
		return this.data[key];
	}

	public set<K extends keyof PreferencesData>(key: K, value: PreferencesData[K]): void {
		this.data[key] = value;
		this.storage.save(this.storageKey, $state.snapshot(this.data));

		if (key === 'theme') {
			applyTheme(this.data.theme);
		}
	}

	private linkLocalStorage() {
		if (typeof window === 'undefined') return;
		const data = this.storage.load<Partial<PreferencesData>>(this.storageKey);
		if (data) {
			this.data.notebookSortingTabViewMode = data.notebookSortingTabViewMode ?? 'grid';
			this.data.theme = isThemePreference(data.theme) ? data.theme : 'system';
		}

		// Also covers the storage event, so changing the theme in one tab moves the others.
		applyTheme(this.data.theme);
	}
}
