Pod::Spec.new do |s|
  s.name           = 'ICloudDrive'
  s.version        = '1.0.0'
  s.summary        = 'Reads and writes the app iCloud Drive (ubiquity) container that the Files app shows as "QU Student".'
  s.description    = s.summary
  s.license        = 'MIT'
  s.author         = 'QU Student'
  s.homepage       = 'https://qustudent.net'
  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Foundation'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
