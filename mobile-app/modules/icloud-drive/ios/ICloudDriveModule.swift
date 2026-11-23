import ExpoModulesCore
import Foundation

/// An error with a stable code that JavaScript can switch on (see ICloudErrorCode in index.ts).
private struct ICloudDriveError: Error {
  let code: String
  let message: String

  static let unavailable = ICloudDriveError(
    code: "ERR_ICLOUD_UNAVAILABLE",
    message: "iCloud Drive is off, or this device is signed out of iCloud"
  )

  static func badPath(_ rel: String) -> ICloudDriveError {
    return ICloudDriveError(code: "ERR_ICLOUD_BAD_PATH", message: "Not a relative path inside the iCloud folder: \(rel)")
  }

  static func notFound(_ what: String) -> ICloudDriveError {
    return ICloudDriveError(code: "ERR_ICLOUD_NOT_FOUND", message: "No such item: \(what)")
  }

  static func timedOut(_ rel: String) -> ICloudDriveError {
    return ICloudDriveError(code: "ERR_ICLOUD_TIMEOUT", message: "iCloud did not finish downloading \(rel) in time")
  }

  static func io(_ message: String) -> ICloudDriveError {
    return ICloudDriveError(code: "ERR_ICLOUD_IO", message: message)
  }
}

/**
 The app's iCloud Drive (ubiquity) container. Its Documents folder is what the Files app shows as
 "QU Student" (NSUbiquitousContainers in app.json, written by P01). Every path JavaScript passes is
 relative to that Documents folder ("Backups/manifest.json"); local paths are absolute paths or
 file:// URIs.

 Threading:
 - Every function runs on `queue`, a serial background queue. Never the main thread:
   url(forUbiquityContainerIdentifier:) can block while iCloud sets the container up, and file
   coordination blocks until iCloud's own presenters let go.
 - NSMetadataQuery lives on the main queue (UbiquityQuery.swift) and hands results back to `queue`.
 - `documents` and `identityToken` are touched only on `queue`; `identityObserver` only on main.

 The container identifier is nil, which means the first entry of
 com.apple.developer.ubiquity-container-identifiers: iCloud.net.qustudent.app, the only one.
 */
public final class ICloudDriveModule: Module {
  private let queue = DispatchQueue(label: "net.qustudent.icloud-drive", qos: .utility)

  /// The container's Documents folder, cached for the current iCloud identity. `queue` only.
  private var documents: URL?
  private var identityToken: (any NSCoding & NSCopying & NSObjectProtocol)?

  /// NSUbiquityIdentityDidChange observer, while JavaScript listens to availabilityChanged. Main only.
  private var identityObserver: NSObjectProtocol?

  private static let resourceKeys: Set<URLResourceKey> = [
    .isDirectoryKey,
    .fileSizeKey,
    .contentModificationDateKey,
    .isUbiquitousItemKey,
    .ubiquitousItemDownloadingStatusKey,
    .ubiquitousItemIsDownloadingKey,
    .ubiquitousItemIsUploadedKey,
    .ubiquitousItemIsUploadingKey,
    .ubiquitousItemUploadingErrorKey,
    .ubiquitousItemDownloadingErrorKey,
  ]

  /// How long a metadata snapshot (list, status) may take before the FileManager view is used alone.
  private static let snapshotTimeout: TimeInterval = 10

