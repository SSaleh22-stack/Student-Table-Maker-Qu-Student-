package net.qustudent.pdfrender

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.ParcelFileDescriptor
import io.legere.pdfiumandroid.PdfDocument
import io.legere.pdfiumandroid.PdfPage
import io.legere.pdfiumandroid.PdfiumCore
import io.legere.pdfiumandroid.api.PdfPasswordException
import io.legere.pdfiumandroid.api.PdfWriteCallback
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileNotFoundException
import java.io.FileOutputStream
import java.io.IOException
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.roundToLong

/**
 * All PDFium work. Runs ONLY in the ':pdf' process, on PdfRenderService's single worker thread.
 *
 * Library: io.legere:pdfiumandroid 2.0.1 (see the header of modules/pdf-render/android/build.gradle for the
 * verified API facts, the 16 KB check and the fallback artifact). API used here:
 * - PdfiumCore(context).newDocument(ParcelFileDescriptor, password: String?): PdfDocument
 *   (PdfPasswordException for a missing or wrong password, IOException("cannot create document: ...") otherwise)
 * - PdfDocument.getPageCount(), openPage(i): PdfPage?, saveAsCopy(PdfWriteCallback, FPDF_REMOVE_SECURITY), close()
 * - PdfPage.getPageWidthPoint()/getPageHeightPoint(): Int (displayed size: crop box, /Rotate applied),
 *   getPageBoundingBox(): RectF (the same box unrotated, floats: gives the fractional size),
 *   getPageRotation(): 0..3 (-1 on error), renderPageBitmap(bitmap, startX, startY, drawW, drawH, renderAnnot,
 *   textMask, canvasColor, pageBackgroundColor), close()
 *
 * Documents: an LRU of MAX_DOCS open documents keyed by the client's handle. Every document request carries
 * the handle plus its path and password (kept in memory only, never written anywhere), so an evicted document,
 * or every document after the process was restarted, is reopened on demand.
 *
 * Bitmaps: ARGB_8888, pre-filled white, one scratch bitmap reused for same-size tiles and recycled otherwise.
 * Regions are rendered by drawing the whole page at the region's scale with a negative offset.
 */
internal class PdfiumWorker(private val context: Context) {
  private class OpenDoc(val path: String, val password: String?, val doc: PdfDocument, val pageCount: Int)

  private var core: PdfiumCore? = null
  private var coreError: Throwable? = null

  /** accessOrder = true: iteration starts at the least recently used document. */
  private val docs = LinkedHashMap<String, OpenDoc>(8, 0.75f, true)

  private var scratch: Bitmap? = null

  fun handle(op: Int, data: Bundle): Bundle = when (op) {
    PdfProtocol.OP_INSPECT -> inspect(data)
    PdfProtocol.OP_OPEN -> open(data)
    PdfProtocol.OP_PAGE_SIZES -> pageSizes(data)
    PdfProtocol.OP_RENDER_REGION -> renderRegion(data)
    PdfProtocol.OP_RENDER_PAGE -> renderPage(data)
    PdfProtocol.OP_PROBE -> probe(data)
    PdfProtocol.OP_SAVE_DECRYPTED -> saveDecrypted(data)
    PdfProtocol.OP_CLOSE -> {
      data.getString(PdfProtocol.K_HANDLE)?.let { h -> docs.remove(h)?.let { closeDoc(it.doc) } }
      Bundle()
    }
    PdfProtocol.OP_CLOSE_ALL -> {
      closeAll()
      Bundle()
    }
    else -> throw PdfWorkerError(PdfProtocol.ERR_UNSUPPORTED, "Unknown operation $op")
  }

  /** Frees memory under pressure: the scratch bitmap and every document except the most recent one. */
  fun trim() {
    releaseScratch()
    while (docs.size > 1) evictEldest()
  }

