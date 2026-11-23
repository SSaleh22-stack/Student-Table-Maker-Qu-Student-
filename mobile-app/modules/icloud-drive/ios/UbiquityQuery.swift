import Foundation

/**
 What iCloud says about one item, from FileManager resource values, from NSMetadataQuery, or both.
 `dictionary()` is the shape JavaScript receives (see modules/icloud-drive/index.ts, ICloudItemInfo).
 */
struct ItemInfo {
  var isDirectory = false
  /// True when the item's bytes are on this device. Used only when iCloud reports no downloading status.
  var hasLocalData = false
  /// "current", "downloaded" (a local copy that may be older than the cloud) or "not-downloaded" (evicted).
  var downloadStatus: String?
  var isDownloading = false
  var isUploaded = false
  var isUploading = false
  var size: Int64?
  var modified: Date?
  var percentDownloaded: Double?
  var uploadError: NSError?
  var downloadError: NSError?

  var isDownloaded: Bool {
    switch downloadStatus {
    case "current"?, "downloaded"?:
      return true
    case "not-downloaded"?:
      return false
    default:
      return hasLocalData
    }
  }

  /// Takes iCloud's view (from the metadata query) over the local one for every sync field.
  mutating func merge(cloud: ItemInfo) {
    if let status = cloud.downloadStatus {
      downloadStatus = status
    }
    isDownloading = cloud.isDownloading
    isUploaded = cloud.isUploaded
    isUploading = cloud.isUploading
    if size == nil {
      size = cloud.size
    }
    if modified == nil {
      modified = cloud.modified
    }
    if let percent = cloud.percentDownloaded {
      percentDownloaded = percent
    }
    if let error = cloud.uploadError {
      uploadError = error
    }
    if let error = cloud.downloadError {
      downloadError = error
    }
    if cloud.isDirectory {
      isDirectory = true
    }
  }

  func dictionary() -> [String: Any] {
    var result: [String: Any] = [
      "isDirectory": isDirectory,
      "isDownloaded": isDownloaded,
      "isDownloading": isDownloading,
      "isUploaded": isUploaded,
      "isUploading": isUploading,
    ]
    if let downloadStatus {
      result["downloadStatus"] = downloadStatus
    }
    if let size {
      result["size"] = Double(size)
    }
    if let modified {
      result["modifiedAt"] = modified.timeIntervalSince1970 * 1000
    }
    if let percentDownloaded {
      result["percentDownloaded"] = percentDownloaded
    }
    if let uploadError {
      result["uploadError"] = ItemInfo.errorDictionary(uploadError)
    }
    if let downloadError {
      result["downloadError"] = ItemInfo.errorDictionary(downloadError)
    }
    return result
  }

  /// `kind` is what the backup service needs to tell the student: a full iCloud, no server, or something else.
  static func errorDictionary(_ error: NSError) -> [String: Any] {
    var kind = "other"
    if error.domain == NSCocoaErrorDomain {
      switch error.code {
      case CocoaError.Code.ubiquitousFileNotUploadedDueToQuota.rawValue:
        kind = "quota"
      case CocoaError.Code.ubiquitousFileUbiquityServerNotAvailable.rawValue:
        kind = "server-unavailable"
      case CocoaError.Code.ubiquitousFileUnavailable.rawValue:
        kind = "unavailable"
      default:
        break
      }
    }
    return [
      "kind": kind,
      "domain": error.domain,
      "code": error.code,
      "message": error.localizedDescription,
    ]
  }

  static func downloadStatusName(_ status: URLUbiquitousItemDownloadingStatus?) -> String? {
    guard let status else {
      return nil
    }
    if status == .current {
      return "current"
    }
    if status == .downloaded {
      return "downloaded"
    }
    if status == .notDownloaded {
      return "not-downloaded"
    }
    return nil
  }
}

/// One NSMetadataQuery result.
struct UbiquityItem {
  let url: URL
  let name: String
  let info: ItemInfo