  public func definition() -> ModuleDefinition {
    Name("ICloudDrive")

    Events("availabilityChanged", "downloadProgress")

    OnStartObserving("availabilityChanged") {
      DispatchQueue.main.async {
        self.startObservingIdentity()
      }
    }

    OnStopObserving("availabilityChanged") {
      DispatchQueue.main.async {
        self.stopObservingIdentity()
      }
    }

    AsyncFunction("isAvailable") { (promise: Promise) in
      promise.resolve(self.documentsURL() != nil)
    }
    .runOnQueue(queue)

    AsyncFunction("documentsPath") { (promise: Promise) in
      let path: Any? = self.documentsURL()?.path
      promise.resolve(path)
    }
    .runOnQueue(queue)

    AsyncFunction("ensureDir") { (rel: String, promise: Promise) in
      self.run(promise) { docs in
        let (url, _) = try self.resolve(rel, in: docs)
        try self.makeDirectory(url)
        return nil
      }
    }
    .runOnQueue(queue)

    AsyncFunction("copyIn") { (localPath: String, rel: String, promise: Promise) in
      self.run(promise) { docs in
        let (dest, _) = try self.resolve(rel, in: docs, allowRoot: false)
        let bytes = try self.copyIn(from: self.fileURL(localPath), to: dest)
        return Double(bytes)
      }
    }
    .runOnQueue(queue)

    AsyncFunction("copyOut") { (rel: String, localPath: String, timeoutMs: Double, token: String, promise: Promise) in
      guard let docs = self.documentsURL() else {
        self.reject(promise, ICloudDriveError.unavailable)
        return
      }
      let source: URL
      let dest = self.fileURL(localPath)
      do {
        source = try self.resolve(rel, in: docs, allowRoot: false).0
      } catch {
        self.reject(promise, error)
        return
      }
      self.whenDownloaded(source, rel: rel, timeout: timeoutMs / 1000, token: token) { error in
        if let error {
          self.reject(promise, error)
          return
        }
        do {
          var bytes: Int64 = 0
          try self.coordinatedRead(source) { url in
            bytes = try self.copyReplacingLocal(from: url, to: dest)
          }
          promise.resolve(Double(bytes))
        } catch {
          self.reject(promise, error)
        }
      }
    }
    .runOnQueue(queue)

    AsyncFunction("readText") { (rel: String, timeoutMs: Double, promise: Promise) in
      guard let docs = self.documentsURL() else {
        self.reject(promise, ICloudDriveError.unavailable)
        return
      }
      let source: URL
      do {
        source = try self.resolve(rel, in: docs, allowRoot: false).0
      } catch {
        self.reject(promise, error)
        return
      }
      self.whenDownloaded(source, rel: rel, timeout: timeoutMs / 1000, token: "") { error in
        if let error {
          if self.isNotFound(error) {
            let none: Any? = nil
            promise.resolve(none)
          } else {
            self.reject(promise, error)
          }
          return
        }
        do {
          var data = Data()
          try self.coordinatedRead(source) { url in
            data = try Data(contentsOf: url)
          }
          guard let text = String(data: data, encoding: .utf8) else {
            throw ICloudDriveError.io("\(rel) is not UTF-8 text")
          }
          promise.resolve(text)
        } catch {
          if self.isNotFound(error) {
            let none: Any? = nil
            promise.resolve(none)
          } else {
            self.reject(promise, error)
          }
        }
      }
    }
    .runOnQueue(queue)

    AsyncFunction("writeText") { (rel: String, text: String, promise: Promise) in
      self.run(promise) { docs in
        let (dest, _) = try self.resolve(rel, in: docs, allowRoot: false)
        try self.makeDirectory(dest.deletingLastPathComponent())
        let data = Data(text.utf8)
        try self.coordinatedWrite(dest, options: .forReplacing) { url in
          try data.write(to: url, options: .atomic)
        }
        return nil
      }
    }
    .runOnQueue(queue)

    AsyncFunction("list") { (relDir: String, recursive: Bool, promise: Promise) in
      guard let docs = self.documentsURL() else {
        self.reject(promise, ICloudDriveError.unavailable)
        return
      }
      do {
        let (dir, normalized) = try self.resolve(relDir, in: docs)
        self.list(dir: dir, rel: normalized, recursive: recursive, docs: docs, promise: promise)
      } catch {
        self.reject(promise, error)
      }
    }
    .runOnQueue(queue)

    AsyncFunction("status") { (rel: String, promise: Promise) in
      guard let docs = self.documentsURL() else {
        self.reject(promise, ICloudDriveError.unavailable)
        return
      }
      do {
        let (url, _) = try self.resolve(rel, in: docs)
        self.status(of: url, promise: promise)
      } catch {
        self.reject(promise, error)
      }
    }
    .runOnQueue(queue)

    AsyncFunction("remove") { (rel: String, promise: Promise) in
      self.run(promise) { docs in
        let (url, _) = try self.resolve(rel, in: docs, allowRoot: false)
        return try self.remove(url)
      }
    }
    .runOnQueue(queue)
  }

