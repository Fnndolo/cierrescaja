import { google } from 'googleapis';

let cachedAuth = null;
let cachedOAuthClient = null;

function loadServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON no esta configurado');
  let text = raw.trim();
  // Soporta el prefijo "base64:..." para evitar problemas con comillas y saltos de linea
  // al pegar el JSON crudo en variables de entorno.
  if (text.startsWith('base64:')) {
    text = Buffer.from(text.slice('base64:'.length), 'base64').toString('utf8');
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON no es un JSON valido: ' + err.message);
  }
}

export function getAuth() {
  if (cachedAuth) return cachedAuth;
  const credentials = loadServiceAccount();
  cachedAuth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets.readonly',
    ],
  });
  return cachedAuth;
}

// OAuth client (necesario para escribir/subir archivos a Drive personal,
// ya que los Service Accounts no tienen quota propia).
export function getOAuthClient() {
  if (cachedOAuthClient) return cachedOAuthClient;
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  cachedOAuthClient = oauth2;
  return cachedOAuthClient;
}

// Drive: usa OAuth si esta configurado (subidas funcionan); cae a service account si no.
export function getDrive() {
  const oauth = getOAuthClient();
  return google.drive({ version: 'v3', auth: oauth || getAuth() });
}

// Sheets: solo lectura, el service account funciona perfecto.
export function getSheets() {
  return google.sheets({ version: 'v4', auth: getAuth() });
}
