/** @type {import('tailwindcss').Config} */
// Palette lifted from the Claude Design canvas (docs/design/LowStockItems.dc.html).
// Names describe role, not hue, so a future re-skin only touches this file.
module.exports = {
	content: ['./src/**/*.{js,jsx,ts,tsx}'],
	theme: {
		extend: {
			colors: {
				// Every colour resolves through a CSS custom property, so a theme is a
				// change of variables rather than a second set of classes. The
				// rgb(... / <alpha-value>) form is what keeps opacity modifiers such
				// as bg-brand-50/50 and bg-heading/35 working. Values live in
				// src/index.css.
				app: 'rgb(var(--c-app) / <alpha-value>)',
				surface: 'rgb(var(--c-surface) / <alpha-value>)',
				'surface-2': 'rgb(var(--c-surface-2) / <alpha-value>)',
				'surface-3': 'rgb(var(--c-surface-3) / <alpha-value>)',
				'surface-4': 'rgb(var(--c-surface-4) / <alpha-value>)',
				sidebar: 'rgb(var(--c-sidebar) / <alpha-value>)',
				line: 'rgb(var(--c-line) / <alpha-value>)',
				'line-2': 'rgb(var(--c-line-2) / <alpha-value>)',
				'line-3': 'rgb(var(--c-line-3) / <alpha-value>)',
				'line-4': 'rgb(var(--c-line-4) / <alpha-value>)',
				heading: 'rgb(var(--c-heading) / <alpha-value>)',
				body: 'rgb(var(--c-body) / <alpha-value>)',
				'body-2': 'rgb(var(--c-body-2) / <alpha-value>)',
				'body-3': 'rgb(var(--c-body-3) / <alpha-value>)',
				muted: 'rgb(var(--c-muted) / <alpha-value>)',
				'muted-2': 'rgb(var(--c-muted-2) / <alpha-value>)',
				'muted-3': 'rgb(var(--c-muted-3) / <alpha-value>)',
				'muted-4': 'rgb(var(--c-muted-4) / <alpha-value>)',
				brand: 'rgb(var(--c-brand) / <alpha-value>)',
				link: 'rgb(var(--c-link) / <alpha-value>)',
				'link-hover': 'rgb(var(--c-link-hover) / <alpha-value>)',
				'brand-bg': 'rgb(var(--c-brand-bg) / <alpha-value>)',
				'brand-border': 'rgb(var(--c-brand-border) / <alpha-value>)',
				'brand-50': 'rgb(var(--c-brand-50) / <alpha-value>)',
				'brand-100': 'rgb(var(--c-brand-100) / <alpha-value>)',
				'brand-200': 'rgb(var(--c-brand-200) / <alpha-value>)',
				'brand-300': 'rgb(var(--c-brand-300) / <alpha-value>)',
				'brand-400': 'rgb(var(--c-brand-400) / <alpha-value>)',
				'brand-500': 'rgb(var(--c-brand-500) / <alpha-value>)',
				'brand-600': 'rgb(var(--c-brand-600) / <alpha-value>)',
				'brand-700': 'rgb(var(--c-brand-700) / <alpha-value>)',
				'brand-800': 'rgb(var(--c-brand-800) / <alpha-value>)',
				'brand-900': 'rgb(var(--c-brand-900) / <alpha-value>)',
				ok: 'rgb(var(--c-ok) / <alpha-value>)',
				'ok-bg': 'rgb(var(--c-ok-bg) / <alpha-value>)',
				'ok-border': 'rgb(var(--c-ok-border) / <alpha-value>)',
				warn: 'rgb(var(--c-warn) / <alpha-value>)',
				'warn-2': 'rgb(var(--c-warn-2) / <alpha-value>)',
				'warn-bg': 'rgb(var(--c-warn-bg) / <alpha-value>)',
				'warn-border': 'rgb(var(--c-warn-border) / <alpha-value>)',
				danger: 'rgb(var(--c-danger) / <alpha-value>)',
				'danger-bg': 'rgb(var(--c-danger-bg) / <alpha-value>)',
				'danger-border': 'rgb(var(--c-danger-border) / <alpha-value>)',
				'row-selected': 'rgb(var(--c-row-selected) / <alpha-value>)',
			},
			fontFamily: {
				sans: ['Lato', 'system-ui', 'sans-serif'],
			},
			// Shadows are tinted with the page's blue-grey rather than pure black,
			// so a lifted surface reads as sitting on this background and not as a
			// grey haze over it.
			boxShadow: {
				// Defined in src/index.css so they can change with the theme. A
				// shadow tuned for a white page is nearly invisible on a dark one,
				// and on dark it wants to be black rather than blue-grey.
				card: 'var(--shadow-card)',
				'card-hover': 'var(--shadow-card-hover)',
				pop: 'var(--shadow-pop)',
				float: 'var(--shadow-float)',
				'inner-line': 'var(--shadow-inner-line)',
			},
			transitionTimingFunction: {
				// One easing curve for everything that moves: a gentle overshoot-free
				// ease-out that reads as responsive rather than floaty.
				smooth: 'cubic-bezier(.22,.61,.36,1)',
				spring: 'cubic-bezier(.34,1.56,.64,1)',
			},
			keyframes: {
				'fade-up': {
					from: { opacity: '0', transform: 'translateY(6px)' },
					to: { opacity: '1', transform: 'translateY(0)' },
				},
				'fade-in': {
					from: { opacity: '0' },
					to: { opacity: '1' },
				},
				'pop-in': {
					'0%': { opacity: '0', transform: 'scale(.94)' },
					'100%': { opacity: '1', transform: 'scale(1)' },
				},
				'slide-down': {
					from: { opacity: '0', transform: 'translateY(-6px) scale(.98)' },
					to: { opacity: '1', transform: 'translateY(0) scale(1)' },
				},
				'slide-up-in': {
					from: { opacity: '0', transform: 'translateY(14px)' },
					to: { opacity: '1', transform: 'translateY(0)' },
				},
				shimmer: {
					'100%': { transform: 'translateX(100%)' },
				},
				// A ring that expands and fades — used behind live activity dots.
				halo: {
					'0%': { transform: 'scale(.7)', opacity: '.55' },
					'70%,100%': { transform: 'scale(2.2)', opacity: '0' },
				},
				'bar-grow': {
					from: { transform: 'scaleX(0)' },
					to: { transform: 'scaleX(1)' },
				},
				'tick-draw': {
					from: { strokeDashoffset: '24' },
					to: { strokeDashoffset: '0' },
				},
			},
			animation: {
				'fade-up': 'fade-up .28s cubic-bezier(.22,.61,.36,1) both',
				'fade-in': 'fade-in .2s ease both',
				// Ease-out, not the spring: the spring's control point sits past 1,
				// so anything scaling on it overshoots and settles back, which
				// reads as a wobble rather than as bounce.
				'pop-in': 'pop-in .18s cubic-bezier(.22,.61,.36,1) both',
				'slide-down': 'slide-down .16s cubic-bezier(.22,.61,.36,1) both',
				'slide-up-in': 'slide-up-in .26s cubic-bezier(.22,.61,.36,1) both',
				shimmer: 'shimmer 1.6s infinite',
				halo: 'halo 1.8s cubic-bezier(0,0,.2,1) infinite',
				'bar-grow': 'bar-grow .5s cubic-bezier(.22,.61,.36,1) both',
				'tick-draw': 'tick-draw .3s cubic-bezier(.22,.61,.36,1) .05s both',
			},
		},
	},
	plugins: [],
};
