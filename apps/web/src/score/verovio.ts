import { parseTimemap, type TimemapEntry } from "./timemap";

type Toolkit = {
  destroy: () => void;
  getPageCount: () => number;
  loadData: (data: string) => boolean;
  renderToSVG: (page: number) => string;
  renderToTimemap: () => unknown;
  setOptions: (options: Record<string, unknown>) => void;
};

type RenderedScore = { svg: string; timemap: TimemapEntry[] };

let toolkitPromise: Promise<Toolkit> | undefined;

async function getToolkit(): Promise<Toolkit> {
  if (!toolkitPromise) {
    toolkitPromise = Promise.all([
      import("verovio/wasm"),
      import("verovio/esm"),
    ]).then(async ([wasm, esm]) => {
      const module = await wasm.default();
      return new esm.VerovioToolkit(module) as Toolkit;
    });
  }
  return toolkitPromise;
}

/** MusicXML を横長の 1 段 SVG と、その時間対応表に描画する。 */
/** 楽譜の描画エンジンを先に読み込んでおく（課題が届いたときに「準備中」を見せないため）。 */
export function preloadVerovio(): void {
  void getToolkit().catch(() => undefined);
}

export async function renderMusicXml(source: string): Promise<RenderedScore> {
  const toolkit = await getToolkit();
  toolkit.setOptions({
    adjustPageHeight: true,
    breaks: "none",
    footer: "none",
    header: "none",
    pageHeight: 340,
    pageWidth: 3600,
    scale: 60,
    spacingLinear: 0.85,
  });
  if (!toolkit.loadData(source))
    throw new Error("MusicXML を読み込めませんでした。");
  const pages = Math.max(1, toolkit.getPageCount());
  const svg = Array.from({ length: pages }, (_, index) =>
    toolkit.renderToSVG(index + 1),
  ).join("");
  return { svg, timemap: parseTimemap(toolkit.renderToTimemap()) };
}
