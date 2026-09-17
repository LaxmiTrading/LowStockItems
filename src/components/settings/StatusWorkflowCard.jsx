import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, Notice } from './primitives';
import { getWorkflow, replaceTransitions } from '../../lib/poFollowups';
import { toneDot } from '../../lib/tones';
import Checkbox from '../Checkbox';
import PipelineModal from './PipelineModal';

const edgeKey = (from, to) => `${from}>${to}`;

const trophy = (
	<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
		<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
		<path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
		<path d="M4 22h16" />
		<path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
		<path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
		<path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
	</svg>
);

const lost = (
	<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
		<circle cx="12" cy="12" r="10" />
		<path d="m15 9-6 6" />
		<path d="m9 9 6 6" />
	</svg>
);

/**
 * The purchase-order pipeline: its stages, and which moves between them the
 * app allows.
 *
 * Stages are edited in the Customize Pipeline dialog and saved in one go. The
 * allowed moves stay a matrix here, because "from this stage an order may go
 * to these" is the part of the flow a list of stages cannot express.
 */
export default function StatusWorkflowCard({ isAdmin }) {
	const [workflow, setWorkflow] = useState(null);
	const [error, setError] = useState(null);
	const [notice, setNotice] = useState(null);
	const [busy, setBusy] = useState(false);
	const [customizing, setCustomizing] = useState(false);

	// The matrix is edited locally and saved in one go, so it needs its own
	// copy rather than reading straight from `workflow`.
	const [edges, setEdges] = useState(() => new Set());
	const [dirty, setDirty] = useState(false);

	const apply = useCallback((wf) => {
		setWorkflow(wf);
		setEdges(
			new Set(wf.transitions.map((t) => edgeKey(t.fromStatusId, t.toStatusId))),
		);
		setDirty(false);
	}, []);

	useEffect(() => {
		let cancelled = false;
		getWorkflow({ force: true })
			.then((wf) => {
				if (!cancelled) apply(wf);
			})
			.catch((e) => {
				if (!cancelled) setError(e.message || 'Could not load the pipeline.');
			});
		return () => {
			cancelled = true;
		};
	}, [apply]);

	const live = useMemo(
		() =>
			(workflow?.statuses ?? [])
				.filter((s) => !s.archived)
				.sort((a, b) => a.sortOrder - b.sortOrder),
		[workflow],
	);
	const archived = useMemo(
		() => (workflow?.statuses ?? []).filter((s) => s.archived),
		[workflow],
	);

	const toggleEdge = (from, to) => {
		setEdges((prev) => {
			const next = new Set(prev);
			const key = edgeKey(from, to);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
		setDirty(true);
	};

	const saveFlow = async () => {
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			apply(
				await replaceTransitions(
					[...edges].map((key) => {
						const [fromStatusId, toStatusId] = key.split('>');
						return { fromStatusId, toStatusId };
					}),
				),
			);
			setNotice('Allowed moves saved.');
		} catch (e) {
			setError(e.message || 'Could not save the allowed moves.');
		} finally {
			setBusy(false);
		}
	};

	const pipelineSaved = (result) => {
		apply(result);
		setCustomizing(false);
		setError(null);
		const parts = ['Pipeline saved.'];
		if (result.added) {
			parts.push(
				`${result.added === 1 ? 'The new stage' : `The ${result.added} new stages`} can be reached from every open stage — narrow that under Allowed moves.`,
			);
		}
		if (result.archived?.length) {
			parts.push(
				`Kept for history, because orders still use ${result.archived.length === 1 ? 'it' : 'them'}: ${result.archived.join(', ')}.`,
			);
		}
		setNotice(parts.join(' '));
	};

	if (!workflow) {
		return (
			<Card title="Purchase-order pipeline">
				{error ? (
					<Notice tone="error">{error}</Notice>
				) : (
					<div className="skeleton h-4 w-1/3" />
				)}
			</Card>
		);
	}

	return (
		<Card
			title="Purchase-order pipeline"
			hint="The stages a purchase order moves through while you chase the vendor. Every order starts at the default stage; won and lost stages record how the chase ended. Reaching one deletes nothing — a follow-up is only removed once its order is no longer open in Zoho.">
			<Notice tone="ok">{notice}</Notice>
			<Notice tone="error">{error}</Notice>

			<div className="flex items-center justify-between gap-3 mb-2.5">
				<div className="text-[13px] font-bold text-heading">Stages</div>
				{isAdmin && (
					<button
						onClick={() => {
							setNotice(null);
							setCustomizing(true);
						}}
						className="h-8 px-3 rounded border border-line-2 bg-surface text-body-2 font-bold text-[12.5px] cursor-pointer hover:bg-surface-2 flex items-center gap-1.5">
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
							<path d="M4 6h11M4 12h5M4 18h11" />
							<circle cx="18" cy="6" r="2" />
							<circle cx="12" cy="12" r="2" />
							<circle cx="18" cy="18" r="2" />
						</svg>
						Customize pipeline
					</button>
				)}
			</div>

			<ol className="list-none m-0 p-0 border border-line rounded overflow-hidden mb-6">
				{live.map((s, i) => (
					<li
						key={s.id}
						className="flex items-center gap-2.5 px-3 py-2.5 border-b border-line-4 last:border-b-0">
						<span className="text-[11px] text-muted-3 num w-4 text-right">{i + 1}</span>
						<span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${toneDot(s.tone)}`} />
						<span className="text-[13px] text-body flex-1 min-w-0 truncate">{s.name}</span>
						{s.isInitial && (
							<span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded border bg-brand-bg text-link border-brand-border">
								Default
							</span>
						)}
						{s.outcome === 'won' && (
							<span className="inline-flex items-center gap-1 text-[11px] font-bold text-ok">
								{trophy}
								Won
							</span>
						)}
						{s.outcome === 'lost' && (
							<span className="inline-flex items-center gap-1 text-[11px] font-bold text-danger">
								{lost}
								Lost
							</span>
						)}
					</li>
				))}
			</ol>

			{/* The flow */}
			<div className="text-[13px] font-bold text-heading mb-1">Allowed moves</div>
			<p className="text-[12.5px] text-muted-2 mt-0 mb-3 leading-relaxed">
				Tick a box to allow moving from the stage on the left to the one along the
				top. An unticked box is a move the app will refuse.
			</p>

			{live.length === 0 ? (
				<p className="text-[13px] text-muted-2">Add a stage first.</p>
			) : (
				<div className="overflow-x-auto border border-line rounded">
					<table className="border-collapse text-[12px] min-w-full">
						<thead>
							<tr>
								<th className="sticky left-0 bg-surface-2 border-b border-r border-line px-3 py-2 text-left text-[10.5px] font-black text-muted tracking-[.06em]">
									FROM &#8594; TO
								</th>
								{live.map((to) => (
									<th
										key={to.id}
										className="bg-surface-2 border-b border-line px-2 py-2 text-[11px] font-bold text-body-3 whitespace-nowrap">
										<span className="inline-flex items-center gap-1.5">
											<span className={`w-1.5 h-1.5 rounded-full ${toneDot(to.tone)}`} />
											{to.name}
										</span>
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{live.map((from) => (
								<tr key={from.id}>
									<th className="sticky left-0 bg-surface border-b border-r border-line px-3 py-2 text-left text-[11.5px] font-bold text-body-2 whitespace-nowrap">
										<span className="inline-flex items-center gap-1.5">
											<span className={`w-1.5 h-1.5 rounded-full ${toneDot(from.tone)}`} />
											{from.name}
										</span>
									</th>
									{live.map((to) => (
										<td key={to.id} className="border-b border-line-4 px-2 py-2 text-center">
											{from.id === to.id ? (
												// A stage to itself is not a move.
												<span className="text-muted-4">&#183;</span>
											) : (
												<div className="flex justify-center">
													<Checkbox
														size={16}
														disabled={!isAdmin || busy}
														checked={edges.has(edgeKey(from.id, to.id))}
														label={`Allow ${from.name} to ${to.name}`}
														onChange={() => toggleEdge(from.id, to.id)}
													/>
												</div>
											)}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			{isAdmin && (
				<div className="flex items-center gap-2.5 mt-3.5">
					<button
						onClick={saveFlow}
						disabled={busy || !dirty}
						className="h-9 px-4 rounded border border-brand bg-brand hover:bg-brand-600 text-white font-bold text-[13px] cursor-pointer disabled:opacity-50 disabled:cursor-default transition-all duration-200 ease-smooth">
						{busy ? 'Saving…' : 'Save allowed moves'}
					</button>
					{dirty && (
						<button
							onClick={() => apply(workflow)}
							disabled={busy}
							className="h-9 px-3.5 rounded border border-line-2 bg-surface text-body-3 font-bold text-[12.5px] cursor-pointer hover:bg-surface-2">
							Discard changes
						</button>
					)}
				</div>
			)}

			{archived.length > 0 && (
				<div className="mt-6">
					<div className="text-[11px] font-bold text-muted tracking-[.04em] mb-2">
						KEPT FOR HISTORY
					</div>
					<div className="flex items-center gap-2 flex-wrap">
						{archived.map((s) => (
							<span
								key={s.id}
								className="inline-flex items-center gap-1.5 text-[11.5px] font-bold px-2 py-0.5 rounded-full border bg-surface-2 border-line text-muted">
								<span className={`w-1.5 h-1.5 rounded-full ${toneDot(s.tone)}`} />
								{s.name}
							</span>
						))}
					</div>
					<p className="text-[11.5px] text-muted-2 mt-2 mb-0 leading-relaxed">
						Removed stages that orders still sit on. They no longer appear when
						choosing a stage, but those orders keep showing them.
					</p>
				</div>
			)}

			{customizing && (
				<PipelineModal
					workflow={workflow}
					onClose={() => setCustomizing(false)}
					onSaved={pipelineSaved}
				/>
			)}
		</Card>
	);
}
