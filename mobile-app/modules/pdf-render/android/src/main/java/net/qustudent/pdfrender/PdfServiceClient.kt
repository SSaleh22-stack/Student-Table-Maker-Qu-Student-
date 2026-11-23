package net.qustudent.pdfrender

import android.app.ActivityManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Message
import android.os.Messenger
import android.os.Process
import android.os.RemoteException
import android.os.SystemClock
import android.util.Log
import expo.modules.kotlin.exception.CodedException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import java.io.File
import kotlin.math.max

/** A rejection with one of the ERR_PDF_* codes of PdfRender.types.ts (Expo hands `code` to JS). */
class PdfException(code: String, message: String, cause: Throwable? = null) : CodedException(code, message, cause)

data class PdfCrash(val path: String, val page: Int)

data class PdfInspectResult(val pageCount: Int, val encrypted: Boolean, val needsPassword: Boolean)

data class PdfOpenResult(val handle: String, val pageCount: Int)

data class PdfPageSize(val w: Double, val h: Double, val rotation: Int)

data class PdfRenderResult(val uri: String, val width: Int, val height: Int)

/**
 * App-process side of the ':pdf' renderer. Never touches PDFium itself.
 *
 * - Binds PdfRenderService with BIND_AUTO_CREATE on the first call. Requests carry an id; each completes
 *   through a CompletableDeferred when the reply Message arrives on this client's own HandlerThread.
 * - When the ':pdf' process dies (onServiceDisconnected, onBindingDied, binderDied, or a DeadObjectException on
 *   send), EVERY in-flight request rejects with ERR_PDF_CRASHED (the message names its path and page), the
 *   binding is dropped, and the next call binds again (lazily). The request whose send() hit the dead binder never
 *   reached the service, so it is not rejected: it binds again and is sent once more. The oldest request that had reached the service
 *   is the one being worked on (the service is strictly FIFO); if it was a page request (renderRegion,
 *   renderPage, probe) its {path, page} is persisted to filesDir/pdf-crash.json and returned by
 *   lastRenderCrash() until clearRenderCrash().
 * - A request that runs past its op's time limit counts as a crash too: the ':pdf' process is killed (same uid,
 *   so Process.killProcess is allowed) so a PDF that hangs PDFium cannot freeze the notebook.
 * - Handles are created here. Each keeps its path and password in memory only, and every document request
 *   sends them along, so the service reopens a document on demand after an LRU eviction or a restart.
 * - After IDLE_UNBIND_MS without requests the binding is released (the service closes its documents); the next
 *   call binds again and documents reopen transparently.
 */
class PdfServiceClient private constructor(private val context: Context) {
  private class HandleInfo(val path: String, val password: String?)

  private class Pending(
    val id: Int,
    val seq: Long,
    val op: Int,
    val conn: Conn,
    val path: String?,
    val page: Int,
    val timeoutMs: Long,
  ) {
    val deferred = CompletableDeferred<Bundle>()
    var sent = false
    var sentAt = 0L
  }

  private inner class Conn : ServiceConnection, IBinder.DeathRecipient {
    val ready = CompletableDeferred<Messenger>()
    var binder: IBinder? = null // guarded by lock
    var messenger: Messenger? = null // guarded by lock
    var dead = false // guarded by lock
    var lastReplyAt = 0L // guarded by lock

    override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
      if (service == null) {
        died(this, "no binder")
        return
      }
      try {
        service.linkToDeath(this, 0)
      } catch (e: RemoteException) {
        died(this, "died while connecting")
        return
      }
      val m = Messenger(service)
      val stale = synchronized(lock) {
        if (dead) {
          true
        } else {
          binder = service
          messenger = m
          false
        }
      }
      if (stale) {
        try {
          service.unlinkToDeath(this, 0)
        } catch (e: Throwable) {
          // ignore
        }
        return
      }
      ready.complete(m)
    }

    override fun onServiceDisconnected(name: ComponentName?) = died(this, "process ended")

    override fun onBindingDied(name: ComponentName?) = died(this, "binding died")

    override fun onNullBinding(name: ComponentName?) = died(this, "no binder")

