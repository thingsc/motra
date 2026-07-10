/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Motra / VSCode-style dark palette
        bg: {
          base: '#0d1117',
          panel: '#161b22',
          raised: '#1f262e',
          hover: '#262d36'
        },
        line: '#30363d',
        fg: {
          base: '#e6edf3',
          muted: '#7d8590',
          subtle: '#6e7681'
        },
        accent: {
          DEFAULT: '#3fb950',
          hover: '#2ea043'
        },
        danger: '#f85149'
      }
    }
  },
  plugins: []
}