  fun closeAll() {
    releaseScratch()
    val all = docs.values.toList()
    docs.clear()
    all.forEach { closeDoc(it.doc) }
  }

  // ---------------------------------------------------------------- operations

  private fun inspect(data: Bundle): Bundle {
    val path = requireString(data, PdfProtocol.K_PATH)
    return try {
      val doc = openDocument(path, null)
      val count = try {
        doc.getPageCount()
      } catch (e: Throwable) {
        -1
      } finally {
        closeDoc(doc)
      }
      if (count <= 0) throw PdfWorkerError(PdfProtocol.ERR_DAMAGED, "The document has no readable pages")
      inspectResult(count, encrypted = false, needsPassword = false)
    } catch (e: PdfWorkerError) {
      // PDFium cannot report an owner-password-only file as encrypted (it opens and renders without a
      // password), so `encrypted` is true exactly when a password is needed to open the file.
      if (e.code == PdfProtocol.ERR_PASSWORD) inspectResult(0, encrypted = true, needsPassword = true) else throw e
    }
  }

  private fun open(data: Bundle): Bundle {
    val od = docFor(data)
    return Bundle().apply { putInt(PdfProtocol.R_PAGE_COUNT, od.pageCount) }
  }

  private fun pageSizes(data: Bundle): Bundle {
    val od = docFor(data)
    val from = max(0, data.getInt(PdfProtocol.K_FROM, 0))
    val count = max(0, data.getInt(PdfProtocol.K_COUNT, 0))
    val end = min(od.pageCount.toLong(), from.toLong() + count.toLong()).toInt()
    val n = max(0, end - from)
    val widths = DoubleArray(n)
    val heights = DoubleArray(n)
    val rotations = IntArray(n)
    // A page that cannot be loaded gets the previous page's size (US Letter for the first), so one broken page
    // never makes the whole document unusable; the import probe marks that page damaged.
    var lastW = LETTER_W
    var lastH = LETTER_H
    for (k in 0 until n) {
      val index = from + k
      var w = lastW
      var h = lastH
      var rot = 0
      val page = loadPage(od, index)
      if (page != null) {
        try {
          displayedSize(page)?.let { (pw, ph) ->
            w = pw
            h = ph
          }
          rot = when (page.getPageRotation()) {
            1 -> 90
            2 -> 180
            3 -> 270
            else -> 0
          }
        } catch (e: Exception) {
          // keep the fallback size
        } finally {
          closePage(page)
        }
      }
      widths[k] = w
      heights[k] = h
      rotations[k] = rot
      lastW = w
      lastH = h
    }
    return Bundle().apply {
      putDoubleArray(PdfProtocol.R_WIDTHS, widths)
      putDoubleArray(PdfProtocol.R_HEIGHTS, heights)
      putIntArray(PdfProtocol.R_ROTATIONS, rotations)
    }
  }

  private fun renderRegion(data: Bundle): Bundle {
    val od = docFor(data)
    val pageIndex = data.getInt(PdfProtocol.K_PAGE, -1)
    val x = data.getDouble(PdfProtocol.K_X, 0.0)
    val y = data.getDouble(PdfProtocol.K_Y, 0.0)
    val w = data.getDouble(PdfProtocol.K_W, 0.0)
    val h = data.getDouble(PdfProtocol.K_H, 0.0)
    val widthPx = data.getInt(PdfProtocol.K_WIDTH_PX, 0)
    val heightPx = data.getInt(PdfProtocol.K_HEIGHT_PX, 0)
    if (!(x.isFinite() && y.isFinite() && w.isFinite() && h.isFinite()) || w <= 0.0 || h <= 0.0) {
      throw PdfWorkerError(PdfProtocol.ERR_IO, "Invalid region $x,$y ${w}x$h")
    }
    checkBitmapSize(widthPx, heightPx)
    val outPath = requireString(data, PdfProtocol.K_OUT_PATH)
    val format = data.getString(PdfProtocol.K_FORMAT) ?: "png"
    val quality = data.getDouble(PdfProtocol.K_QUALITY, DEFAULT_QUALITY)

    val uri = withPage(od, pageIndex) { page ->
      val (pw, ph) = pagePoints(page)
      renderToFile(page, pw, ph, x, y, w, h, widthPx, heightPx, outPath, format, quality)
    }
    return renderResult(uri, widthPx, heightPx)
  }

