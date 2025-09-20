/** @type {import('tailwindcss').Config} */
import plugin from 'tailwindcss/plugin.js';
import { iconsPlugin } from '@egoist/tailwindcss-icons';

export default {
  // darkMode: 'selector',
  content: ['./views/**/*.ejs', './views/**/*.njk'],
  theme: {
    extend: {
      colors: {
        bsky: '#0070ff',
      },
    },
  },
  plugins: [
    iconsPlugin(),
    plugin(function ({ addVariant }) {
      addVariant('htmx-request', [
        '&.htmx-request',
        '.htmx-request &',
        '&[aria-busy]',
        '[aria-busy] &',
      ]);
    }),
  ],
};
