package net.qustudent.widgets

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** The app's side of the widgets (modules/qu-widgets/index.ts). */
class QuWidgetsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("QuWidgets")

    Function("setSnapshot") { json: String ->
      val context = appContext.reactContext ?: return@Function
      WidgetStore.saveSnapshot(context, json)
      Ticker.refresh(context)
    }

    Function("takePendingToggles") {
      val context = appContext.reactContext ?: return@Function "[]"
      WidgetStore.takePending(context)
    }
  }
}
