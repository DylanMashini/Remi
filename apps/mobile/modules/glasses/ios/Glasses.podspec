DAT_VERSION = '1.0.1'
dat_dir = File.join(__dir__, 'Frameworks')
dat_frameworks = %w[MWDATCore MWDATCamera MWDATMockDevice MWDATInputs]

# The DAT SDK ships as binary dynamic xcframeworks inside its Swift package. We vendor them
# (fetched on demand, gitignored) instead of using spm_dependency, because SPM binary targets
# linked into a static pod are not embedded into the app bundle (dyld crash at launch).
unless dat_frameworks.all? { |f| File.exist?(File.join(dat_dir, "#{f}.xcframework")) } &&
       File.exist?(File.join(dat_dir, 'VERSION')) &&
       File.read(File.join(dat_dir, 'VERSION')).strip == DAT_VERSION
  ok = system('sh', File.join(__dir__, 'scripts', 'fetch-dat.sh'), DAT_VERSION)
  raise "[Glasses] Failed to fetch Meta Wearables DAT #{DAT_VERSION}" unless ok
end

# "Hey Remi" wake word (WakeWord.swift): sherpa-onnx keyword spotter + onnxruntime as static
# xcframeworks, and the KWS model in Models/wake. Fetched on demand, gitignored, Apache 2.0.
SHERPA_VERSION = '1.13.8'
sherpa_frameworks = %w[SherpaOnnxC onnxruntime]
wake_dir = File.join(__dir__, 'Models', 'wake')
unless sherpa_frameworks.all? { |f| File.exist?(File.join(dat_dir, "#{f}.xcframework")) } &&
       File.exist?(File.join(wake_dir, 'VERSION')) &&
       File.read(File.join(wake_dir, 'VERSION')).strip == SHERPA_VERSION
  ok = system('sh', File.join(__dir__, 'scripts', 'fetch-sherpa.sh'), SHERPA_VERSION)
  raise "[Glasses] Failed to fetch sherpa-onnx #{SHERPA_VERSION}" unless ok
end

Pod::Spec.new do |s|
  s.name           = 'Glasses'
  s.version        = '0.1.0'
  s.summary        = 'Meta Ray-Ban glasses bridge (DAT SDK) for Recall'
  s.description    = s.summary
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '17.2' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'
  s.vendored_frameworks = (dat_frameworks + sherpa_frameworks).map { |f| "Frameworks/#{f}.xcframework" }
  s.frameworks = 'AVFoundation', 'Speech', 'Security', 'Vision', 'CoreML', 'Accelerate'
  # sherpa-onnx and onnxruntime are C++ static libraries.
  s.libraries = 'c++'

  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '*.{h,m,mm,swift}'
  # Precompiled Core ML face embedder (scripts/README.md). Shipped compiled because CocoaPods'
  # resource copy step does not run coremlcompiler on .mlpackage files.
  s.resource_bundles = {
    'GlassesModels' => ['Models/FaceEmbedder.mlmodelc'],
    # Wake word model files (int8 onnx + tokens), loaded by path at runtime.
    'GlassesWake' => ['Models/wake/*.onnx', 'Models/wake/tokens.txt'],
  }
end
