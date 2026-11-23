package net.qustudent.pdfrender

import android.content.Context
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import kotlinx.coroutines.CancellationException
import kotlin.math.roundToInt

/** NativeRegionRequest of PdfRender.types.ts. */
internal class RegionRequest : Record {
  @Field var handle: String = ""
  @Field var page: Int = 0
  @Field var x: Double = 0.0
  @Field var y: Double = 0.0
  @Field var w: Double = 0.0
  @Field var h: Double = 0.0
  @Field var widthPx: Double = 0.0
  @Field var heightPx: Double = 0.0
  @Field var outPath: String = ""
  @Field var format: String = "png"
  @Field var quality: Double = 0.9
}

/** NativePageRequest of PdfRender.types.ts. */
internal class PageRequest : Record {
  @Field var handle: String = ""
  @Field var page: Int = 0
  @Field var widthPx: Double = 0.0
  @Field var outPath: String = ""
  @Field var format: String = "png"
  @Field var quality: Double = 0.9
}

/**
 * Android side of the PdfRender contract (modules/pdf-render/src/PdfRender.types.ts, class name
 * PDF_RENDER_ANDROID_CLASS). Every function delegates to PdfServiceClient, which runs PDFium in the
 * separate ':pdf' process; nothing here touches PDFium. Every failure, whatever its type, reaches JS as a
 * rejection with an ERR_PDF_* code (never an uncaught exception).
 */
class PdfRenderModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext
      ?: throw PdfException(PdfProtocol.ERR_IO, "No Android context")

  private val client: PdfServiceClient
    get() = PdfServiceClient.get(context)

  override fun definition() = ModuleDefinition {
    Name("PdfRender")

    AsyncFunction("inspect") Coroutine { path: String ->
      guard("inspect") {
        val r = client.inspect(path)
        mapOf("pageCount" to r.pageCount, "encrypted" to r.encrypted, "needsPassword" to r.needsPassword)
      }
    }

    AsyncFunction("open") Coroutine { path: String, password: String? ->
      guard("open") {
        val r = client.open(path, password)
        mapOf("handle" to r.handle, "pageCount" to r.pageCount)
      }
    }

    AsyncFunction("pageSizes") Coroutine { handle: String, from: Int, count: Int ->
      guard("pageSizes") {
        client.pageSizes(handle, from, count).map { s ->
          mapOf("w" to s.w, "h" to s.h, "rotation" to s.rotation)
        }
      }
    }

    AsyncFunction("renderRegion") Coroutine { req: RegionRequest ->
      guard("renderRegion") {
        val r = client.renderRegion(
          req.handle,
          req.page,
          req.x,
          req.y,
          req.w,
          req.h,
          pixels(req.widthPx),
          pixels(req.heightPx),
          req.outPath,
          req.format,
          req.quality,
        )
        mapOf("uri" to r.uri, "width" to r.width, "height" to r.height)
      }
    }

    AsyncFunction("renderPage") Coroutine { req: PageRequest ->
      guard("renderPage") {
        val r = client.renderPage(req.handle, req.page, pixels(req.widthPx), req.outPath, req.format, req.quality)
        mapOf("uri" to r.uri, "width" to r.width, "height" to r.height)
      }
    }

    AsyncFunction("probe") Coroutine { handle: String, page: Int ->
      guard("probe") {
        client.probe(handle, page)
      }
    }

    AsyncFunction("saveDecrypted") Coroutine { src: String, password: String, dest: String ->
      guard("saveDecrypted") {
        client.saveDecrypted(src, password, dest)
      }
    }

    AsyncFunction("close") Coroutine { handle: String ->
      guard("close") {
        client.close(handle)
      }
    }

    Function("lastRenderCrash") {
      try {
        client.lastRenderCrash()?.let { mapOf("path" to it.path, "page" to it.page) }
      } catch (e: Throwable) {
        null
      }
    }

    Function("clearRenderCrash") {
      try {
        client.clearRenderCrash()
      } catch (e: Throwable) {
        // nothing to clear
      }
    }

    OnDestroy {
      // The JS runtime that owned the handles is gone (reload): forget them and close the documents.
      try {
        PdfServiceClient.peek()?.forgetAll()
      } catch (e: Throwable) {
        // ignore
      }
    }
  }

  /** JS numbers arrive as doubles; output sizes are whole pixels. */
  private fun pixels(v: Double): Int =
    if (v.isFinite() && v >= 1.0 && v <= Int.MAX_VALUE.toDouble()) v.roundToInt() else 0

  /** Catch Throwable everywhere: coded errors pass through, anything else becomes ERR_PDF_IO. */
  private suspend fun <T> guard(op: String, block: suspend () -> T): T {
    try {
      return block()
    } catch (e: CancellationException) {
      throw e
    } catch (e: PdfException) {
      throw e
    } catch (e: CodedException) {
      throw PdfException(PdfProtocol.ERR_IO, "$op failed: ${e.message}", e)
    } catch (e: OutOfMemoryError) {
      throw PdfException(PdfProtocol.ERR_IO, "$op failed: out of memory", e)
    } catch (e: Throwable) {
      throw PdfException(PdfProtocol.ERR_IO, "$op failed: ${e.javaClass.simpleName}: ${e.message}", e)
    }
  }
}
