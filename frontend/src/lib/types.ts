export const BILLETES = [100000, 50000, 20000, 10000, 5000, 2000, 1000] as const;
export const MONEDAS = [1000, 500, 200, 100, 50] as const;

export const ENTRADAS_KEYS = [
  'factura_electronica',
  'venta_factura_pos',
  'ingresos_rc',
  'anticipos_clientes',
  'otros_ingresos',
  'cuota_inicial_efectivo',
] as const;

export const ENTRADAS_LABELS: Record<string, string> = {
  factura_electronica: 'Factura electronica',
  venta_factura_pos: 'Venta factura POS',
  ingresos_rc: 'Ingresos por R.C.',
  anticipos_clientes: 'Anticipos clientes (abonos)',
  otros_ingresos: 'Otros ingresos',
  cuota_inicial_efectivo: 'Cuota inicial en efectivo',
};

export type EntradasKey = (typeof ENTRADAS_KEYS)[number];

export type Gasto = {
  fecha?: string;
  cp_no?: string;
  tercero?: string;
  concepto?: string;
  valor?: number;
  alegra_payment_id?: string;
};

export type ClosingPhoto = {
  drive_file_id: string;
  name: string;
  web_view_link?: string | null;
  uploaded_at?: string;
};

export type Conteo = {
  billetes?: Record<string, number>;
  monedas?: Record<string, number>;
};

export type Closing = {
  id: number;
  sede: string;
  fecha: string;
  hora?: string | null;
  responsable?: string | null;
  saldo_anterior?: number | string;
  entradas?: Record<string, number>;
  gastos?: Gasto[];
  conteo?: Conteo;
  photos?: ClosingPhoto[];
  drive_folder_id?: string | null;
  drive_excel_id?: string | null;
  drive_closing_photo_id?: string | null;
  estado: 'borrador' | 'finalizado';
  created_at?: string;
  finalized_at?: string | null;
};

export type CategoriaConciliacion = {
  clave: string;
  label: string;
  alegra: number;
  comprobantes: number | null;
  diff: number;
  status: 'ok' | 'comprobantes_mayor' | 'alegra_mayor' | 'info';
  nota?: string;
  detalle_alegra?: string[];
  detalle_comprobantes?: string[];
};

export type ReconciliationResponse = {
  date: string;
  sede: string;
  alegra: {
    totalIngresos: number;
    totalEgresos: number;
    porMetodo: Record<string, number>;
  };
  comprobantes: {
    tabs: Record<string, { total: number; count: number; warning?: string }>;
    grandTotal: number;
  };
  categorias: CategoriaConciliacion[];
};

export type AlegraSummary = {
  date: string;
  sede: string;
  totalIngresos: number;
  totalEgresos: number;
  porMetodo: Record<string, number>;
  countIngresos: number;
  countEgresos: number;
};
