import './ItemRow.css';
import Checkbox from './Checkbox';
import { simpleQuantityFor } from './ZohoAPI';
import { useIsDesktop, useIsWide } from '../lib/useMediaQuery';

// Shared so the header and the rows can never drift apart. Desktop only — the
// card layout below lg has no columns to line up with.
export const LOW_TABLE_COLS = '38px 2.4fr 1fr 1fr 1.4fr 1.2fr 1.3fr 0.9fr 1.1fr';

const money = (v) =>
	'₹' +
	Number(v || 0).toLocaleString('en-IN', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});

const dec2 = (v) => (v == null || v === '' ? '—' : Number(v).toFixed(2));

const zohoItemUrl = (id) => `https://books.zoho.com/app#/items/${id}`;

/**
 * How much of an item is left, drawn rather than spelled out.
 *
 * The stock columns already carry the figures; what they cannot show is the
 * *relationship* between them — that 12 units against a reorder point of 40 is
 * a different kind of problem from 38 against 40. The bar fills to stock as a
 * fraction of maximum capacity and carries a notch at the reorder point, so
 * how far under the line an item has fallen is legible without arithmetic.
 *
 * Falls back to twice the reorder level when no capacity is set, which is the
 * same assumption the ordering side already makes about a sensible full shelf.
 */
