import { useSyncExternalStore } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import {
	subscribe as subscribeToRun,
	getState as getRunState,
} from '../lib/reorderRun';
import {
	subscribe as subscribeToLoad,
	getState as getLoadState,
} from '../lib/lowStockRun';

// 52px top bar + 236px sidebar, per docs/design/LowStockItems.dc.html.
export const TOP_BAR_H = 52;
export const SIDEBAR_W = 236;

const NAV = [
	{
		to: '/',
		label: 'Low stock items',
		// The New PO page is a child of this section, so the item stays lit there.
		matches: (p) => p === '/' || p.startsWith('/po'),
		icon: (
			<>
				<path d="M3 7l9-4 9 4-9 4-9-4z" />
				<path d="M3 7v10l9 4 9-4V7" />
				<path d="M12 11v10" />
			</>
		),
	},
	{
		to: '/lost-sales',
		label: 'Lost sales',
		matches: (p) => p.startsWith('/lost-sales'),
		icon: (
			<>
				<path d="M4 4h12l4 4v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
				<path d="M8 13h8" />
			</>
		),
	},
	{
		to: '/reorder-suggestions',
		label: 'Reorder suggestions',
		matches: (p) => p.startsWith('/reorder-suggestions'),
		icon: (
			<>
				<path d="M4 6h11" />
				<circle cx="18" cy="6" r="2" />
				<path d="M4 12h5" />
				<circle cx="12" cy="12" r="2" />
				<path d="M4 18h11" />
				<circle cx="18" cy="18" r="2" />
			</>
		),
	},
];

