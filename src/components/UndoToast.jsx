import { useState, useEffect, useRef } from 'react';

/**
 * Decision toast, per the design reference: a dark card with a green tick, the
 * action in progress, a live "Applying in Ns" countdown, an Undo button, and a
 * green bar draining along the bottom for the life of the window.
 *
 * The bar is CSS so it stays smooth; only the seconds readout is state.
 */
export default function UndoToast({ label, duration = 5000, onUndo, onExpire }) {
	const [remaining, setRemaining] = useState(Math.ceil(duration / 1000));
	const expireRef = useRef(onExpire);
	expireRef.current = onExpire;

	useEffect(() => {
		const started = Date.now();

		const tick = setInterval(() => {
			const left = Math.ceil((duration - (Date.now() - started)) / 1000);
			setRemaining(left > 0 ? left : 0);
		}, 200);

		const done = setTimeout(() => expireRef.current?.(), duration);

		return () => {
			clearInterval(tick);
			clearTimeout(done);
		};
	}, [duration]);

	return (
		<div
			role="status"
			className="toast-rise relative overflow-hidden rounded shadow-[0_14px_38px_rgb(var(--c-shadow)/0.45)] w-[380px]"
			style={{ background: 'rgb(var(--c-toast-bg))' }}>
			<div className="flex items-center gap-3 px-4 py-3.5">
				<span
					className="w-7 h-7 rounded flex items-center justify-center flex-shrink-0 bg-ok">
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3">
						<path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
					</svg>
				</span>

				<span className="flex-1 min-w-0">
					<span className="block text-[13.5px] font-black text-[rgb(var(--c-toast-fg))] truncate">
						{label}
					</span>
					<span
						className="block text-[11.5px] mt-0.5 num"
						style={{ color: 'rgb(var(--c-toast-muted))' }}>
						Applying in {remaining}s
					</span>
				</span>

				<button
					onClick={onUndo}
					className="flex-shrink-0 h-8 px-3.5 rounded bg-white/5 text-white font-black text-[12.5px] cursor-pointer hover:bg-white/15 hover:border-white/40 transition-colors"
					style={{ border: '1px solid #3a424c' }}>
					Undo
				</button>
			</div>

			<div
				className="toast-drain absolute bottom-0 left-0 h-[3px] w-full bg-ok"
				style={{ animationDuration: `${duration}ms` }}
			/>
		</div>
	);
}
