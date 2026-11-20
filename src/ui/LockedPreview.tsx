// Página bloqueada: por trás, uma prévia desfocada do que a página tem; por cima, o cartão com o cadeado e o que falta fazer.
import type { ReactNode } from 'react';
import { Ic } from './fx';

const LOCK = 'M6 11h12v10H6zM8 11V8a4 4 0 0 1 8 0v3M12 15v2';

function MockChat() {
  return (
    <div className="lp-mock">
      <div className="lp-bub me">Quanto gastei em supermercado este mês?</div>
      <div className="lp-bub">Gastaste 262,94 € em supermercado — 18% menos do que em outubro. 👏</div>
      <div className="lp-bub me">E onde posso poupar?</div>
      <div className="lp-bub">Os restaurantes subiram 40 €. Se reduzires para metade, poupas cerca de 20 € por mês.</div>
      <div className="lp-input">Escreve uma pergunta…</div>
    </div>
  );
}
function MockSplit() {
  return (
    <div className="lp-mock">
      {[['✈️ Viagem a Lisboa', '4 pessoas', '320,00 €'], ['🏠 Contas da casa', '3 pessoas', '186,40 €'], ['🍕 Jantar de sexta', '5 pessoas', '72,50 €']].map(([n, p, v]) => (
        <div key={n} className="lp-card"><span className="lp-av" /><span className="lp-txt"><b>{n}</b><small>{p}</small></span><b>{v}</b></div>
      ))}
      <div className="lp-card"><span className="lp-av g" /><span className="lp-txt"><b>A Ana deve-te</b><small>Viagem a Lisboa</small></span><b className="fx-pos">80,00 €</b></div>
    </div>
  );
}

export function LockedPreview({ kind, title, text, action }: { kind: 'chat' | 'split'; title: string; text?: string; action: ReactNode }) {
  return (
    <div className="lp">
      <div className="lp-behind" aria-hidden="true">{kind === 'chat' ? <MockChat /> : <MockSplit />}</div>
      <div className="lp-lock" role="note">
        <span className="lp-ic"><Ic d={LOCK} size={26} /></span>
        <h3>{title}</h3>
        {text && <p>{text}</p>}
        {action}
      </div>
    </div>
  );
}
