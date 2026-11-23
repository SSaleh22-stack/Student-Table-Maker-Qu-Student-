/**
 * The Skia painter (P16): import everything from '@/notebook/ink'.
 *
 * RUNTIME RULE (react-native-skia #4339): every SkImage, SkPicture and SkParagraph below is created
 * on the JS runtime, given to <Canvas> as a prop or a shared value, and disposed on the JS runtime
 * with disposeLater once the canvas no longer draws it. Never create or dispose them in a worklet.
 *
 * Contract (shared plan "painter"):
 *   PaintContext { image(fileId), pdfPreview(fileId, pageIndex), fonts }
 *   drawItem(c, item, ctx, alpha)
 *   paintPage(c, page, ctx, { scale, dimAfter?, skipIds?, background? })
 *   buildPagePictures(page, ctx, { dimAfter?, skipIds?, background? }) -> { under, ink }
 *   appendStrokePicture(prev, item, ctx) -> SkPicture
 *   layoutText(item, fonts) -> { paragraphs, offsets, height, width }
 *   renderPageImage(session, pageId, widthPx) -> Promise<SkImage>
 *   pageThumb(session, pageId, widthPx) -> Promise<file uri>
 *   usePdfPreview(session, fileId, pageIndex, widthPx, onError?) -> SkImage | null
 *   usePdfTiles(session, fileId, pageIndex, options, onError?) -> { image, rect, key }[]
 *   useAssetImage(session, fileId, maxLongPx?) -> SkImage | null
 *   useNotebookFonts() -> SkTypefaceFontProvider | null
 */
export {
  ASSET_MAX_PX,
  assetImageDecoder,
  assetImageKey,
  decodeImageFile,
  fitLong,
  rasterize,
  toFileUri,
  useAssetImage,
} from './images';
export {
  IMAGE_BUDGET_BYTES,
  MAX_LIVE_TILES,
  budgetStats,
  disposeLater,
  disposeUnseen,
  dropImages,
  flushDisposals,
  holdImage,
  imageBytes,
  loadImage,
  onImageEvicted,
  peekImage,
  resetBudgetPeak,
  subscribeBudget,
  subscribeImage,
  trimImageBudget,
  type BudgetKind,
  type BudgetStats,
  type DisposableLike,
} from './imageBudget';
export { getNotebookFonts, loadNotebookFonts, useNotebookFonts } from './fonts';
export {
  EMPTY_PAINT_CONTEXT,
  IMAGE_PLACEHOLDER_FILL,
  drawItem,
  isHighlighterItem,
  strokeCommands,
  type PaintContext,
} from './items';
export { MAX_RENDER_PX, paintPage, renderPageImage, renderSize, type PaintPageOptions } from './paintPage';
export { PDF_PLACEHOLDER_FILL, drawImageFill, drawPdfImage, paintBackground, paintPaper, paintPdfPlaceholder } from './paper';
export {
  PREVIEW_MAX_PIXELS,
  acquirePdf,
  decodePdfPage,
  loadPdfPreview,
  loadPdfTile,
  pageRectToPdf,
  pdfPreviewDecoder,
  pdfPreviewKey,
  pdfPreviewWidth,
  pdfRotationOps,
  pdfRotationTransform,
  pdfSizeOf,
  pdfTileDecoder,
  pdfTileKey,
  pdfToPage,
  usePdfPreview,
  usePdfTiles,
  withPdf,
  type PdfRotation,
  type PdfTileImage,
  type PdfTilesOptions,
} from './pdfTiles';
export { THUMB_CONCURRENCY, dropPageThumbs, pageThumb, thumbFileName } from './pageThumbs';
export {
  DIM_ALPHA,
  HIGHLIGHTER_ALPHA,
  MAX_APPEND_DEPTH,
  appendDepth,
  appendStrokePicture,
  buildPagePictures,
  isDimmed,
  itemAlpha,
  paintHighlighterGroup,
  paintInkLayer,
  paintUnderLayer,
  recordPicture,
  type LayerOptions,
  type PagePictures,
} from './pictures';
export {
  TEXT_CACHE_MAX,
  TEXT_FALLBACK_DIR,
  buildTextLayout,
  forgetTextLayout,
  layoutText,
  measureTextHeight,
  paintTextLayout,
  renderTextImage,
  type TextLayout,
} from './textLayout';
