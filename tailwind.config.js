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
          base: '#11110f',
          panel: '#171714',
          raised: '#22221f',
          hover: '#2c2c28'
        },
        line: '#373733',
        fg: {
          base: '#ecebe7',
          muted: '#999892',
          subtle: '#6f6e69'
        },
        accent: {
          DEFAULT: '#55c2d8',
          hover: '#72d2e3'
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
