package net.qustudent.pdfrender

import android.app.Service
import android.content.ComponentCallbacks2
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Looper
import android.os.Message
import android.os.Messenger
import android.os.RemoteException
import android.util.Log

/**
 * The wire protocol between PdfServiceClient (app process) and PdfRenderService (':pdf' process).
 *
 * A request is a Message with what = OP_*, arg1 = request id, replyTo = the client's Messenger and a
 * Bundle of plain values (strings, numbers, booleans, primitive arrays). The reply has what = REPLY_OK or
 * REPLY_ERROR and the same arg1. Only paths and sizes travel; bitmaps never cross processes.
 */
internal object PdfProtocol {
  const val OP_INSPECT = 1
  const val OP_OPEN = 2
  const val OP_PAGE_SIZES = 3
  const val OP_RENDER_REGION = 4
  const val OP_RENDER_PAGE = 5
  const val OP_PROBE = 6
  const val OP_SAVE_DECRYPTED = 7
  const val OP_CLOSE = 8
  const val OP_CLOSE_ALL = 9

  const val REPLY_OK = 100
  const val REPLY_ERROR = 101

  // Request keys
  const val K_PATH = "path"
  const val K_PASSWORD = "password"
  const val K_HANDLE = "handle"
  const val K_PAGE = "page"
  const val K_FROM = "from"
  const val K_COUNT = "count"
  const val K_X = "x"
  const val K_Y = "y"
  const val K_W = "w"
  const val K_H = "h"
  const val K_WIDTH_PX = "widthPx"
  const val K_HEIGHT_PX = "heightPx"
  const val K_OUT_PATH = "outPath"
  const val K_FORMAT = "format"
  const val K_QUALITY = "quality"
  const val K_DEST = "dest"

  // Reply keys
  const val R_CODE = "code"
  const val R_MESSAGE = "message"
  const val R_PAGE_COUNT = "pageCount"
  const val R_ENCRYPTED = "encrypted"
  const val R_NEEDS_PASSWORD = "needsPassword"
  const val R_WIDTHS = "widths"
  const val R_HEIGHTS = "heights"
  const val R_ROTATIONS = "rotations"
  const val R_URI = "uri"
  const val R_WIDTH = "width"
  const val R_HEIGHT = "height"

  // Error codes (same strings as PDF_NATIVE_ERROR_CODES in modules/pdf-render/src/PdfRender.types.ts)
  const val ERR_PASSWORD = "ERR_PDF_PASSWORD"
  const val ERR_WRONG_PASSWORD = "ERR_PDF_WRONG_PASSWORD"
  const val ERR_DAMAGED = "ERR_PDF_DAMAGED"
  const val ERR_UNSUPPORTED = "ERR_PDF_UNSUPPORTED"
  const val ERR_IO = "ERR_PDF_IO"
  const val ERR_CRASHED = "ERR_PDF_CRASHED"

  /** Process name suffix of the service (android:process=':pdf' in the module's AndroidManifest). */
  const val PROCESS_SUFFIX = ":pdf"

  fun opName(op: Int): String = when (op) {
    OP_INSPECT -> "inspect"
    OP_OPEN -> "open"
    OP_PAGE_SIZES -> "pageSizes"
    OP_RENDER_REGION -> "renderRegion"
    OP_RENDER_PAGE -> "renderPage"
    OP_PROBE -> "probe"
    OP_SAVE_DECRYPTED -> "saveDecrypted"
    OP_CLOSE -> "close"
    OP_CLOSE_ALL -> "closeAll"
    else -> "op$op"
  }
}

/**
 * Bound service in the private ':pdf' process (android:exported=false, so only this app can bind).
 *
 * Every request is handled by PdfiumWorker on ONE HandlerThread, in arrival order, so PDFium is never
 * entered from two threads. A failure is answered with REPLY_ERROR and an ERR_PDF_* code; only a native
 * crash inside PDFium can end this process, and the client turns that into ERR_PDF_CRASHED.
 */
class PdfRenderService : Service() {
  private var thread: HandlerThread? = null
  private var handler: WorkerHandler? = null
  private var messenger: Messenger? = null

  override fun onCreate() {
    super.onCreate()
    val t = HandlerThread("PdfiumWorker")
    t.start()
    val h = WorkerHandler(t.looper, PdfiumWorker(applicationContext))
    thread = t
    handler = h
    messenger = Messenger(h)
  }

  override fun onBind(intent: Intent?): IBinder? = messenger?.binder

  @Suppress("DEPRECATION") // TRIM_MEMORY_RUNNING_LOW is deprecated from API 34 but still delivered below it.
  override fun onTrimMemory(level: Int) {
    super.onTrimMemory(level)
    val h = handler ?: return
    if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) {
      // Runs on the worker thread, after the request in progress.
      h.post { h.worker.trim() }
    }
  }

  override fun onDestroy() {
    val h = handler
    val t = thread
    handler = null
    messenger = null
    thread = null
    if (h != null && t != null) {
      // Close the documents on the worker thread (PDFium is only ever entered there), then stop it.
      h.post {
        h.worker.closeAll()
        t.quitSafely()
      }
    }
    super.onDestroy()
  }

  private class WorkerHandler(looper: Looper, val worker: PdfiumWorker) : Handler(looper) {
    override fun handleMessage(msg: Message) {
      val replyTo = msg.replyTo ?: return
      val op = msg.what
      val id = msg.arg1
      val data: Bundle = msg.data ?: Bundle()

      var what = PdfProtocol.REPLY_OK
      val result: Bundle = try {
        worker.handle(op, data)
      } catch (e: PdfWorkerError) {
        what = PdfProtocol.REPLY_ERROR
        errorBundle(e.code, e.message ?: e.code)
      } catch (e: OutOfMemoryError) {
        worker.trim()
        what = PdfProtocol.REPLY_ERROR
        errorBundle(PdfProtocol.ERR_IO, "Out of memory in ${PdfProtocol.opName(op)}")
      } catch (e: Throwable) {
        what = PdfProtocol.REPLY_ERROR
        Log.w(TAG, "${PdfProtocol.opName(op)} failed", e)
        errorBundle(PdfProtocol.ERR_IO, "${PdfProtocol.opName(op)} failed: ${e.javaClass.simpleName}: ${e.message}")
      }

      val reply = Message.obtain(null, what, id, 0)
      reply.data = result
      try {
        replyTo.send(reply)
      } catch (e: RemoteException) {
        // The app process is gone or unbound; nothing to answer.
        Log.w(TAG, "reply to ${PdfProtocol.opName(op)} not delivered", e)
      }
    }

    private fun errorBundle(code: String, message: String): Bundle = Bundle().apply {
      putString(PdfProtocol.R_CODE, code)
      putString(PdfProtocol.R_MESSAGE, message)
    }
  }

  private companion object {
    const val TAG = "PdfRenderService"
  }
}
