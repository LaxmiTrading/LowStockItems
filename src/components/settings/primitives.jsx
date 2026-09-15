// The shared furniture of the Settings page.
//
// Pulled out of SettingsPage.jsx once cards started living in their own files:
// importing them back from the page would have made a cycle, and copying them
// would have let the two drift apart.

export const field =
	'w-full h-9 border border-line-2 rounded px-3 text-[13.5px] bg-surface text-body outline-none transition-colors focus:border-muted-3';

export function Card({ title, hint, children }) {
	return (
		<div className="bg-surface border border-line rounded p-4 sm:p-5 mb-4 max-w-[760px]">
			<div className="text-[14px] font-black text-heading">{title}</div>
			{hint && (
				<p className="text-[12.5px] text-muted-2 mt-1 mb-4 leading-relaxed">
					{hint}
				</p>
			)}
			{children}
		</div>
	);
}

export function Notice({ tone = 'ok', children }) {
	if (!children) return null;
	const tones = {
		ok: 'bg-ok-bg border-ok-border text-ok',
		error: 'bg-danger-bg border-danger-border text-danger',
	};
	return (
		<div
			role="status"
			className={`px-3 py-2.5 rounded border text-[12.5px] font-bold mb-3 animate-fade-in ${tones[tone]}`}>
			{children}
		</div>
	);
}
