// Bandeira do país de cada moeda (euro = bandeira da UE). Imagens locais da biblioteca flag-icons (MIT).
// Só entram na app as bandeiras destas moedas.
const FLAGS = import.meta.glob('../../node_modules/flag-icons/flags/1x1/{ae,al,ao,ar,au,bg,br,ca,ch,cl,cn,co,cv,cz,dk,eg,eu,gb,hk,hu,id,il,in,jp,ke,kr,ma,mx,my,mz,ng,no,nz,pe,ph,pl,qa,ro,sa,se,sg,th,tr,tw,ua,us,uy,vn,za}.svg', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

export const CURRENCY_COUNTRY: Record<string, string> = {'EUR': 'eu', 'USD': 'us', 'GBP': 'gb', 'BRL': 'br', 'CHF': 'ch', 'CAD': 'ca', 'AUD': 'au', 'JPY': 'jp', 'CNY': 'cn', 'SEK': 'se', 'NOK': 'no', 'DKK': 'dk', 'PLN': 'pl', 'CZK': 'cz', 'HUF': 'hu', 'RON': 'ro', 'BGN': 'bg', 'ALL': 'al', 'TRY': 'tr', 'UAH': 'ua', 'MXN': 'mx', 'ARS': 'ar', 'CLP': 'cl', 'COP': 'co', 'PEN': 'pe', 'UYU': 'uy', 'AOA': 'ao', 'MZN': 'mz', 'CVE': 'cv', 'ZAR': 'za', 'MAD': 'ma', 'EGP': 'eg', 'NGN': 'ng', 'KES': 'ke', 'INR': 'in', 'IDR': 'id', 'THB': 'th', 'VND': 'vn', 'PHP': 'ph', 'MYR': 'my', 'SGD': 'sg', 'HKD': 'hk', 'KRW': 'kr', 'TWD': 'tw', 'NZD': 'nz', 'AED': 'ae', 'SAR': 'sa', 'ILS': 'il', 'QAR': 'qa'};

export function currencyFlagUrl(code: string): string | null {
  const cc = CURRENCY_COUNTRY[code.toUpperCase()];
  if (!cc) return null;
  const key = Object.keys(FLAGS).find((k) => k.endsWith(`/${cc}.svg`));
  return key ? FLAGS[key] : null;
}
