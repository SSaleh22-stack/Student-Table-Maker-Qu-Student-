/**
 * iOS widget extension (WidgetKit): الجدول، مهامي، المحاضرة القادمة, on the home screen, the lock
 * screen and the iPad. Linked into the Xcode project by @bacons/apple-targets on prebuild.
 * It reads the app's snapshot from the App Group (modules/qu-widgets, src/lib/widgets.ts).
 *
 * @type {import('@bacons/apple-targets/app.plugin').ConfigFunction}
 */
module.exports = (config) => ({
  type: 'widget',
  name: 'QUWidgets',
  displayName: 'QU Student',
  bundleIdentifier: '.widgets',
  // Interactive widgets (ticking a task) and containerBackground need iOS 17.
  deploymentTarget: '17.0',
  frameworks: ['SwiftUI', 'WidgetKit', 'AppIntents'],
  colors: {
    $accent: { color: '#0E7490', darkColor: '#7FD3E3' },
    $widgetBackground: { color: '#FFFFFF', darkColor: '#18222D' },
  },
  entitlements: {
    'com.apple.security.application-groups': config.ios.entitlements['com.apple.security.application-groups'],
  },
});
