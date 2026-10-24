Pod::Spec.new do |s|
  s.name           = 'Glasses'
  s.version        = '0.1.0'
  s.summary        = 'Meta Ray-Ban glasses bridge and photo processing'
  s.description    = s.summary
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '17.2' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.swift_version  = '6.0'

  s.dependency 'ExpoModulesCore'
  # Add the Meta Wearables DAT SDK here once vendored, e.g.:
  # s.dependency 'MetaWearablesDAT', '= 1.0.1'

  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,mm,swift}'
end
