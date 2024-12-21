/** @type {import('tailwindcss').Config} */
import { iconsPlugin } from '@egoist/tailwindcss-icons';

export default {
  // darkMode: 'selector',
  content: ['./views/**/*.ejs'],
  theme: {
    extend: {
      colors: {
        bsky: '#0070ff',
      },
    },
  },
  plugins: [iconsPlugin()],
};