  private fun renderPage(data: Bundle): Bundle {
    val od = docFor(data)
    val pageIndex = data.getInt(PdfProtocol.K_PAGE, -1)
    val widthPx = data.getInt(PdfProtocol.K_WIDTH_PX, 0)
    val outPath = requireString(data, PdfProtocol.K_OUT_PATH)
    val format = data.getString(PdfProtocol.K_FORMAT) ?: "png"
    val quality = data.getDouble(PdfProtocol.K_QUALITY, DEFAULT_QUALITY)
    if (widthPx !in 1..MAX_SIDE) throw PdfWorkerError(PdfProtocol.ERR_IO, "Invalid width $widthPx")

    var heightPx = 0
    val uri = withPage(od, pageIndex) { page ->
      val (pw, ph) = pagePoints(page)
      heightPx = max(1, (widthPx * ph / pw).roundToInt())
      checkBitmapSize(widthPx, heightPx)
      renderToFile(page, pw, ph, 0.0, 0.0, pw, ph, widthPx, heightPx, outPath, format, quality)
    }
    return renderResult(uri, widthPx, heightPx)
  }

  private fun probe(data: Bundle): Bundle {
    val od = docFor(data)
    val pageIndex = data.getInt(PdfProtocol.K_PAGE, -1)
    withPage(od, pageIndex) { page ->
      val (pw, ph) = pagePoints(page)
      val widthPx = PROBE_WIDTH
      val heightPx = max(1, min(MAX_SIDE, (widthPx * ph / pw).roundToInt()))
      val bmp = createWhiteBitmap(widthPx, heightPx)
      try {
        page.renderPageBitmap(bmp, 0, 0, widthPx, heightPx, true, false, Color.WHITE, Color.WHITE)
      } finally {
        bmp.recycle()
      }
    }
    return Bundle()
  }

