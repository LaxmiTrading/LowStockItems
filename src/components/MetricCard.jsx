import { useEffect, useRef, useState } from 'react';

/**
 * The figure that sits above a list, as the design canvas draws it.
 *
 * Shared rather than copied: the low-stock and lost-sale lists both open with
 * a row of these, and a second copy would be the first thing to drift.
 */

// Numbers count up to their new value instead of snapping to it. On a page
// whose totals climb while the catalogue streams in, the movement is the whole
// point — it shows the list filling rather than just reporting the result.
//
// Anything non-numeric (an em dash, a pre-formatted string) is passed straight
// through, and the locale formatting of the caller's value is preserved by
// re-formatting the interpolated number the same way.
function useCountUp(target, duration = 650) {
	const [display, setDisplay] = useState(target);
	const fromRef = useRef(target);
	const rafRef = useRef(null);

	useEffect(() => {
		if (typeof target !== 'number') {
			setDisplay(target);
			return;
		}

		const from = typeof fromRef.current === 'number' ? fromRef.current : 0;
		const delta = target - from;

		// A small step is not worth animating — it just looks like a stutter.
		if (Math.abs(delta) < 2) {
			fromRef.current = target;
			setDisplay(target);
			return;
		}

		const started = performance.now();
		const step = (now) => {
			const t = Math.min(1, (now - started) / duration);
			// Ease-out cubic: fast off the mark, gentle into the final figure.
			const eased = 1 - Math.pow(1 - t, 3);
			const value = Math.round(from + delta * eased);
			setDisplay(value);
			if (t < 1) rafRef.current = requestAnimationFrame(step);
			else fromRef.current = target;
		};

		rafRef.current = requestAnimationFrame(step);
		return () => cancelAnimationFrame(rafRef.current);
	}, [target, duration]);

	return display;
}

export default function MetricCard({
	label,
	value,
	accent,
	icon,
	hint,
	tone = 'neutral',
}) {
	// The callers hand in either a number or an already-formatted string; only
	// the former can be animated.
	const numeric = typeof value === 'number' ? value : null;
	const counted = useCountUp(numeric ?? 0);
	const shown =
		numeric != null ? counted.toLocaleString('en-IN') : (value ?? '—');

	// `accent` is the old boolean API — the one card on a row that matters most.
	// It maps onto the tone scale so existing call sites keep working.
	const resolved = accent && tone === 'neutral' ? 'ok' : tone;

	const TONES = {
		neutral: {
			value: 'text-heading',
			chip: 'bg-brand-50 text-brand-600 border-brand-100',
		},
		ok: {
			value: 'text-ok',
			chip: 'bg-ok-bg text-ok border-ok-border',
		},
		warn: {
			value: 'text-warn',
			chip: 'bg-warn-bg text-warn-2 border-warn-border',
		},
	};
	const t = TONES[resolved] || TONES.neutral;

	return (
		<div className="flex-1 min-w-0 bg-surface border border-line rounded px-3 py-3 sm:px-5 sm:py-[17px]">
			<div className="flex items-center gap-3">
				{icon && (
					<span
						className={`hidden sm:flex w-9 h-9 rounded border items-center justify-center flex-shrink-0 ${t.chip}`}>
						<svg
							width="17"
							height="17"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.9"
							strokeLinecap="round"
							strokeLinejoin="round">
							{icon}
						</svg>
					</span>
				)}

				<div className="min-w-0">
					<div className="text-[11px] sm:text-[11.5px] font-bold text-muted tracking-[.04em] sm:tracking-[.05em] uppercase leading-tight">
						{label}
					</div>
					<div
						className={`num text-[22px] sm:text-[27px] leading-[1.15] font-black tracking-[-.02em] mt-0.5 ${t.value}`}>
						{shown}
					</div>
				</div>
			</div>

			{hint && (
				<div className="hidden sm:block mt-2 text-[11.5px] text-muted-2 leading-snug">
					{hint}
				</div>
			)}
		</div>
	);
}
