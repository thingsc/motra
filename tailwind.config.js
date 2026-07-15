/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/renderer/index.html',
    './src/renderer/scope.html',
    './src/renderer/src/**/*.{ts,tsx}'
  ],
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
        danger: '#f85149',
        // 虚拟示波器(scope 窗口)专用
        scope: {
          ch1: '#58a6ff',
          ch2: '#f0883e',
          ch3: '#a371f7',
          ch4: '#3fb950',
          ch5: '#f778ba',
          ch6: '#ffd33d',
          ch7: '#76e3ea',
          ch8: '#e85a72',
          grid: '#21262d',
          axis: '#7d8590'
        }
      }
    }
  },
  plugins: []
}