  private fun saveDecrypted(data: Bundle): Bundle {
    val src = requireString(data, PdfProtocol.K_PATH)
    val password = data.getString(PdfProtocol.K_PASSWORD) ?: ""
    val dest = requireString(data, PdfProtocol.K_DEST)
    val srcFile = fileFromPath(src)
    val destFile = fileFromPath(dest)
    if (srcFile.absoluteFile == destFile.absoluteFile) {
      throw PdfWorkerError(PdfProtocol.ERR_IO, "saveDecrypted: dest is the source file")
    }
    destFile.parentFile?.mkdirs()
    val tmp = File(destFile.parentFile, destFile.name + ".part")

    val doc = openDocument(src, password)
    var writeError: Throwable? = null
    var saved = false
    var srcCount = -1
    try {
      srcCount = doc.getPageCount()
      saved = FileOutputStream(tmp).use { fos ->
        // PDFium writes many small blocks: buffer them instead of one write() syscall per block.
        val out = BufferedOutputStream(fos, WRITE_BUFFER)
        val callback = object : PdfWriteCallback {
          // Called from native code: must never throw. 1 = block written, 0 = failure (FPDF_FILEWRITE).
          @Suppress("FunctionName")
          override fun WriteBlock(data: ByteArray?): Int {
            if (writeError != null) return 0
            return try {
              if (data != null) out.write(data)
              1
            } catch (t: Throwable) {
              writeError = t
              0
            }
          }
        }
        val ok = doc.saveAsCopy(callback, PdfDocument.FPDF_REMOVE_SECURITY)
        out.flush()
        fos.fd.sync()
        ok
      }
    } catch (e: PdfWorkerError) {
      tmp.delete()
      throw e
    } catch (e: IOException) {
      tmp.delete()
      throw PdfWorkerError(PdfProtocol.ERR_IO, "saveDecrypted: cannot write ${destFile.name}: ${e.message}", e)
    } catch (e: Exception) {
      tmp.delete()
      throw PdfWorkerError(PdfProtocol.ERR_UNSUPPORTED, "saveDecrypted: saveAsCopy failed: ${e.message}", e)
    } finally {
      closeDoc(doc)
    }

    writeError?.let {
      tmp.delete()
      throw PdfWorkerError(PdfProtocol.ERR_IO, "saveDecrypted: write failed: ${it.message}", it)
    }
    if (!saved || tmp.length() == 0L) {
      tmp.delete()
      throw PdfWorkerError(PdfProtocol.ERR_UNSUPPORTED, "saveDecrypted: PDFium could not write a copy without security")
    }

    // Verify: the copy must open WITHOUT a password and have every page.
    val check = try {
      openDocument(tmp.path, null)
    } catch (e: PdfWorkerError) {
      tmp.delete()
      throw PdfWorkerError(PdfProtocol.ERR_UNSUPPORTED, "saveDecrypted: the copy is not an unprotected PDF (${e.code})", e)
    }
    val checkCount = try {
      check.getPageCount()
    } catch (e: Throwable) {
      -1
    } finally {
      closeDoc(check)
    }
    if (checkCount != srcCount) {
      tmp.delete()
      throw PdfWorkerError(PdfProtocol.ERR_UNSUPPORTED, "saveDecrypted: the copy has $checkCount of $srcCount pages")
    }
    moveInto(tmp, destFile)
    return Bundle()
  }

  // ---------------------------------------------------------------- documents

  private fun core(): PdfiumCore {
    core?.let { return it }
    coreError?.let { throw PdfWorkerError(PdfProtocol.ERR_UNSUPPORTED, "PDF engine unavailable: ${it.message}", it) }
    return try {
      PdfiumCore(context).also { core = it }
    } catch (e: Throwable) {
      // Native libraries failed to load (wrong ABI, missing .so): never crash, report it.
      coreError = e
      throw PdfWorkerError(PdfProtocol.ERR_UNSUPPORTED, "PDF engine unavailable: ${e.message}", e)
    }
  }

  private fun openDocument(path: String, password: String?): PdfDocument {
    val file = fileFromPath(path)
    if (!file.isFile) throw PdfWorkerError(PdfProtocol.ERR_IO, "File not found: ${file.name}")
    if (file.length() == 0L) throw PdfWorkerError(PdfProtocol.ERR_DAMAGED, "The file is empty: ${file.name}")
    val engine = core()
    val pfd = try {
      ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    } catch (e: FileNotFoundException) {
      throw PdfWorkerError(PdfProtocol.ERR_IO, "Cannot open ${file.name}: ${e.message}", e)
    } catch (e: SecurityException) {
      throw PdfWorkerError(PdfProtocol.ERR_IO, "Cannot open ${file.name}: ${e.message}", e)
    }
    try {
      // On success the document owns the descriptor and closes it in PdfDocument.close().
      return engine.newDocument(pfd, password)
    } catch (e: PdfPasswordException) {
      closeQuietly(pfd)
      val code = if (password.isNullOrEmpty()) PdfProtocol.ERR_PASSWORD else PdfProtocol.ERR_WRONG_PASSWORD
      throw PdfWorkerError(code, "Password required or incorrect", e)
    } catch (e: IOException) {
      closeQuietly(pfd)
      val msg = e.message ?: ""
      val code = when {
        msg.contains("File not found", ignoreCase = true) -> PdfProtocol.ERR_IO
        msg.contains("Unsupported security", ignoreCase = true) -> PdfProtocol.ERR_UNSUPPORTED
        else -> PdfProtocol.ERR_DAMAGED
      }
      throw PdfWorkerError(code, "Cannot open ${file.name}: $msg", e)
    } catch (e: OutOfMemoryError) {
      closeQuietly(pfd)
      throw e
    } catch (e: Throwable) {
      closeQuietly(pfd)
      throw PdfWorkerError(PdfProtocol.ERR_DAMAGED, "Cannot open ${file.name}: ${e.message}", e)
    }
  }

