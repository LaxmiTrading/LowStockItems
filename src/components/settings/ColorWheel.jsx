import { useEffect, useRef, useState } from 'react';

/**
 * A colour wheel: hue around the rim, saturation from the centre out, and
 * brightness on a slider beneath — HSV, which is how people describe picking a
 * colour ("that blue, but paler, and darker"). The value in and out is a
 * lowercase #rrggbb.
 *
 * Drawn with CSS gradients rather than a canvas, so it is crisp at any pixel
 * ratio and there is no drawing code to keep in step with the maths below.
 */

const SIZE = 168;

function hexToHsv(hex) {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
	if (!m) return { h: 0, s: 0, v: 1 };
	const n = parseInt(m[1], 16);
	const r = ((n >> 16) & 255) / 255;
	const g = ((n >> 8) & 255) / 255;
	const b = (n & 255) / 255;
	const max = Math.max(r, g, b);
	const d = max - Math.min(r, g, b);
	let h = 0;
	if (d) {
		if (max === r) h = ((g - b) / d) % 6;
		else if (max === g) h = (b - r) / d + 2;
		else h = (r - g) / d + 4;
		h *= 60;
		if (h < 0) h += 360;
	}
	return { h, s: max ? d / max : 0, v: max };
}

export function hsvToHex({ h, s, v }) {
	const f = (k) => {
		const x = (k + h / 60) % 6;
		return v - v * s * Math.max(0, Math.min(x, 4 - x, 1));
	};
	const byte = (x) =>
		Math.round(x * 255)
			.toString(16)
			.padStart(2, '0');
	return `#${byte(f(5))}${byte(f(3))}${byte(f(1))}`;
}

export default function ColorWheel({ value, onChange }) {
	// Held as HSV rather than derived from `value` each render: a hex cannot
	// carry the hue of a grey or of black, so the marker would jump to red the
	// moment saturation or brightness reached zero.
	const [hsv, setHsv] = useState(() => hexToHsv(value));
	const [draft, setDraft] = useState(value ?? '');
	const wheelRef = useRef(null);
	const lastEmitted = useRef(value);

	// A value set from outside — a swatch picked above the wheel — re-seeds it.
	useEffect(() => {
		if (value === lastEmitted.current) return;
		lastEmitted.current = value;
		setHsv(hexToHsv(value));
		setDraft(value ?? '');
	}, [value]);

	const emit = (next) => {
		setHsv(next);
		const hex = hsvToHex(next);
		setDraft(hex);
		lastEmitted.current = hex;
		onChange(hex);
	};

	const pickAt = (clientX, clientY) => {
		const box = wheelRef.current.getBoundingClientRect();
		const dx = clientX - (box.left + box.width / 2);
		const dy = clientY - (box.top + box.height / 2);
		// Clockwise from twelve o'clock, which is where conic-gradient starts.
		const h = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
		const s = Math.min(1, Math.hypot(dx, dy) / (box.width / 2));
		// Picking on the wheel at zero brightness would change nothing visible,
		// so it lifts brightness back to full.
		emit({ h, s, v: hsv.v < 0.05 ? 1 : hsv.v });
	};

	const onPointerDown = (e) => {
		e.preventDefault();
		e.currentTarget.setPointerCapture(e.pointerId);
		pickAt(e.clientX, e.clientY);
	};

	const onPointerMove = (e) => {
		if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
		pickAt(e.clientX, e.clientY);
	};

	// Arrow keys: left and right turn the hue, up and down move saturation.
	const onKeyDown = (e) => {
		const step = e.shiftKey ? 10 : 2;
		const moves = {
			ArrowLeft: { h: (hsv.h - step + 360) % 360 },
			ArrowRight: { h: (hsv.h + step) % 360 },
			ArrowUp: { s: Math.min(1, hsv.s + step / 100) },
			ArrowDown: { s: Math.max(0, hsv.s - step / 100) },
		};
		if (!moves[e.key]) return;
		e.preventDefault();
		emit({ ...hsv, ...moves[e.key] });
	};

	const commitDraft = (text) => {
		const hex = text.trim().toLowerCase().replace(/^#?/, '#');
		if (/^#[0-9a-f]{6}$/.test(hex)) emit(hexToHsv(hex));
	};

	const radius = SIZE / 2;
	const angle = (hsv.h * Math.PI) / 180;
	const markerX = radius + Math.sin(angle) * hsv.s * radius;
	const markerY = radius - Math.cos(angle) * hsv.s * radius;
	const current = hsvToHex(hsv);
	const fullBright = hsvToHex({ ...hsv, v: 1 });

	return (
		<div className="flex flex-col items-center gap-3" style={{ width: SIZE }}>
			<div
				ref={wheelRef}
				role="slider"
				tabIndex={0}
				aria-label="Hue and saturation"
				aria-valuemin={0}
				aria-valuemax={360}
				aria-valuenow={Math.round(hsv.h)}
				aria-valuetext={current}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onKeyDown={onKeyDown}
				className="relative rounded-full cursor-crosshair touch-none outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
				style={{
					width: SIZE,
					height: SIZE,
					background:
						'radial-gradient(circle closest-side, #fff, rgb(255 255 255 / 0)), ' +
						'conic-gradient(#f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
				}}>
				{/* Brightness darkens the whole wheel, so what is under the marker
				    is the colour that will be saved. */}
				<div
					className="absolute inset-0 rounded-full pointer-events-none"
					style={{ background: '#000', opacity: 1 - hsv.v }}
				/>
				<span
					className="absolute w-4 h-4 -ml-2 -mt-2 rounded-full border-2 border-white pointer-events-none"
					style={{
						left: markerX,
						top: markerY,
						background: current,
						boxShadow: '0 0 0 1px rgb(0 0 0 / 0.35), 0 1px 3px rgb(0 0 0 / 0.4)',
					}}
				/>
			</div>

			<input
				type="range"
				min={0}
				max={100}
				value={Math.round(hsv.v * 100)}
				onChange={(e) => emit({ ...hsv, v: Number(e.target.value) / 100 })}
				aria-label="Brightness"
				className="w-full h-3 rounded-full appearance-none cursor-pointer colour-slider"
				style={{ background: `linear-gradient(to right, #000, ${fullBright})` }}
			/>

			<div className="w-full flex items-center gap-2">
				<span
					className="w-7 h-7 rounded flex-shrink-0 border border-line-2"
					style={{ background: current }}
				/>
				<input
					value={draft}
					onChange={(e) => {
						setDraft(e.target.value);
						commitDraft(e.target.value);
					}}
					onBlur={() => setDraft(current)}
					maxLength={7}
					spellCheck={false}
					aria-label="Hex colour"
					className="flex-1 min-w-0 h-7 rounded border border-line-2 px-2 text-[12.5px] num bg-surface text-body outline-none focus:border-brand uppercase"
				/>
			</div>
		</div>
	);
}
