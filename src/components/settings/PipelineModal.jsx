import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { savePipeline } from '../../lib/poFollowups';
import { PALETTE, resolveTone, toneDot } from '../../lib/tones';

let keySeq = 0;
const newKey = () => `new-${++keySeq}`;

/** The live stages in order, shaped for editing — with exactly one default. */
function rowsFrom(workflow) {
	const live = (workflow?.statuses ?? [])
		.filter((s) => !s.archived)
		.sort((a, b) => a.sortOrder - b.sortOrder);

	let defaultTaken = false;
	const rows = live.map((s) => {
		const isDefault = Boolean(s.isInitial) && !defaultTaken;
		if (isDefault) defaultTaken = true;
		return {
			key: s.id,
			id: s.id,
			name: s.name,
			tone: resolveTone(s.tone).id,
			isDefault,
			outcome: isDefault ? null : (s.outcome ?? (s.isTerminal ? 'won' : null)),
		};
	});
	if (!defaultTaken && rows.length > 0) {
		rows[0] = { ...rows[0], isDefault: true, outcome: null };
	}
	return rows;
}

const icon = {
	up: <path d="M12 19V5M5 12l7-7 7 7" />,
	down: <path d="M12 5v14M19 12l-7 7-7-7" />,
	trophy: (
		<>
			<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
			<path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
			<path d="M4 22h16" />
			<path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
			<path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
			<path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
		</>
	),
	lost: (
		<>
			<circle cx="12" cy="12" r="10" />
			<path d="m15 9-6 6" />
			<path d="m9 9 6 6" />
		</>
	),
	trash: (
		<>
			<path d="M3 6h18" />
			<path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
			<path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
		</>
	),
	plus: <path d="M12 5v14M5 12h14" />,
	close: <path d="M6 6l12 12M18 6L6 18" />,
};

function Svg({ children, size = 16, width = 2 }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">
			{children}
		</svg>
	);
}

/**
 * Customize Pipeline: every stage in one list, edited freely and saved once.
 *
 * Nothing is written until Save Changes, so reordering, renaming and
 * rethinking the default can be tried and abandoned with Cancel.
 */
