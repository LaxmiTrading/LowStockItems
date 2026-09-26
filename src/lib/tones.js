/**
 * Stage colours for the purchase-order pipeline.
 *
 * Usually a name — the database says "teal" and this file decides what teal
 * looks like. A stage can also carry a custom #rrggbb picked on the colour
 * wheel (migration 0008). Only the dot carries the colour either way: the pill
 * around a stage name stays on the neutral surface tokens, so every stage
 * reads in both themes.
 *
 * A dot needs both toneDot (the class, for a palette name) and toneStyle (the
 * inline colour, for a custom one); each is empty for the other kind.
 *
 * Class strings are written out in full so Tailwind's compiler finds them.
 */

export const PALETTE = [
	{ id: 'slate', label: 'Slate', dot: 'bg-slate-400' },
	{ id: 'red', label: 'Red', dot: 'bg-red-500' },
	{ id: 'orange', label: 'Orange', dot: 'bg-orange-500' },
	{ id: 'amber', label: 'Amber', dot: 'bg-amber-500' },
	{ id: 'yellow', label: 'Yellow', dot: 'bg-yellow-400' },
	{ id: 'green', label: 'Green', dot: 'bg-green-500' },
	{ id: 'teal', label: 'Teal', dot: 'bg-teal-500' },
	{ id: 'cyan', label: 'Cyan', dot: 'bg-cyan-500' },
	{ id: 'blue', label: 'Blue', dot: 'bg-blue-500' },
	{ id: 'indigo', label: 'Indigo', dot: 'bg-indigo-500' },
	{ id: 'violet', label: 'Violet', dot: 'bg-violet-500' },
	{ id: 'pink', label: 'Pink', dot: 'bg-pink-500' },
];

// The role names the first version stored, before stages had colours.
const LEGACY = {
	neutral: 'slate',
	brand: 'blue',
	ok: 'green',
	warn: 'amber',
	danger: 'red',
};

const BY_ID = Object.fromEntries(PALETTE.map((p) => [p.id, p]));

export const resolveTone = (tone) => BY_ID[LEGACY[tone] ?? tone] ?? BY_ID.slate;

const HEX_RE = /^#[0-9a-f]{6}$/i;

export const isCustomTone = (tone) =>
	typeof tone === 'string' && HEX_RE.test(tone);

/** A palette id, or a custom colour in the lowercase form the server stores. */
export const normaliseTone = (tone) =>
	isCustomTone(tone) ? tone.toLowerCase() : resolveTone(tone).id;

export const toneDot = (tone) => (isCustomTone(tone) ? '' : resolveTone(tone).dot);

export const toneStyle = (tone) =>
	isCustomTone(tone) ? { backgroundColor: tone } : undefined;
