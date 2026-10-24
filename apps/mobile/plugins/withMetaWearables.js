const { withInfoPlist } = require('expo/config-plugins');

/** Info.plist entries required by the Meta Wearables Device Access Toolkit. Survives `expo prebuild --clean`. */
module.exports = function withMetaWearables(config, { urlScheme, appId = '0', clientToken = '', teamId = '' } = {}) {
  return withInfoPlist(config, (config) => {
    const plist = config.modResults;
    const merge = (key, values) => {
      plist[key] = [...new Set([...(plist[key] ?? []), ...values])];
    };

    plist.MWDAT = {
      ...plist.MWDAT,
      AppLinkURLScheme: `${urlScheme ?? config.scheme}://`,
      MetaAppID: appId,
      ClientToken: clientToken,
      TeamID: teamId,
    };
    plist.NSBluetoothAlwaysUsageDescription = 'Connect to your Meta glasses.';
    plist.NSLocalNetworkUsageDescription = 'Communicate with your Meta glasses.';
    merge('NSBonjourServices', ['_bonjour._tcp']);
    merge('UISupportedExternalAccessoryProtocols', ['com.meta.ar.wearable']);
    merge('UIBackgroundModes', ['external-accessory', 'bluetooth-central', 'bluetooth-peripheral']);
    return config;
  });
};
