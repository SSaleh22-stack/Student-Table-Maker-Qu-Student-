import CoreGraphics
import ExpoModulesCore
import Foundation
import PDFKit
import UIKit

/// renderRegion's argument (NativeRegionRequest in PdfRender.types.ts).
struct RegionRequest: Record {
  @Field var handle: String = ""
  @Field var page: Int = 0
  @Field var x: Double = 0
  @Field var y: Double = 0
  @Field var w: Double = 0
  @Field var h: Double = 0
  @Field var widthPx: Int = 0
  @Field var heightPx: Int = 0
  @Field var outPath: String = ""
  @Field var format: String = "png"
  @Field var quality: Double?
}

/// renderPage's argument (NativePageRequest in PdfRender.types.ts).
struct PageRequest: Record {
  @Field var handle: String = ""
  @Field var page: Int = 0
  @Field var widthPx: Int = 0
  @Field var outPath: String = ""
  @Field var format: String = "png"
  @Field var quality: Double?
}

/**
 PDF rendering with PDFKit for the notebook (P10). Contract: modules/pdf-render/src/PdfRender.types.ts.

 THREADING (the reason for this design): PDFDocument and PDFPage are not safe to use from two threads
 at once, and the canvas asks for many tiles at the same time. Every AsyncFunction therefore runs on
 ONE serial queue, `queue` ('net.qustudent.pdf'), via .runOnQueue(queue): its whole body, every
 PDFKit call in it and the promise resolve or reject all happen there, one call after another. The
 document store is touched only on that queue. The two sync functions (lastRenderCrash,
 clearRenderCrash) run on the JavaScript thread and touch only the journal files, under the
 journal's lock; they never touch PDFKit.

 CRASH JOURNAL: renderRegion, renderPage and probe write {path, page} to the journal before any PDFKit
 work for that page and remove it when they return (RenderJournal.swift).

 ERRORS: every failure rejects with one of the ERR_PDF_* codes; there are no force unwraps, and
 unexpected Swift errors become ERR_PDF_IO.

 GEOMETRY: page points as DISPLAYED (crop box, /Rotate applied), origin top-left, y down. Bitmaps are
 opaque and pre-filled white, at scale 1 (one bitmap pixel per requested pixel).
 */
public final class PdfRenderModule: Module {
  /// Process-wide, so even two module instances (a JavaScript reload in a development build) never
  /// run PDFKit at the same time.
  private static let sharedQueue = DispatchQueue(label: "net.qustudent.pdf", qos: .userInitiated)
  private let queue = PdfRenderModule.sharedQueue
  /// Only on `queue`.
  private let store = PdfDocumentStore()
  /// Created with the module, so a crash entry from the previous run is set aside before any render.
  private let journal = RenderJournal()

  /// Largest bitmap side and area accepted (a bigger request rejects ERR_PDF_IO, "out of memory").
  private static let maxSidePx = 8192
  private static let maxAreaPx = 32 * 1024 * 1024
  /// Width of the throwaway bitmap probe() draws.
  private static let probeWidthPx = 32

