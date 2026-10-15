// 全画面の切り替え。ブラウザの標準ショートカットは環境ごとに違う（Chrome の Mac は Cmd+Ctrl+F など）ので、
// アプリ側でも Cmd/Ctrl+Shift+F と F11 で切り替えられるようにする。ボタンからも呼ぶ。

export function isFullscreen(): boolean {
  return Boolean(document.fullscreenElement);
}

export async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else
      await document.documentElement.requestFullscreen({
        navigationUI: "hide",
      });
  } catch {
    // 全画面を許可しない環境（iframe など）では何もしない
  }
}

/** Cmd/Ctrl+Shift+F、または F11 か。 */
export function isFullscreenShortcut(event: KeyboardEvent): boolean {
  if (event.key === "F11") return true;
  return (
    (event.metaKey || event.ctrlKey) &&
    event.shiftKey &&
    event.key.toLowerCase() === "f"
  );
}
