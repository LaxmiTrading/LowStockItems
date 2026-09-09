import { useState, useMemo, useRef, useCallback, useSyncExternalStore } from 'react';
import { subLineFor } from '../lib/reorderEngine';
import {
	subscribe as subscribeToRun,
	getState as getRunState,
	startRun,
	setDecision,
	setDecisions,
} from '../lib/reorderRun';
import UndoToast from '../components/UndoToast';

const COLS = 'minmax(0,2.4fr) minmax(0,1.7fr) minmax(0,1.7fr) 130px';
const UNDO_WINDOW = 5000;

// §B.6's three tiers, as a filling meter: red, amber, then green as the
// evidence behind a proposal grows. The wording of each tip follows the
// thresholds in confidenceFor, so the two cannot drift apart silently.
const CONFIDENCE_SEGMENTS = 3;
const CONFIDENCE = {
	low: {
		filled: 1,
		fill: 'bg-danger',
		tip: 'Low confidence — limited stock history, so this proposal stays deliberately conservative.',
	},
	medium: {
		filled: 2,
		fill: 'bg-warn',
		tip: 'Medium confidence — 90+ days of stock history and some sales activity behind it.',
	},
	high: {
		filled: 3,
		fill: 'bg-ok',
		tip: 'High confidence — 180+ days of stock history and steady sales behind it.',
	},
};

/**
 * Confidence as a three-segment meter, with the word itself one hover away.
 *
 * A native title, not a positioned element: the list container clips its
 * children (overflow-hidden, for its rounded corners), so a CSS tooltip would
 * be cut off on the first and last rows. The browser draws a native one
 * outside the page entirely, where nothing can clip it.
 */
function ConfidenceBar({ level }) {
	const tier = CONFIDENCE[level] ? level : 'low';
	const cfg = CONFIDENCE[tier];

	return (
		<span
			className="flex items-center gap-[3px] flex-shrink-0"
			title={cfg.tip}
			role="img"
			aria-label={`${tier} confidence`}>
			{Array.from({ length: CONFIDENCE_SEGMENTS }, (_, i) => (
				<span
					key={i}
					className={`w-[10px] h-[7px] rounded-[2px] transition-colors duration-200 ${
						i < cfg.filled ? cfg.fill : 'bg-line-3'
					}`}
				/>
			))}
		</span>
	);
}

/**
 * Reorder-point suggestion review — Engine B.
 *
 * Suggestions are computed on demand rather than on load: each item costs one
 * sales-report call, so running over a large catalogue is a deliberate act.
 *
 * A decision takes the row off the list and raises a countdown toast; until
 * the timer runs out it can be taken back. Nothing is written to Zoho — see
 * the note at the foot of the page.
 */
