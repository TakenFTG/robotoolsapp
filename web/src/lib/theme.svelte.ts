/**
 * Light, dark, or whatever the device says.
 *
 * The applied class lives on <html> rather than on a component, so it covers dialogs and
 * anything else portalled outside the app tree. The same logic runs twice: once inline in
 * app.html before first paint, and once here when the app boots. Duplicating it is the
 * price of not showing a white flash to someone who chose dark — see THEME_BOOT_SCRIPT.
 */
export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_PREFERENCES: ThemePreference[] = ['system', 'light', 'dark'];

export function isThemePreference(value: unknown): value is ThemePreference {
	return value === 'system' || value === 'light' || value === 'dark';
}

function prefersDark(): boolean {
	return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}

export function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
	return preference === 'system' ? (prefersDark() ? 'dark' : 'light') : preference;
}

export function applyTheme(preference: ThemePreference): void {
	if (typeof document === 'undefined') {
		return;
	}
	document.documentElement.classList.toggle('dark', resolveTheme(preference) === 'dark');
}

/**
 * Follow the device while the preference is System.
 *
 * Returns a teardown function. Only meaningful for 'system'; the other two are fixed and
 * the listener would have nothing to say.
 */
export function watchSystemTheme(getPreference: () => ThemePreference): () => void {
	if (typeof window === 'undefined' || !window.matchMedia) {
		return () => {};
	}

	const query = window.matchMedia('(prefers-color-scheme: dark)');
	const onChange = () => {
		if (getPreference() === 'system') {
			applyTheme('system');
		}
	};

	query.addEventListener('change', onChange);
	return () => query.removeEventListener('change', onChange);
}
