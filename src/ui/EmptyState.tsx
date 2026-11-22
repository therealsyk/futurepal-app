// Ecrã vazio: ícone grande, título, explicação curta e exemplos (em vez de uma frase solta).
import { Ic } from './fx';
import { L } from '../i18n/phrases';

export function EmptyState({ icon, title, text, examples = [] }: { icon: string; title: string; text: string; examples?: string[] }) {
  return (
    <div className="es">
      <span className="es-ic"><Ic d={icon} size={30} /></span>
      <h3>{title}</h3>
      <p>{text}</p>
      {examples.length > 0 && <div className="es-chips">{examples.map((x) => <span key={x}>{x.includes(' ') && !/^[\p{L}\d]/u.test(x) ? x.slice(0, x.indexOf(' ') + 1) + L(x.slice(x.indexOf(' ') + 1)) : L(x)}</span>)}</div>}
    </div>
  );
}
