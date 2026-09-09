import { useState, useRef, useEffect } from 'react';
import Checkbox from '../Checkbox';

/**
 * Quantity-mode dropdown. A list rather than a stack of cards, so the inputs a
 * method needs sit immediately under the selection instead of far down the form.
 *
 * options: [{ id, n, name, desc, existing }]
 *
 * With `multiple`, the same dropdown ticks several methods instead of picking
 * one: `values` holds the chosen ids and `onChange` is a toggle. The panel then
 * stays open while you tick, since choosing one is rarely the whole intent.
 */
export default function ModeSelect({
	options,
	value,
	values,
	onChange,
	placeholder,
	multiple = false,
}) {
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(0);
	const wrapRef = useRef(null);
	const listRef = useRef(null);

	const chosen = multiple ? (values ?? []) : [];
	const isChosen = (o) => chosen.includes(o.id);
	const selected = options.find((o) => o.id === value);

	useEffect(() => {
		const onDown = (e) => {
			if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
		};
		document.addEventListener('mousedown', onDown);
		return () => document.removeEventListener('mousedown', onDown);
	}, []);

	// Open on the current selection so the arrows start from the right place.
	// Multi-select starts at the first thing already ticked, for the same reason.
	useEffect(() => {
		if (open) {
			const i = multiple
				? options.findIndex((o) => (values ?? []).includes(o.id))
				: options.findIndex((o) => o.id === value);
			setActive(i >= 0 ? i : 0);
		}
		// `values` is deliberately absent: re-running this on every tick would
		// throw the highlight back to the top of the list mid-selection.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, options, value, multiple]);

	useEffect(() => {
		if (!open || !listRef.current) return;
		listRef.current
			.querySelector(`[data-idx="${active}"]`)
			?.scrollIntoView({ block: 'nearest' });
	}, [active, open]);

	const pick = (o) => {
		onChange(o.id);
		// Ticking one of several is rarely the end of the job, so the panel stays.
		if (!multiple) setOpen(false);
	};

	const onKeyDown = (e) => {
		if (!open) {
			if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				setOpen(true);
			}
			return;
		}
		if (e.key === 'Escape') {
			setOpen(false);
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			setActive((i) => (i + 1) % options.length);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			setActive((i) => (i - 1 + options.length) % options.length);
		} else if (e.key === 'Enter' || (multiple && e.key === ' ')) {
			e.preventDefault();
			const o = options[active];
			if (o) pick(o);
		}
	};

	return (
		<div ref={wrapRef} className="relative">
			<button
				onClick={() => setOpen((v) => !v)}
				onKeyDown={onKeyDown}
				aria-haspopup="listbox"
				aria-expanded={open}
				className={`w-full h-[38px] px-3 border rounded bg-surface flex items-center justify-between gap-2 cursor-pointer text-left transition-colors duration-150 ${
					open
						? 'border-brand'
						: 'border-line-2 hover:border-muted-4'
				}`}>
				{multiple ? (
					chosen.length === 0 ? (
						<span className="text-[13.5px] text-muted-3">{placeholder}</span>
					) : (
						<span
							className="min-w-0 text-[13px] font-bold text-body truncate"
							title={options
								.filter(isChosen)
								.map((o) => `${o.n}. ${o.name}`)
								.join(' · ')}>
							{chosen.length} method{chosen.length !== 1 ? 's' : ''} selected
						</span>
					)
				) : selected ? (
					<span
						className="min-w-0 text-[13px] font-bold text-body truncate"
						title={selected.desc}>
						{selected.n}. {selected.name}
					</span>
				) : (
					<span className="text-[13.5px] text-muted-3">{placeholder}</span>
				)}
				<svg
						width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					className={`text-muted flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}>
					<path d="M6 9l6 6 6-6" />
				</svg>
			</button>

			{open && (
				<div
					ref={listRef}
					role="listbox"
					aria-multiselectable={multiple || undefined}
					className="animate-slide-down absolute top-[calc(100%+5px)] left-0 right-0 bg-surface border border-line-2 rounded shadow-pop z-40 overflow-auto max-h-[320px]">
					{options.map((o, i) => {
						const isActive = i === active;
						// Solid brand would swallow a ticked checkbox, which is the one
						// thing a multi-select row has to keep showing — so the
						// highlight there is a tint rather than a fill.
						const dark = isActive && !multiple;
						return (
							<div
								key={o.id}
								data-idx={i}
								role="option"
								aria-selected={multiple ? isChosen(o) : o.id === value}
								onMouseEnter={() => setActive(i)}
								onClick={() => pick(o)}
								className={`px-3.5 py-2.5 cursor-pointer border-b border-line-4 last:border-b-0 flex items-start gap-2.5 transition-colors duration-100 ${
									dark
										? 'bg-brand text-white'
										: isActive
											? 'bg-brand-50 text-body'
											: 'text-body'
								}`}>
								{multiple && (
									<div className="pt-0.5 flex-shrink-0">
										<Checkbox
											checked={isChosen(o)}
											size={16}
											label={o.name}
											onChange={() => pick(o)}
										/>
									</div>
								)}
								<div className="min-w-0">
									<div className="flex items-center gap-2 flex-wrap">
										<span className="text-[13px] font-black">
											{o.n}. {o.name}
										</span>
										{o.existing && (
											<span
												className={`text-[9.5px] font-black uppercase tracking-wide rounded-full px-1.5 py-px border ${
													dark
														? 'bg-white/20 text-white border-white/30'
														: 'bg-surface-2 text-muted border-line'
												}`}>
												existing
											</span>
										)}
									</div>
									<div
										className={`text-[11px] mt-0.5 ${dark ? 'text-white/85' : 'text-muted'}`}>
										{o.desc}
									</div>
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
