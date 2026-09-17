import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import StatusMenu from './StatusMenu';

const MENU_WIDTH = 190;

function Item({ icon, label, onClick, trailing, active }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] border-none cursor-pointer ${
				active ? 'bg-brand-bg text-link' : 'bg-transparent text-body hover:bg-surface-2'
			}`}>
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
				{icon}
			</svg>
			<span className="flex-1 truncate">{label}</span>
			{trailing}
		</button>
	);
}

/**
 * A row's "⋯" menu: View, Log call, and Change status as a submenu.
 *
 * Portalled to the body with fixed coordinates, because the table sits inside
 * a rounded container with overflow hidden — a menu drawn inside it would be
 * cut off at the table's edge on the last few rows.
 */
export default function PoRowActions({
	workflow,
	followup,
	isAdmin,
	busy,
	onView,
	onLogCall,
	onChangeStatus,
}) {
	const [open, setOpen] = useState(false);
	const [statusOpen, setStatusOpen] = useState(false);
	const [position, setPosition] = useState(null);
	const buttonRef = useRef(null);
	const menuRef = useRef(null);

	const close = () => {
		setOpen(false);
		setStatusOpen(false);
	};

	const toggle = (e) => {
		e.stopPropagation();
		if (open) {
			close();
			return;
		}
		const rect = buttonRef.current.getBoundingClientRect();
		const left = Math.max(
			8,
			Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8),
		);
		// Open upwards when there is not room for the menu below the row.
		const top =
			window.innerHeight - rect.bottom > 150 ? rect.bottom + 4 : rect.top - 128;
		setPosition({ top: Math.max(8, top), left });
		setOpen(true);
	};

	useEffect(() => {
		if (!open) return undefined;
		const onDown = (e) => {
			if (menuRef.current?.contains(e.target)) return;
			if (buttonRef.current?.contains(e.target)) return;
			close();
		};
		const onKey = (e) => {
			if (e.key === 'Escape') close();
		};
		// A fixed menu would float away from its row as the page scrolls, so a
		// scroll closes it instead.
		const onScroll = (e) => {
			if (menuRef.current?.contains(e.target)) return;
			close();
		};
		document.addEventListener('mousedown', onDown);
		document.addEventListener('keydown', onKey);
		window.addEventListener('scroll', onScroll, true);
		window.addEventListener('resize', close);
		return () => {
			document.removeEventListener('mousedown', onDown);
			document.removeEventListener('keydown', onKey);
			window.removeEventListener('scroll', onScroll, true);
			window.removeEventListener('resize', close);
		};
	}, [open]);

	return (
		<>
			<button
				ref={buttonRef}
				type="button"
				onClick={toggle}
				disabled={busy}
				aria-label="Actions"
				aria-haspopup="menu"
				aria-expanded={open}
				className={`w-8 h-8 rounded flex items-center justify-center border cursor-pointer disabled:opacity-40 ${
					open
						? 'bg-surface-2 border-line-2 text-heading'
						: 'bg-transparent border-transparent text-muted hover:bg-surface-2 hover:text-body-2'
				}`}>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
					<circle cx="5" cy="12" r="1.8" />
					<circle cx="12" cy="12" r="1.8" />
					<circle cx="19" cy="12" r="1.8" />
				</svg>
			</button>

			{open &&
				position &&
				createPortal(
					<div
						ref={menuRef}
						role="menu"
						onClick={(e) => e.stopPropagation()}
						className="fixed z-[90] animate-slide-down bg-surface border border-line-2 rounded shadow-pop py-1"
						style={{ top: position.top, left: position.left, width: MENU_WIDTH }}>
						<Item
							label="View"
							onClick={() => {
								close();
								onView();
							}}
							icon={
								<>
									<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
									<circle cx="12" cy="12" r="3" />
								</>
							}
						/>
						<Item
							label="Log call"
							onClick={() => {
								close();
								onLogCall();
							}}
							icon={
								<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
							}
						/>

						{/* The submenu opens to the left, where there is room: the menu
						    itself sits against the right edge of the table. The padded
						    wrapper bridges the gap so the pointer can cross into it. */}
						<div
							className="relative"
							onMouseEnter={() => setStatusOpen(true)}
							onMouseLeave={() => setStatusOpen(false)}>
							<Item
								label="Change status"
								active={statusOpen}
								onClick={() => setStatusOpen((v) => !v)}
								trailing={
									<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
										<path d="M9 18l6-6-6-6" />
									</svg>
								}
								icon={
									<>
										<path d="m16 3 4 4-4 4" />
										<path d="M20 7H4" />
										<path d="m8 21-4-4 4-4" />
										<path d="M4 17h16" />
									</>
								}
							/>
							{statusOpen && (
								<div className="absolute top-0 right-full pr-1">
									<div className="animate-slide-down bg-surface border border-line-2 rounded shadow-pop">
										<StatusMenu
											workflow={workflow}
											currentStatusId={followup?.statusId ?? null}
											isAdmin={isAdmin}
											busy={busy}
											onPick={(statusId, force) => {
												close();
												onChangeStatus(statusId, force);
											}}
										/>
									</div>
								</div>
							)}
						</div>
					</div>,
					document.body,
				)}
		</>
	);
}
