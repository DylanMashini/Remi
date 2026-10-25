const { withEntitlementsPlist, withInfoPlist } = require('expo/config-plugins');

/**
 * Info.plist entries required by the Meta Wearables Device Access Toolkit (DAT 1.0.x).
 * Survives `expo prebuild --clean`. The SDK itself is vendored by modules/glasses/ios/Glasses.podspec.
 */
// TeamID defaults to the build's signing team; DAT rejects a misconfigured (empty) TeamID.
module.exports = function withMetaWearables(config, { urlScheme, appId = '0', clientToken = '0', teamId = '$(DEVELOPMENT_TEAM)' } = {}) {
  const scheme = urlScheme ?? (Array.isArray(config.scheme) ? config.scheme[0] : config.scheme) ?? 'memoryaid';
  // Wi-Fi camera streaming joins the glasses' hotspot, which needs this capability.
  config = withEntitlementsPlist(config, (config) => {
    config.modResults['com.apple.developer.networking.HotspotConfiguration'] = true;
    return config;
  });
  return withInfoPlist(config, (config) => {
    const plist = config.modResults;
    const merge = (key, values) => {
      plist[key] = [...new Set([...(plist[key] ?? []), ...values])];
    };

    // Meta AI calls back on this scheme after registration / permission grants.
    plist.MWDAT = {
      ...plist.MWDAT,
      AppLinkURLScheme: `${scheme}://`,
      MetaAppID: appId,
      ClientToken: clientToken,
      TeamID: teamId,
    };

    // Make sure the scheme is actually registered as a URL type (expo adds config.scheme, but a
    // custom urlScheme option would not be).
    const urlTypes = plist.CFBundleURLTypes ?? [];
    const hasScheme = urlTypes.some((t) => (t.CFBundleURLSchemes ?? []).includes(scheme));
    if (!hasScheme) {
      urlTypes.push({ CFBundleURLSchemes: [scheme] });
    }
    plist.CFBundleURLTypes = urlTypes;

    plist.NSBluetoothAlwaysUsageDescription = 'Connect to your Meta glasses.';
    plist.NSLocalNetworkUsageDescription = 'Communicate with your Meta glasses and the Recall server.';
    plist.NSMicrophoneUsageDescription =
      plist.NSMicrophoneUsageDescription ?? 'Listen when you ask a question, so Recall can answer.';
    plist.NSCameraUsageDescription =
      plist.NSCameraUsageDescription ?? 'Recall uses the camera to take photos of family members so the glasses can recognize them, and to simulate the glasses in demo mode.';
    // Read access (PhotoKit, readWrite level: addOnly cannot fetch assets) for the on-device
    // photo index that suggests enrollment photos. Say exactly what it does.
    plist.NSPhotoLibraryUsageDescription =
      'Recall indexes faces in your photos on this phone, the way Photos does, so you can pick good photos when adding someone. Nothing leaves the phone.';
    // With "limited" access iOS would otherwise pop its "Select More Photos" sheet on the first fetch.
    plist.PHPhotoLibraryPreventAutomaticLimitedAccessAlert = true;
    // Dev backend runs over plain http on the Mac's LAN IP.
    plist.NSAppTransportSecurity = {
      ...(plist.NSAppTransportSecurity ?? {}),
      NSAllowsArbitraryLoads: true,
      NSAllowsLocalNetworking: true,
    };
    merge('NSBonjourServices', ['_bonjour._tcp']);
    merge('UISupportedExternalAccessoryProtocols', ['com.meta.ar.wearable']);
    merge('UIBackgroundModes', ['external-accessory', 'bluetooth-central', 'bluetooth-peripheral', 'audio']);
    return config;
  });
};
