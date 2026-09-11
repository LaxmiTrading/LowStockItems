import { useEffect, useState } from 'react';

/**
 * Subscribes to a media query.
 *
 * The initial value is read synchronously in the state initialiser rather than
 * in an effect, so the very first render is already correct. Reading it in an
 * effect would render one layout and swap it a frame later, which on a phone
 * is a visible flash of a layout that never fits.
 */
export function useMediaQuery(query) {
	const [matches, setMatches] = useState(() =>
		typeof window !== 'undefined' && window.matchMedia
			? window.matchMedia(query).matches
			: false,
	);

	useEffect(() => {
		if (!window.matchMedia) return undefined;
		const media = window.matchMedia(query);
		const onChange = (event) => setMatches(event.matches);

		// Re-read on subscribe: the query can change between the first render
		// and this effect, which is exactly what happens when a foldable is
		// unfolded while the app is loading.
		setMatches(media.matches);
		media.addEventListener('change', onChange);
		return () => media.removeEventListener('change', onChange);
	}, [query]);

	return matches;
}

/**
 * Three layouts, because this app is used on a foldable.
 *
 *   phone    < 640px   a Fold's cover screen is about 300–400px of CSS width.
 *                      One column, the fewest fields that still identify a row.
 *
 *   folded   640–1023  the inner screen is roughly 670–840px. Too wide to keep
 *   open                showing phone cards with three fields, too narrow for a
 *                      nine-column table. Cards, but denser: a two-column
 *                      detail grid inside each, and flat lists two across.
 *
 *   desktop  >= 1024   sidebar and real tables.
 *
 * Unfolding moves between the second and first of these live, which is why
 * these are media queries rather than anything measured once at startup.
 */
export const DESKTOP_QUERY = '(min-width: 1024px)';
export const WIDE_QUERY = '(min-width: 640px)';

export const useIsDesktop = () => useMediaQuery(DESKTOP_QUERY);
/** True on a fold-open inner screen or a tablet, and on desktop. */
export const useIsWide = () => useMediaQuery(WIDE_QUERY);