  init?(_ item: NSMetadataItem) {
    guard let url = item.value(forAttribute: NSMetadataItemURLKey) as? URL else {
      return nil
    }
    self.url = url
    self.name = (item.value(forAttribute: NSMetadataItemFSNameKey) as? String) ?? url.lastPathComponent

    func flag(_ key: String) -> Bool {
      return (item.value(forAttribute: key) as? NSNumber)?.boolValue ?? false
    }

    var info = ItemInfo()
    info.isDirectory = (item.value(forAttribute: NSMetadataItemContentTypeKey) as? String) == "public.folder"
    info.hasLocalData = false
    let status = item.value(forAttribute: NSMetadataUbiquitousItemDownloadingStatusKey) as? String
    if status == NSMetadataUbiquitousItemDownloadingStatusCurrent {
      info.downloadStatus = "current"
    } else if status == NSMetadataUbiquitousItemDownloadingStatusDownloaded {
      info.downloadStatus = "downloaded"
    } else if status == NSMetadataUbiquitousItemDownloadingStatusNotDownloaded {
      info.downloadStatus = "not-downloaded"
    } else {
      info.downloadStatus = nil
    }
    info.isDownloading = flag(NSMetadataUbiquitousItemIsDownloadingKey)
    info.isUploaded = flag(NSMetadataUbiquitousItemIsUploadedKey)
    info.isUploading = flag(NSMetadataUbiquitousItemIsUploadingKey)
    info.size = (item.value(forAttribute: NSMetadataItemFSSizeKey) as? NSNumber)?.int64Value
    info.modified = item.value(forAttribute: NSMetadataItemFSContentChangeDateKey) as? Date
    info.percentDownloaded = (item.value(forAttribute: NSMetadataUbiquitousItemPercentDownloadedKey) as? NSNumber)?.doubleValue
    info.uploadError = item.value(forAttribute: NSMetadataUbiquitousItemUploadingErrorKey) as? NSError
    info.downloadError = item.value(forAttribute: NSMetadataUbiquitousItemDownloadingErrorKey) as? NSError
    self.info = info
  }
}

/**
 NSMetadataQuery over the app's ubiquitous Documents scope.

 Threading rule: an NSMetadataQuery is CREATED, STARTED, OBSERVED and STOPPED only on the main queue.
 The query needs the main run loop: started from a background queue it never posts its notifications.
 So every entry point hops to `DispatchQueue.main.async`, the query's `operationQueue` and the
 notification observers use `OperationQueue.main`, and the timeout runs on `DispatchQueue.main`.
 Results go back to the caller's queue (the module's background queue) with `deliverOn.async`.
 Instances and the `running` registry are touched only on the main thread.

 Callers must have looked up the container (url(forUbiquityContainerIdentifier:), off the main thread)
 at least once before searching; the module does that before any query.
 */
final class UbiquityQuery {
  enum Failure: Error {
    case timedOut
    case notFound
    case couldNotStart
    case downloadFailed(NSError)
  }

  /// Keeps each query alive until it finishes. Main thread only.
  private static var running: [ObjectIdentifier: UbiquityQuery] = [:]

  private let query: NSMetadataQuery
  private var observers: [NSObjectProtocol] = []
  private var finished = false
  /// Called on main with every result set; `gathered` is false while the initial gathering is still running.
  private let onResults: (UbiquityQuery, [UbiquityItem], _ gathered: Bool) -> Void
  /// Called on main once, when the query times out or fails to start.
  private let onFailure: (Failure) -> Void

  private init(
    predicate: NSPredicate,
    onResults: @escaping (UbiquityQuery, [UbiquityItem], Bool) -> Void,
    onFailure: @escaping (Failure) -> Void
  ) {
    dispatchPrecondition(condition: .onQueue(.main))
    self.query = NSMetadataQuery()
    self.onResults = onResults
    self.onFailure = onFailure
    query.searchScopes = [NSMetadataQueryUbiquitousDocumentsScope]
    query.predicate = predicate
    query.operationQueue = OperationQueue.main
    query.notificationBatchingInterval = 0.3
  }

  // MARK: - Entry points (call from any queue except where noted)

  /**
   One gathering pass: every item matching `predicate` once the initial gathering finishes.
   `completion` runs on `deliverOn`.
   */
  static func snapshot(
    predicate: NSPredicate,
    timeout: TimeInterval,
    deliverOn queue: DispatchQueue,
    completion: @escaping (Result<[UbiquityItem], Failure>) -> Void
  ) {
    DispatchQueue.main.async {
      let runner = UbiquityQuery(
        predicate: predicate,
        onResults: { runner, items, gathered in
          guard gathered else {
            return
          }
          runner.finish()
          queue.async { completion(.success(items)) }
        },
        onFailure: { failure in
          queue.async { completion(.failure(failure)) }
        }
      )
      runner.start(timeout: timeout)
    }
  }

  /**
   The single item at `url`, or nil when iCloud does not know it. `completion` runs on `deliverOn`.
   */
  static func item(
    at url: URL,
    timeout: TimeInterval,
    deliverOn queue: DispatchQueue,
    completion: @escaping (Result<UbiquityItem?, Failure>) -> Void
  ) {
    let target = canonicalPath(url)
    snapshot(predicate: namePredicate(url), timeout: timeout, deliverOn: queue) { result in
      switch result {
      case .success(let items):
        completion(.success(items.first { canonicalPath($0.url) == target }))
      case .failure(let failure):
        completion(.failure(failure))
      }
    }
  }

