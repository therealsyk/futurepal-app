// Linha dos widgets do Resumo: anel ou ícone à esquerda, nome, valor e uma etiqueta à direita.
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Ic } from './fx';

export function WidgetRow({ to, pic, title, value, tone = '', sub, when, i = 0 }: { to: string; pic: ReactNode; title: string; value?: ReactNode; tone?: string; sub?: ReactNode; when?: string; i?: number }) {
  return (
    <Link to={to} className="wr" style={{ '--i': Math.min(i, 8) } as CSSProperties}>
      <span className="wr-pic">{pic}</span>
      <span className="wr-main"><b>{title}</b>{sub && (typeof sub === 'string' ? <small>{sub}</small> : sub)}{when && <small className="wr-when"><Ic d="M6 21V4h11l-2 4 2 4H6" size={13} />{when}</small>}</span>
      <span className="wr-end">{value && <span className={'wr-val ' + tone}>{value}</span>}</span>
    </Link>
  );
}

/** Nada para mostrar: frase curta e um botão que leva à página certa. */
export function WidgetEmpty({ pic, text, to, label }: { pic: ReactNode; text: string; to: string; label: string }) {
  return <div className="wr-empty"><span>{pic}</span><p>{text}</p><Link to={to} className="sh-pill">{label}</Link></div>;
}

/** Número principal do widget, com uma barra animada. */
export function WidgetTop({ label, value, tone = '', ratio, barTone = '' }: { label: string; value: ReactNode; tone?: string; ratio?: number; barTone?: string }) {
  return <div className="wr-top"><small>{label}</small><strong className={tone}>{value}</strong>{ratio !== undefined && <i className={'wr-bar ' + barTone}><i style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }} /></i>}</div>;
}