export default function PipelineModal({ workflow, onClose, onSaved }) {
	const [rows, setRows] = useState(() => rowsFrom(workflow));
	const [errors, setErrors] = useState({});
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState(null);
	const [paletteFor, setPaletteFor] = useState(null);
	const focusKey = useRef(null);
	const originalIds = useRef(rowsFrom(workflow).map((r) => r.id));

	useEffect(() => {
		const prev = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = prev;
		};
	}, []);

	useEffect(() => {
		const onKey = (e) => {
			if (e.key !== 'Escape') return;
			if (paletteFor) setPaletteFor(null);
			else if (!saving) onClose();
		};
		const onDown = (e) => {
			if (paletteFor && !e.target.closest('[data-palette]')) setPaletteFor(null);
		};
		document.addEventListener('keydown', onKey);
		document.addEventListener('mousedown', onDown);
		return () => {
			document.removeEventListener('keydown', onKey);
			document.removeEventListener('mousedown', onDown);
		};
	}, [onClose, saving, paletteFor]);

	// A stage added with an empty name is for typing into straight away.
	useEffect(() => {
		if (!focusKey.current) return;
		document.getElementById(`stage-${focusKey.current}`)?.focus();
		focusKey.current = null;
	}, [rows]);

	const clearError = (key) =>
		setErrors((current) => {
			if (!current[key]) return current;
			const next = { ...current };
			delete next[key];
			return next;
		});

	const update = (key, patch) => {
		setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
		clearError(key);
	};

	const move = (index, delta) =>
		setRows((rs) => {
			const target = index + delta;
			if (target < 0 || target >= rs.length) return rs;
			const next = [...rs];
			[next[index], next[target]] = [next[target], next[index]];
			return next;
		});

	// One default, like a radio. The default is where orders start, so it
	// cannot also be how a chase ended.
	const makeDefault = (key) =>
		setRows((rs) =>
			rs.map((r) => ({
				...r,
				isDefault: r.key === key,
				outcome: r.key === key ? null : r.outcome,
			})),
		);

	const toggleOutcome = (key, value) =>
		setRows((rs) =>
			rs.map((r) =>
				r.key === key ? { ...r, outcome: r.outcome === value ? null : value } : r,
			),
		);

	const remove = (key) => {
		setRows((rs) => {
			const next = rs.filter((r) => r.key !== key);
			if (next.length > 0 && !next.some((r) => r.isDefault)) {
				next[0] = { ...next[0], isDefault: true, outcome: null };
			}
			return next;
		});
		clearError(key);
	};

	const add = () => {
		const key = newKey();
		focusKey.current = key;
		setRows((rs) => [
			...rs,
			{
				key,
				id: null,
				name: '',
				tone: PALETTE[rs.length % PALETTE.length].id,
				isDefault: rs.length === 0,
				outcome: null,
			},
		]);
	};

	const validate = () => {
		const next = {};
		const seen = new Set();
		for (const r of rows) {
			const name = r.name.trim();
			if (!name) {
				next[r.key] = 'Give this stage a name.';
				continue;
			}
			const lower = name.toLowerCase();
			if (seen.has(lower)) next[r.key] = `"${name}" is already a stage.`;
			seen.add(lower);
		}
		setErrors(next);
		return Object.keys(next).length === 0;
	};

	const save = async () => {
		if (saving || !validate()) return;
		setSaving(true);
		setError(null);
		try {
			const result = await savePipeline(
				rows.map((r) => ({
					id: r.id,
					name: r.name.trim(),
					tone: r.tone,
					isDefault: r.isDefault,
					outcome: r.outcome,
				})),
			);
			onSaved(result);
		} catch (e) {
			setError(e.message || 'Could not save the pipeline.');
			setSaving(false);
		}
	};

	const removedCount = originalIds.current.filter(
		(id) => !rows.some((r) => r.id === id),
	).length;

	const iconButton = (active, activeClasses) =>
		`w-8 h-8 rounded flex items-center justify-center border cursor-pointer flex-shrink-0 transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
			active
				? activeClasses
				: 'bg-transparent border-transparent text-body-3 hover:bg-surface-2 hover:text-heading'
		}`;

	return createPortal(
		<div
			className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in"
			style={{ background: 'rgb(var(--c-overlay) / 0.42)' }}
			onClick={(e) => {
				if (e.target === e.currentTarget && !saving) onClose();
			}}>
			<div
				role="dialog"
				aria-modal="true"
				aria-label="Customize pipeline"
				className="animate-pop-in w-[540px] max-w-full max-h-[92vh] flex flex-col bg-surface rounded-lg shadow-float overflow-hidden">
				<div className="flex items-center justify-between gap-3 px-6 pt-5 pb-4 flex-shrink-0">
					<h2 className="text-[18px] font-black text-heading m-0">Customize Pipeline</h2>
					<button
						onClick={onClose}
						disabled={saving}
						aria-label="Close"
						className="w-8 h-8 rounded flex items-center justify-center bg-transparent border-none cursor-pointer text-muted hover:text-heading hover:bg-surface-2 disabled:opacity-50">
						<Svg size={16}>{icon.close}</Svg>
					</button>
				</div>

				<div className="flex-1 min-h-0 overflow-y-auto px-6 pb-2">
					<ol className="list-none m-0 p-0 flex flex-col gap-2.5">
						{rows.map((r, index) => (
							<li key={r.key} className="border border-line rounded-lg px-2.5 py-2">
								<div className="flex items-center gap-2">
									<div className="flex flex-col flex-shrink-0">
										<button
											type="button"
											onClick={() => move(index, -1)}
											disabled={index === 0}
											aria-label={`Move ${r.name || 'this stage'} up`}
											className="w-6 h-[18px] flex items-center justify-center bg-transparent border-none cursor-pointer text-body-3 hover:text-heading disabled:text-muted-4 disabled:cursor-default">
											<Svg size={15}>{icon.up}</Svg>
										</button>
										<button
											type="button"
											onClick={() => move(index, 1)}
											disabled={index === rows.length - 1}
											aria-label={`Move ${r.name || 'this stage'} down`}
											className="w-6 h-[18px] flex items-center justify-center bg-transparent border-none cursor-pointer text-body-3 hover:text-heading disabled:text-muted-4 disabled:cursor-default">
											<Svg size={15}>{icon.down}</Svg>
										</button>
									</div>

									<div className="relative flex-shrink-0" data-palette>
										<button
											type="button"
											onClick={() => setPaletteFor((k) => (k === r.key ? null : r.key))}
											aria-label={`Colour of ${r.name || 'this stage'}`}
											className="w-7 h-7 rounded-full flex items-center justify-center bg-transparent border-none cursor-pointer hover:bg-surface-2">
											<span className={`w-[18px] h-[18px] rounded-full ${toneDot(r.tone)}`} />
										</button>
										{paletteFor === r.key && (
											<div className="absolute top-8 left-0 z-20 p-2 grid grid-cols-6 gap-1 bg-surface border border-line-2 rounded shadow-pop animate-slide-down">
												{PALETTE.map((p) => (
													<button
														key={p.id}
														type="button"
														title={p.label}
														aria-label={p.label}
														onClick={() => {
															update(r.key, { tone: p.id });
															setPaletteFor(null);
														}}
														className={`w-7 h-7 rounded-full flex items-center justify-center bg-transparent cursor-pointer border-2 ${
															r.tone === p.id ? 'border-heading' : 'border-transparent hover:border-line-2'
														}`}>
														<span className={`w-[18px] h-[18px] rounded-full ${p.dot}`} />
													</button>
												))}
											</div>
										)}
									</div>

									<input
										id={`stage-${r.key}`}
										value={r.name}
										maxLength={60}
										placeholder="Stage name"
										onChange={(e) => update(r.key, { name: e.target.value })}
										className={`flex-1 min-w-0 h-9 rounded border px-3 text-[13.5px] bg-surface text-body outline-none transition-colors focus:border-brand ${
											errors[r.key] ? 'border-danger' : 'border-line-2'
										}`}
									/>

									<button
										type="button"
										onClick={() => makeDefault(r.key)}
										title={r.isDefault ? 'Every purchase order starts here' : 'Make this the starting stage'}
										aria-pressed={r.isDefault}
										className={`h-7 px-2 rounded text-[11.5px] font-bold border cursor-pointer flex-shrink-0 transition-colors ${
											r.isDefault
												? 'bg-brand-bg text-link border-brand-border'
												: 'bg-surface-2 text-muted border-transparent hover:text-body-2'
										}`}>
										Default
									</button>

									<button
										type="button"
										onClick={() => toggleOutcome(r.key, 'won')}
										disabled={r.isDefault}
										aria-pressed={r.outcome === 'won'}
										title={r.isDefault ? 'The default stage cannot be an outcome' : 'Won — the chase ended well'}
										className={iconButton(r.outcome === 'won', 'bg-ok border-ok text-white')}>
										<Svg size={16}>{icon.trophy}</Svg>
									</button>

									<button
										type="button"
										onClick={() => toggleOutcome(r.key, 'lost')}
										disabled={r.isDefault}
										aria-pressed={r.outcome === 'lost'}
										title={r.isDefault ? 'The default stage cannot be an outcome' : 'Lost — the order fell through'}
										className={iconButton(r.outcome === 'lost', 'bg-danger border-danger text-white')}>
										<Svg size={16}>{icon.lost}</Svg>
									</button>

									<button
										type="button"
										onClick={() => remove(r.key)}
										disabled={rows.length === 1}
										aria-label={`Remove ${r.name || 'this stage'}`}
										title={rows.length === 1 ? 'A pipeline needs at least one stage' : 'Remove this stage'}
										className={iconButton(false, '')}>
										<Svg size={16} width={1.9}>{icon.trash}</Svg>
									</button>
								</div>

								{errors[r.key] && (
									<div className="text-[11.5px] font-bold text-danger mt-1.5 ml-[70px] animate-fade-in">
										{errors[r.key]}
									</div>
								)}
							</li>
						))}
					</ol>

					<button
						type="button"
						onClick={add}
						className="mt-2.5 w-full h-11 rounded-lg border border-line-2 bg-surface text-body-2 font-bold text-[13px] cursor-pointer flex items-center justify-center gap-2 hover:bg-surface-2">
						<Svg size={15}>{icon.plus}</Svg>
						Add Stage
					</button>

					<p className="text-[11.5px] text-muted-2 mt-3 mb-1 leading-relaxed">
						New stages can be reached from every open stage; narrow that under
						Allowed moves.
						{removedCount > 0 &&
							` ${removedCount === 1 ? 'A removed stage' : 'Removed stages'} that orders still sit on will be kept for their history.`}
					</p>
				</div>

				<div className="px-6 py-4 flex-shrink-0">
					{error && (
						<div className="px-3 py-2.5 mb-3 rounded border bg-danger-bg border-danger-border text-danger text-[12.5px] font-bold">
							{error}
						</div>
					)}
					<div className="flex justify-end gap-2.5">
						<button
							type="button"
							onClick={onClose}
							disabled={saving}
							className="h-10 px-4 rounded-lg border border-line-2 bg-surface text-body-2 font-bold text-[13.5px] cursor-pointer hover:bg-surface-2 disabled:opacity-50">
							Cancel
						</button>
						<button
							type="button"
							onClick={save}
							disabled={saving}
							className="h-10 px-5 rounded-lg border border-brand bg-brand hover:bg-brand-600 text-white font-bold text-[13.5px] cursor-pointer disabled:opacity-60 flex items-center gap-2">
							{saving && (
								<span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
							)}
							{saving ? 'Saving…' : 'Save Changes'}
						</button>
					</div>
				</div>
			</div>
		</div>,
		document.body,
	);
}