  /** The open document for the request's handle, opened (again) from its path and password when needed. */
  private fun docFor(data: Bundle): OpenDoc {
    val handle = requireString(data, PdfProtocol.K_HANDLE)
    val path = requireString(data, PdfProtocol.K_PATH)
    val password = data.getString(PdfProtocol.K_PASSWORD)
    docs[handle]?.let { od ->
      if (od.path == path && od.password == password) return od
      docs.remove(handle)
      closeDoc(od.doc)
    }
    val doc = openDocument(path, password)
    val count = try {
      doc.getPageCount()
    } catch (e: Throwable) {
      -1
    }
    if (count <= 0) {
      closeDoc(doc)
      throw PdfWorkerError(PdfProtocol.ERR_DAMAGED, "The document has no readable pages")
    }
    val od = OpenDoc(path, password, doc, count)
    docs[handle] = od
    while (docs.size > MAX_DOCS) evictEldest()
    return od
  }

  private fun evictEldest() {
    val it = docs.entries.iterator()
    if (!it.hasNext()) return
    val eldest = it.next()
    it.remove()
    closeDoc(eldest.value.doc)
  }

  private fun loadPage(od: OpenDoc, index: Int): PdfPage? = try {
    od.doc.openPage(index)
  } catch (e: Exception) {
    null
  }

  private inline fun <T> withPage(od: OpenDoc, index: Int, block: (PdfPage) -> T): T {
    if (index < 0 || index >= od.pageCount) {
      throw PdfWorkerError(PdfProtocol.ERR_IO, "Page $index is out of range (0..${od.pageCount - 1})")
    }
    val page = loadPage(od, index) ?: throw PdfWorkerError(PdfProtocol.ERR_DAMAGED, "Page $index cannot be loaded")
    try {
      return block(page)
    } finally {
      closePage(page)
    }
  }

  private fun pagePoints(page: PdfPage): Pair<Double, Double> =
    displayedSize(page) ?: throw PdfWorkerError(PdfProtocol.ERR_DAMAGED, "Page ${page.pageIndex} has no size")

  /**
   * The page's displayed size in points (crop box intersected with the media box, /Rotate applied), or null
   * when PDFium has no size for it. getPageWidthPoint/getPageHeightPoint are FPDF_GetPageWidth/Height
   * truncated to Int; FPDF_GetPageBoundingBox is the same box unrotated, in floats, so its size (swapped for
   * /Rotate 90 and 270) gives the fractional size iOS reports too. It is used only when it agrees with the
   * Int size, otherwise the Int size stays. pageSizes and every render use this one function, so tiles and
   * the sizes JS stores always share one geometry.
   */
  private fun displayedSize(page: PdfPage): Pair<Double, Double>? {
    val wi = page.getPageWidthPoint()
    val hi = page.getPageHeightPoint()
    if (wi <= 0 || hi <= 0) return null
    val w = wi.toDouble()
    val h = hi.toDouble()
    return try {
      val box = page.getPageBoundingBox()
      var bw = abs(box.right - box.left).toDouble()
      var bh = abs(box.top - box.bottom).toDouble()
      val rot = page.getPageRotation()
      if (rot == 1 || rot == 3) {
        val t = bw
        bw = bh
        bh = t
      }
      if (agrees(bw, w) && agrees(bh, h)) Pair(round4(bw), round4(bh)) else Pair(w, h)
    } catch (e: Exception) {
      Pair(w, h)
    }
  }

