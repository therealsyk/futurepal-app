// Linha dos widgets do Resumo: anel ou ícone à esquerda, nome, valor e uma etiqueta à direita.
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function WidgetRow({ to, pic, title, value, tone = '', sub, tag, tagTone = '', i = 0 }: { to: string; pic: ReactNode; title: string; value?: string; tone?: string; sub?: string; tag?: string; tagTone?: string; i?: number }) {
  return (
    <Link to={to} className="wr" style={{ '--i': Math.min(i, 8) } as CSSProperties}>
      <span className="wr-pic">{pic}</span>
      <span className="wr-main"><b>{title}</b>{sub && <small>{sub}</small>}</span>
      <span className="wr-end">{value && <b className={tone}>{value}</b>}{tag && <em className={'lm-tag ' + tagTone}>{tag}</em>}</span>
    </Link>
  );
}

/** Nada para mostrar: frase curta e um botão que leva à página certa. */
export function WidgetEmpty({ pic, text, to, label }: { pic: ReactNode; text: string; to: string; label: string }) {
  return <div className="wr-empty"><span>{pic}</span><p>{text}</p><Link to={to} className="sh-pill">{label}</Link></div>;
}

/** Número principal do widget, com uma barra animada. */
export function WidgetTop({ label, value, tone = '', ratio, barTone = '' }: { label: string; value: string; tone?: string; ratio?: number; barTone?: string }) {
  return <div className="wr-top"><small>{label}</small><strong className={tone}>{value}</strong>{ratio !== undefined && <i className={'wr-bar ' + barTone}><i style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }} /></i>}</div>;
}
