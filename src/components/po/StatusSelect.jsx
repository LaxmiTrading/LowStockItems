import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { reachableFrom, statusById } from '../../lib/poFollowups';
import { toneDot, toneStyle } from '../../lib/tones';
import { anchoredStyle, useAnchoredPosition } from '../../lib/useAnchoredPosition';

/**
 * Pick the stage a call moves an order to, or leave it where it is.
 *
 * A native <select> cannot show a stage's colour, so this is a listbox of its
 * own. It offers what StatusMenu offers — only the moves the pipeline allows,
 * and for an administrator a switch at the foot of the list to show every
 * stage — but it records a choice for a form to submit rather than making the
 * move on the spot.
 *
 * The list is portalled to the body and positioned against the trigger. Drawn
 * inside the form it sat in the dialog's scrolling body, which cut it off at
 * the bottom edge and scrolled the fields above out of view.
 */
export default function StatusSelect({
	workflow,
	currentStatusId,
	isAdmin,
	value,
	onChange,
	disabled,
}) {
	const [open, setOpen] = useState(false);
	const rootRef = useRef(null);
	const triggerRef = useRef(null);
	const popRef = useRef(null);
	const listRef = useRef(null);

	const reachable = useMemo(
		() => reachableFrom(workflow, currentStatusId),
		[workflow, currentStatusId],
	);
	const isReachable = (id) => reachable.some((s) => s.id === id);

	// Starts on when the chosen stage is one only the override shows, so
	// reopening the list never hides what is selected.
	const [override, setOverride] = useState(() => !!value && !isReachable(value));

	const options = useMemo(() => {
		if (!override) return reachable;
		return (workflow?.statuses ?? []).filter(
			(s) => !s.archived && s.id !== currentStatusId,
		);
	}, [override, reachable, workflow, currentStatusId]);

	const selected = statusById(workflow, value);

	const place = useAnchoredPosition({
		open,
		anchorRef: triggerRef,
		popRef,
		matchWidth: true,
		// The popover scrolls its inner list, so its own scrollHeight shrinks
		// once capped; the list's overflow is added back.
		naturalHeight: (pop) => {
			const list = listRef.current;
			return list ? list.scrollHeight + pop.offsetHeight - list.offsetHeight : pop.scrollHeight;
		},
		deps: [override],
	});

	useEffect(() => {
		if (!open) return undefined;
		const onDown = (e) => {
			if (rootRef.current?.contains(e.target)) return;
			if (popRef.current?.contains(e.target)) return;
			setOpen(false);
		};
		document.addEventListener('mousedown', onDown);
		return () => document.removeEventListener('mousedown', onDown);
	}, [open]);

	// Focus the chosen row once the list is placed, so arrow keys start from
	// it. preventScroll, or focusing would scroll the dialog behind it.
	const placed = !!place;
	useEffect(() => {
		if (!placed || !listRef.current) return;
		const rows = [...listRef.current.querySelectorAll('[role="option"]')];
		(rows.find((r) => r.getAttribute('aria-selected') === 'true') ?? rows[0])?.focus({
			preventScroll: true,
		});
	}, [placed]);

	const pick = (id) => {
		onChange(id);
		setOpen(false);
	};

	const toggleOverride = (on) => {
		setOverride(on);
		// Turning it off must not leave selected a stage the narrower list no
		// longer shows — it would be submitted unseen.
		if (!on && value && !isReachable(value)) onChange('');
	};

	const onKeyDown = (e) => {
		if (!open) return;
		if (e.key === 'Escape') {
			// Stopped here, or the dialog around this form closes too.
			e.stopPropagation();
			setOpen(false);
			triggerRef.current?.focus();
			return;
		}
		if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
		e.preventDefault();
		const rows = [...listRef.current.querySelectorAll('[role="option"]')];
		const at = rows.indexOf(document.activeElement);
		const next = e.key === 'ArrowDown' ? at + 1 : at - 1;
		rows[(next + rows.length) % rows.length]?.focus();
	};

	const row = (id, children, { selectedRow, forced } = {}) => (
		<button
			key={id || 'unchanged'}
			type="button"
			role="option"
			aria-selected={selectedRow}
			onClick={() => pick(id)}
			className={`w-full flex items-center gap-2.5 px-3 h-9 text-left text-[13px] bg-transparent border-none cursor-pointer outline-none hover:bg-surface-2 focus-visible:bg-surface-2 ${
				selectedRow ? 'text-heading font-bold' : 'text-body'
			}`}>
			{children}
			{forced && (
				<span className="ml-auto text-[10.5px] font-bold text-warn-2 bg-warn-bg border border-warn-border rounded-full px-1.5 py-px flex-shrink-0">
					override
				</span>
			)}
			<svg
				width="13"
				height="13"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2.6"
				strokeLinecap="round"
				strokeLinejoin="round"
				className={`flex-shrink-0 text-brand ${forced ? '' : 'ml-auto'} ${selectedRow ? '' : 'invisible'}`}>
				<path d="M20 6 9 17l-5-5" />
			</svg>
		</button>
	);

	return (
		// React carries key events from the portalled list back up to here, so
		// one handler covers both.
		<div ref={rootRef} className="relative" onKeyDown={onKeyDown}>
			<button
				ref={triggerRef}
				type="button"
				disabled={disabled}
				onClick={() => setOpen((v) => !v)}
				aria-haspopup="listbox"
				aria-expanded={open}
				className={`w-full h-[38px] border rounded px-3 text-[13.5px] bg-surface outline-none flex items-center gap-2.5 text-left cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-default ${
					open ? 'border-brand' : 'border-line-2 focus:border-brand'
				}`}>
				{selected ? (
					<>
						<span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${toneDot(selected.tone)}`} style={toneStyle(selected.tone)} />
						<span className="truncate text-body font-bold">{selected.name}</span>
						{!isReachable(selected.id) && (
							<span className="text-[10.5px] font-bold text-warn-2 bg-warn-bg border border-warn-border rounded-full px-1.5 py-px flex-shrink-0">
								override
							</span>
						)}
					</>
				) : (
					<span className="truncate text-muted-2">Leave unchanged</span>
				)}
				<svg
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2.4"
					strokeLinecap="round"
					strokeLinejoin="round"
					className={`ml-auto flex-shrink-0 text-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
					<path d="M6 9l6 6 6-6" />
				</svg>
			</button>

			{open &&
				createPortal(
					<div
						ref={popRef}
						// Above the dialog (z-100). Hidden for the one frame before it is
						// measured, so it never flashes at the wrong place.
						style={anchoredStyle(place)}
						className="z-[110] flex flex-col bg-surface border border-line-2 rounded shadow-pop overflow-hidden animate-fade-in">
						<div ref={listRef} role="listbox" aria-label="Status" className="py-1 min-h-0 overflow-y-auto">
							{row(
								'',
								<>
									<span className="w-2.5 h-2.5 rounded-full flex-shrink-0 border-[1.5px] border-dashed border-muted-2" />
									<span className="truncate">Leave unchanged</span>
								</>,
								{ selectedRow: !value },
							)}

							{options.length > 0 && <div className="my-1 border-t border-line-4" />}

							{options.map((s) =>
								row(
									s.id,
									<>
										<span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${toneDot(s.tone)}`} style={toneStyle(s.tone)} />
										<span className="truncate">{s.name}</span>
									</>,
									{ selectedRow: s.id === value, forced: !isReachable(s.id) },
								),
							)}

							{options.length === 0 && (
								<div className="px-3 py-2 text-[12px] text-muted-2 leading-relaxed">
									{currentStatusId
										? 'The pipeline allows no move from this stage.'
										: 'No stage is marked as the default, so there is nowhere to start.'}
								</div>
							)}
						</div>

						{isAdmin && (
							<label className="flex-shrink-0 flex items-center gap-2 px-3 h-9 border-t border-line-2 bg-surface-2 cursor-pointer select-none text-[12px] text-muted-2 hover:text-body-2">
								<input
									type="checkbox"
									checked={override}
									onChange={(e) => toggleOverride(e.target.checked)}
									className="cursor-pointer accent-brand"
								/>
								Show every stage (override)
							</label>
						)}
					</div>,
				document.body,
			)}
		</div>
	);
}
