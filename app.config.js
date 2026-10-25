// Configurarea aplicației e în app.json. Aici doar ce vine din construirea pornită din panou (Aplicații → „Actualizați aplicația”):
// APP_VERSION = versiunea nouă din magazine (ex. 1.0.1), GOOGLE_SERVICES_JSON = fișierul Firebase pus în Expo
// (variabilă de tip fișier), fiindcă google-services.json nu e în GitHub.
module.exports = ({ config }) => ({
  ...config,
  version: process.env.APP_VERSION || config.version,
  android: { ...config.android, googleServicesFile: process.env.GOOGLE_SERVICES_JSON || config.android.googleServicesFile },
});