  /** True when `precise` truncates to `whole` (small float slack below, so 611.99997 still matches 612). */
  private fun agrees(precise: Double, whole: Double): Boolean =
    precise.isFinite() && precise >= whole - 0.01 && precise < whole + 1.0

  private fun round4(v: Double): Double = Math.round(v * 10000.0) / 10000.0

  // ---------------------------------------------------------------- rendering

  private fun renderToFile(
    page: PdfPage,
    pageW: Double,
    pageH: Double,
    x: Double,
    y: Double,
    w: Double,
    h: Double,
    widthPx: Int,
    heightPx: Int,
    outPath: String,
    format: String,
    quality: Double,
  ): String {
    val sx = widthPx / w
    val sy = heightPx / h
    val drawW = (pageW * sx).roundToLong()
    val drawH = (pageH * sy).roundToLong()
    val startX = (-x * sx).roundToLong()
    val startY = (-y * sy).roundToLong()
    if (drawW < 1 || drawH < 1 || drawW > MAX_DRAW || drawH > MAX_DRAW ||
      startX < -MAX_DRAW || startX > MAX_DRAW || startY < -MAX_DRAW || startY > MAX_DRAW
    ) {
      throw PdfWorkerError(PdfProtocol.ERR_IO, "Zoom out of range (page drawn at ${drawW}x$drawH)")
    }
    val bmp = scratchBitmap(widthPx, heightPx)
    page.renderPageBitmap(
      bmp,
      startX.toInt(),
      startY.toInt(),
      drawW.toInt(),
      drawH.toInt(),
      true, // annotations (highlights, notes from other apps) are part of the page as the student sees it
      false,
      Color.WHITE, // canvas outside the page: white, never the library's grey
      Color.WHITE, // page background
    )
    bmp.setHasAlpha(false) // opaque output (smaller PNG, no alpha in JPEG)
    try {
      return writeImage(bmp, outPath, format, quality)
    } finally {
      if (widthPx.toLong() * heightPx.toLong() > KEEP_SCRATCH_MAX_PIXELS) releaseScratch()
    }
  }

  private fun checkBitmapSize(widthPx: Int, heightPx: Int) {
    if (widthPx !in 1..MAX_SIDE || heightPx !in 1..MAX_SIDE || widthPx.toLong() * heightPx.toLong() > MAX_PIXELS) {
      throw PdfWorkerError(PdfProtocol.ERR_IO, "Invalid output size ${widthPx}x$heightPx")
    }
  }

  /** A white ARGB_8888 bitmap of exactly this size; reuses the previous one when the size matches. */
  private fun scratchBitmap(widthPx: Int, heightPx: Int): Bitmap {
    val old = scratch
    if (old != null && !old.isRecycled && old.width == widthPx && old.height == heightPx &&
      old.config == Bitmap.Config.ARGB_8888
    ) {
      old.setHasAlpha(true)
      old.eraseColor(Color.WHITE)
      return old
    }
    releaseScratch()
    return createWhiteBitmap(widthPx, heightPx).also { scratch = it }
  }

  private fun createWhiteBitmap(widthPx: Int, heightPx: Int): Bitmap {
    val bmp = Bitmap.createBitmap(widthPx, heightPx, Bitmap.Config.ARGB_8888)
    bmp.eraseColor(Color.WHITE)
    return bmp
  }

  private fun releaseScratch() {
    scratch?.let { if (!it.isRecycled) it.recycle() }
    scratch = null
  }