export default function AppShell() {
	const { pathname } = useLocation();
	const { user, signOut } = useAuth();

	// A suggestion run continues while you are on another page, so the nav has
	// to show it — otherwise minutes of work happen with no sign of it.
	const run = useSyncExternalStore(subscribeToRun, getRunState);
	const runProgress =
		run.phase === 'running' && run.progress?.total
			? Math.round((run.progress.done / run.progress.total) * 100)
			: null;

	const load = useSyncExternalStore(subscribeToLoad, getLoadState);

	// Which nav item, if any, has work in flight — and what to show against it.
	const activity = {
		'/reorder-suggestions':
			run.phase === 'running'
				? {
						label: runProgress != null ? `${runProgress}%` : '',
						title: run.progress
							? `Computing ${run.progress.done} of ${run.progress.total}`
							: 'Computing',
					}
				: null,
		'/': load.phase === 'loading'
			? {
					label: load.loaded ? String(load.loaded) : '',
					title: `Loaded ${load.loaded} of ${load.total || '?'} items`,
				}
			: null,
	};

	return (
		<div className="min-h-screen flex flex-col text-left">
			{/* TOP BAR */}
			<div className="h-[52px] bg-surface border-b border-line flex items-center px-5 gap-[11px] sticky top-0 z-40 flex-shrink-0">
				{/* Wordmark: the flat blue square becomes a lit tile, which is the
				    cheapest way to give the chrome a focal point. */}
				<div className="w-[27px] h-[27px] rounded bg-brand flex items-center justify-center text-white font-black text-[14px] select-none">
					L
				</div>
				<div className="font-black text-[15px] text-heading tracking-[-.01em]">
					Low<span className="text-brand-600">Stock</span>Items
				</div>

				<div className="flex-1" />

				{user && (
					<span className="flex items-center gap-2 mr-1 min-w-0">
						<span
							className="w-[26px] h-[26px] rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-[11px] font-black flex-shrink-0"
							title={user.email}>
							{(user.displayName || user.email || '?').slice(0, 2).toUpperCase()}
						</span>
						<span className="text-[12.5px] font-bold text-body-2 truncate max-w-[150px]">
							{user.displayName}
						</span>
					</span>
				)}

				{/* Everyone: appearance and your own password live here. The
				    administrator-only cards inside are gated separately. */}
				{user && (
					<NavLink
						to="/settings"
						className={`flex items-center h-8 px-3 rounded border text-[12.5px] font-bold no-underline hover:no-underline ${
							pathname.startsWith('/settings')
								? 'border-brand-200 bg-brand-50 text-brand-700'
								: 'border-line-2 bg-surface text-body-3 hover:text-heading'
						}`}>
						Settings
					</NavLink>
				)}

				<button
					onClick={signOut}
					className="group flex items-center gap-2 h-8 px-3 rounded border border-line-2 bg-surface text-body-3 font-bold text-[12.5px] cursor-pointer hover:border-danger-border hover:bg-danger-bg hover:text-danger">
					<svg
						width="15"
						height="15"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.9"
						strokeLinecap="round"
						strokeLinejoin="round"
						className="transition-transform duration-200 group-hover:translate-x-0.5">
						<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
						<path d="M16 17l5-5-5-5" />
						<path d="M21 12H9" />
					</svg>
					Log out
				</button>

			</div>

			<div className="flex-1 flex items-start min-h-0">
				{/* SIDEBAR */}
				<nav className="w-[236px] flex-shrink-0 bg-sidebar border-r border-line p-4 px-3 flex flex-col gap-1 sticky top-[52px] h-[calc(100vh-52px)] overflow-y-auto self-start">
					<div className="text-[10px] font-black text-muted-3 tracking-[.09em] px-3 pt-1 pb-2">
						WORKSPACE
					</div>

					{NAV.map((item) => {
						const active = item.matches(pathname);
						return (
							<NavLink
								key={item.to}
								to={item.to}
								className={`group flex items-center gap-[11px] w-full text-left rounded px-3 py-[9px] text-[13.5px] font-bold no-underline hover:no-underline transition-colors duration-150 ${
									active
										? 'bg-brand text-white'
										: 'bg-transparent text-body-2 hover:bg-line-3 hover:text-heading'
								}`}>
								<svg
									width="18"
									height="18"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="1.9"
									strokeLinecap="round"
									strokeLinejoin="round"
									className={`flex-shrink-0 transition-colors duration-150 ${
										active ? 'text-white' : 'text-muted-2 group-hover:text-body-2'
									}`}>
									{item.icon}
								</svg>
								<span className="flex-1 min-w-0 truncate">{item.label}</span>

								{/* Work in flight for this section, so a background job is
								    visible from wherever you are. */}
								{activity[item.to] && (
									<span
										title={activity[item.to].title}
										className={`flex items-center gap-1 text-[10px] font-black num flex-shrink-0 ${
											active ? 'text-white/90' : 'text-brand-600'
										}`}>
										<span
											className={`w-2.5 h-2.5 rounded-full border-2 border-t-transparent animate-spin ${
												active ? 'border-white/70' : 'border-brand'
											}`}
										/>
										{activity[item.to].label}
									</span>
								)}
							</NavLink>
						);
					})}

					<div className="flex-1" />

					{/* Foot of the rail. A quiet reminder of what the app is for — and
					    it stops the sidebar ending in dead space. */}
					<div className="mx-1 mb-1 rounded border border-line bg-surface p-3">
						<div className="flex items-center gap-2 mb-1.5">
							<span className="w-1.5 h-1.5 rounded-full bg-ok" />
							<span className="text-[10.5px] font-black text-body-3 tracking-[.06em]">
								CONNECTED TO ZOHO
							</span>
						</div>
						<p className="m-0 text-[11.5px] leading-[1.45] text-muted-2">
							Stock, vendors and purchase orders read live through the server.
							No Zoho credential reaches this browser.
						</p>
					</div>
				</nav>

				{/* MAIN — keyed on the path so each page arrives with a short fade
				    rather than snapping in.

				    Deliberately not a scroll container. `overflow-x` here would
				    compute `overflow-y` to auto as well, making this the scrollport
				    for everything inside it — and since the column is sized to its
				    content it never actually scrolls, so any `position: sticky`
				    descendant would silently stop sticking. Every table below lays
				    out in fr units and compresses rather than overflowing, so the
				    scroll container bought nothing and cost the sticky toolbars. */}
				{/* The fade here must stay opacity-only. A transform — even the
				    translateY(0) that a fade-up animation retains under
				    `fill-mode: both` — would make this element the containing block
				    for every `position: fixed` descendant, and the New PO and lost
				    sale forms are fixed overlays offset by the sidebar and top bar.
				    They would be pushed a second sidebar-width off-screen, and
				    ItemPicker's fixed dropdown would resolve its viewport
				    coordinates against the wrong origin. */}
				<main key={pathname} className="flex-1 min-w-0 animate-fade-in">
					<Outlet />
				</main>
			</div>
		</div>
	);
}