    override fun binderDied() = died(this, "process ended")
  }

  private val lock = Any()
  private val thread = HandlerThread("PdfRenderClient").apply { start() }
  private val handler = Handler(thread.looper) { msg ->
    onReply(msg)
    true
  }
  private val replyMessenger = Messenger(handler)

  // All guarded by lock
  private var conn: Conn? = null
  private val pending = HashMap<Int, Pending>()
  private val handles = HashMap<String, HandleInfo>()
  private var nextId = 1
  private var nextSeq = 1L
  private var nextHandle = 1
  private var lastActivityAt = 0L
  private var tickPosted = false
  private var crashLoaded = false
  private var crash: PdfCrash? = null

  // ---------------------------------------------------------------- API (mirrors PdfRenderNativeModule)

  suspend fun inspect(path: String): PdfInspectResult {
    val r = call(PdfProtocol.OP_INSPECT, Bundle().apply { putString(PdfProtocol.K_PATH, path) }, path, -1, TIMEOUT_OPEN_MS)
    return PdfInspectResult(
      r.getInt(PdfProtocol.R_PAGE_COUNT, 0),
      r.getBoolean(PdfProtocol.R_ENCRYPTED, false),
      r.getBoolean(PdfProtocol.R_NEEDS_PASSWORD, false),
    )
  }

  suspend fun open(path: String, password: String?): PdfOpenResult {
    val handle = synchronized(lock) { "pdf" + nextHandle++ }
    val data = Bundle().apply {
      putString(PdfProtocol.K_HANDLE, handle)
      putString(PdfProtocol.K_PATH, path)
      putString(PdfProtocol.K_PASSWORD, password)
    }
    val r = call(PdfProtocol.OP_OPEN, data, path, -1, TIMEOUT_OPEN_MS)
    synchronized(lock) { handles[handle] = HandleInfo(path, password) }
    return PdfOpenResult(handle, r.getInt(PdfProtocol.R_PAGE_COUNT, 0))
  }

  suspend fun pageSizes(handle: String, from: Int, count: Int): List<PdfPageSize> {
    val (info, data) = docRequest(handle)
    data.putInt(PdfProtocol.K_FROM, from)
    data.putInt(PdfProtocol.K_COUNT, count)
    val r = call(PdfProtocol.OP_PAGE_SIZES, data, info.path, -1, TIMEOUT_SIZES_MS)
    val ws = r.getDoubleArray(PdfProtocol.R_WIDTHS) ?: DoubleArray(0)
    val hs = r.getDoubleArray(PdfProtocol.R_HEIGHTS) ?: DoubleArray(0)
    val rs = r.getIntArray(PdfProtocol.R_ROTATIONS) ?: IntArray(0)
    val n = minOf(ws.size, hs.size, rs.size)
    return List(n) { i -> PdfPageSize(ws[i], hs[i], rs[i]) }
  }

  suspend fun renderRegion(
    handle: String,
    page: Int,
    x: Double,
    y: Double,
    w: Double,
    h: Double,
    widthPx: Int,
    heightPx: Int,
    outPath: String,
    format: String,
    quality: Double,
  ): PdfRenderResult {
    val (info, data) = docRequest(handle)
    data.putInt(PdfProtocol.K_PAGE, page)
    data.putDouble(PdfProtocol.K_X, x)
    data.putDouble(PdfProtocol.K_Y, y)
    data.putDouble(PdfProtocol.K_W, w)
    data.putDouble(PdfProtocol.K_H, h)
    data.putInt(PdfProtocol.K_WIDTH_PX, widthPx)
    data.putInt(PdfProtocol.K_HEIGHT_PX, heightPx)
    data.putString(PdfProtocol.K_OUT_PATH, outPath)
    data.putString(PdfProtocol.K_FORMAT, format)
    data.putDouble(PdfProtocol.K_QUALITY, quality)
    return renderResult(call(PdfProtocol.OP_RENDER_REGION, data, info.path, page, TIMEOUT_RENDER_MS))
  }

  suspend fun renderPage(
    handle: String,
    page: Int,
    widthPx: Int,
    outPath: String,
    format: String,
    quality: Double,
  ): PdfRenderResult {
    val (info, data) = docRequest(handle)
    data.putInt(PdfProtocol.K_PAGE, page)
    data.putInt(PdfProtocol.K_WIDTH_PX, widthPx)
    data.putString(PdfProtocol.K_OUT_PATH, outPath)
    data.putString(PdfProtocol.K_FORMAT, format)
    data.putDouble(PdfProtocol.K_QUALITY, quality)
    return renderResult(call(PdfProtocol.OP_RENDER_PAGE, data, info.path, page, TIMEOUT_RENDER_MS))
  }

  suspend fun probe(handle: String, page: Int) {
    val (info, data) = docRequest(handle)
    data.putInt(PdfProtocol.K_PAGE, page)
    call(PdfProtocol.OP_PROBE, data, info.path, page, TIMEOUT_RENDER_MS)
  }

  suspend fun saveDecrypted(src: String, password: String, dest: String) {
    val data = Bundle().apply {
      putString(PdfProtocol.K_PATH, src)
      putString(PdfProtocol.K_PASSWORD, password)
      putString(PdfProtocol.K_DEST, dest)
    }
    call(PdfProtocol.OP_SAVE_DECRYPTED, data, src, -1, TIMEOUT_SAVE_MS)
  }

  /** Forgets the handle and closes it in the service if the service is running. Never binds just to close. */
  suspend fun close(handle: String) {
    val known = synchronized(lock) { handles.remove(handle) != null }
    if (!known || liveMessenger() == null) return
    try {
      call(PdfProtocol.OP_CLOSE, Bundle().apply { putString(PdfProtocol.K_HANDLE, handle) }, null, -1, TIMEOUT_CLOSE_MS)
    } catch (e: PdfException) {
      // The service is gone, so the document is closed anyway.
    }
  }

  /** Forgets every handle (the JS runtime that owned them is gone) and asks the service to close all. */
  fun forgetAll() {
    synchronized(lock) { handles.clear() }
    val m = liveMessenger() ?: return
    try {
      // Fire and forget: id 0 is never a pending id, so the reply is dropped.
      m.send(Message.obtain(null, PdfProtocol.OP_CLOSE_ALL, 0, 0).apply { replyTo = replyMessenger })
    } catch (e: RemoteException) {
      // the process is gone; its documents with it
    }
  }

  /** Sync. The last page whose render crashed the renderer, or null (read from filesDir/pdf-crash.json once). */
  fun lastRenderCrash(): PdfCrash? = synchronized(lock) {
    if (!crashLoaded) {
      crashLoaded = true
      crash = readCrashFile()
    }
    crash
  }

  /** Sync. Forgets the crash entry. */
  fun clearRenderCrash() {
    synchronized(lock) {
      crash = null
      crashLoaded = true
    }
    try {
      crashFile().delete()
    } catch (e: Throwable) {
      // ignore
    }
  }

  // ---------------------------------------------------------------- requests

  private fun docRequest(handle: String): Pair<HandleInfo, Bundle> {
    val info = synchronized(lock) { handles[handle] }
      ?: throw PdfException(PdfProtocol.ERR_IO, "Unknown or closed PDF handle")
    val data = Bundle().apply {
      putString(PdfProtocol.K_HANDLE, handle)
      putString(PdfProtocol.K_PATH, info.path)
      putString(PdfProtocol.K_PASSWORD, info.password)
    }
    return Pair(info, data)
  }

  private fun renderResult(r: Bundle): PdfRenderResult = PdfRenderResult(
    r.getString(PdfProtocol.R_URI) ?: throw PdfException(PdfProtocol.ERR_IO, "Renderer returned no image"),
    r.getInt(PdfProtocol.R_WIDTH, 0),
    r.getInt(PdfProtocol.R_HEIGHT, 0),
  )

  private suspend fun call(op: Int, data: Bundle, path: String?, page: Int, timeoutMs: Long): Bundle {
    var attempt = 0
    while (true) {
      val (c, messenger) = connection()
      var sendFailed = false
      val p = synchronized(lock) {
        if (c.dead) {
          null
        } else {
          val id = nextId
          nextId = if (nextId >= Int.MAX_VALUE - 1) 1 else nextId + 1
          val created = Pending(id, nextSeq++, op, c, path, page, timeoutMs)
          created.sentAt = SystemClock.elapsedRealtime()
          lastActivityAt = created.sentAt
          pending[id] = created
          val msg = Message.obtain(null, op, id, 0)
          msg.data = data
          msg.replyTo = replyMessenger
          // Sent under the lock: requests reach the FIFO service in seq order (so the culprit of a crash is the
          // oldest sent one), and `sent` is never true for a request that did not reach the service. send() is
          // a oneway binder call and never waits for the ':pdf' process.
          try {
            messenger.send(msg)
            created.sent = true
          } catch (e: RemoteException) {
            // DeadObjectException: the process died before this request reached it. It never ran, so it is
            // taken out of the binding's in-flight list (it is no victim of that death) and sent again below.
            pending.remove(id)
            sendFailed = true
          }
          created
        }
      }
      if (sendFailed && p != null) {
        // Rejects what WAS sent on that binding (ERR_PDF_CRASHED) and drops it; this request binds again.
        died(c, "process ended")
      }
      if (p == null || sendFailed) {
        // The binding was dropped (idle release or a crash) between connection() and here, or the process was
        // already dead when this request was sent. Nothing of this request ran, so binding again is safe.
        attempt++
        if (attempt < CONNECT_ATTEMPTS) continue
        throw PdfException(PdfProtocol.ERR_CRASHED, crashMessage(op, path, page, false, "process ended"))
      }
      scheduleTick()

      try {
        return p.deferred.await()
      } catch (e: CancellationException) {
        synchronized(lock) { pending.remove(p.id) }
        throw e
      }
    }
  }

  private suspend fun connection(): Pair<Conn, Messenger> {
    val (c, bindNow) = synchronized(lock) {
      val cur = conn
      if (cur != null && !cur.dead) {
        Pair(cur, false)
      } else {
        val fresh = Conn()
        conn = fresh
        lastActivityAt = SystemClock.elapsedRealtime()
        Pair(fresh, true)
      }
    }
    if (bindNow) {
      val ok = try {
        context.bindService(Intent(context, PdfRenderService::class.java), c, Context.BIND_AUTO_CREATE)
      } catch (e: Exception) {
        // SecurityException, or an IllegalArgumentException from a broken manifest merge: never leave this
        // binding half-registered, report it instead.
        Log.w(TAG, "bindService failed", e)
        false
      }
      if (!ok) {
        died(c, "bind failed")
        throw PdfException(PdfProtocol.ERR_IO, "The PDF renderer service is not available")
      }
      scheduleTick()
    }
    val m = try {
      withTimeout(CONNECT_TIMEOUT_MS) { c.ready.await() }
    } catch (e: TimeoutCancellationException) {
      killPdfProcess()
      died(c, "did not start")
      throw PdfException(PdfProtocol.ERR_CRASHED, "The PDF renderer did not start")
    }
    return Pair(c, m)
  }

  private fun onReply(msg: Message) {
    val now = SystemClock.elapsedRealtime()
    val p = synchronized(lock) {
      val found = pending.remove(msg.arg1)
      // Every reply (also one for a cancelled request or the fire-and-forget closeAll) means the FIFO service
      // moved on to the next request, so the watchdog measures the next head from now.
      if (found != null) found.conn.lastReplyAt = now else conn?.lastReplyAt = now
      lastActivityAt = now
      found
    } ?: return
    val data = msg.data ?: Bundle()
    if (msg.what == PdfProtocol.REPLY_OK) {
      p.deferred.complete(data)
    } else {
      val code = data.getString(PdfProtocol.R_CODE) ?: PdfProtocol.ERR_IO
      val message = data.getString(PdfProtocol.R_MESSAGE) ?: "${PdfProtocol.opName(p.op)} failed"
      p.deferred.completeExceptionally(PdfException(code, message))
    }
  }

  /**
   * Drops a binding: rejects its in-flight requests with ERR_PDF_CRASHED and records the culprit page.
   * With idleOnly, does nothing when a request arrived on this binding in the meantime.
   */
  private fun died(c: Conn, reason: String, idleOnly: Boolean = false) {
    val snapshot = synchronized(lock) {
      if (c.dead || (idleOnly && pending.values.any { it.conn === c })) {
        null
      } else {
        c.dead = true
        if (conn === c) conn = null
        val victims = pending.values.filter { it.conn === c }.sortedBy { it.seq }
        victims.forEach { pending.remove(it.id) }
        val b = c.binder
        c.binder = null
        c.messenger = null
        Pair(victims, b)
      }
    } ?: return
    val (victims, binder) = snapshot

    try {
      binder?.unlinkToDeath(c, 0)
    } catch (e: Throwable) {
      // ignore
    }
    try {
      context.unbindService(c)
    } catch (e: Throwable) {
      // not bound (bindService failed) or already unbound
    }
    c.ready.completeExceptionally(PdfException(PdfProtocol.ERR_CRASHED, "The PDF renderer stopped ($reason)"))

    if (victims.isEmpty()) return
    val culprit = victims.firstOrNull { it.sent }
    val culpritPath = culprit?.path
    if (culprit != null && culpritPath != null && culprit.page >= 0 && isPageOp(culprit.op)) {
      recordCrash(PdfCrash(culpritPath, culprit.page))
    }
    Log.w(TAG, "PDF renderer stopped ($reason) with ${victims.size} request(s) in flight")
    for (v in victims) {
      v.deferred.completeExceptionally(
        PdfException(PdfProtocol.ERR_CRASHED, crashMessage(v.op, v.path, v.page, v === culprit, reason)),
      )
    }
  }

  // ---------------------------------------------------------------- watchdog and idle release

  private fun scheduleTick() {
    synchronized(lock) {
      if (tickPosted) return
      tickPosted = true
    }
    handler.postDelayed({ tick() }, TICK_MS)
  }

  private fun tick() {
    val now = SystemClock.elapsedRealtime()
    var hung: Conn? = null
    var idle: Conn? = null
    var reason = ""
    val keepTicking = synchronized(lock) {
      tickPosted = false
      val c = conn
      if (c != null && !c.dead) {
        val head = pending.values.filter { it.conn === c && it.sent }.minByOrNull { it.seq }
        if (head != null) {
          // FIFO service: the head started when it was sent or when the request before it was answered.
          val started = max(head.sentAt, c.lastReplyAt)
          if (now - started > head.timeoutMs) {
            hung = c
            reason = "${PdfProtocol.opName(head.op)} took longer than ${head.timeoutMs / 1000} s"
          }
        } else if (pending.isEmpty() && c.ready.isCompleted && now - lastActivityAt > IDLE_UNBIND_MS) {
          idle = c
        }
      }
      conn != null || pending.isNotEmpty()
    }
    hung?.let { c ->
      killPdfProcess()
      died(c, reason)
    }
    idle?.let { c -> died(c, "idle", idleOnly = true) }
    if (keepTicking && hung == null) scheduleTick()
  }

  private fun killPdfProcess() {
    try {
      val am = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return
      // A process name that starts with ':' is appended to the PACKAGE name (not to android:process of the app).
      val name = context.packageName + PdfProtocol.PROCESS_SUFFIX
      val me = Process.myPid()
      am.runningAppProcesses?.forEach { info ->
        if (info.processName == name && info.pid != me) Process.killProcess(info.pid)
      }
    } catch (e: Throwable) {
      Log.w(TAG, "could not stop the PDF renderer process", e)
    }
  }

  private fun liveMessenger(): Messenger? = synchronized(lock) { conn?.takeIf { !it.dead }?.messenger }

  // ---------------------------------------------------------------- crash record

  private fun crashFile() = File(context.filesDir, CRASH_FILE)

  private fun recordCrash(entry: PdfCrash) {
    synchronized(lock) {
      crash = entry
      crashLoaded = true
    }
    try {
      val json = JSONObject().put("path", entry.path).put("page", entry.page).toString()
      val file = crashFile()
      val tmp = File(file.parentFile, "$CRASH_FILE.tmp")
      tmp.writeText(json)
      if (!tmp.renameTo(file)) {
        file.delete()
        tmp.renameTo(file)
      }
    } catch (e: Throwable) {
      Log.w(TAG, "could not persist the render crash", e)
    }
  }

  private fun readCrashFile(): PdfCrash? = try {
    val file = crashFile()
    if (!file.isFile) {
      null
    } else {
      val o = JSONObject(file.readText())
      val path = o.optString("path", "")
      val page = o.optInt("page", -1)
      if (path.isEmpty() || page < 0) null else PdfCrash(path, page)
    }
  } catch (e: Throwable) {
    null
  }

  private fun isPageOp(op: Int) =
    op == PdfProtocol.OP_RENDER_REGION || op == PdfProtocol.OP_RENDER_PAGE || op == PdfProtocol.OP_PROBE

  private fun crashMessage(op: Int, path: String?, page: Int, culprit: Boolean, reason: String): String {
    val where = buildString {
      append(PdfProtocol.opName(op))
      if (page >= 0) append(" page=").append(page)
      if (path != null) append(" path=").append(path)
    }
    return if (culprit) {
      "PDF renderer crashed while working on $where ($reason)"
    } else {
      "PDF renderer stopped before $where was done ($reason)"
    }
  }

  companion object {
    private const val TAG = "PdfServiceClient"
    private const val CRASH_FILE = "pdf-crash.json"
    private const val CONNECT_TIMEOUT_MS = 15_000L
    private const val CONNECT_ATTEMPTS = 3
    private const val TIMEOUT_OPEN_MS = 60_000L
    private const val TIMEOUT_SIZES_MS = 120_000L
    private const val TIMEOUT_RENDER_MS = 45_000L
    private const val TIMEOUT_SAVE_MS = 300_000L
    private const val TIMEOUT_CLOSE_MS = 10_000L
    private const val TICK_MS = 2_000L
    private const val IDLE_UNBIND_MS = 120_000L

    @Volatile
    private var instance: PdfServiceClient? = null

    fun get(context: Context): PdfServiceClient =
      instance ?: synchronized(this) {
        instance ?: PdfServiceClient(context.applicationContext ?: context).also { instance = it }
      }

    /** The client if one was created; never creates it. */
    fun peek(): PdfServiceClient? = instance
  }
}
