import { useMemo, useState } from 'react';
import { reachableFrom } from '../../lib/poFollowups';
import { toneDot } from '../../lib/tones';

/**
 * The stages an order can move to from where it stands.
 *
 * Only the moves the pipeline allows are offered — the server refuses the
 * rest anyway, and a menu that offers what will then be refused is worse than
 * a short one. An administrator can show every stage; the move is then made
 * as an override and recorded on the timeline as one.
 *
 * Renders only the list; the caller supplies the popover around it, because
 * the panel header and the table's action submenu position it differently.
 */
export default function StatusMenu({
	workflow,
	currentStatusId,
	isAdmin,
	busy,
	onPick,
}) {
	const [override, setOverride] = useState(false);

	const options = useMemo(() => {
		if (!workflow) return [];
		if (override) {
			return workflow.statuses.filter(
				(s) => !s.archived && s.id !== currentStatusId,
			);
		}
		return reachableFrom(workflow, currentStatusId);
	}, [workflow, currentStatusId, override]);

	return (
		<div className="min-w-[200px] py-1">
			{!workflow ? (
				<div className="px-3.5 py-2.5 text-[12.5px] text-muted-2">Loading…</div>
			) : options.length === 0 ? (
				<div className="px-3.5 py-2.5 text-[12.5px] text-muted-2 max-w-[240px] leading-relaxed">
					{currentStatusId
						? 'The pipeline allows no move from this stage.'
						: 'No stage is marked as the default, so there is nowhere to start.'}
				</div>
			) : (
				options.map((s) => (
					<button
						key={s.id}
						type="button"
						disabled={busy}
						onClick={() => onPick(s.id, override)}
						className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-[13px] text-body bg-transparent border-none cursor-pointer hover:bg-surface-2 disabled:opacity-50 disabled:cursor-default">
						<span className={`w-2 h-2 rounded-full flex-shrink-0 ${toneDot(s.tone)}`} />
						<span className="truncate">{s.name}</span>
					</button>
				))
			)}

			{isAdmin && workflow && (
				<label className="flex items-center gap-2 px-3.5 pt-2 pb-1.5 mt-1 border-t border-line-4 cursor-pointer select-none text-[11.5px] text-muted-2">
					<input
						type="checkbox"
						checked={override}
						onChange={(e) => setOverride(e.target.checked)}
						className="cursor-pointer"
					/>
					Show every stage (override)
				</label>
			)}
		</div>
	);
}
