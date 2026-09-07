export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        accent: "var(--accent-color)",
      },
      // The corner language, defined once. These map Tailwind's stock scale
      // onto --radius-* tokens in globals.css, so retuning every card, control,
      // panel and dialog in the app is an edit to those four variables rather
      // than a sweep across ~900 call sites.
      //
      // `sm` and `full` are deliberately NOT remapped: `sm` is the chat-bubble
      // tail (globals.css `@apply rounded-2xl rounded-tr-sm`) and `full` is
      // pills/avatars. Both are already consistent and neither is a surface.
      //
      // Note `2xl` is shared by section panels AND those same bubble rules, so
      // it is pinned at its stock 16px; prefer --radius-card for card tuning.
      borderRadius: {
        md: "var(--radius-control)",
        lg: "var(--radius-control)",
        xl: "var(--radius-card)",
        "2xl": "var(--radius-panel)",
        "3xl": "var(--radius-dialog)",
      },
      fontFamily: {
        // Defer to --app-font-family so `font-sans` matches what <body> actually
        // renders. globals.css swaps that token per platform (Noto Sans on
        // Linux); hardcoding the Apple stack here meant the utility and the body
        // could resolve to two different fonts on non-Apple platforms.
        sans: ["var(--app-font-family)"],
        mono: ["JetBrains Mono", "Fira Code", "Menlo", "monospace"],
      },
    },
  },
  plugins: [
    require("@tailwindcss/typography"),
  ],
}