  public func definition() -> ModuleDefinition {
    Name("PdfRender")

    AsyncFunction("inspect") { (path: String, promise: Promise) in
      self.settle(promise) {
        let url = try PdfPaths.fileURL(path)
        guard FileManager.default.fileExists(atPath: url.path) else {
          throw PdfRenderError.io("No file at \(url.lastPathComponent)")
        }
        guard let document = PDFDocument(url: url) else {
          throw PdfRenderError.damaged("Not a readable PDF: \(url.lastPathComponent)")
        }
        let locked = document.isLocked
        return [
          "pageCount": locked ? 0 : document.pageCount,
          "encrypted": document.isEncrypted || locked,
          "needsPassword": locked,
        ] as [String: Any]
      }
    }
    .runOnQueue(queue)

    AsyncFunction("open") { (path: String, password: String?, promise: Promise) in
      self.settle(promise) {
        let url = try PdfPaths.fileURL(path)
        let opened = try self.store.open(url: url, password: password)
        return ["handle": opened.handle, "pageCount": opened.document.pageCount] as [String: Any]
      }
    }
    .runOnQueue(queue)

    AsyncFunction("pageSizes") { (handle: String, from: Int, count: Int, promise: Promise) in
      self.settle(promise) {
        let document = try self.store.document(for: handle)
        let start = max(0, from)
        let end = min(document.pageCount, start + max(0, count))
        var sizes: [[String: Any]] = []
        if start < end {
          for index in start..<end {
            sizes.append(self.sizeInfo(document, index))
          }
        }
        return sizes
      }
    }
    .runOnQueue(queue)

    AsyncFunction("renderRegion") { (req: RegionRequest, promise: Promise) in
      self.settle(promise) {
        let region = CGRect(x: req.x, y: req.y, width: req.w, height: req.h)
        guard region.minX.isFinite, region.minY.isFinite, region.width.isFinite, region.height.isFinite,
          region.width > 0, region.height > 0
        else {
          throw PdfRenderError.io("Bad region")
        }
        return try self.render(
          handle: req.handle, page: req.page, region: region, widthPx: req.widthPx, heightPx: req.heightPx,
          outPath: req.outPath, format: req.format, quality: req.quality)
      }
    }
    .runOnQueue(queue)

    AsyncFunction("renderPage") { (req: PageRequest, promise: Promise) in
      self.settle(promise) {
        return try self.render(
          handle: req.handle, page: req.page, region: nil, widthPx: req.widthPx, heightPx: nil,
          outPath: req.outPath, format: req.format, quality: req.quality)
      }
    }
    .runOnQueue(queue)

    AsyncFunction("probe") { (handle: String, page: Int, promise: Promise) in
      self.settle(promise) {
        let url = try self.store.url(for: handle)
        self.journal.begin(path: url.absoluteString, page: page)
        defer { self.journal.end() }
        let document = try self.store.document(for: handle)
        let (pdfPage, size) = try self.page(document, page)
        let width = PdfRenderModule.probeWidthPx
        // Clamped: a freakishly tall page must not turn the tiny probe into a huge bitmap.
        let height = min(PdfRenderModule.maxSidePx, PdfRenderModule.heightFor(width: width, size: size))
        // Drawn and thrown away: only whether PDFKit gets through the page matters.
        _ = self.draw(pdfPage, displayed: size, region: CGRect(origin: .zero, size: size), widthPx: width, heightPx: height, format: "jpeg", quality: 0.5)
        return nil
      }
    }
    .runOnQueue(queue)

    AsyncFunction("saveDecrypted") { (src: String, password: String, dest: String, promise: Promise) in
      self.settle(promise) {
        let srcURL = try PdfPaths.fileURL(src)
        let destURL = try PdfPaths.fileURL(dest)
        let document = try PdfDocumentStore.load(url: srcURL, password: password)
        try self.writeDecrypted(document, to: destURL)
        return nil
      }
    }
    .runOnQueue(queue)

    AsyncFunction("close") { (handle: String, promise: Promise) in
      self.settle(promise) {
        self.store.close(handle)
        return nil
      }
    }
    .runOnQueue(queue)

    Function("lastRenderCrash") { () -> [String: Any]? in
      return self.journal.lastCrash()
    }

    Function("clearRenderCrash") {
      self.journal.clearCrash()
    }
  }

  // MARK: - Promise plumbing (runs on `queue`)

  /// Runs `body` in an autorelease pool (bitmaps are freed per call, not when the queue drains) and
  /// settles the promise: a value resolves it, a PdfRenderError rejects with its code, anything
  /// else rejects ERR_PDF_IO.
  private func settle(_ promise: Promise, _ body: () throws -> Any?) {
    do {
      let value = try autoreleasepool { try body() }
      promise.resolve(value)
    } catch let error as PdfRenderError {
      promise.reject(error.code, error.message)
    } catch {
      promise.reject("ERR_PDF_IO", error.localizedDescription)
    }
  }

  // MARK: - Pages

  private func page(_ document: PDFDocument, _ index: Int) throws -> (PDFPage, CGSize) {
    guard index >= 0, index < document.pageCount else {
      throw PdfRenderError.io("Page \(index) is outside 0..<\(document.pageCount)")
    }
    guard let page = document.page(at: index) else {
      throw PdfRenderError.damaged("Page \(index) cannot be read")
    }
    guard let size = PdfGeometry.displayedSize(page) else {
      throw PdfRenderError.damaged("Page \(index) has no usable size")
    }
    return (page, size)
  }

