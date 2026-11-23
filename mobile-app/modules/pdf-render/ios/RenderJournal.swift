import Foundation

/**
 The render journal: proof of which page PDFKit was drawing if the app dies while drawing it.

 iOS gives PDFKit no process isolation, so a PDF page that crashes PDFKit takes the whole app down.
 Before every renderRegion, renderPage and probe the module SYNCHRONOUSLY writes {path, page} to
 Documents/notebooks/.render-journal (Data.write with .atomic, so the file is either the old entry or
 the new one, never torn) and deletes it when the call returns, successfully or not. A journal that is
 still there when the app starts again therefore names the page the previous run died in.

 Launch handling: the first time a journal is created in this PROCESS (before any render of this
 process can write the journal), a leftover journal is moved to .render-journal.crash. A second
 module instance in the same process (a JavaScript reload in a development build creates one) skips
 that step, so a render still in flight in this process is never mistaken for a crash.
 lastRenderCrash() reads the .crash file, and the crash survives until JavaScript consumes it with
 clearRenderCrash() (even across several launches).

 THREADING: begin() and end() run on the module's serial queue; lastCrash() and clearCrash() run on
 the JavaScript thread (sync functions). Every method holds the process-wide `lock`, so they never
 interleave, not even across module instances.
 */
final class RenderJournal {
  private static let lock = NSLock()
  /// Set once the leftover journal of the previous process has been set aside (under `lock`).
  private static var launchHandled = false

  private let lock = RenderJournal.lock
  private let directory: URL?
  private let journalURL: URL?
  private let crashURL: URL?

  init() {
    let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
    let directory = documents?.appendingPathComponent("notebooks", isDirectory: true)
    self.directory = directory
    journalURL = directory?.appendingPathComponent(".render-journal", isDirectory: false)
    crashURL = directory?.appendingPathComponent(".render-journal.crash", isDirectory: false)

    lock.lock()
    defer { lock.unlock() }
    guard !RenderJournal.launchHandled else {
      return
    }
    RenderJournal.launchHandled = true
    guard let journalURL, let crashURL, FileManager.default.fileExists(atPath: journalURL.path) else {
      return
    }
    // The newest crash wins over an older one JavaScript has not read yet.
    do {
      if FileManager.default.fileExists(atPath: crashURL.path) {
        try FileManager.default.removeItem(at: crashURL)
      }
      try FileManager.default.moveItem(at: journalURL, to: crashURL)
    } catch {
      NSLog("PdfRender: could not keep the render journal: %@", error.localizedDescription)
      try? FileManager.default.removeItem(at: journalURL)
    }
  }

  /// Records the page about to be drawn. A failed write (disk full) never blocks the render.
  func begin(path: String, page: Int) {
    lock.lock()
    defer { lock.unlock() }
    guard let directory, let journalURL else {
      return
    }
    let entry: [String: Any] = [
      "path": path,
      "page": page,
      "at": Date().timeIntervalSince1970 * 1000,
    ]
    do {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      let data = try JSONSerialization.data(withJSONObject: entry, options: [])
      try data.write(to: journalURL, options: .atomic)
    } catch {
      NSLog("PdfRender: could not write the render journal: %@", error.localizedDescription)
    }
  }

  /// The render returned: the page did not crash the app.
  func end() {
    lock.lock()
    defer { lock.unlock() }
    guard let journalURL else {
      return
    }
    if FileManager.default.fileExists(atPath: journalURL.path) {
      try? FileManager.default.removeItem(at: journalURL)
    }
  }

  /// {path, page} of the render the previous run died in, or nil.
  func lastCrash() -> [String: Any]? {
    lock.lock()
    defer { lock.unlock() }
    guard let crashURL, FileManager.default.fileExists(atPath: crashURL.path) else {
      return nil
    }
    guard let data = try? Data(contentsOf: crashURL),
      let object = try? JSONSerialization.jsonObject(with: data, options: []),
      let dict = object as? [String: Any],
      let path = dict["path"] as? String,
      let pageNumber = dict["page"] as? NSNumber
    else {
      // Unreadable: nothing can be matched to a page, so drop it.
      try? FileManager.default.removeItem(at: crashURL)
      return nil
    }
    return ["path": path, "page": pageNumber.intValue]
  }

  /// Forgets the crash entry.
  func clearCrash() {
    lock.lock()
    defer { lock.unlock() }
    guard let crashURL else {
      return
    }
    if FileManager.default.fileExists(atPath: crashURL.path) {
      try? FileManager.default.removeItem(at: crashURL)
    }
  }
}
