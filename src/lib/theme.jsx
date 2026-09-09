/**
 * Light, dark, or follow the system.
 *
 * The choice is stored per browser rather than per account: it is a property
 * of the screen you are sitting at, not of who you are. Somebody on a bright
 * warehouse terminal and the same person on a laptop at night want different
 * answers.
 *
 * "System" is resolved here rather than by a prefers-color-scheme media query
 * in the stylesheet, so `data-theme` on <html> is always a concrete
 * light/dark. One source of truth, and no chance of a media query and an
 * explicit choice fighting at equal specificity.
 */

import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useState,
} from 'react';

export const THEME_STORAGE_KEY = 'lsi:theme';
export const THEMES = ['light', 'dark', 'system'];

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function readStoredTheme() {
	try {
		const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
		return THEMES.includes(stored) ? stored : 'system';
	} catch {
		// Private browsing, or site data blocked. Following the system is the
		// right thing to fall back to.
		return 'system';
	}
}

export const systemTheme = () =>
	window.matchMedia?.(DARK_QUERY).matches ? 'dark' : 'light';

export const resolveTheme = (preference) =>
	preference === 'system' ? systemTheme() : preference;

function apply(resolved) {
	document.documentElement.setAttribute('data-theme', resolved);
}

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
	const [preference, setPreference] = useState(readStoredTheme);
	const [resolved, setResolved] = useState(() => resolveTheme(readStoredTheme()));

	// Apply, and persist the choice.
	useEffect(() => {
		const next = resolveTheme(preference);
		setResolved(next);
		apply(next);
		try {
			window.localStorage.setItem(THEME_STORAGE_KEY, preference);
		} catch {
			// Not being able to remember the choice is not a reason to ignore it
			// for this session.
		}
	}, [preference]);

	// Follow the system while "system" is selected — someone whose OS switches
	// at sunset should see the app switch with it, without a reload.
	useEffect(() => {
		if (preference !== 'system') return undefined;
		const media = window.matchMedia?.(DARK_QUERY);
		if (!media) return undefined;

		const onChange = () => {
			const next = systemTheme();
			setResolved(next);
			apply(next);
		};
		media.addEventListener('change', onChange);
		return () => media.removeEventListener('change', onChange);
	}, [preference]);

	const value = useMemo(
		() => ({
			preference,
			resolved,
			setTheme: (next) => setPreference(THEMES.includes(next) ? next : 'system'),
		}),
		[preference, resolved],
	);

	return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
	const context = useContext(ThemeContext);
	if (context === null) {
		throw new Error('useTheme must be used inside a ThemeProvider.');
	}
	return context;
}

/** Shared by the settings control, so the labels and icons live in one place. */
export const THEME_OPTIONS = [
	{
		id: 'light',
		label: 'Light',
		icon: (
			<>
				<circle cx="12" cy="12" r="4.5" />
				<path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
			</>
		),
	},
	{
		id: 'dark',
		label: 'Dark',
		icon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
	},
	{
		id: 'system',
		label: 'System',
		icon: (
			<>
				<rect x="2.5" y="4" width="19" height="13" rx="2" />
				<path d="M8 21h8M12 17v4" />
			</>
		),
	},
];
