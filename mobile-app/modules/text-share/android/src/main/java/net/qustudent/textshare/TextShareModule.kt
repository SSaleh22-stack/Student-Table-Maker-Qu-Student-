package net.qustudent.textshare

import android.content.ClipData
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * Shares several files in one share sheet (expo-sharing shares one file at a time).
 *
 * The files must be inside the app's cache or files folder: their content:// URIs come from
 * expo-sharing's FileProvider ("<package>.SharingFileProvider"), whose paths cover both. The promise
 * resolves once the chooser is open (Android does not report what was picked); the caller deletes the
 * files later, as it does for expo-sharing.
 */
class TextShareModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TextShare")

    AsyncFunction("shareFilesAsync") { paths: List<String>, mimeType: String?, title: String?, promise: Promise ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      if (paths.isEmpty()) throw CodedException("ERR_TEXT_SHARE_NO_FILE", "There is no file to share", null)
      val authority = context.applicationInfo.packageName + ".SharingFileProvider"
      val uris = ArrayList<Uri>()
      for (p in paths) {
        val path = if (p.startsWith("file://")) Uri.parse(p).path else p
        val file = File(path ?: "")
        if (!file.isFile) throw CodedException("ERR_TEXT_SHARE_NO_FILE", "A file to share does not exist", null)
        uris.add(FileProvider.getUriForFile(context, authority, file))
      }

      val send = Intent(Intent.ACTION_SEND_MULTIPLE).apply {
        type = mimeType ?: "*/*"
        putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
        // The ClipData carries the read grant to whichever app is picked.
        val clip = ClipData.newRawUri(null, uris[0])
        for (i in 1 until uris.size) clip.addItem(ClipData.Item(uris[i]))
        clipData = clip
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      val chooser = Intent.createChooser(send, title).apply {
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      appContext.throwingActivity.startActivity(chooser)
      promise.resolve(true)
    }
  }
}
