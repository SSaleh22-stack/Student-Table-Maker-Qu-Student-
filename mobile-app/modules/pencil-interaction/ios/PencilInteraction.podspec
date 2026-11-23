Pod::Spec.new do |s|
  s.name           = 'PencilInteraction'
  s.version        = '1.0.0'
  s.summary        = 'Apple Pencil double tap and squeeze (UIPencilInteraction) for the notebook.'
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
  s.frameworks = 'UIKit'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