  private fun writeImage(bmp: Bitmap, outPath: String, format: String, quality: Double): String {
    val dest = fileFromPath(outPath)
    val dir = dest.parentFile ?: throw PdfWorkerError(PdfProtocol.ERR_IO, "Invalid output path")
    if (!dir.isDirectory && !dir.mkdirs() && !dir.isDirectory) {
      throw PdfWorkerError(PdfProtocol.ERR_IO, "Cannot create ${dir.name}")
    }
    val jpeg = format.equals("jpeg", ignoreCase = true) || format.equals("jpg", ignoreCase = true)
    val compress = if (jpeg) Bitmap.CompressFormat.JPEG else Bitmap.CompressFormat.PNG
    val q = if (jpeg) (if (quality.isFinite()) quality else DEFAULT_QUALITY).times(100).roundToInt().coerceIn(0, 100) else 100
    val tmp = File(dir, dest.name + ".part")
    val ok = try {
      FileOutputStream(tmp).use { out -> bmp.compress(compress, q, out) }
    } catch (e: IOException) {
      tmp.delete()
      throw PdfWorkerError(PdfProtocol.ERR_IO, "Cannot write ${dest.name}: ${e.message}", e)
    }
    if (!ok) {
      tmp.delete()
      throw PdfWorkerError(PdfProtocol.ERR_IO, "Cannot encode ${dest.name}")
    }
    moveInto(tmp, dest)
    return Uri.fromFile(dest).toString()
  }

  private fun moveInto(tmp: File, dest: File) {
    if (tmp.renameTo(dest)) return
    dest.delete()
    if (!tmp.renameTo(dest)) {
      tmp.delete()
      throw PdfWorkerError(PdfProtocol.ERR_IO, "Cannot move the output into ${dest.name}")
    }
  }

  // ---------------------------------------------------------------- helpers

  private fun inspectResult(pageCount: Int, encrypted: Boolean, needsPassword: Boolean) = Bundle().apply {
    putInt(PdfProtocol.R_PAGE_COUNT, pageCount)
    putBoolean(PdfProtocol.R_ENCRYPTED, encrypted)
    putBoolean(PdfProtocol.R_NEEDS_PASSWORD, needsPassword)
  }

  private fun renderResult(uri: String, width: Int, height: Int) = Bundle().apply {
    putString(PdfProtocol.R_URI, uri)
    putInt(PdfProtocol.R_WIDTH, width)
    putInt(PdfProtocol.R_HEIGHT, height)
  }

  private fun requireString(data: Bundle, key: String): String {
    val v = data.getString(key)
    if (v.isNullOrEmpty()) throw PdfWorkerError(PdfProtocol.ERR_IO, "Missing $key")
    return v
  }

  private fun closeDoc(doc: PdfDocument) {
    try {
      doc.close()
    } catch (e: Throwable) {
      // already closed
    }
  }

  private fun closePage(page: PdfPage) {
    try {
      page.close()
    } catch (e: Throwable) {
      // already closed
    }
  }

  private fun closeQuietly(pfd: ParcelFileDescriptor) {
    try {
      pfd.close()
    } catch (e: Throwable) {
      // ignore
    }
  }

  private companion object {
    const val MAX_DOCS = 3
    const val MAX_SIDE = 16384
    const val MAX_PIXELS = 48L * 1024 * 1024
    const val KEEP_SCRATCH_MAX_PIXELS = 4L * 1024 * 1024
    const val MAX_DRAW = 1L shl 24
    const val PROBE_WIDTH = 32
    const val DEFAULT_QUALITY = 0.9
    const val WRITE_BUFFER = 256 * 1024
    const val LETTER_W = 612.0
    const val LETTER_H = 792.0
  }
}

/** A failure the worker reports to the client as REPLY_ERROR with an ERR_PDF_* code. */
internal class PdfWorkerError(val code: String, message: String, cause: Throwable? = null) : Exception(message, cause)

/** A file:// URI (percent-decoded) or an absolute path, as a File. */
internal fun fileFromPath(path: String): File {
  val p = if (path.startsWith("file:")) Uri.parse(path).path ?: "" else path
  if (p.isEmpty()) throw PdfWorkerError(PdfProtocol.ERR_IO, "Invalid path")
  return File(p)
}
