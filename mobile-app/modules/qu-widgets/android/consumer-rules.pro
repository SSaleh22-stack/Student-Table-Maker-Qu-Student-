# WorkManager (used by Glance) creates its Room database by reflection when the app starts.
# Without these rules R8 removed the generated database's constructor and the app closed on launch.
-keep class * extends androidx.room.RoomDatabase { <init>(); }
-keep class androidx.work.impl.WorkDatabase_Impl { *; }