function StockGauge({ stock, reorder, max, tone, className = '' }) {
	const ceiling =
		Number(max) > 0
			? Number(max)
			: Number(reorder) > 0
				? Number(reorder) * 2
				: Math.max(Number(stock), 1);

	if (!(ceiling > 0)) return null;

	const pct = Math.max(0, Math.min(100, (Math.max(0, stock) / ceiling) * 100));
	const markAt =
		Number(reorder) > 0
			? Math.max(0, Math.min(100, (Number(reorder) / ceiling) * 100))
			: null;

	const FILL = {
		'text-danger': 'bg-danger',
		'text-warn': 'bg-warn',
		'text-ok': 'bg-ok',
	};

	return (
		<div
			className={`relative h-[5px] w-full rounded-full bg-line-4 overflow-hidden ${className}`}
			title={
				markAt != null
					? `${dec2(stock)} on hand · reorder at ${dec2(reorder)} · capacity ${dec2(ceiling)}`
					: `${dec2(stock)} on hand · capacity ${dec2(ceiling)}`
			}>
			<div
				className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-smooth ${
					FILL[tone] || 'bg-brand'
				}`}
				style={{ width: `${pct}%` }}
			/>
			{/* The reorder point, as a notch cut through the track. */}
			{markAt != null && markAt < 100 && (
				<span
					className="absolute top-0 bottom-0 w-[2px] bg-heading/35"
					style={{ left: `calc(${markAt}% - 1px)` }}
				/>
			)}
		</div>
	);
}

/** A label above its figure, for the card's detail grid. */
const Detail = ({ label, children, className = '' }) => (
	<div className={`min-w-0 ${className}`}>
		<div className="text-[10.5px] font-bold text-muted tracking-[.04em] uppercase">
			{label}
		</div>
		<div className="num text-[13px] text-body truncate">{children}</div>
	</div>
);

export default function ItemRow({ item, selected, toggleSelect, style }) {
	const isDesktop = useIsDesktop();
	const isWide = useIsWide();

	const stock = Number(item.stock_on_hand);
	const reorder = item.reorder_level;
	const simpleQty = simpleQuantityFor(item);

	// Design's stockColorFor: red at or below zero, amber at or below the
	// reorder point, green otherwise.
	const stockColor =
		stock <= 0
			? 'text-danger'
			: reorder != null && stock <= Number(reorder)
				? 'text-warn'
				: 'text-ok';

	const openInZoho = () => window.open(zohoItemUrl(item.item_id), '_blank');

	/* ── Card, below lg ──────────────────────────────────────────────────────
	   Built like Zoho's item list: the name, then the few figures that
	   identify the row, then the quantity as the largest thing on the card
	   because it is the reason the row is here at all. The fold-open screen
	   has room for the fuller detail grid; the cover screen does not. */
	if (!isDesktop) {
		return (
			<div
				className={`flex items-start gap-3 px-4 py-3.5 border-b border-line-4 ${
					selected ? 'bg-row-selected' : 'bg-surface'
				}`}
				style={style}>
				{/* 44px of tappable area around an 18px box. */}
				<button
					onClick={() => toggleSelect?.(item.item_id)}
					aria-label={`Select ${item.name}`}
					className="flex items-center justify-center w-11 h-11 -m-2.5 flex-shrink-0 bg-transparent border-none cursor-pointer">
					<Checkbox checked={selected} onChange={() => toggleSelect?.(item.item_id)} />
				</button>

				<div className="min-w-0 flex-1">
					<div
						onClick={openInZoho}
						className="text-link font-bold text-[14.5px] leading-snug break-words cursor-pointer">
						{item.name}
					</div>

					<div className="num text-[12px] text-muted-2 mt-0.5">
						SKU: {item.sku || '—'}
					</div>

					<div
						className={`mt-2 grid gap-x-4 gap-y-2 ${isWide ? 'grid-cols-4' : 'grid-cols-2'}`}>
						<Detail label="Rate">{money(item.rate)}</Detail>
						<Detail label="Reorder">{dec2(reorder)}</Detail>
						{isWide && (
							<>
								<Detail label="Max capacity">
									{dec2(item.cf_maximum_capacity)}
								</Detail>
								<Detail label="Unit">{item.unit || 'box'}</Detail>
							</>
						)}
					</div>

					<StockGauge
						stock={stock}
						reorder={reorder}
						max={item.cf_maximum_capacity}
						tone={stockColor}
						className="mt-3"
					/>

					<div className="flex items-end justify-between gap-3 mt-2">
						<div className="min-w-0">
							<span className={`num text-[19px] font-black ${stockColor}`}>
								{dec2(item.stock_on_hand)}
							</span>
							<span className="text-[12.5px] text-muted ml-1">
								{item.unit || 'box'}
							</span>
						</div>

						{simpleQty != null && (
							<span className="flex items-center gap-1.5 flex-shrink-0">
								<span className="text-[10.5px] font-bold text-muted tracking-[.04em] uppercase">
									Simple qty
								</span>
								<span className="num inline-flex items-center justify-center min-w-[42px] px-2 py-[3px] rounded bg-brand-50 border border-brand-100 text-brand-700 font-black text-[13px]">
									{simpleQty}
								</span>
							</span>
						)}
					</div>
				</div>
			</div>
		);
	}

	/* ── Table row, lg and up ─────────────────────────────────────────────── */
	return (
		<div
			className={`item-row grid px-[18px] py-[13px] border-b border-line-4 text-[13.5px] items-center ${
				selected ? 'bg-row-selected' : 'bg-surface'
			}`}
			style={{ gridTemplateColumns: LOW_TABLE_COLS, ...style }}>
			<div>
				<Checkbox
					checked={selected}
					onChange={() => toggleSelect?.(item.item_id)}
					label={`Select ${item.name}`}
				/>
			</div>

			<div className="min-w-0">
				<span
					onClick={openInZoho}
					className="group inline-flex items-start gap-1.5 text-link font-bold cursor-pointer hover:text-link-hover break-words">
					<span className="group-hover:underline underline-offset-2">
						{item.name}
					</span>
					{/* Says where the click goes, without a permanent icon in every
					    row of the table. */}
					<svg
						width="12"
						height="12"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2.2"
						strokeLinecap="round"
						strokeLinejoin="round"
						className="row-reveal flex-shrink-0 mt-[3px]">
						<path d="M14 4h6v6" />
						<path d="M20 4l-9 9" />
						<path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
					</svg>
				</span>
			</div>

			<div className="num text-body-3 truncate">{item.sku || '—'}</div>

			<div className="num text-right pr-2.5 text-body">{money(item.rate)}</div>

			{/* Stock is the column the page exists for, so it gets the extra
			    dimension: the figure, then the same figure as a filled track. */}
			<div className="pr-2.5">
				<div className={`num text-right font-black text-[14px] ${stockColor}`}>
					{dec2(item.stock_on_hand)}
				</div>
				<StockGauge
					stock={stock}
					reorder={reorder}
					max={item.cf_maximum_capacity}
					tone={stockColor}
					className="mt-1.5"
				/>
			</div>

			<div className="num text-right pr-2.5 text-body-3">{dec2(reorder)}</div>

			<div className="num text-right pr-2.5 text-body-3">
				{dec2(item.cf_maximum_capacity)}
			</div>

			<div className="text-muted truncate">{item.unit || 'box'}</div>

			{/* What a Simple-mode PO would order for this item. Taken from the
			    same helper the PO itself uses, so the column can never disagree
			    with what actually gets raised. */}
			<div className="text-right pr-2.5">
				{simpleQty == null ? (
					<span className="num text-muted-2">—</span>
				) : (
					<span className="num inline-flex items-center justify-center min-w-[42px] px-2 py-[3px] rounded bg-brand-50 border border-brand-100 text-brand-700 font-black text-[13px]">
						{simpleQty}
					</span>
				)}
			</div>
		</div>
	);
}
