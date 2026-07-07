(() => {
  const theme = document.createElement("style");
  theme.id = "agenda-ohif-theme";
  theme.textContent = `
  :root, .dark {
    --highlight: 174 56% 49% !important;
    --background: 192 53% 7% !important;
    --foreground: 177 29% 91% !important;
    --card: 190 44% 13% !important;
    --card-foreground: 177 29% 91% !important;
    --popover: 190 44% 13% !important;
    --popover-foreground: 177 29% 91% !important;
    --primary: 174 71% 42% !important;
    --primary-foreground: 192 53% 7% !important;
    --secondary: 183 60% 15% !important;
    --secondary-foreground: 177 29% 91% !important;
    --muted: 189 37% 19% !important;
    --muted-foreground: 180 15% 60% !important;
    --accent: 183 60% 15% !important;
    --accent-foreground: 177 29% 91% !important;
    --border: 189 37% 19% !important;
    --input: 192 48% 9% !important;
    --ring: 174 56% 49% !important;
    --neutral: 180 15% 60% !important;
    --neutral-light: 177 29% 91% !important;
    --neutral-dark: 189 37% 19% !important;
  }
  html, body, #root { background: #09191d !important; }
  [class~="bg-bkg-low"] { background-color: #09191d !important; }
  [class~="bg-bkg-med"] { background-color: #0b2025 !important; }
  [class~="bg-bkg-full"] { background-color: #0f3a3d !important; }
  [class~="bg-actions-primary"] { background-color: #1fb6a6 !important; }
  [class~="text-actions-primary"] { color: #35c3b5 !important; }
  [class~="text-actions-highlight"] { color: #8adbd3 !important; }
  [class~="text-info-primary"] { color: #e2efee !important; }
  [class~="text-info-secondary"] { color: #8aa8a8 !important; }
  [class~="border-actions-primary"], [class~="border-actions-highlight"] { border-color: #35c3b5 !important; }
  [class~="bg-customblue-10"], [class~="bg-customblue-20"] { background-color: #09191d !important; }
  [class~="bg-customblue-30"], [class~="bg-customblue-300"] { background-color: #12292e !important; }
  [class~="bg-customblue-40"], [class~="bg-customblue-50"] { background-color: #0f3a3d !important; }
  [class~="bg-customblue-80"] { background-color: #128577 !important; }
  [class~="text-customblue-100"], [class~="text-customblue-200"], [class~="text-customblue-400"] { color: #8adbd3 !important; }
  [class~="border-customblue-100"], [class~="border-customblue-200"], [class~="border-customblue-300"] { border-color: #1e5a5c !important; }
  [class~="bg-primary-dark"] { background-color: #081418 !important; }
  [class~="bg-primary-main"] { background-color: #0f3a3d !important; }
  [class~="bg-primary-light"] { background-color: #8adbd3 !important; }
  [class~="bg-primary-active"] { background-color: #35c3b5 !important; }
  [class~="bg-secondary-dark"] { background-color: #09191d !important; }
  [class~="bg-secondary-main"] { background-color: #0f3a3d !important; }
  [class~="bg-secondary-light"] { background-color: #1e5a5c !important; }
  [class~="bg-secondary-active"] { background-color: #12292e !important; }
  [class~="bg-indigo-dark"] { background-color: #0b2025 !important; }
  [class~="text-primary-light"], [class~="text-aqua-pale"] { color: #8adbd3 !important; }
  [class~="text-primary-main"], [class~="text-primary-active"] { color: #35c3b5 !important; }
  [class~="border-primary-main"], [class~="border-primary-light"], [class~="border-secondary-light"] { border-color: #1e5a5c !important; }
  [class~="hover:bg-primary-main"]:hover { background-color: #128577 !important; }
  [class~="hover:text-primary-light"]:hover { color: #e2efee !important; }
  * { scrollbar-color: #1e5a5c #09191d; }
`;
  document.head.appendChild(theme);
})();

window.config = {
  extensions: [],
  modes: [],
  investigationalUseDialog: { option: "never" },
  whiteLabeling: {
    createLogoComponentFn: function (React) {
      return React.createElement("span", {
        style: {
          color: "#35c3b5",
          fontSize: "13px",
          fontWeight: 800,
          letterSpacing: "0.08em",
          whiteSpace: "nowrap",
        },
      }, "PACS · IMAGENOLOGÍA");
    },
  },
};