  /**
   Waits until the item at `url` is fully downloaded (status "current"). Call it after
   FileManager.startDownloadingUbiquitousItem(at:). Fails with `.notFound` when the gathering
   finishes without the item, `.downloadFailed` when iCloud reports a download error, and
   `.timedOut` after `timeout`. `progress` (percent 0...100) and `completion` run on `deliverOn`.
   */
  static func waitForDownload(
    of url: URL,
    timeout: TimeInterval,
    deliverOn queue: DispatchQueue,
    progress: @escaping (Double) -> Void,
    completion: @escaping (Result<UbiquityItem, Failure>) -> Void
  ) {
    let target = canonicalPath(url)
    let predicate = namePredicate(url)
    DispatchQueue.main.async {
      var lastPercent = -1.0
      // The initial gathering can still carry the error of an EARLIER failed download, from before
      // startDownloadingUbiquitousItem was called. Only an error reported by a later update (once
      // gathering is over and iCloud has reacted to this request) ends the wait; else the timeout does.
      var gatheredBefore = false
      let runner = UbiquityQuery(
        predicate: predicate,
        onResults: { runner, items, gathered in
          let isUpdate = gatheredBefore
          gatheredBefore = gatheredBefore || gathered
          guard let item = items.first(where: { canonicalPath($0.url) == target }) else {
            if gathered {
              runner.finish()
              queue.async { completion(.failure(.notFound)) }
            }
            return
          }
          if item.info.downloadStatus == "current" {
            runner.finish()
            queue.async { completion(.success(item)) }
            return
          }
          if isUpdate, let error = item.info.downloadError, !item.info.isDownloading {
            runner.finish()
            queue.async { completion(.failure(.downloadFailed(error))) }
            return
          }
          if let percent = item.info.percentDownloaded, percent != lastPercent {
            lastPercent = percent
            queue.async { progress(percent) }
          }
        },
        onFailure: { failure in
          queue.async { completion(.failure(failure)) }
        }
      )
      runner.start(timeout: timeout)
    }
  }

  // MARK: - Paths

  /**
   A path that compares equal for the same file whichever way it was spelled: the container can be
   reported under /private/var or /var, with or without a trailing slash.
   */
  static func canonicalPath(_ url: URL) -> String {
    var path = url.standardizedFileURL.path
    if path.hasPrefix("/private/var/") {
      path.removeFirst("/private".count)
    }
    while path.count > 1 && path.hasSuffix("/") {
      path.removeLast()
    }
    return path
  }

  /// Matches by file name (cheap to index), then callers compare the canonical path.
  private static func namePredicate(_ url: URL) -> NSPredicate {
    return NSPredicate(format: "%K == %@", NSMetadataItemFSNameKey, url.lastPathComponent)
  }

  // MARK: - Main-thread lifecycle

  private func start(timeout: TimeInterval) {
    dispatchPrecondition(condition: .onQueue(.main))
    UbiquityQuery.running[ObjectIdentifier(self)] = self

    let center = NotificationCenter.default
    let names: [Notification.Name] = [.NSMetadataQueryDidFinishGathering, .NSMetadataQueryDidUpdate]
    for name in names {
      let token = center.addObserver(forName: name, object: query, queue: OperationQueue.main) { [weak self] _ in
        self?.deliver()
      }
      observers.append(token)
    }

    DispatchQueue.main.asyncAfter(deadline: .now() + max(timeout, 0.5)) { [weak self] in
      guard let self, !self.finished else {
        return
      }
      self.finish()
      self.onFailure(.timedOut)
    }

    if !query.start() {
      finish()
      onFailure(.couldNotStart)
    }
  }

  private func deliver() {
    dispatchPrecondition(condition: .onQueue(.main))
    guard !finished else {
      return
    }
    // Results must not change while they are read.
    query.disableUpdates()
    var items: [UbiquityItem] = []
    items.reserveCapacity(query.resultCount)
    for index in 0..<query.resultCount {
      if let metadata = query.result(at: index) as? NSMetadataItem, let item = UbiquityItem(metadata) {
        items.append(item)
      }
    }
    query.enableUpdates()
    onResults(self, items, !query.isGathering)
  }

  /// Stops the query and drops it. Safe to call more than once. Main thread only.
  func finish() {
    dispatchPrecondition(condition: .onQueue(.main))
    guard !finished else {
      return
    }
    finished = true
    query.stop()
    let center = NotificationCenter.default
    for token in observers {
      center.removeObserver(token)
    }
    observers.removeAll()
    UbiquityQuery.running[ObjectIdentifier(self)] = nil
  }
}
