/** RIPPLE design tokens live in src/styles/tokens.css; Tailwind maps to those variables. */
const rgb = (v) => `rgb(var(${v}) / <alpha-value>)`
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: rgb('--c-bg'),
        sidebar: rgb('--c-sidebar'),
        card: rgb('--c-card'),
        elevated: rgb('--c-elevated'),
        ink: {
          DEFAULT: rgb('--c-ink'),
          2: rgb('--c-ink-2'),
          3: rgb('--c-ink-3'),
          4: rgb('--c-ink-4'),
        },
        accent: { DEFAULT: rgb('--c-accent'), soft: rgb('--c-accent-soft'), deep: rgb('--c-accent-deep') },
        magenta: { DEFAULT: rgb('--c-magenta'), soft: rgb('--c-magenta-soft') },
        amber: { DEFAULT: rgb('--c-amber') },
        sev: {
          critical: rgb('--sev-critical'),
          high: rgb('--sev-high'),
          medium: rgb('--sev-medium'),
          low: rgb('--sev-low'),
          info: rgb('--sev-info'),
        },
        ok: rgb('--c-ok'),
      },
      borderColor: {
        hair: 'var(--line)',
        'hair-strong': 'var(--line-strong)',
      },
      borderRadius: { r1: '8px', r2: '12px', r3: '16px', r4: '20px', r5: '24px' },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        pop: 'var(--shadow-pop)',
        focus: 'var(--shadow-focus)',
      },
      transitionTimingFunction: { ripple: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      transitionDuration: { micro: '180ms', comp: '280ms', page: '420ms', hero: '650ms' },
    },
  },
  plugins: [],
}
