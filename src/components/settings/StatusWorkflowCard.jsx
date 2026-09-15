import { useEffect, useMemo, useState } from 'react';
import { Card, Notice, field } from './primitives';
import {
	createStatus,
	deleteStatus,
	getWorkflow,
	replaceTransitions,
	updateStatus,
} from '../../lib/poFollowups';
import { StatusPill } from '../po/FollowUpTimeline';
import Checkbox from '../Checkbox';
import ConfirmDialog from '../ConfirmDialog';

const TONES = ['neutral', 'brand', 'ok', 'warn', 'danger'];

const edgeKey = (from, to) => `${from}>${to}`;

/**
 * The vendor-chase workflow: which statuses exist, and which moves between
 * them the app will allow.
 *
 * Two halves, because they are edited differently — the statuses one at a
 * time, and the flow as a whole. Saving the matrix replaces every edge in one
 * request, so closing the tab halfway cannot leave the flow partly rewired.
 */
export default function StatusWorkflowCard({ isAdmin }) {
	const [workflow, setWorkflow] = useState(null);
	const [error, setError] = useState(null);
	const [notice, setNotice] = useState(null);
	const [busy, setBusy] = useState(false);
	const [newName, setNewName] = useState('');
	const [pendingDelete, setPendingDelete] = useState(null);

	// The matrix is edited locally and saved in one go, so it needs its own
	// copy rather than reading straight from `workflow`.
	const [edges, setEdges] = useState(() => new Set());
	const [dirty, setDirty] = useState(false);

	const load = async ({ force = true } = {}) => {
		try {
			const wf = await getWorkflow({ force });
			setWorkflow(wf);
			setEdges(
				new Set(wf.transitions.map((t) => edgeKey(t.fromStatusId, t.toStatusId))),
			);
			setDirty(false);
		} catch (e) {
			setError(e.message || 'Could not load the follow-up workflow.');
		}
	};

	useEffect(() => {
		let cancelled = false;
		getWorkflow()
			.then((wf) => {
				if (cancelled) return;
				setWorkflow(wf);
				setEdges(
					new Set(
						wf.transitions.map((t) => edgeKey(t.fromStatusId, t.toStatusId)),
					),
				);
			})
			.catch((e) => {
				if (!cancelled) {
					setError(e.message || 'Could not load the follow-up workflow.');
				}
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const live = useMemo(
		() => (workflow?.statuses ?? []).filter((s) => !s.archived),
		[workflow],
	);
	const archived = useMemo(
		() => (workflow?.statuses ?? []).filter((s) => s.archived),
		[workflow],
	);

	const run = async (fn, successMessage) => {
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			await fn();
			await load();
			if (successMessage) setNotice(successMessage);
		} catch (e) {
			setError(e.message || 'That did not work.');
		} finally {
			setBusy(false);
		}
	};

	const add = (e) => {
		e.preventDefault();
		const name = newName.trim();
		if (!name) return;
		run(async () => {
			await createStatus({ name, tone: 'neutral' });
			setNewName('');
		}, `Added "${name}".`);
	};

	// Swapping sort_order with the neighbour is enough to move a row, and needs
	// no drag-and-drop dependency for a list this short.
	const move = (index, delta) => {
		const target = live[index + delta];
		const current = live[index];
		if (!target || !current) return;
		run(async () => {
			await updateStatus({ id: current.id, sortOrder: target.sortOrder });
			await updateStatus({ id: target.id, sortOrder: current.sortOrder });
		});
	};

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

	const saveFlow = () =>
		run(async () => {
			await replaceTransitions(
				[...edges].map((key) => {
					const [fromStatusId, toStatusId] = key.split('>');
					return { fromStatusId, toStatusId };
				}),
			);
		}, 'Follow-up flow saved.');

	const confirmDelete = () =>
		run(async () => {
			const result = await deleteStatus(pendingDelete.id);
			setPendingDelete(null);
			setNotice(
				result.archived
					? `"${pendingDelete.name}" is still on ${result.inUseOn} purchase order${result.inUseOn === 1 ? '' : 's'}, so it was kept for history and hidden from the pickers.`
					: `Removed "${pendingDelete.name}".`,
			);
		});

	if (!workflow) {
		return (
			<Card title="Purchase-order follow-up">
				<div className="skeleton h-4 w-1/3" />
			</Card>
		);
	}

	return (
		<Card
			title="Purchase-order follow-up"
			hint="The states a purchase order moves through while you chase the vendor, and which moves are allowed. Removing a status that orders still sit on keeps it for their history.">
			<Notice tone="ok">{notice}</Notice>
			<Notice tone="error">{error}</Notice>

			{/* The statuses */}
			<div className="border border-line rounded overflow-hidden mb-5">
				{live.map((s, i) => (
					<div
						key={s.id}
						className="flex items-center gap-2.5 px-3 py-2.5 border-b border-line-4 last:border-b-0 flex-wrap">
						<StatusPill name={s.name} tone={s.tone} />

						{isAdmin && (
							<>
								<select
									value={s.tone}
									disabled={busy}
									onChange={(e) =>
										run(() => updateStatus({ id: s.id, tone: e.target.value }))
									}
									aria-label={`Colour for ${s.name}`}
									className="h-7 border border-line-2 rounded px-2 text-[12px] bg-surface text-body-3 cursor-pointer">
									{TONES.map((t) => (
										<option key={t} value={t}>
											{t}
										</option>
									))}
								</select>

								<label className="flex items-center gap-1.5 text-[11.5px] text-muted-2 cursor-pointer">
									<Checkbox
										size={15}
										checked={s.isInitial}
										disabled={busy}
										label={`${s.name} can start an order`}
										onChange={() =>
											run(() =>
												updateStatus({ id: s.id, isInitial: !s.isInitial }),
											)
										}
									/>
									starts
								</label>

								<label className="flex items-center gap-1.5 text-[11.5px] text-muted-2 cursor-pointer">
									<Checkbox
										size={15}
										checked={s.isTerminal}
										disabled={busy}
										label={`${s.name} ends the chase`}
										onChange={() =>
											run(() =>
												updateStatus({ id: s.id, isTerminal: !s.isTerminal }),
											)
										}
									/>
									ends
								</label>

								<div className="flex-1" />

								<button
									onClick={() => move(i, -1)}
									disabled={busy || i === 0}
									aria-label={`Move ${s.name} up`}
									className="w-6 h-6 rounded border border-line-2 bg-surface text-muted text-[11px] cursor-pointer hover:bg-surface-2 disabled:opacity-30 disabled:cursor-default">
									&#9650;
								</button>
								<button
									onClick={() => move(i, 1)}
									disabled={busy || i === live.length - 1}
									aria-label={`Move ${s.name} down`}
									className="w-6 h-6 rounded border border-line-2 bg-surface text-muted text-[11px] cursor-pointer hover:bg-surface-2 disabled:opacity-30 disabled:cursor-default">
									&#9660;
								</button>
								<button
									onClick={() => setPendingDelete(s)}
									disabled={busy}
									aria-label={`Remove ${s.name}`}
									className="w-6 h-6 rounded-full border border-danger-border bg-surface text-danger text-[11px] cursor-pointer hover:bg-danger-bg disabled:opacity-40">
									&#10005;
								</button>
							</>
						)}
					</div>
				))}
			</div>

			{isAdmin && (
				<form onSubmit={add} className="flex items-center gap-2 mb-6 flex-wrap">
					<input
						value={newName}
						onChange={(e) => setNewName(e.target.value)}
						placeholder="Add a status…"
						maxLength={60}
						className={`${field} flex-1 min-w-[180px] max-w-[280px]`}
					/>
					<button
						type="submit"
						disabled={busy || !newName.trim()}
						className="h-9 px-4 rounded border border-brand-border bg-brand-bg text-link font-bold text-[12.5px] cursor-pointer hover:bg-brand-50 disabled:opacity-50 disabled:cursor-default">
						Add
					</button>
				</form>
			)}

			{/* The flow */}
			<div className="text-[13px] font-bold text-heading mb-1">
				Allowed moves
			</div>
			<p className="text-[12.5px] text-muted-2 mt-0 mb-3 leading-relaxed">
				Tick a box to allow moving from the status on the left to the one along
				the top. An unticked box is a move the app will refuse.
			</p>

			{live.length === 0 ? (
				<p className="text-[13px] text-muted-2">Add a status first.</p>
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
										{to.name}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{live.map((from) => (
								<tr key={from.id}>
									<th className="sticky left-0 bg-surface border-b border-r border-line px-3 py-2 text-left text-[11.5px] font-bold text-body-2 whitespace-nowrap">
										{from.name}
									</th>
									{live.map((to) => (
										<td
											key={to.id}
											className="border-b border-line-4 px-2 py-2 text-center">
											{from.id === to.id ? (
												// A status to itself is not a move.
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
						{busy ? 'Saving…' : 'Save flow'}
					</button>
					{dirty && (
						<button
							onClick={() => load()}
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
							<StatusPill key={s.id} name={s.name} tone={s.tone} archived />
						))}
					</div>
					<p className="text-[11.5px] text-muted-2 mt-2 mb-0 leading-relaxed">
						These no longer appear when choosing a status, but orders that
						still hold one keep showing it.
					</p>
				</div>
			)}

			{pendingDelete && (
				<ConfirmDialog
					title={`Remove "${pendingDelete.name}"?`}
					body="If no purchase order is on this status it is deleted outright. If some are, it is kept so their history still reads correctly, and hidden everywhere else."
					confirmLabel="Remove"
					busy={busy}
					onConfirm={confirmDelete}
					onCancel={() => setPendingDelete(null)}
				/>
			)}
		</Card>
	);
}