  /// Displayed size and rotation of one page. A page PDFKit cannot read or measure reports A4
  /// portrait, so one bad page never fails a whole batch; its probe or render reports the damage.
  private func sizeInfo(_ document: PDFDocument, _ index: Int) -> [String: Any] {
    guard let page = document.page(at: index), let size = PdfGeometry.displayedSize(page) else {
      return ["w": Double(PdfGeometry.fallbackSize.width), "h": Double(PdfGeometry.fallbackSize.height), "rotation": 0]
    }
    return ["w": Double(size.width), "h": Double(size.height), "rotation": PdfGeometry.rotation(page)]
  }

  // MARK: - Rendering (runs on `queue`)

  /// Height in px of a whole page `width` px wide (rounded, at least 1). The value is clamped before
  /// the Int conversion, which would trap on an out-of-range Double.
  private static func heightFor(width: Int, size: CGSize) -> Int {
    let exact = Double(width) * Double(size.height) / Double(size.width)
    guard exact.isFinite else {
      return Int.max / 2
    }
    return max(1, Int(min(exact, 1_000_000_000).rounded()))
  }

  /// Renders a region (or the whole page when `region` is nil) to an image file.
  private func render(
    handle: String, page index: Int, region: CGRect?, widthPx: Int, heightPx: Int?,
    outPath: String, format: String, quality: Double?
  ) throws -> [String: Any] {
    let outURL = try PdfPaths.fileURL(outPath)
    let url = try store.url(for: handle)

    journal.begin(path: url.absoluteString, page: index)
    defer { journal.end() }

    let document = try store.document(for: handle)
    let (pdfPage, size) = try page(document, index)
    let rect = region ?? CGRect(origin: .zero, size: size)
    // The width is checked before the height is derived from it, so the arithmetic stays in range.
    guard widthPx >= 1, widthPx <= PdfRenderModule.maxSidePx else {
      throw PdfRenderError.io("Bitmap width \(widthPx) is out of range")
    }
    let height = heightPx ?? PdfRenderModule.heightFor(width: widthPx, size: size)
    guard height >= 1, height <= PdfRenderModule.maxSidePx,
      widthPx * height <= PdfRenderModule.maxAreaPx
    else {
      throw PdfRenderError.io("Bitmap \(widthPx)x\(height) is too large")
    }
    let jpegQuality = CGFloat(min(1, max(0, quality ?? 0.9)))
    guard let data = draw(pdfPage, displayed: size, region: rect, widthPx: widthPx, heightPx: height, format: format, quality: jpegQuality) else {
      throw PdfRenderError.io("Could not encode the image")
    }
    do {
      try FileManager.default.createDirectory(at: outURL.deletingLastPathComponent(), withIntermediateDirectories: true)
      try data.write(to: outURL, options: .atomic)
    } catch {
      throw PdfRenderError.io("Could not write \(outURL.lastPathComponent): \(error.localizedDescription)")
    }
    return ["uri": outURL.absoluteString, "width": widthPx, "height": height]
  }

  /**
   Draws `region` (displayed page points, top-left origin) of a page into an opaque white bitmap of
   exactly widthPx x heightPx and encodes it.

   PDFPage.draw(with:to:) draws in PDF space: y up, origin at the bottom-left of the displayed box,
   with the page rotation and the crop box origin applied (it calls transform(_:for:) itself). The
   renderer's context is UIKit space (y down), so the context is flipped first, then scaled to
   pixels, then moved so the region's bottom-left (x, H - y - h in PDF space) lands at the origin.
   */
  private func draw(
    _ page: PDFPage, displayed size: CGSize, region: CGRect, widthPx: Int, heightPx: Int, format: String,
    quality: CGFloat
  ) -> Data? {
    let rendererFormat = UIGraphicsImageRendererFormat()
    rendererFormat.scale = 1
    rendererFormat.opaque = true
    rendererFormat.preferredRange = .standard
    let pixelSize = CGSize(width: widthPx, height: heightPx)
    let renderer = UIGraphicsImageRenderer(size: pixelSize, format: rendererFormat)
    let actions: (UIGraphicsImageRendererContext) -> Void = { rendererContext in
      let context = rendererContext.cgContext
      context.setFillColor(gray: 1, alpha: 1)
      context.fill(CGRect(origin: .zero, size: pixelSize))
      context.interpolationQuality = .high
      context.translateBy(x: 0, y: pixelSize.height)
      context.scaleBy(x: 1, y: -1)
      context.scaleBy(x: pixelSize.width / region.width, y: pixelSize.height / region.height)
      context.translateBy(x: -region.minX, y: -(size.height - region.maxY))
      page.draw(with: .cropBox, to: context)
    }
    if format == "jpeg" {
      return renderer.jpegData(withCompressionQuality: quality, actions: actions)
    }
    return renderer.pngData(actions: actions)
  }

