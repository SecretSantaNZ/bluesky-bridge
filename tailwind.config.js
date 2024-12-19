/** @type {import('tailwindcss').Config} */
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
  plugins: [],
};