export default function ReorderSuggestionsPage() {
	// The run lives outside React so it survives navigating away — see
	// src/lib/reorderRun.js. The page is only a view onto it.
	const run = useSyncExternalStore(subscribeToRun, getRunState);
	const { suggestions, status, progress, error, scanned } = run;
	const busy = run.phase === 'running';

	// Toasts are ephemeral UI and stay local: leaving the page commits whatever
	// undo window was open, which is the right outcome.
	const [toasts, setToasts] = useState([]);
	const toastSeq = useRef(0);

	const dismiss = useCallback((tid) => {
		setToasts((list) => list.filter((t) => t.tid !== tid));
	}, []);

	const undo = useCallback(
		(toast) => {
			setDecisions(toast.previous);
			dismiss(toast.tid);
		},
		[dismiss],
	);

	const pushToast = (previous, label) => {
		const tid = ++toastSeq.current;
		setToasts((list) => [...list, { tid, previous, label }]);
	};

	const compute = () => {
		setToasts([]);
		startRun();
	};

	const decide = (suggestion, next) => {
		const previous = { [suggestion.item_id]: status[suggestion.item_id] };
		setDecision(suggestion.item_id, next);
		pushToast(
			previous,
			`${next === 'approved' ? 'Approving' : 'Rejecting'} ${suggestion.item_name}`,
		);
	};

	const approveAll = () => {
		const targets = (suggestions || []).filter(
			(s) => status[s.item_id] === 'pending',
		);
		if (targets.length === 0) return;

		setDecisions(
			Object.fromEntries(targets.map((s) => [s.item_id, 'approved'])),
		);
		for (const s of targets) {
			pushToast({ [s.item_id]: 'pending' }, `Approving ${s.item_name}`);
		}
	};

	const visible = useMemo(
		() => (suggestions || []).filter((s) => status[s.item_id] === 'pending'),
		[suggestions, status],
	);

	const counts = useMemo(() => {
		let approved = 0;
		let pending = 0;
		let rejected = 0;
		for (const st of Object.values(status)) {
			if (st === 'approved') approved++;
			else if (st === 'rejected') rejected++;
			else pending++;
		}
		return { approved, pending, rejected };
	}, [status]);

	// How far through the review you are. With decisions arriving one row at a
	// time, a bar closing on full is the clearest statement of "nearly done".
	const reviewed = counts.approved + counts.rejected;
	const reviewTotal = suggestions ? suggestions.length : 0;

	const progressPct = progress?.total
		? (progress.done / progress.total) * 100
		: 0;

	return (
		<div className="px-7 pt-6 pb-20 max-w-[1400px]">
			{/* Title row */}
			<div className="flex items-end gap-3.5 mb-5 flex-wrap">
				<div className="min-w-0">
					<h1 className="text-[23px] font-black text-heading tracking-[-.02em] m-0">
						Reorder point suggestions
					</h1>
					<p className="text-[13px] text-muted-2 m-0 mt-1">
						Proposed reorder points and capacities, from a year of sales and
						your logged lost sales.
					</p>
				</div>
				<div className="flex-1" />

				{suggestions && (
					<button
						onClick={compute}
						disabled={busy}
						className="h-9 px-3.5 rounded border border-line-2 bg-surface text-body-3 font-bold text-[12.5px] cursor-pointer disabled:opacity-50 hover:border-brand-300 hover:text-brand-600 transition-all duration-200 ease-smooth flex items-center gap-1.5">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
							<path d="M21 12a9 9 0 1 1-3-6.7" />
							<path d="M21 3v6h-6" />
						</svg>
						Recompute
					</button>
				)}
				<button
					onClick={suggestions ? approveAll : compute}
					disabled={busy || (suggestions && counts.pending === 0)}
					className="h-9 px-[18px] rounded border border-brand bg-brand hover:bg-brand-600 text-white font-bold text-[13px] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-all duration-200 ease-smooth">
					{busy && (
						<span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
					)}
					{busy
						? 'Computing…'
						: suggestions
							? `Approve all${counts.pending ? ` (${counts.pending})` : ''}`
							: 'Compute suggestions'}
				</button>
			</div>

			{progress && (
				<div className="mb-4 max-w-[760px] bg-surface border border-line rounded px-[18px] py-3.5">
					<div className="flex justify-between items-center gap-4 mb-2">
						<span className="text-[12.5px] text-body-3 flex items-center gap-2 min-w-0">
							<span className="relative flex w-2 h-2 flex-shrink-0">
								<span className="absolute inset-0 rounded-full bg-brand animate-halo" />
								<span className="relative w-2 h-2 rounded-full bg-brand" />
							</span>
							<span className="truncate">
								Reading 365-day sales for each item. This keeps running if you
								go elsewhere.
							</span>
						</span>
						<span className="text-[12.5px] font-black text-body-3 num flex-shrink-0">
							{progress.done} / {progress.total}
						</span>
					</div>
					<div className="relative w-full h-[4px] bg-line-4 rounded-full overflow-hidden">
						<div
							className="h-full bg-brand rounded-full transition-[width] duration-300 ease-smooth"
							style={{ width: `${progressPct}%` }}
						/>
					</div>
				</div>
			)}

			{error && (
				<div className="px-4 py-3 mb-4 rounded border bg-danger-bg border-danger-border text-danger text-[13px] max-w-[760px]">
					{error}
				</div>
			)}

			{/* Review progress — only once there is a list to get through. */}
			{suggestions && suggestions.length > 0 && (
				<div className="flex items-center gap-4 mb-4 px-[18px] py-3 bg-surface border border-line rounded max-w-[760px]">
					<div className="flex-1 min-w-0">
						<div className="flex items-center justify-between mb-1.5 text-[12px]">
							<span className="font-black text-body-2">Review progress</span>
							<span className="num text-muted">
								{reviewed} of {reviewTotal}
							</span>
						</div>
						<div className="w-full h-[6px] bg-line-4 rounded-full overflow-hidden flex">
							<div
								className="h-full bg-ok transition-[width] duration-300 ease-smooth"
								style={{
									width: `${reviewTotal ? (counts.approved / reviewTotal) * 100 : 0}%`,
								}}
							/>
							<div
								className="h-full bg-danger/70 transition-[width] duration-300 ease-smooth"
								style={{
									width: `${reviewTotal ? (counts.rejected / reviewTotal) * 100 : 0}%`,
								}}
							/>
						</div>
					</div>
					<div className="flex items-center gap-3.5 flex-shrink-0 text-[12px] font-bold">
						<span className="flex items-center gap-1.5 text-ok">
							<span className="w-2 h-2 rounded-full bg-ok" />
							<span className="num">{counts.approved}</span> approved
						</span>
						<span className="flex items-center gap-1.5 text-muted">
							<span className="w-2 h-2 rounded-full bg-muted-4" />
							<span className="num">{counts.pending}</span> pending
						</span>
						{counts.rejected > 0 && (
							<span className="flex items-center gap-1.5 text-danger">
								<span className="w-2 h-2 rounded-full bg-danger/70" />
								<span className="num">{counts.rejected}</span> rejected
							</span>
						)}
					</div>
				</div>
			)}

			{/* Table */}
			<div className="bg-surface border border-line rounded overflow-hidden">
				<div
					className="grid px-5 py-3 bg-surface-2 border-b border-line text-[10.5px] font-black text-muted tracking-[.06em]"
					style={{ gridTemplateColumns: COLS }}>
					<div>ITEM</div>
					<div>REORDER POINT</div>
					<div>MAX CAPACITY</div>
					<div className="text-right">DECISION</div>
				</div>

				{suggestions === null ? (
					<div className="px-5 py-16 text-center">
						<div className="w-14 h-14 rounded bg-brand-50 border border-brand-100 mx-auto mb-3.5 flex items-center justify-center">
							<svg className="text-brand" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
								<path d="M4 6h11" />
								<circle cx="18" cy="6" r="2" />
								<path d="M4 12h5" />
								<circle cx="12" cy="12" r="2" />
								<path d="M4 18h11" />
								<circle cx="18" cy="18" r="2" />
							</svg>
						</div>
						<div className="text-[14.5px] font-black text-heading mb-1">
							Nothing computed yet
						</div>
						<p className="text-[13px] text-muted-2 m-0 max-w-[520px] mx-auto leading-relaxed">
							Suggestions are worked out from each item’s trailing 365-day sales
							and the lost sales you have logged. That is one report call per
							item, so it runs only when you ask.
						</p>
						<button
							onClick={compute}
							disabled={busy}
							className="mt-4 h-9 px-4 rounded border border-brand bg-brand hover:bg-brand-600 text-white font-bold text-[13px] cursor-pointer disabled:opacity-40">
							Compute suggestions
						</button>
					</div>
				) : visible.length === 0 ? (
					<div className="px-5 py-16 text-center">
						<div
							className={`w-14 h-14 rounded mx-auto mb-3.5 flex items-center justify-center border ${
								busy
									? 'bg-brand-50 border-brand-100'
									: 'bg-ok-bg border-ok-border'
							}`}>
							{busy ? (
								<span className="w-5 h-5 border-2 border-brand-200 border-t-brand rounded-full animate-spin" />
							) : (
								<svg className="text-ok" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
									<path d="M20 6L9 17l-5-5" />
								</svg>
							)}
						</div>
						<div className="text-[14.5px] font-black text-heading mb-1">
							{busy
								? 'Working…'
								: suggestions.length === 0
									? 'No changes worth making'
									: 'All suggestions reviewed'}
						</div>
						<p className="text-[13px] text-muted-2 m-0 max-w-[520px] mx-auto leading-relaxed">
							{busy
								? 'No suggestions yet. Rows appear here as they are found.'
								: suggestions.length === 0
									? `Checked ${scanned} item${scanned === 1 ? '' : 's'}; every reorder point and max capacity is already close enough to demand.`
									: `${counts.approved} approved${counts.rejected > 0 ? `, ${counts.rejected} rejected` : ''}.`}
						</p>
					</div>
				) : (
					<div className="stagger">
						{visible.map((s, i) => (
							<div
								key={s.item_id}
								className="group grid px-5 py-[15px] border-b border-line-4 items-center bg-surface hover:bg-brand-50/50 transition-colors duration-150"
								style={{ gridTemplateColumns: COLS, '--i': Math.min(i, 20) }}>
								<div className="pr-4 min-w-0">
									<div className="font-black text-[14px] text-heading truncate">
										{s.item_name}
									</div>
									<div className="flex items-center gap-2 mt-1 min-w-0">
										<ConfidenceBar level={s.confidence} />
										<span
											className="text-[11.5px] text-muted-2 truncate"
											title={s.reason}>
											{subLineFor(s)}
										</span>
									</div>
								</div>

								<Pair prev={s.current_rop} next={s.proposed_rop} />
								<Pair prev={s.current_max} next={s.proposed_max} />

								<div className="flex items-center justify-end gap-2">
									<button
										onClick={() => decide(s, 'approved')}
										title="Approve"
										aria-label={`Approve ${s.item_name}`}
										className="w-[34px] h-[34px] rounded border border-ok-border bg-ok-bg flex items-center justify-center cursor-pointer text-ok hover:bg-ok hover:text-white hover:border-ok transition-all duration-150 ease-smooth">
										<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8">
											<path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
										</svg>
									</button>
									<button
										onClick={() => decide(s, 'rejected')}
										title="Reject"
										aria-label={`Reject ${s.item_name}`}
										className="w-[34px] h-[34px] rounded border border-line-2 bg-surface flex items-center justify-center cursor-pointer text-muted hover:bg-danger hover:text-white hover:border-danger transition-all duration-150 ease-smooth">
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
											<path d="M6 6l12 12M18 6L6 18" />
										</svg>
									</button>
								</div>
							</div>
						))}
					</div>
				)}
			</div>

			{/* The decisions are not yet written anywhere, and saying so is the
			    difference between a review screen and a misleading one. */}
			{suggestions && suggestions.length > 0 && (
				<div className="mt-4 flex items-start gap-3 px-4 py-3.5 rounded border border-warn-border bg-warn-bg text-warn-2 max-w-[760px]">
					<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="flex-shrink-0 mt-px">
						<circle cx="12" cy="12" r="9" />
						<path d="M12 8v5M12 16h.01" />
					</svg>
					<div className="text-[12.5px] leading-relaxed">
						<span className="font-black">Approving does not update Zoho yet.</span>{' '}
						The figures are real, but write-back is not built — decisions are
						kept only until you leave this page. Confidence reads low on every
						row because there is no daily stock history to correct demand for
						the days an item was unavailable.
					</div>
				</div>
			)}

			{toasts.length > 0 && (
				<div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2.5 items-end pointer-events-none max-h-[calc(100vh-100px)] overflow-y-auto">
					{toasts.map((t) => (
						<div key={t.tid} className="pointer-events-auto">
							<UndoToast
								label={t.label}
								duration={UNDO_WINDOW}
								onUndo={() => undo(t)}
								onExpire={() => dismiss(t.tid)}
							/>
						</div>
					))}
				</div>
			)}
		</div>
	);
}