  // MARK: - Decrypted copy (runs on `queue`)

  /**
   Writes an unprotected copy of an unlocked document to `dest`:
   1. write(to:) with no options, then re-open the output and check isEncrypted == false (and the
      page count);
   2. if PDFKit kept the encryption (or could not write), redraw every page into a new CGPDFContext
      document, which has no security. That copy keeps the look but may lose selectable text
      (device checklist item 4).
   Both go through a temporary file next to dest, so dest is either the finished copy or untouched.
   Nothing usable: ERR_PDF_UNSUPPORTED (JavaScript then falls back to @cantoo/pdf-lib, P17).
   */
  private func writeDecrypted(_ document: PDFDocument, to dest: URL) throws {
    let fileManager = FileManager.default
    let folder = dest.deletingLastPathComponent()
    do {
      try fileManager.createDirectory(at: folder, withIntermediateDirectories: true)
    } catch {
      throw PdfRenderError.io("Could not create \(folder.lastPathComponent): \(error.localizedDescription)")
    }
    let temp = folder.appendingPathComponent(".\(UUID().uuidString).pdf.tmp", isDirectory: false)
    defer { try? fileManager.removeItem(at: temp) }

    let pageCount = document.pageCount
    var done = document.write(to: temp) && isUnprotectedCopy(temp, pageCount: pageCount)
    if !done {
      NSLog("PdfRender: redraw fallback (PDFKit kept the encryption or could not write)")
      try? fileManager.removeItem(at: temp)
      do {
        try redraw(document, to: temp)
        done = isUnprotectedCopy(temp, pageCount: pageCount)
      } catch {
        // Any failure of the fallback means this engine cannot make the copy: ERR_PDF_UNSUPPORTED
        // below, so JavaScript tries @cantoo/pdf-lib instead of giving up.
        NSLog("PdfRender: redraw fallback failed: %@", String(describing: error))
        done = false
      }
    }
    guard done else {
      throw PdfRenderError.unsupported("Could not write an unprotected copy of this PDF")
    }
    do {
      if fileManager.fileExists(atPath: dest.path) {
        try fileManager.removeItem(at: dest)
      }
      try fileManager.moveItem(at: temp, to: dest)
    } catch {
      throw PdfRenderError.io("Could not write \(dest.lastPathComponent): \(error.localizedDescription)")
    }
  }

  private func isUnprotectedCopy(_ url: URL, pageCount: Int) -> Bool {
    guard let copy = PDFDocument(url: url) else {
      return false
    }
    return !copy.isEncrypted && !copy.isLocked && copy.pageCount == pageCount
  }

  /// Every page drawn (as vectors, with its crop box and rotation) into a new PDF with no security.
  private func redraw(_ document: PDFDocument, to url: URL) throws {
    guard let context = CGContext(url as CFURL, mediaBox: nil, nil) else {
      throw PdfRenderError.io("Could not create a PDF at \(url.lastPathComponent)")
    }
    // Closed on every path, so a failed page never leaves the file open (the caller deletes it).
    defer { context.closePDF() }
    for index in 0..<document.pageCount {
      try autoreleasepool {
        guard let page = document.page(at: index) else {
          throw PdfRenderError.damaged("Page \(index) cannot be read")
        }
        let size = PdfGeometry.displayedSize(page) ?? PdfGeometry.fallbackSize
        let mediaBox = CGRect(origin: .zero, size: size)
        let boxData = withUnsafeBytes(of: mediaBox) { Data($0) }
        let pageInfo = [kCGPDFContextMediaBox as String: boxData as CFData] as CFDictionary
        context.beginPDFPage(pageInfo)
        // A PDF context is already y-up PDF space; draw(with:to:) applies rotation and box origin.
        page.draw(with: .cropBox, to: context)
        context.endPDFPage()
      }
    }
  }
}
