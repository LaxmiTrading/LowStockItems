import { useState, useCallback, useMemo } from 'react';
import {
	METHODS,
	DEFAULT_DAMPING_EXPONENT,
	DEFAULT_COVER_DAYS,
	SALES_WINDOW_DAYS,
	deriveRow,
	allocate,
	emitStockoutSignals,
} from '../../lib/allocation';
import { recordStockoutSignals } from '../../lib/stockoutSignals';
import { calculateBundleQuantities, simpleQuantityFor } from '../ZohoAPI';
import { getSales, peekSales, missingFor } from '../../lib/salesCache';
import Toggle from './Toggle';
import ModeSelect from './ModeSelect';
import Field from '../Field';

// Re-exported so existing imports keep working.
export { Field };

// Method 2 keeps its 180-day window; methods 3–6 use 365. Method 1 needs none.
const WINDOW_FOR = {
	[METHODS.SIMPLE]: null,
	[METHODS.BUNDLE_VELOCITY]: 180,
	[METHODS.BUNDLE_DAMPED]: SALES_WINDOW_DAYS,
	[METHODS.COVER_DAYS]: SALES_WINDOW_DAYS,
	[METHODS.COVER_BUNDLE]: SALES_WINDOW_DAYS,
	[METHODS.SIMPLE_BALANCE]: null,
};

const METHOD_LIST = [
	{
		id: METHODS.SIMPLE,
		n: 1,
		name: 'Simple',
		desc: 'Quantity = maximum capacity − available stock',
		existing: true,
		needs: [],
	},
	{
		id: METHODS.BUNDLE_VELOCITY,
		n: 2,
		name: 'Bundle',
		desc: 'Fixed total, distributed by sales velocity',
		existing: true,
		needs: ['B'],
	},
	{
		id: METHODS.BUNDLE_DAMPED,
		n: 3,
		name: 'Bundle — damped size-curve',
		desc: 'Share of a fixed total by soldᵉ, so slow sizes keep a share',
		existing: false,
		needs: ['B', 'e'],
	},
	{
		id: METHODS.COVER_DAYS,
		n: 4,
		name: 'Cover-duration',
		desc: 'Cover D days of demand for every item. No fixed total',
		existing: false,
		needs: ['D'],
	},
	{
		id: METHODS.COVER_BUNDLE,
		n: 5,
		name: 'Cover-duration fitted to bundle',
		desc: 'The cover-duration shape, scaled to hit a fixed total exactly',
		existing: false,
		needs: ['B', 'D'],
	},
	{
		id: METHODS.SIMPLE_BALANCE,
		n: 6,
		name: 'Simple + equal balance',
		desc: 'Starts at Simple, then closes the gap to the bundle total equally',
		existing: false,
		needs: ['B'],
	},
];

const specFor = (id) => METHOD_LIST.find((m) => m.id === id);

const nf = (v) => (v == null ? '—' : Number(v).toLocaleString('en-IN'));

