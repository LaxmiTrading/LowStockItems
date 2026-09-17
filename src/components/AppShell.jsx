import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useIsDesktop, useIsWide } from '../lib/useMediaQuery';
import {
	subscribe as subscribeToRun,
	getState as getRunState,
} from '../lib/reorderRun';
import {
	subscribe as subscribeToLoad,
	getState as getLoadState,
} from '../lib/lowStockRun';
import {
	subscribe as subscribeToPOs,
	getState as getPOState,
} from '../lib/poRun';

export const TOP_BAR_H = 52;
export const SIDEBAR_W = 236;
export const SIDEBAR_RAIL_W = 60;

const COLLAPSE_KEY = 'lsi:nav-collapsed';

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
		to: '/purchase-orders',
		label: 'Purchase orders',
		matches: (p) => p.startsWith('/purchase-orders'),
		icon: (
			<>
				<path d="M9 3h6l1 3H8l1-3z" />
				<path d="M5 6h14v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6z" />
				<path d="M9 12h6M9 16h4" />
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

const SettingsIcon = () => (
	<>
		<circle cx="12" cy="12" r="3" />
		<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.09A1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
	</>
);

const SignOutIcon = () => (
	<>
		<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
		<path d="M16 17l5-5-5-5" />
		<path d="M21 12H9" />
	</>
);

export default function AppShell() {
	const { pathname } = useLocation();
	const { user, signOut } = useAuth();

	const isWide = useIsWide(); // fold-open inner screen and up
	const isDesktop = useIsDesktop();

	const [drawerOpen, setDrawerOpen] = useState(false);

	// null = never chosen, so fall back to the width: expanded on a desktop,
	// a rail on a fold-open screen where 236px is a quarter of the width.
	const [collapsePref, setCollapsePref] = useState(() => {
		try {
			const stored = window.localStorage.getItem(COLLAPSE_KEY);
			return stored === 'true' ? true : stored === 'false' ? false : null;
		} catch {
			return null;
		}
	});
	const collapsed = collapsePref === null ? !isDesktop : collapsePref;

	const toggleCollapsed = useCallback(() => {
		setCollapsePref((previous) => {
			const next = !(previous === null ? !isDesktop : previous);
			try {
				window.localStorage.setItem(COLLAPSE_KEY, String(next));
			} catch {
				// Not remembering the choice is no reason to ignore it now.
			}
			return next;
		});
	}, [isDesktop]);

	/**
	 * The rail's width, published for anything positioned against it.
	 *
	 * The two full-page forms and the selection bar are `fixed`, so they cannot
	 * be laid out next to the sidebar — they have to be told how wide it is.
	 * A custom property on the root keeps that in one place instead of three
	 * copies of a magic number that now has three possible values.
	 */
	const navWidth = !isWide ? 0 : collapsed ? SIDEBAR_RAIL_W : SIDEBAR_W;
	useEffect(() => {
		document.documentElement.style.setProperty('--nav-w', `${navWidth}px`);
	}, [navWidth]);

	// Navigating closes the drawer. Without this, tapping a destination leaves
	// the menu sitting over the page you just asked for.
	useEffect(() => setDrawerOpen(false), [pathname]);

	// Escape closes it, and while it is open the page behind must not scroll —
	// on a phone, a drawer over a scrolling page is how you lose your place.
	useEffect(() => {
		if (!drawerOpen) return undefined;
		const onKey = (e) => e.key === 'Escape' && setDrawerOpen(false);
		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		document.addEventListener('keydown', onKey);
		return () => {
			document.body.style.overflow = previous;
			document.removeEventListener('keydown', onKey);
		};
	}, [drawerOpen]);

	// A suggestion run continues while you are on another page, so the nav has
	// to show it — otherwise minutes of work happen with no sign of it.
	const run = useSyncExternalStore(subscribeToRun, getRunState);
	const runProgress =
		run.phase === 'running' && run.progress?.total
			? Math.round((run.progress.done / run.progress.total) * 100)
			: null;

	const load = useSyncExternalStore(subscribeToLoad, getLoadState);
	const pos = useSyncExternalStore(subscribeToPOs, getPOState);

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
		'/purchase-orders': pos.phase === 'loading'
			? {
					label: pos.loaded ? String(pos.loaded) : '',
					title: `Loaded ${pos.loaded} purchase orders`,
				}
			: null,
		'/': load.phase === 'loading'
			? {
					label: load.loaded ? String(load.loaded) : '',
					title: `Loaded ${load.loaded} of ${load.total || '?'} items`,
				}
			: null,
	};
	const anyActivity = Object.values(activity).some(Boolean);

	/** One nav item, drawn either as a labelled row or as an icon on the rail. */
	const navItem = (item, { rail }) => {
		const active = item.matches(pathname);
		return (
			<NavLink
				key={item.to}
				to={item.to}
				title={rail ? item.label : undefined}
				aria-label={rail ? item.label : undefined}
				className={`group relative flex items-center rounded no-underline hover:no-underline transition-colors duration-150 font-bold ${
					rail
						? 'justify-center w-10 h-10 mx-auto'
						: 'gap-[11px] w-full px-3 py-3 lg:py-[9px] text-[14px] lg:text-[13.5px]'
				} ${
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

				{!rail && <span className="flex-1 min-w-0 truncate">{item.label}</span>}

				{activity[item.to] &&
					(rail ? (
						// No room for a percentage on a 40px square, so the rail
						// shows only that something is happening.
						<span
							title={activity[item.to].title}
							className={`absolute top-1 right-1 w-2 h-2 rounded-full ${
								active ? 'bg-white' : 'bg-brand'
							}`}
						/>
					) : (
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
					))}
			</NavLink>
		);
	};

	return (
		<div className="min-h-screen flex flex-col text-left">
			{/* TOP BAR */}
			<div className="h-[52px] bg-surface border-b border-line flex items-center px-3 lg:px-5 gap-2 lg:gap-[11px] sticky top-0 z-40 flex-shrink-0">
				{/* Drawer trigger, phones only. 40px square so it is a thumb target
				    rather than an icon you have to aim at. */}
				<button
					onClick={() => setDrawerOpen(true)}
					aria-label="Open menu"
					aria-expanded={drawerOpen}
					className="sm:hidden relative w-10 h-10 -ml-1 rounded flex items-center justify-center text-body-2 bg-transparent border-none cursor-pointer hover:bg-line-3">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
						<path d="M3 6h18M3 12h18M3 18h18" />
					</svg>
					{anyActivity && (
						<span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-brand" />
					)}
				</button>

				<div className="w-[27px] h-[27px] rounded bg-brand flex items-center justify-center text-white font-black text-[14px] select-none flex-shrink-0">
					L
				</div>
				<div className="font-black text-[15px] text-heading tracking-[-.01em] truncate">
					Low<span className="text-brand-600">Stock</span>Items
				</div>

				<div className="flex-1" />

				{/* Identity and the chrome actions need room to be legible, so below
				    the fold-open width they move into the drawer footer. */}
				{user && (
					<span className="hidden sm:flex items-center gap-2 mr-1 min-w-0">
						<span
							className="w-[26px] h-[26px] rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-[11px] font-black flex-shrink-0"
							title={user.email}>
							{(user.displayName || user.email || '?').slice(0, 2).toUpperCase()}
						</span>
						<span className="hidden lg:block text-[12.5px] font-bold text-body-2 truncate max-w-[150px]">
							{user.displayName}
						</span>
					</span>
				)}

				{user && (
					<NavLink
						to="/settings"
						title="Settings"
						className={`hidden sm:flex items-center justify-center h-9 w-9 lg:w-auto lg:px-3 rounded border text-[12.5px] font-bold no-underline hover:no-underline ${
							pathname.startsWith('/settings')
								? 'border-brand-200 bg-brand-50 text-brand-700'
								: 'border-line-2 bg-surface text-body-3 hover:text-heading'
						}`}>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="lg:hidden">
							<SettingsIcon />
						</svg>
						<span className="hidden lg:inline">Settings</span>
					</NavLink>
				)}

				<button
					onClick={signOut}
					title="Log out"
					className="hidden sm:flex group items-center justify-center gap-2 h-9 w-9 lg:w-auto lg:px-3 rounded border border-line-2 bg-surface text-body-3 font-bold text-[12.5px] cursor-pointer hover:border-danger-border hover:bg-danger-bg hover:text-danger">
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.9"
						strokeLinecap="round"
						strokeLinejoin="round"
						className="transition-transform duration-200 group-hover:translate-x-0.5">
						<SignOutIcon />
					</svg>
					<span className="hidden lg:inline">Log out</span>
				</button>
			</div>

			{/* DRAWER — phones only */}
			{drawerOpen && (
				<div
					className="sm:hidden fixed inset-0 z-50 animate-fade-in"
					style={{ background: 'rgb(var(--c-overlay) / 0.45)' }}
					onClick={(e) => e.target === e.currentTarget && setDrawerOpen(false)}>
					<nav
						role="dialog"
						aria-modal="true"
						aria-label="Menu"
						className="drawer-in w-[272px] max-w-[85vw] h-full bg-sidebar border-r border-line flex flex-col p-3 shadow-float">
						<div className="flex items-center gap-2 px-1 pb-3 mb-1 border-b border-line">
							<div className="w-[27px] h-[27px] rounded bg-brand flex items-center justify-center text-white font-black text-[14px]">
								L
							</div>
							<div className="font-black text-[15px] text-heading flex-1">
								Low<span className="text-brand-600">Stock</span>Items
							</div>
							<button
								onClick={() => setDrawerOpen(false)}
								aria-label="Close menu"
								className="w-9 h-9 rounded flex items-center justify-center text-muted bg-transparent border-none cursor-pointer hover:bg-line-3">
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
									<path d="M6 6l12 12M18 6L6 18" />
								</svg>
							</button>
						</div>

						<div className="text-[10px] font-black text-muted-3 tracking-[.09em] px-3 pt-1 pb-2">
							WORKSPACE
						</div>
						<div className="flex flex-col gap-1">
							{NAV.map((item) => navItem(item, { rail: false }))}
						</div>

						<div className="flex-1" />

						{user && (
							<div className="border-t border-line pt-3 mt-3 flex flex-col gap-1">
								<div className="flex items-center gap-2.5 px-3 pb-2 min-w-0">
									<span className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-[12px] font-black flex-shrink-0">
										{(user.displayName || user.email || '?')
											.slice(0, 2)
											.toUpperCase()}
									</span>
									<span className="min-w-0">
										<span className="block text-[13px] font-bold text-body truncate">
											{user.displayName}
										</span>
										<span className="block text-[11.5px] text-muted-2 truncate">
											{user.email}
										</span>
									</span>
								</div>

								<NavLink
									to="/settings"
									className="flex items-center gap-[11px] rounded px-3 py-3 text-[14px] font-bold text-body-2 no-underline hover:no-underline hover:bg-line-3">
									<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="text-muted-2">
										<SettingsIcon />
									</svg>
									Settings
								</NavLink>

								<button
									onClick={signOut}
									className="flex items-center gap-[11px] rounded px-3 py-3 text-[14px] font-bold text-danger bg-transparent border-none cursor-pointer hover:bg-danger-bg text-left">
									<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
										<SignOutIcon />
									</svg>
									Log out
								</button>
							</div>
						)}
					</nav>
				</div>
			)}

			<div className="flex-1 flex items-start min-h-0">
				{/* SIDEBAR — from the fold-open width up. Collapses to an icon rail,
				    which is the default on a fold-open screen where a 236px rail
				    would take a quarter of the width. */}
				<nav
					style={{ width: navWidth }}
					className={`hidden sm:flex flex-shrink-0 bg-sidebar border-r border-line py-4 flex-col gap-1 sticky top-[52px] h-[calc(100vh-52px)] overflow-y-auto overflow-x-hidden self-start transition-[width] duration-200 ease-smooth ${
						collapsed ? 'px-2.5' : 'px-3'
					}`}>
					{!collapsed && (
						<div className="text-[10px] font-black text-muted-3 tracking-[.09em] px-3 pt-1 pb-2">
							WORKSPACE
						</div>
					)}

					<div className={collapsed ? 'flex flex-col gap-2' : 'flex flex-col gap-1'}>
						{NAV.map((item) => navItem(item, { rail: collapsed }))}
					</div>

					<div className="flex-1" />

					{!collapsed && (
						<div className="mx-1 mb-2 rounded border border-line bg-surface p-3">
							<div className="flex items-center gap-2">
								<span className="w-1.5 h-1.5 rounded-full bg-ok" />
								<span className="text-[10.5px] font-black text-body-3 tracking-[.06em]">
									CONNECTED TO ZOHO
								</span>
							</div>
						</div>
					)}

					<button
						onClick={toggleCollapsed}
						title={collapsed ? 'Expand menu' : 'Collapse menu'}
						aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
						className={`flex items-center gap-2 rounded text-[12px] font-bold text-muted bg-transparent border-none cursor-pointer hover:bg-line-3 hover:text-body-2 ${
							collapsed ? 'justify-center w-10 h-10 mx-auto' : 'px-3 py-2'
						}`}>
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							className={`flex-shrink-0 transition-transform duration-200 ${
								collapsed ? 'rotate-180' : ''
							}`}>
							<path d="M15 18l-6-6 6-6" />
						</svg>
						{!collapsed && 'Collapse'}
					</button>
				</nav>

				{/* MAIN — keyed on the path so each page arrives with a short fade.

				    Deliberately not a scroll container: `overflow-x` here would
				    compute `overflow-y` to auto as well, making this the scrollport
				    for everything inside it, and any `position: sticky` descendant
				    would silently stop sticking. */}
				<main key={pathname} className="flex-1 min-w-0 animate-fade-in">
					<Outlet />
				</main>
			</div>
		</div>
	);
}