/**
 * current → proposed. The new value is emphasised in blue when it moves and
 * left grey when it does not, so an unchanged value reads as "nothing to do".
 * The delta is green going up, red going down.
 */
function Pair({ prev, next }) {
	// A suppressed proposal (materiality) comes back null — treat it as unchanged.
	const to = next == null ? prev : next;
	const same = to === prev;
	const up = to > prev;

	return (
		<div className="flex items-center gap-2.5 pr-4 min-w-0">
			<span className="num text-[14px] text-muted-2 tabular-nums">{prev}</span>
			<svg
				width="16"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2.2"
				className={`flex-shrink-0 transition-colors ${same ? 'text-line-2' : 'text-brand-300'}`}>
				<path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
			{/* The proposed figure is the row's answer, so it is set as a chip —
			    a value you can act on rather than another number in a line. */}
			<span
				className={`num inline-flex items-center px-2 py-[3px] rounded text-[15px] font-black ${
					same
						? 'text-muted-2'
						: 'bg-brand-50 border border-brand-100 text-brand-700'
				}`}>
				{to}
			</span>
			{!same && (
				<span
					className={`num text-[11px] font-black px-1.5 py-px rounded ${
						up ? 'text-ok bg-ok-bg' : 'text-danger bg-danger-bg'
					}`}>
					{up ? `+${to - prev}` : `−${prev - to}`}
				</span>
			)}
		</div>
	);
}
