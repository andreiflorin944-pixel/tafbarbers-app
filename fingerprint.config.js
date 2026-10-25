// Amprenta părții native (runtimeVersion „fingerprint”): o actualizare rapidă ajunge doar la versiunile din magazine cu
// aceeași parte nativă. Numărul versiunii și calea fișierului Firebase nu schimbă partea nativă, așa că nu intră în amprentă.
/** @type {import('expo/fingerprint').Config} */
module.exports = {
  fileHookTransform: (source, chunk) => {
    if (source.type === 'contents' && source.id === 'expoConfig') {
      const config = JSON.parse(chunk);
      delete config.version;
      if (config.ios) delete config.ios.buildNumber;
      if (config.android) {
        delete config.android.versionCode;
        delete config.android.googleServicesFile;
      }
      return JSON.stringify(config);
    }
    return chunk;
  },
};
