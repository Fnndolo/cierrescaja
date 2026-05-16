# CierresCaja

Plataforma web mobile-first para automatizar el cierre de caja diario en las sedes Smart Gadgets (KUPOCELL S.A.S.).

## Que hace

- Reemplaza el Excel manual del arqueo con un formulario movil.
- Toma fotos del cierre del turno y de los comprobantes de gasto, y las sube a Google Drive en una estructura `SEDE/FECHA/`.
- Trae ingresos y egresos del dia directamente desde la API de Alegra.
- Lee la hoja de comprobantes alimentada por el bot ConfirmadorComprobantes y suma por dia y sede.
- Detecta descuadres comparando Alegra vs los comprobantes (por transferencias, datafono, credito).
- Genera el Excel final usando la plantilla del usuario y lo deja en Drive.

## Arquitectura

- `backend/` Node 20 + Express (ESM), Postgres (`pg`), `exceljs`, `googleapis`, `multer`, `axios`.
- `frontend/` Vite + React 18 + TypeScript + Tailwind.
- Deploy: Railway con plugin de Postgres.

## Setup local

```bash
npm run install:all
cp .env.example .env
# editar .env con credenciales
npm run dev
```

Frontend en `http://localhost:5173` (movil: `vite --host` y conectar por LAN).
Backend en `http://localhost:4000`.

## Variables de entorno

Ver `.env.example`. Las criticas:

- `DATABASE_URL` Postgres.
- `ALEGRA_<SEDE>_EMAIL` y `ALEGRA_<SEDE>_TOKEN` para cada sede: PASTO, MEDELLIN, ARMENIA, PEREIRA. Cada sede tiene su propia cuenta de Alegra, asi que son 4 pares email+token independientes.
- `GOOGLE_SERVICE_ACCOUNT_JSON` el JSON del service account en una sola linea (mismo del bot). Acepta tambien el prefijo `base64:` seguido del JSON codificado en base64.
- `DRIVE_FOLDER_PASTO`, `DRIVE_FOLDER_MEDELLIN`, `DRIVE_FOLDER_ARMENIA`, `DRIVE_FOLDER_PEREIRA`: id de la carpeta raiz en Drive de cada sede. Compartir cada una con el service account como Editor. Dentro de cada carpeta la plataforma crea automaticamente la ruta `cierre caja / CIERRES <MES> / MM-DD /`.
- `DRIVE_CIERRES_PARENT_NAME` (opcional): nombre de la subcarpeta padre de los meses dentro de cada sede. Default `cierre caja`.
- `COMPROBANTES_SPREADSHEET_ID` id de la hoja de calculo de comprobantes (la misma del bot).
- `SEDES` lista separada por coma de los puntos de venta para el selector.

## Plantilla Excel

Poner el archivo original del arqueo en `backend/templates/arqueo.xlsx`. El servicio `excelFiller` lo lee, rellena las celdas mapeadas y devuelve un buffer que se sube a Drive.
