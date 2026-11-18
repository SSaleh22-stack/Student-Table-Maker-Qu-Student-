Pod::Spec.new do |s|
  s.name           = 'TextShare'
  s.version        = '1.0.0'
  s.summary        = 'Share sheet for plain text that also works on regular-width iPhones (iPhone Duo).'
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

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
