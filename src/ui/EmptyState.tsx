// Ecrã vazio: ícone grande, título, explicação curta e exemplos (em vez de uma frase solta).
import { Ic } from './fx';

import { L } from '../i18n/phrases';

/** Cartão tracejado no fim de uma lista para criar mais um (em vez de um botão a flutuar ou no canto). */
export function AddTile({ label, onClick, cls = '' }: { label: string; onClick: () => void; cls?: string }) {
  return <button type="button" className={'pg-addtile ' + cls} onClick={onClick}><span><Ic d="M12 5v14M5 12h14" size={18} /></span>{label}</button>;
}

export function EmptyState({ icon, title, text, examples = [], ask, onAsk }: { icon: string; title: string; text: string; examples?: string[]; ask?: string; onAsk?: () => void }) {
  return (
    <div className="es">
      <span className="es-ic"><Ic d={icon} size={30} /></span>
      <h3>{title}</h3>
      <p>{text}</p>
      {ask && onAsk && <button type="button" className="es-ask" onClick={onAsk}><span className="es-ask-ic"><Ic d="M12 5v14M5 12h14" size={17} /></span>{ask}<Ic d="M5 12h14M13 6l6 6-6 6" size={15} /></button>}
      {examples.length > 0 && <div className="es-chips">{examples.map((x) => <span key={x}>{x.includes(' ') && !/^[\p{L}\d]/u.test(x) ? x.slice(0, x.indexOf(' ') + 1) + L(x.slice(x.indexOf(' ') + 1)) : L(x)}</span>)}</div>}
    </div>
  );
}
