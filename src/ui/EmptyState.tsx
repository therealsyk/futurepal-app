// Ecrã vazio: ícone grande, título, explicação curta e exemplos (em vez de uma frase solta).
import { Ic } from './fx';

export function EmptyState({ icon, title, text, examples = [] }: { icon: string; title: string; text: string; examples?: string[] }) {
  return (
    <div className="es">
      <span className="es-ic"><Ic d={icon} size={30} /></span>
      <h3>{title}</h3>
      <p>{text}</p>
      {examples.length > 0 && <div className="es-chips">{examples.map((x) => <span key={x}>{x}</span>)}</div>}
    </div>
  );
}
