import { useCallback, useEffect, useState } from 'react';
import { endSessions, loginActivity } from '../../lib/api';
import { Card } from './primitives';
import Pagination from '../Pagination';

const OUTCOMES = {
	success: ['Signed in', 'text-ok bg-ok-bg border-ok-border'],
	bad_password: ['Wrong password', 'text-danger bg-danger-bg border-danger-border'],
	no_account: ['No such account', 'text-danger bg-danger-bg border-danger-border'],
	disabled: ['Account disabled', 'text-warn-2 bg-warn-bg border-warn-border'],
	not_activated: ['Not activated', 'text-warn-2 bg-warn-bg border-warn-border'],
	blocked: ['Blocked — too many', 'text-warn-2 bg-warn-bg border-warn-border'],
};

const when = (value) =>
	new Date(value).toLocaleString('en-IN', {
		day: '2-digit',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit',
	});

/**
 * Every sign-in attempt on every account, a page at a time.
 *
 * Paged on the server rather than in the browser: the table keeps 90 days of
 * every attempt, and one bad week of mistyped passwords — or someone guessing —
 * is more than a single request should carry.
 */
export default function SignInActivityCard({ onError }) {
	const [data, setData] = useState(null); // { attempts, total, failed }
	const [page, setPage] = useState(0);
	const [pageSize, setPageSize] = useState(25);
	const [loading, setLoading] = useState(false);
	const [busy, setBusy] = useState(false);
	const [ended, setEnded] = useState(false);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			setData(await loginActivity(pageSize, page * pageSize));
		} catch (e) {
			onError(e.message);
		} finally {
			setLoading(false);
		}
	}, [page, pageSize, onError]);

	useEffect(() => {
		load();
	}, [load]);

	// A page can run out from under you if the page size grows, so step back to
	// the last page that still has rows rather than showing an empty one.
	useEffect(() => {
		if (!data || page === 0 || data.attempts.length > 0 || data.total === 0) return;
		setPage(Math.max(0, Math.ceil(data.total / pageSize) - 1));
	}, [data, page, pageSize]);

	const rows = data?.attempts ?? [];

	return (
		<Card
			title="Sign-in activity"
			hint="Every attempt on every account, newest first, kept for 90 days. A country here is only where the network says the request came from — a signed-in session is never granted or refused on that basis.">
			{data === null ? (
				<div className="skeleton h-4 w-1/3" />
			) : data.total === 0 ? (
				<p className="text-[13px] text-muted-2 m-0">Nothing recorded yet.</p>
			) : (
				<>
					<div className="flex items-center justify-between gap-3 flex-wrap mb-3">
						<div className="text-[12.5px] text-muted-2">
							<strong className="text-body-2 font-black num">
								{data.total.toLocaleString('en-IN')}
							</strong>{' '}
							attempts
							{data.failed > 0 && (
								<>
									{' · '}
									<strong className="text-danger font-black num">
										{data.failed.toLocaleString('en-IN')}
									</strong>{' '}
									failed
								</>
							)}
						</div>
						<button
							onClick={load}
							disabled={loading}
							className="h-8 px-3 rounded border border-line-2 bg-surface text-body-2 font-bold text-[12px] cursor-pointer hover:border-muted-3 disabled:opacity-60">
							{loading ? 'Refreshing…' : 'Refresh'}
						</button>
					</div>

					<div
						className={`border border-line rounded overflow-hidden transition-opacity ${
							loading ? 'opacity-60' : ''
						}`}>
						<div className="hidden sm:grid grid-cols-[130px_minmax(0,1.6fr)_minmax(0,1.4fr)_130px] px-3.5 py-2 bg-surface-2 border-b border-line text-[10.5px] font-black text-muted tracking-[.06em]">
							<div>WHEN</div>
							<div>EMAIL TRIED</div>
							<div>FROM</div>
							<div className="text-right">OUTCOME</div>
						</div>
						{rows.map((r, i) => {
							const [label, tone] =
								OUTCOMES[r.outcome] ?? [r.outcome, 'text-muted bg-surface-2 border-line'];
							return (
								<div
									key={`${r.at}-${i}`}
									className="grid grid-cols-1 sm:grid-cols-[130px_minmax(0,1.6fr)_minmax(0,1.4fr)_130px] gap-x-3 gap-y-0.5 px-3.5 py-2.5 border-b border-line-4 last:border-0 text-[12.5px] sm:items-center">
									<div className="num text-muted-2">{when(r.at)}</div>
									<div className="text-body-3 truncate">{r.email ?? '—'}</div>
									<div className="text-muted-2 truncate">
										{[r.city, r.country].filter(Boolean).join(', ') || 'Unknown'}
										<span className="num text-muted-3"> · {r.ip ?? '—'}</span>
									</div>
									<div className="sm:text-right mt-1 sm:mt-0">
										<span
											className={`text-[11px] font-black rounded-full px-2 py-px border ${tone}`}>
											{label}
										</span>
									</div>
								</div>
							);
						})}
					</div>

					<div className="mt-3">
						<Pagination
							total={data.total}
							page={page}
							pageSize={pageSize}
							onPageChange={setPage}
							onPageSizeChange={(n) => {
								setPageSize(n);
								setPage(0);
							}}
						/>
					</div>

					{/* The action you actually want when an attempt looks real: it
					    does not change your password, it just stops every token
					    already issued for your account from verifying. */}
					<div className="flex items-center gap-3 flex-wrap mt-4">
						<button
							disabled={busy}
							onClick={async () => {
								setBusy(true);
								try {
									await endSessions();
									setEnded(true);
								} catch (e) {
									onError(e.message);
								} finally {
									setBusy(false);
								}
							}}
							className="h-9 px-4 rounded border border-line-2 bg-surface text-body-2 font-bold text-[13px] cursor-pointer hover:border-danger-border hover:text-danger disabled:opacity-60">
							Sign out everywhere else
						</button>
						{ended && (
							<span className="text-[12.5px] text-ok font-bold animate-fade-in">
								Every other session for your account has been ended.
							</span>
						)}
					</div>
				</>
			)}
		</Card>
	);
}
