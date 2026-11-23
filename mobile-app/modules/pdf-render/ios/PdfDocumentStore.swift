import CoreGraphics
import Foundation
import PDFKit

/// An error with one of the codes JavaScript maps with toPdfError (PDF_NATIVE_ERROR_CODES in
/// modules/pdf-render/src/PdfRender.types.ts).
struct PdfRenderError: Error {
  let code: String
  let message: String

  static func password(_ message: String = "This PDF needs a password") -> PdfRenderError {
    return PdfRenderError(code: "ERR_PDF_PASSWORD", message: message)
  }

  static func wrongPassword(_ message: String = "The password does not open this PDF") -> PdfRenderError {
    return PdfRenderError(code: "ERR_PDF_WRONG_PASSWORD", message: message)
  }

  static func damaged(_ message: String) -> PdfRenderError {
    return PdfRenderError(code: "ERR_PDF_DAMAGED", message: message)
  }

  static func unsupported(_ message: String) -> PdfRenderError {
    return PdfRenderError(code: "ERR_PDF_UNSUPPORTED", message: message)
  }

  static func io(_ message: String) -> PdfRenderError {
    return PdfRenderError(code: "ERR_PDF_IO", message: message)
  }
}

/// Paths from JavaScript: a file:// URI (percent-encoded or not) or an absolute path.
enum PdfPaths {
  static func fileURL(_ path: String) throws -> URL {
    let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.lowercased().hasPrefix("file://") {
      if let url = URL(string: trimmed), url.isFileURL, !url.path.isEmpty {
        return url.standardizedFileURL
      }
      // Not a valid URL string (for example an unencoded space before iOS 17): treat the rest as a path.
      let raw = String(trimmed.dropFirst("file://".count))
      let decoded = raw.removingPercentEncoding ?? raw
      guard decoded.hasPrefix("/") else {
        throw PdfRenderError.io("Not a file path: \(path)")
      }
      return URL(fileURLWithPath: decoded).standardizedFileURL
    }
    guard trimmed.hasPrefix("/") else {
      throw PdfRenderError.io("Not a file path: \(path)")
    }
    return URL(fileURLWithPath: trimmed).standardizedFileURL
  }
}

/// Page geometry as DISPLAYED: the crop box with the page's own /Rotate applied.
enum PdfGeometry {
  /// A4 portrait, for a page PDFKit cannot measure.
  static let fallbackSize = CGSize(width: 595.28, height: 841.89)

  /// The page's /Rotate as 0, 90, 180 or 270.
  static func rotation(_ page: PDFPage) -> Int {
    let r = ((page.rotation % 360) + 360) % 360
    return (r / 90) * 90
  }

  /// Width and height in points of the page as shown, or nil when PDFKit gives no usable box.
  static func displayedSize(_ page: PDFPage) -> CGSize? {
    let box = page.bounds(for: .cropBox)
    let w = abs(box.width)
    let h = abs(box.height)
    guard w.isFinite, h.isFinite, w > 0, h > 0 else {
      return nil
    }
    let r = rotation(page)
    return (r == 90 || r == 270) ? CGSize(width: h, height: w) : CGSize(width: w, height: h)
  }
}

/**
 Open documents, keyed by an opaque handle string.

 THREADING: every method, and every PDFDocument or PDFPage it hands out, is used ONLY on the
 module's serial queue ('net.qustudent.pdf'). PDFKit objects are not safe to use from two threads
 at once, and the serial queue guarantees they never are. Nothing here locks.

 At most `maxOpen` (3) documents are parsed at a time. Older ones are dropped (LRU) and reopened on
 demand from the path and password, which are kept in memory only (never written anywhere).
 */
final class PdfDocumentStore {
  static let maxOpen = 3

  private struct Entry {
    let url: URL
    let password: String?
    var document: PDFDocument?
  }

  private var entries: [String: Entry] = [:]
  /// Handles whose document is parsed, least recently used first.
  private var live: [String] = []

  /// Parses and, when it is locked, unlocks a document.
  static func load(url: URL, password: String?) throws -> PDFDocument {
    guard FileManager.default.fileExists(atPath: url.path) else {
      throw PdfRenderError.io("No file at \(url.lastPathComponent)")
    }
    guard FileManager.default.isReadableFile(atPath: url.path) else {
      throw PdfRenderError.io("Cannot read \(url.lastPathComponent)")
    }
    guard let document = PDFDocument(url: url) else {
      throw PdfRenderError.damaged("Not a readable PDF: \(url.lastPathComponent)")
    }
    if document.isLocked {
      guard let password, !password.isEmpty else {
        throw PdfRenderError.password()
      }
      guard document.unlock(withPassword: password) else {
        throw PdfRenderError.wrongPassword()
      }
    }
    return document
  }

  /// Opens a document and returns its new handle.
  func open(url: URL, password: String?) throws -> (handle: String, document: PDFDocument) {
    let document = try PdfDocumentStore.load(url: url, password: password)
    let handle = UUID().uuidString
    entries[handle] = Entry(url: url, password: password, document: document)
    markUsed(handle)
    return (handle, document)
  }

  /// The file a handle was opened from, without parsing it (for the render journal).
  func url(for handle: String) throws -> URL {
    guard let entry = entries[handle] else {
      throw PdfRenderError.io("Unknown or closed PDF handle")
    }
    return entry.url
  }

  /// The parsed document of a handle, reopened when it was dropped from the LRU.
  func document(for handle: String) throws -> PDFDocument {
    guard var entry = entries[handle] else {
      throw PdfRenderError.io("Unknown or closed PDF handle")
    }
    if let document = entry.document {
      markUsed(handle)
      return document
    }
    let document = try PdfDocumentStore.load(url: entry.url, password: entry.password)
    entry.document = document
    entries[handle] = entry
    markUsed(handle)
    return document
  }

  /// Forgets a handle. An unknown handle is not an error.
  func close(_ handle: String) {
    entries.removeValue(forKey: handle)
    live.removeAll { $0 == handle }
  }

  private func markUsed(_ handle: String) {
    live.removeAll { $0 == handle }
    live.append(handle)
    while live.count > PdfDocumentStore.maxOpen {
      let oldest = live.removeFirst()
      if var entry = entries[oldest] {
        entry.document = nil
        entries[oldest] = entry
      }
    }
  }
}
