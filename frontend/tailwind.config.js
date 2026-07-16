/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Brand palette from spec §9
        background: "#13111C",
        "brand-purple": "#7C3AED",
        "brand-blue": "#2563EB",
        "glass-bg": "rgba(255,255,255,0.05)",
        "glass-border": "rgba(255,255,255,0.08)",
        "text-muted": "rgba(248,250,252,0.35)",
      },
      fontFamily: {
        sans: ["Inter", "System"],
      },
    },
  },
  plugins: [],
};
