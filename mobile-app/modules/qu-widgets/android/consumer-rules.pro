# WorkManager (used by Glance) creates its Room database by reflection when the app starts.
# Without these rules R8 removed the generated database's constructor and the app closed on launch.
-keep class * extends androidx.room.RoomDatabase { <init>(); }
-keep class androidx.work.impl.WorkDatabase_Impl { *; }

# Glance tells the widgets apart by their GlanceAppWidget class (getGlanceIds, and the receiver →
# widget map it stores by class name). R8 merged the three widget classes into one, so after the app
# redrew the widgets the timetable took over the مهامي widget. Keeping each class (and its name, so
# the stored map still matches after an update) stops that. Glance also creates the tick action
# (ToggleTaskAction) from its class name.
-keep class * extends androidx.glance.appwidget.GlanceAppWidget
-keep class * implements androidx.glance.appwidget.action.ActionCallback { <init>(); }
