/**
 * Stage colours for the purchase-order pipeline.
 *
 * Stored as names, never hex, so the database says "teal" and this file
 * decides what teal looks like. Only the dot carries the colour: the pill
 * around a stage name stays on the neutral surface tokens, so every stage
 * reads correctly in both themes without a dark-mode copy of twelve hues.
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

export const toneDot = (tone) => resolveTone(tone).dot;