  // MARK: - Container

  /// The container's Documents folder, or nil when iCloud Drive is unavailable. `queue` only.
  private func documentsURL() -> URL? {
    dispatchPrecondition(condition: .onQueue(queue))
    let fileManager = FileManager.default
    guard let token = fileManager.ubiquityIdentityToken else {
      documents = nil
      identityToken = nil
      return nil
    }
    if let documents, let identityToken, identityToken.isEqual(token) {
      return documents
    }
    // Never on main: the first call extends the sandbox and can take a while.
    guard let container = fileManager.url(forUbiquityContainerIdentifier: nil) else {
      documents = nil
      identityToken = nil
      return nil
    }
    let docs = container.appendingPathComponent("Documents", isDirectory: true)
    if !fileManager.fileExists(atPath: docs.path) {
      try? coordinatedWrite(docs, options: []) { url in
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
      }
    }
    documents = docs
    identityToken = token
    return docs
  }

  private func startObservingIdentity() {
    dispatchPrecondition(condition: .onQueue(.main))
    guard identityObserver == nil else {
      return
    }
    identityObserver = NotificationCenter.default.addObserver(
      forName: .NSUbiquityIdentityDidChange,
      object: nil,
      queue: OperationQueue.main
    ) { [weak self] _ in
      guard let self else {
        return
      }
      self.queue.async {
        self.documents = nil
        self.identityToken = nil
        let available = self.documentsURL() != nil
        self.sendEvent("availabilityChanged", ["available": available])
      }
    }
  }

  private func stopObservingIdentity() {
    dispatchPrecondition(condition: .onQueue(.main))
    if let identityObserver {
      NotificationCenter.default.removeObserver(identityObserver)
    }
    identityObserver = nil
  }

  // MARK: - Paths

  /**
   Resolves `rel` inside Documents. Rejects absolute paths and "." or ".." segments; empty segments
   are dropped. Returns the URL and the normalized relative path ("" is the Documents folder).
   */
  private func resolve(_ rel: String, in docs: URL, allowRoot: Bool = true) throws -> (URL, String) {
    if rel.hasPrefix("/") || rel.hasPrefix("file:") {
      throw ICloudDriveError.badPath(rel)
    }
    var url = docs
    var parts: [String] = []
    for part in rel.split(separator: "/", omittingEmptySubsequences: true) {
      if part == "." || part == ".." || part.contains("\0") {
        throw ICloudDriveError.badPath(rel)
      }
      parts.append(String(part))
      url.appendPathComponent(String(part))
    }
    if parts.isEmpty && !allowRoot {
      throw ICloudDriveError.badPath(rel)
    }
    return (url, parts.joined(separator: "/"))
  }

  /// `url`'s path relative to Documents, or nil when it is outside.
  private func relativePath(of url: URL, docs: URL) -> String? {
    let root = UbiquityQuery.canonicalPath(docs)
    let path = UbiquityQuery.canonicalPath(url)
    guard path.hasPrefix(root + "/") else {
      return nil
    }
    return String(path.dropFirst(root.count + 1))
  }

  /// A local path from JavaScript: "file:///…" (expo-file-system URIs) or "/…".
  private func fileURL(_ path: String) -> URL {
    if path.hasPrefix("file://") {
      if let url = URL(string: path), url.isFileURL {
        return url
      }
      return URL(fileURLWithPath: String(path.dropFirst("file://".count)))
    }
    return URL(fileURLWithPath: path)
  }