export default function MethodPicker({ lines, onApply }) {
	// Nothing is persisted — the picker opens fresh with no method preselected.
	const [method, setMethod] = useState(null);
	// Comparing runs several methods over the same items and the same inputs, so
	// the only thing differing between the columns is the method itself.
	const [compare, setCompare] = useState(false);
	const [compareIds, setCompareIds] = useState([]);

	const [bundleTotal, setBundleTotal] = useState('');
	const [exponent, setExponent] = useState(String(DEFAULT_DAMPING_EXPONENT));
	const [coverDays, setCoverDays] = useState(String(DEFAULT_COVER_DAYS));
	const [overrideMax, setOverrideMax] = useState(false);

	const [preview, setPreview] = useState(null);
	const [busy, setBusy] = useState(false);
	const [progress, setProgress] = useState(null);
	const [error, setError] = useState(null);

	const allocatable = useMemo(
		() => lines.filter((l) => !l.isFreeText && l.item_id),
		[lines],
	);
	// Counted directly, not as a remainder — the table's trailing blank row is
	// neither allocatable nor free text.
	const freeTextCount = useMemo(
		() => lines.filter((l) => l.isFreeText).length,
		[lines],
	);

	const selectedIds = useMemo(
		() => (compare ? compareIds : method ? [method] : []),
		[compare, compareIds, method],
	);
	const specs = useMemo(
		() => selectedIds.map(specFor).filter(Boolean),
		[selectedIds],
	);

	// The knobs on show are the union of what the chosen methods ask for, and
	// they are shared: comparing is only meaningful at the same bundle total.
	const needs = useMemo(() => {
		const set = new Set();
		for (const s of specs) for (const n of s.needs) set.add(n);
		return set;
	}, [specs]);

	const invalidate = useCallback(() => {
		setPreview(null);
		setError(null);
	}, []);

	const choose = (id) => {
		setMethod(id);
		invalidate();
	};

	const toggleCompared = (id) => {
		setCompareIds((prev) =>
			prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
		);
		invalidate();
	};

	const toggleCompare = () => {
		if (compare) {
			// Leaving compare keeps the first ticked method, so the page does not
			// silently lose the selection.
			setMethod((m) => compareIds[0] ?? m);
			setCompare(false);
		} else {
			setCompareIds(method ? [method] : []);
			setCompare(true);
		}
		invalidate();
	};

	const minMethods = compare ? 2 : 1;
	const isValid = (() => {
		if (selectedIds.length < minMethods) return false;
		if (needs.has('B') && !(Number(bundleTotal) > 0)) return false;
		if (needs.has('D') && !(Number(coverDays) > 0)) return false;
		if (needs.has('e')) {
			const e = Number(exponent);
			if (!(e >= 0 && e <= 1)) return false;
		}
		return true;
	})();

	// One method's quantities for the current items, in the order of
	// `allocatable`. Methods 1 and 2 run through the very code the create call
	// uses; the rest go through the allocation library.
	const quantitiesFor = useCallback(
		async (id, soldFor) => {
			if (id === METHODS.SIMPLE) {
				// Method 1 — MUST PRESERVE. Same helper the create call uses.
				return { qty: allocatable.map((l) => simpleQuantityFor(l) ?? 0) };
			}

			if (id === METHODS.BUNDLE_VELOCITY) {
				// Method 2 — MUST PRESERVE. The real function, fed from the cache so
				// the preview costs no extra API calls.
				const qtyMap = await calculateBundleQuantities(
					allocatable,
					Number(bundleTotal),
					{
						getSales: async (itemId) => peekSales(itemId, 180) ?? 0,
						interDelay: 0,
					},
				);

				if (qtyMap) {
					return { qty: allocatable.map((l) => qtyMap[l.item_id] ?? 0) };
				}

				// MUST PRESERVE: with no candidates the existing code path falls
				// through to Simple, so the preview has to do the same.
				return {
					qty: allocatable.map((l) => simpleQuantityFor(l) ?? 0),
					notice:
						'No item qualified for bundle allocation — every item is at or over max capacity, or has none set. Falling back to Simple, exactly as the existing behaviour does. Method 3 or 6 will spread across the group instead.',
				};
			}

			const rows = allocatable.map((l) =>
				deriveRow(l, soldFor(l, id), overrideMax),
			);
			return {
				qty: allocate(rows, {
					method: id,
					bundleTotal: Number(bundleTotal),
					exponent: Number(exponent),
					coverDays: Number(coverDays),
				}),
			};
		},
		[allocatable, bundleTotal, exponent, coverDays, overrideMax],
	);

	const runPreview = async () => {
		if (!isValid || allocatable.length === 0) return;
		setBusy(true);
		setError(null);
		setPreview(null);

		try {
			// Every distinct window the chosen methods need, fetched once between
			// them — comparing methods 2 and 4 reads 180 and 365 days, not one of
			// them twice.
			const windows = [
				...new Set(selectedIds.map((id) => WINDOW_FOR[id]).filter(Boolean)),
			].sort((a, b) => a - b);

			if (windows.length > 0) {
				const plan = windows.map((win) => ({
					win,
					missing: missingFor(
						allocatable.map((l) => l.item_id),
						win,
					),
				}));
				const total = plan.reduce((s, p) => s + p.missing.length, 0);
				const reused = allocatable.length * windows.length - total;

				let done = 0;
				setProgress({ done, total, reused });

				for (const { win, missing } of plan) {
					for (const itemId of missing) {
						await getSales(itemId, win);
						done += 1;
						setProgress({ done, total, reused });
						// Same pacing the rest of the app uses against the proxy.
						if (done < total) await new Promise((r) => setTimeout(r, 150));
					}
				}

				setProgress(null);
			}

			const soldFor = (l, id) => {
				const win = WINDOW_FOR[id];
				return win ? (peekSales(l.item_id, win) ?? 0) : 0;
			};

			const methods = [];
			for (const id of selectedIds) {
				const spec = specFor(id);
				const { qty, notice } = await quantitiesFor(id, soldFor);
				methods.push({
					id,
					n: spec.n,
					name: spec.name,
					window: WINDOW_FOR[id],
					qty,
					notice: notice || null,
					total: qty.reduce((s, q) => s + q, 0),
				});
			}

			const rows = allocatable.map((l, i) => ({
				key: l.key,
				index: i,
				name: l.name,
				onHand: Number(l.available_stock ?? l.stock_on_hand ?? 0) || 0,
				max: Number(l.cf_maximum_capacity) || 0,
				sold: Object.fromEntries(
					windows.map((w) => [w, peekSales(l.item_id, w) ?? 0]),
				),
			}));

			setPreview({ rows, windows, methods });

			// §A.5: evaluating a selection is the moment the stockout-group
			// condition can be observed — it depends on the whole group's stock
			// levels right now, which Zoho does not retain. Recorded on every
			// method, deduplicated per item per day by the endpoint, and
			// deliberately not awaited: this is a side effect of previewing and
			// must never delay or break it.
			const signalRows = allocatable.map((l) => deriveRow(l, 0, false));
			recordStockoutSignals(emitStockoutSignals(signalRows));
		} catch (e) {
			setError(e.message || 'Preview failed.');
		} finally {
			setBusy(false);
			setProgress(null);
		}
	};

	const apply = (entry) => {
		if (!preview || !entry) return;
		const map = {};
		for (const r of preview.rows) map[r.key] = entry.qty[r.index] ?? 0;
		onApply(map);
	};

	const supportsOverride = specs.some(
		(s) => s.id !== METHODS.SIMPLE && s.id !== METHODS.BUNDLE_VELOCITY,
	);

	// ITEM · ON HAND · MAX · one SOLD per window · one quantity per method.
	const gridCols = preview
		? `2fr 0.8fr 0.8fr ${preview.windows
				.map(() => '0.9fr')
				.join(' ')} ${preview.methods.map(() => '1fr').join(' ')}`
		: '';

	return (
		<>
			<Field label="Quantity mode" align="start">
				<div className="flex items-center justify-between gap-3 mb-2">
					<span className="text-[11.5px] text-muted">
						{compare
							? 'Pick two or more to run side by side.'
							: 'One method fills the quantity column.'}
					</span>
					<label className="flex items-center gap-2 cursor-pointer flex-shrink-0">
						<Toggle on={compare} onChange={toggleCompare} />
						<span className="text-[12px] font-semibold text-body-3">
							Compare methods
						</span>
					</label>
				</div>

				{/* The same dropdown either way — it just ticks rather than picks
				    when comparing, so the control does not move or change shape
				    underneath you when the toggle is flipped. */}
				{compare ? (
					<ModeSelect
						multiple
						options={METHOD_LIST}
						values={compareIds}
						onChange={toggleCompared}
						placeholder="Select methods to compare"
					/>
				) : (
					<ModeSelect
						options={METHOD_LIST}
						value={method}
						onChange={choose}
						placeholder="Select a quantity mode"
					/>
				)}

				{/* A method's own inputs live right under the selection, so the knobs
				    are next to the choice that introduced them. */}
				{specs.length > 0 && (
					<div className="mt-3 flex flex-col gap-3">
						{needs.has('B') && (
							<Knob
								label={
									<>
										Total bundle quantity <span className="text-danger">*</span>
									</>
								}
								hint="Distributed across the items on this page."
								value={bundleTotal}
								onChange={(v) => {
									setBundleTotal(v);
									invalidate();
								}}
								min="1"
								placeholder="e.g. 500"
							/>
						)}

						{needs.has('D') && (
							<Knob
								label={
									<>
										Target cover (days) <span className="text-danger">*</span>
									</>
								}
								hint="Days of demand each item should hold, from its trailing 365-day sales."
								value={coverDays}
								onChange={(v) => {
									setCoverDays(v);
									invalidate();
								}}
								min="1"
							/>
						)}

						{needs.has('e') && (
							<Knob
								label="Damping exponent e"
								hint="1 = raw sales share · 0 = equal split · 0.5 = compressed."
								value={exponent}
								onChange={(v) => {
									setExponent(v);
									invalidate();
								}}
								min="0"
								max="1"
								step="0.05"
							/>
						)}

						{supportsOverride && (
							<div>
								<div className="flex items-center gap-2.5">
									<Toggle
										on={overrideMax}
										onChange={() => {
											setOverrideMax((v) => !v);
											invalidate();
										}}
									/>
									<span className="text-[12.5px] font-semibold text-body">
										Allow ordering past max capacity
									</span>
								</div>
								<div className="text-[11px] text-muted mt-1">
									Lifts the headroom clamp for this PO only. Methods 1 and 2 are
									unaffected.
								</div>
							</div>
						)}
					</div>
				)}

				<p className="text-[11px] text-muted mt-2.5">
					Shares are computed across the {allocatable.length} item
					{allocatable.length !== 1 ? 's' : ''} on this page — that selection is
					the group.
					{freeTextCount > 0 && (
						<>
							{' '}
							{freeTextCount} free-text line
							{freeTextCount !== 1 ? 's are' : ' is'} excluded.
						</>
					)}
				</p>
			</Field>

			{/* Preview — a full-width band, so the result table gets the whole page
			    rather than the narrow control column. */}
			<div className="-mx-4 sm:-mx-8 mt-1 px-4 sm:px-8 py-[18px] border-y border-line bg-sidebar">
				<div className="flex items-start justify-between gap-4 flex-wrap">
					<div className="min-w-0">
						<div className="text-[13.5px] font-black text-heading">
							{compare ? 'Method comparison' : 'Quantity preview'}
						</div>
						<div className="text-[11.5px] text-muted mt-0.5">
							{selectedIds.length === 0
								? compare
									? 'Tick the methods you want to compare.'
									: 'Pick a quantity mode above to work out order quantities.'
								: selectedIds.length < minMethods
									? 'Tick at least one more method to compare.'
									: !isValid
										? 'Fill in the inputs above, then preview.'
										: compare
											? 'Read-only — apply whichever column you prefer.'
											: 'Read-only — nothing reaches the table until you apply it.'}
						</div>
					</div>

					<div className="flex items-center gap-2.5 flex-wrap flex-shrink-0">
						<button
							onClick={runPreview}
							disabled={!isValid || busy || allocatable.length === 0}
							className="h-10 sm:h-[38px] flex-1 sm:flex-none px-4 rounded border border-line-2 bg-surface text-body-2 font-bold text-[13px] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:border-brand-300 hover:text-brand-600 flex items-center justify-center gap-2 transition-all duration-200 ease-smooth">
							{busy && (
								<span className="w-3.5 h-3.5 border-2 border-muted-4 border-t-body-3 rounded-full animate-spin" />
							)}
							{busy
								? 'Computing…'
								: compare
									? 'Compare quantities'
									: 'Preview quantities'}
						</button>

						{preview && !compare && (
							<button
								onClick={() => apply(preview.methods[0])}
								className="h-10 sm:h-[38px] flex-1 sm:flex-none px-4 rounded border border-brand bg-brand hover:bg-brand-600 text-white font-bold text-[13px] cursor-pointer transition-all duration-200 ease-smooth animate-pop-in">
								Use these quantities
							</button>
						)}
					</div>
				</div>

				{progress && (
					<div className="text-[11px] text-muted mt-2 num">
						{progress.total > 0
							? `Fetching sales… ${progress.done} / ${progress.total}`
							: 'Using cached sales'}
						{progress.reused > 0 ? ` · ${progress.reused} reused` : ''}
					</div>
				)}
				{error && (
					<div className="text-[12px] text-danger bg-danger-bg border border-danger-border rounded px-3 py-2 mt-2.5">
						{error}
					</div>
				)}
				{preview?.methods
					.filter((m) => m.notice)
					.map((m) => (
						<div
							key={m.id}
							className="text-[12px] text-warn-2 bg-warn-bg border border-warn-border rounded px-3 py-2 mt-2.5">
							<span className="font-bold">
								{m.n}. {m.name}:
							</span>{' '}
							{m.notice}
						</div>
					))}

				{preview && (
					<div className="mt-3 border border-line rounded overflow-hidden bg-surface animate-fade-up">
						<div className="flex items-center justify-between px-3.5 py-2 bg-surface-2 border-b border-line">
							<span className="text-[11.5px] text-muted">
								Read-only — nothing is saved until you create the PO.
							</span>
							{!compare && (
								<span className="num text-[12.5px] font-bold text-body">
									Total: {nf(preview.methods[0].total)}
								</span>
							)}
						</div>

						<div className="max-h-[320px] overflow-auto [&>*]:min-w-[560px]">
							<div
								style={{ gridTemplateColumns: gridCols }}
								className="grid bg-surface-2 border-b border-line text-[10px] font-black text-muted tracking-[.06em] sticky top-0 z-10">
								<div className="px-3 py-1.5">ITEM</div>
								<div className="px-3 py-1.5 text-right">ON HAND</div>
								<div className="px-3 py-1.5 text-right">MAX</div>
								{preview.windows.map((w) => (
									<div key={w} className="px-3 py-1.5 text-right">
										SOLD {w}D
									</div>
								))}
								{preview.methods.map((m) => (
									<div
										key={m.id}
										className="px-3 py-1.5 text-right text-body-3 truncate"
										title={m.name}>
										{compare ? `${m.n}. ${m.name}` : 'ORDER QTY'}
									</div>
								))}
							</div>

							{preview.rows.map((r) => (
								<div
									key={r.key}
									style={{ gridTemplateColumns: gridCols }}
									className="grid border-b border-line-4 text-[12.5px] text-body-3 hover:bg-brand-50/50 transition-colors duration-150">
									<div className="px-3 py-1.5 truncate">{r.name}</div>
									<div className="num px-3 py-1.5 text-right">{nf(r.onHand)}</div>
									<div className="num px-3 py-1.5 text-right">{nf(r.max)}</div>
									{preview.windows.map((w) => (
										<div key={w} className="num px-3 py-1.5 text-right">
											{nf(r.sold[w])}
										</div>
									))}
									{preview.methods.map((m) => {
										const q = m.qty[r.index] ?? 0;
										return (
											<div
												key={m.id}
												className={`num px-3 py-1.5 text-right font-bold ${
													q === 0 ? 'text-muted-2' : 'text-body'
												}`}>
												{nf(q)}
											</div>
										);
									})}
								</div>
							))}

							{/* Totals, and — when comparing — the way to take a column. */}
							<div
								style={{ gridTemplateColumns: gridCols }}
								className="grid bg-surface-2 border-t border-line text-[11.5px] font-black text-heading sticky bottom-0">
								<div className="px-3 py-2">TOTAL</div>
								<div />
								<div />
								{preview.windows.map((w) => (
									<div key={w} />
								))}
								{preview.methods.map((m) => (
									<div key={m.id} className="px-3 py-2 text-right">
										<div className="num">{nf(m.total)}</div>
										{compare && (
											<button
												onClick={() => apply(m)}
												className="mt-1 h-[26px] px-2.5 rounded border border-brand bg-brand hover:bg-brand-600 text-white font-bold text-[11px] cursor-pointer">
												Use
											</button>
										)}
									</div>
								))}
							</div>
						</div>

						<div className="px-3.5 py-2 text-[11px] text-muted-2">
							Lines showing 0 stay visible so you can see why, but are dropped
							from the PO.
						</div>
					</div>
				)}
			</div>
		</>
	);
}

function Knob({ label, hint, value, onChange, ...rest }) {
	return (
		<label className="block">
			<span className="block text-[12.5px] font-semibold text-body mb-1">
				{label}
			</span>
			<input
				type="number"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				className="num w-full h-[38px] border border-line-2 rounded px-3 text-[13.5px] font-bold outline-none bg-surface transition-colors hover:border-muted-4 focus:border-muted-3"
				{...rest}
			/>
			{hint && <span className="block text-[11px] text-muted mt-1">{hint}</span>}
		</label>
	);
}
