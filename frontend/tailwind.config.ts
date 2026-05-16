import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: '#0f172a',
        accent: '#2563eb',
      },
    },
  },
  plugins: [],
} satisfies Config;
