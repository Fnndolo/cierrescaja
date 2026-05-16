// Setup OAuth para que el backend pueda subir archivos a Drive personal.
//
// Pasos previos (una sola vez):
//   1) Ve a https://console.cloud.google.com/apis/credentials
//      (asegurate de estar en el proyecto que ya usas, p.ej. "confirmadorcomprobantes")
//   2) Crea un "OAuth client ID" tipo "Web application"
//   3) En "Authorized redirect URIs" agrega exactamente:
//        http://localhost:8765/oauth/callback
//   4) Copia el Client ID y Client Secret al .env:
//        GOOGLE_OAUTH_CLIENT_ID=...
//        GOOGLE_OAUTH_CLIENT_SECRET=...
//   5) Asegurate de tener habilitada Drive API en el proyecto (APIs & Services > Library)
//   6) Si el proyecto esta en modo "Testing", agrega tu correo como "test user"
//      (APIs & Services > OAuth consent screen > Test users)
//
// Despues ejecuta este script:
//    cd backend && node scripts/oauth-setup.js
//
// El script abre un servidor local en :8765, te muestra una URL para autorizar.
// Inicia sesion CON LA CUENTA QUE POSEE LAS CARPETAS DE LAS SEDES en Drive
// (la dueña de las 4 carpetas raiz). Acepta los permisos. El refresh token aparece
// en consola listo para pegar en .env.

import '../env.js';
import http from 'node:http';
import { google } from 'googleapis';

const PORT = 8765;
const REDIRECT_URI = `http://localhost:${PORT}/oauth/callback`;

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('\nFaltan GOOGLE_OAUTH_CLIENT_ID y/o GOOGLE_OAUTH_CLIENT_SECRET en .env.');
  console.error('Lee el comentario al inicio de este script para los pasos.\n');
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: [
    'https://www.googleapis.com/auth/drive',
  ],
});

console.log('\n1) Abre esta URL en tu navegador:\n');
console.log(authUrl + '\n');
console.log('2) Inicia sesion con la cuenta que POSEE las carpetas de Drive de las sedes.');
console.log('3) Acepta los permisos. Te redirige a localhost:8765 (puede mostrar advertencia, no importa).');
console.log('4) Espera el mensaje en esta terminal con el refresh token.\n');

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url || !req.url.startsWith('/oauth/callback')) {
      res.writeHead(404).end();
      return;
    }
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        .end('<h2>Error de OAuth</h2><p>' + error + '</p>');
      console.error('Error de OAuth:', error);
      process.exit(1);
    }
    if (!code) {
      res.writeHead(400).end('Falta el parametro "code"');
      return;
    }
    const { tokens } = await oauth2.getToken(code);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(
      '<h2>Listo</h2><p>Ya puedes cerrar esta ventana y volver al terminal.</p>'
    );

    console.log('\n✅ Refresh token obtenido. Agrega esto a tu .env:\n');
    console.log('GOOGLE_OAUTH_REFRESH_TOKEN=' + tokens.refresh_token + '\n');
    if (!tokens.refresh_token) {
      console.warn('⚠  Google no devolvio refresh_token. Probable que ya hayas autorizado antes con esta cuenta.');
      console.warn('   Ve a https://myaccount.google.com/permissions, revoca el acceso a tu OAuth Client, y corre este script otra vez.\n');
    }
    server.close();
    setTimeout(() => process.exit(0), 200);
  } catch (e) {
    res.writeHead(500).end('Error: ' + e.message);
    console.error('Error obteniendo tokens:', e);
  }
});

server.listen(PORT, () => {
  console.log(`Esperando callback en ${REDIRECT_URI}...`);
});
