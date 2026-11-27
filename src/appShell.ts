// Make the webview behave like a desktop app, not a browser page: no
// browser context menu (except in text fields, for copy/paste), no print /
// reload / devtools shortcuts. Development builds keep them for debugging.

const EDITABLE = "input, textarea, [contenteditable=true]";

export function installAppShell() {
  // Ctrl+F: our own search box instead of the browser's find bar
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === "f") {
      e.preventDefault();
      document.querySelector<HTMLInputElement>("header input")?.focus();
    }
  });

  if (!import.meta.env.PROD) return;

  window.addEventListener("contextmenu", (e) => {
    if (!(e.target as Element | null)?.closest?.(EDITABLE)) e.preventDefault();
  });
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    const blocked =
      k === "f5" ||
      k === "f12" ||
      k === "f7" || // caret browsing
      (mod && (k === "p" || k === "r" || k === "u" || k === "s")) ||
      (mod && e.shiftKey && (k === "i" || k === "j" || k === "c"));
    if (blocked) e.preventDefault();
  });
}
