import { useLayoutEffect, useState } from 'react';

// The gap between anchor and popover, and the margin kept from the viewport.
const GAP = 4;
const EDGE = 12;

/**
 * Place a `position: fixed` popover against the element that opened it.
 *
 * For popovers portalled out of a dialog: drawn inside one, they sit in its
 * scrolling body, which cuts them off at the bottom edge. Below the anchor when
 * the popover fits there, above it when it fits there better, and never past
 * the viewport — the chosen side caps the height. Re-measured on scroll (in any
 * container) and resize, and whenever `deps` change the popover's content.
 *
 * `naturalHeight(pop)` reports the uncapped height. The default, scrollHeight,
 * is right for a popover that scrolls itself; one that scrolls an inner list
 * must add that list's overflow back, or a capped popover measures as if it
 * fitted and flips on the next scroll.
 *
 * Returns null until measured, so the caller can keep it hidden for that frame.
 */
export function useAnchoredPosition({
	open,
	anchorRef,
	popRef,
	matchWidth = false,
	naturalHeight = (pop) => pop.scrollHeight,
	deps = [],
}) {
	const [place, setPlace] = useState(null);

	useLayoutEffect(() => {
		if (!open) {
			setPlace(null);
			return undefined;
		}
		const measure = () => {
			const a = anchorRef.current?.getBoundingClientRect();
			const pop = popRef.current;
			if (!a || !pop) return;

			const natural = naturalHeight(pop);
			const below = window.innerHeight - a.bottom - GAP - EDGE;
			const above = a.top - GAP - EDGE;
			const up = natural > below && above > below;

			const width = matchWidth ? a.width : pop.offsetWidth;
			const left = Math.max(
				EDGE,
				Math.min(a.left, window.innerWidth - width - EDGE),
			);

			setPlace({
				left,
				width: matchWidth ? a.width : undefined,
				top: up ? undefined : a.bottom + GAP,
				bottom: up ? window.innerHeight - a.top + GAP : undefined,
				maxHeight: Math.max(160, up ? above : below),
			});
		};
		measure();
		window.addEventListener('resize', measure);
		window.addEventListener('scroll', measure, true);
		return () => {
			window.removeEventListener('resize', measure);
			window.removeEventListener('scroll', measure, true);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, matchWidth, ...deps]);

	return place;
}

/** The style for a popover placed by useAnchoredPosition. */
export function anchoredStyle(place) {
	return {
		position: 'fixed',
		left: place?.left,
		width: place?.width,
		top: place?.top,
		bottom: place?.bottom,
		maxHeight: place?.maxHeight,
		visibility: place ? 'visible' : 'hidden',
	};
}
