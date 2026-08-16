/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./client/index.html', './client/src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#0f1117',
          soft: '#161a23',
          card: '#1c212e',
          border: '#2a3142',
        },
        accent: {
          DEFAULT: '#6366f1',
          soft: '#818cf8',
        },
      },
    },
  },
  plugins: [],
};