  /// Older iOS versions keep an evicted file as a hidden ".name.icloud" placeholder.
  private func placeholderURL(for url: URL) -> URL {
    return url.deletingLastPathComponent().appendingPathComponent(".\(url.lastPathComponent).icloud")
  }

  private func realName(ofPlaceholder name: String) -> String? {
    guard name.hasPrefix("."), name.hasSuffix(".icloud"), name.count > ".icloud".count + 1 else {
      return nil
    }
    let real = String(name.dropFirst().dropLast(".icloud".count))
    return real.isEmpty ? nil : real
  }

  // MARK: - File coordination

  private func coordinatedWrite(_ url: URL, options: NSFileCoordinator.WritingOptions, _ body: (URL) throws -> Void) throws {
    var coordinationError: NSError?
    var bodyError: Error?
    NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: url, options: options, error: &coordinationError) { newURL in
      do {
        try body(newURL)
      } catch {
        bodyError = error
      }
    }
    if let coordinationError {
      throw coordinationError
    }
    if let bodyError {
      throw bodyError
    }
  }

  private func coordinatedRead(_ url: URL, _ body: (URL) throws -> Void) throws {
    var coordinationError: NSError?
    var bodyError: Error?
    NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: url, options: [], error: &coordinationError) { newURL in
      do {
        try body(newURL)
      } catch {
        bodyError = error
      }
    }
    if let coordinationError {
      throw coordinationError
    }
    if let bodyError {
      throw bodyError
    }
  }

  // MARK: - Operations

  /// Creates `url` (and its parents) as a folder, under coordination. A file in the way is an error.
  private func makeDirectory(_ url: URL) throws {
    let fileManager = FileManager.default
    var isDirectory: ObjCBool = false
    if fileManager.fileExists(atPath: url.path, isDirectory: &isDirectory) {
      if isDirectory.boolValue {
        return
      }
      throw ICloudDriveError.io("A file is in the way of the folder \(url.lastPathComponent)")
    }
    try coordinatedWrite(url, options: []) { newURL in
      try FileManager.default.createDirectory(at: newURL, withIntermediateDirectories: true)
    }
  }

  /**
   Copies a local file into iCloud with a coordinated replace: the bytes are first copied to a
   temporary file, then swapped in under a .forReplacing write, so iCloud never syncs a half-written file.
   */
  private func copyIn(from source: URL, to dest: URL) throws -> Int64 {
    let fileManager = FileManager.default
    var isDirectory: ObjCBool = false
    guard fileManager.fileExists(atPath: source.path, isDirectory: &isDirectory), !isDirectory.boolValue else {
      throw ICloudDriveError.notFound(source.path)
    }
    try makeDirectory(dest.deletingLastPathComponent())

    let staging = fileManager.temporaryDirectory.appendingPathComponent("icloud-drive-\(UUID().uuidString)", isDirectory: true)
    try fileManager.createDirectory(at: staging, withIntermediateDirectories: true)
    defer { try? fileManager.removeItem(at: staging) }
    let temp = staging.appendingPathComponent(dest.lastPathComponent)
    try fileManager.copyItem(at: source, to: temp)
    let bytes = Int64((try? temp.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0)

    try coordinatedWrite(dest, options: .forReplacing) { url in
      let fileManager = FileManager.default
      if fileManager.fileExists(atPath: url.path) || fileManager.fileExists(atPath: self.placeholderURL(for: url).path) {
        do {
          _ = try fileManager.replaceItemAt(url, withItemAt: temp, backupItemName: nil, options: .usingNewMetadataOnly)
        } catch {
          // A failed swap that already consumed the new file cannot be retried; keep the original.
          guard fileManager.fileExists(atPath: temp.path) else {
            throw error
          }
          // An evicted (dataless) original can refuse the swap: delete it, then move the new file in.
          try? fileManager.removeItem(at: url)
          try? fileManager.removeItem(at: self.placeholderURL(for: url))
          try fileManager.moveItem(at: temp, to: url)
        }
      } else {
        try fileManager.moveItem(at: temp, to: url)
      }
    }
    return bytes
  }

  /// Copies a (downloaded, coordinated) iCloud file over a local file through a temp file beside it.
  private func copyReplacingLocal(from source: URL, to dest: URL) throws -> Int64 {
    let fileManager = FileManager.default
    let parent = dest.deletingLastPathComponent()
    try fileManager.createDirectory(at: parent, withIntermediateDirectories: true)
    let temp = parent.appendingPathComponent(".\(dest.lastPathComponent).\(UUID().uuidString).part")
    try fileManager.copyItem(at: source, to: temp)
    do {
      if fileManager.fileExists(atPath: dest.path) {
        _ = try fileManager.replaceItemAt(dest, withItemAt: temp)
      } else {
        try fileManager.moveItem(at: temp, to: dest)
      }
    } catch {
      try? fileManager.removeItem(at: temp)
      throw error
    }
    return Int64((try? dest.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0)
  }

  /// Deletes under a .forDeleting coordination. Resolves false when nothing was there.
  private func remove(_ url: URL) throws -> Bool {
    let fileManager = FileManager.default
    let placeholder = placeholderURL(for: url)
    let hasItem = fileManager.fileExists(atPath: url.path)
    let hasPlaceholder = fileManager.fileExists(atPath: placeholder.path)
    guard hasItem || hasPlaceholder else {
      return false
    }
    try coordinatedWrite(hasItem ? url : placeholder, options: .forDeleting) { newURL in
      try FileManager.default.removeItem(at: newURL)
    }
    if hasItem && fileManager.fileExists(atPath: placeholder.path) {
      try? coordinatedWrite(placeholder, options: .forDeleting) { newURL in
        try FileManager.default.removeItem(at: newURL)
      }
    }
    return true
  }

  /**
   Calls `done(nil)` on `queue` once `url` is fully downloaded, starting the download when needed.
   An item iCloud has never heard of ends with ERR_ICLOUD_NOT_FOUND; a slow download with
   ERR_ICLOUD_TIMEOUT. Progress goes out as downloadProgress events when `token` is not empty.
   */
  private func whenDownloaded(_ url: URL, rel: String, timeout: TimeInterval, token: String, _ done: @escaping (Error?) -> Void) {
    dispatchPrecondition(condition: .onQueue(queue))
    if let local = localInfo(url) {
      if local.isDirectory {
        done(ICloudDriveError.io("\(rel) is a folder"))
        return
      }
      // Up to date, or not managed by iCloud at all: nothing to wait for.
      if local.downloadStatus == "current" || local.downloadStatus == nil {
        done(nil)
        return
      }
    }
    do {
      try FileManager.default.startDownloadingUbiquitousItem(at: url)
    } catch {
      // Throws for an item that is not in iCloud (yet); the query below decides whether it exists.
    }
    UbiquityQuery.waitForDownload(
      of: url,
      timeout: max(timeout, 1),
      deliverOn: queue,
      progress: { [weak self] percent in
        guard let self, !token.isEmpty else {
          return
        }
        self.sendEvent("downloadProgress", ["token": token, "rel": rel, "percent": percent])
      },
      completion: { result in
        switch result {
        case .success:
          done(nil)
        case .failure(.notFound):
          // A file just written on this device can be missing from the index for a moment.
          if let local = self.localInfo(url), local.downloadStatus != "not-downloaded" {
            done(nil)
          } else {
            done(ICloudDriveError.notFound(rel))
          }
        case .failure(.downloadFailed(let error)):
          done(error)
        case .failure(.timedOut), .failure(.couldNotStart):
          done(ICloudDriveError.timedOut(rel))
        }
      }
    )
  }

  /// FileManager's view of `url`, or nil when nothing is at that path. Fresh values on every call.
  private func localInfo(_ url: URL) -> ItemInfo? {
    let fresh = URL(fileURLWithPath: url.path)
    var isDirectory: ObjCBool = false
    guard FileManager.default.fileExists(atPath: fresh.path, isDirectory: &isDirectory) else {
      return nil
    }
    var info = ItemInfo()
    info.isDirectory = isDirectory.boolValue
    info.hasLocalData = true
    if let values = try? fresh.resourceValues(forKeys: Self.resourceKeys) {
      if let size = values.fileSize, !info.isDirectory {
        info.size = Int64(size)
      }
      info.modified = values.contentModificationDate
      if values.isUbiquitousItem == true {
        info.downloadStatus = ItemInfo.downloadStatusName(values.ubiquitousItemDownloadingStatus)
        info.isDownloading = values.ubiquitousItemIsDownloading ?? false
        info.isUploaded = values.ubiquitousItemIsUploaded ?? false
        info.isUploading = values.ubiquitousItemIsUploading ?? false
        info.uploadError = values.ubiquitousItemUploadingError
        info.downloadError = values.ubiquitousItemDownloadingError
      }
    }
    return info
  }

  /**
   Lists a folder: FileManager first (placeholders become their real names, not downloaded), then
   one metadata snapshot that adds items iCloud knows but this device has not materialised and
   overrides the sync fields, so evicted files report isDownloaded false. Sorted by rel.
   */
  private func list(dir: URL, rel: String, recursive: Bool, docs: URL, promise: Promise) {
    let fileManager = FileManager.default
    let keys = Array(Self.resourceKeys)
    var found: [URL] = []
    var isDirectory: ObjCBool = false
    if fileManager.fileExists(atPath: dir.path, isDirectory: &isDirectory), isDirectory.boolValue {
      if recursive {
        if let enumerator = fileManager.enumerator(at: dir, includingPropertiesForKeys: keys, options: []) {
          while let url = enumerator.nextObject() as? URL {
            let name = url.lastPathComponent
            if name.hasPrefix(".") && realName(ofPlaceholder: name) == nil {
              enumerator.skipDescendants()
              continue
            }
            found.append(url)
          }
        }
      } else {
        found = (try? fileManager.contentsOfDirectory(at: dir, includingPropertiesForKeys: keys, options: [])) ?? []
      }
    }

    var entries: [String: (name: String, info: ItemInfo, placeholder: Bool)] = [:]
    for url in found {
      let name = url.lastPathComponent
      if let real = realName(ofPlaceholder: name) {
        let logical = url.deletingLastPathComponent().appendingPathComponent(real)
        guard let itemRel = relativePath(of: logical, docs: docs), entries[itemRel] == nil else {
          continue
        }
        var info = ItemInfo()
        info.hasLocalData = false
        info.downloadStatus = "not-downloaded"
        entries[itemRel] = (real, info, true)
        continue
      }
      if name.hasPrefix(".") {
        continue
      }
      guard let itemRel = relativePath(of: url, docs: docs), let info = localInfo(url) else {
        continue
      }
      entries[itemRel] = (name, info, false)
    }

    let prefix = rel.isEmpty ? "" : rel + "/"
    let predicate: NSPredicate
    if rel.isEmpty {
      predicate = NSPredicate(format: "%K LIKE %@", NSMetadataItemFSNameKey, "*")
    } else {
      let canonical = UbiquityQuery.canonicalPath(dir) + "/"
      predicate = NSPredicate(
        format: "(%K BEGINSWITH %@) OR (%K BEGINSWITH %@)",
        NSMetadataItemPathKey, canonical,
        NSMetadataItemPathKey, "/private" + canonical
      )
    }

    UbiquityQuery.snapshot(predicate: predicate, timeout: Self.snapshotTimeout, deliverOn: queue) { result in
      // A timed-out snapshot leaves the FileManager view, which is still correct for local files.
      if case .success(let items) = result {
        for item in items {
          guard !item.name.hasPrefix("."), let itemRel = self.relativePath(of: item.url, docs: docs), itemRel.hasPrefix(prefix) else {
            continue
          }
          // Like the FileManager walk above: nothing inside a hidden folder (".Trash", ".tmp") is listed.
          if itemRel.split(separator: "/").contains(where: { $0.hasPrefix(".") }) {
            continue
          }
          let rest = itemRel.dropFirst(prefix.count)
          if rest.isEmpty || (!recursive && rest.contains("/")) {
            continue
          }
          if var entry = entries[itemRel] {
            entry.info.merge(cloud: item.info)
            entries[itemRel] = entry
          } else {
            entries[itemRel] = (item.name, item.info, false)
          }
        }
      }
      let list: [[String: Any]] = entries.keys.sorted().compactMap { itemRel in
        guard let entry = entries[itemRel] else {
          return nil
        }
        var dictionary = entry.info.dictionary()
        dictionary["name"] = entry.name
        dictionary["rel"] = itemRel
        return dictionary
      }
      promise.resolve(list)
    }
  }

  /// status(rel): FileManager when the item is on this device, otherwise the metadata index.
  private func status(of url: URL, promise: Promise) {
    if let info = localInfo(url) {
      var dictionary = info.dictionary()
      dictionary["exists"] = true
      promise.resolve(dictionary)
      return
    }
    let hasPlaceholder = FileManager.default.fileExists(atPath: placeholderURL(for: url).path)
    UbiquityQuery.item(at: url, timeout: Self.snapshotTimeout, deliverOn: queue) { result in
      if case .success(let item?) = result {
        var dictionary = item.info.dictionary()
        dictionary["exists"] = true
        promise.resolve(dictionary)
        return
      }
      var info = ItemInfo()
      if hasPlaceholder {
        info.downloadStatus = "not-downloaded"
      }
      var dictionary = info.dictionary()
      dictionary["exists"] = hasPlaceholder
      promise.resolve(dictionary)
    }
  }

  // MARK: - Promise helpers

  /// Runs `body` with the Documents folder, or rejects with ERR_ICLOUD_UNAVAILABLE.
  private func run(_ promise: Promise, _ body: (URL) throws -> Any?) {
    guard let docs = documentsURL() else {
      reject(promise, ICloudDriveError.unavailable)
      return
    }
    do {
      let value = try body(docs)
      promise.resolve(value)
    } catch {
      reject(promise, error)
    }
  }

  private func isNotFound(_ error: Error) -> Bool {
    if let error = error as? ICloudDriveError {
      return error.code == "ERR_ICLOUD_NOT_FOUND"
    }
    let ns = error as NSError
    if ns.domain == NSCocoaErrorDomain {
      return ns.code == NSFileNoSuchFileError || ns.code == NSFileReadNoSuchFileError
    }
    return ns.domain == NSPOSIXErrorDomain && ns.code == Int(ENOENT)
  }

  private func reject(_ promise: Promise, _ error: Error) {
    if let error = error as? ICloudDriveError {
      promise.reject(error.code, error.message)
      return
    }
    if isNotFound(error) {
      promise.reject("ERR_ICLOUD_NOT_FOUND", (error as NSError).localizedDescription)
      return
    }
    let ns = error as NSError
    if ns.domain == NSCocoaErrorDomain {
      switch ns.code {
      case NSFileWriteOutOfSpaceError:
        promise.reject("ERR_ICLOUD_NO_SPACE", ns.localizedDescription)
        return
      case CocoaError.Code.ubiquitousFileNotUploadedDueToQuota.rawValue:
        promise.reject("ERR_ICLOUD_QUOTA", ns.localizedDescription)
        return
      case CocoaError.Code.ubiquitousFileUnavailable.rawValue,
        CocoaError.Code.ubiquitousFileUbiquityServerNotAvailable.rawValue:
        promise.reject("ERR_ICLOUD_UNAVAILABLE", ns.localizedDescription)
        return
      default:
        break
      }
    }
    promise.reject("ERR_ICLOUD_IO", ns.localizedDescription)
  }
}
