import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Layout } from '../core/dashLayout';
import { COLUMNS } from '../core/dashLayout';
import { Ic, ICON } from './fx';

// Grelha de janelas: 3 colunas, arrastar para reorganizar (modo "Personalizar").
// O arrasto usa só a pega (⠿); com o teclado: setas movem a janela.

const GRIP = 'M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01';
const WIDE = new Set(['overview']); // ocupam as duas meias-colunas da coluna central

export interface WidgetGridProps {
  layout: Layout;
  editing: boolean;
  render: (id: string) => ReactNode | null;
  labelOf: (id: string) => string;
  onMove: (id: string, col: number, beforeId: string | null) => void;
  onRemove: (id: string) => void;
  onNudge: (id: string, dir: 'up' | 'down' | 'left' | 'right') => void;
  /** Esticar/encolher (só nos cartões em que faz sentido) */
  stretched?: Set<string>;
  canStretch?: (id: string) => boolean;
  onStretch?: (id: string) => void;
}

export function WidgetGrid({ layout, editing, render, labelOf, onMove, onRemove, onNudge, stretched, canStretch, onStretch }: WidgetGridProps) {
  const { t } = useTranslation();
  const dragId = useRef<string | null>(null);
  const [over, setOver] = useState<string | null>(null); // "col:id" ou "col:end"

  const drop = (col: number, beforeId: string | null) => {
    const id = dragId.current;
    dragId.current = null;
    setOver(null);
    if (id && id !== beforeId) onMove(id, col, beforeId);
  };

  return (
    <div className={'fx-grid' + (editing ? ' editing' : '')}>
      {Array.from({ length: COLUMNS }, (_, col) => (
        <div
          key={col}
          className={'fx-col' + (col === 1 ? ' center' : '') + (editing && over === `${col}:end` ? ' drop' : '')}
          onDragOver={editing ? (e) => { if (dragId.current) { e.preventDefault(); setOver(`${col}:end`); } } : undefined}
          onDrop={editing ? (e) => { e.preventDefault(); drop(col, null); } : undefined}
        >
          {layout[col].map((id) => {
            const body = render(id);
            if (body === null) return null;
            return (
              <div
                key={id}
                className={'fx-widget' + (WIDE.has(id) && col === 1 ? ' wide' : '') + (editing ? ' edit' : '') + (editing && over === `${col}:${id}` ? ' drop-before' : '')}
                onDragOver={editing ? (e) => { if (dragId.current) { e.preventDefault(); e.stopPropagation(); setOver(`${col}:${id}`); } } : undefined}
                onDrop={editing ? (e) => { e.preventDefault(); e.stopPropagation(); drop(col, id); } : undefined}
              >
                {editing && (
                  <div className="fx-widget-bar">
                    <button
                      type="button"
                      className="fx-grip"
                      draggable
                      aria-label={`${t('panel.moveWidget')}: ${labelOf(id)}`}
                      title={t('panel.dragHint')}
                      onDragStart={(e) => {
                        dragId.current = id;
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', id);
                        const card = (e.currentTarget as HTMLElement).closest('.fx-widget');
                        if (card) e.dataTransfer.setDragImage(card as HTMLElement, 24, 24);
                      }}
                      onDragEnd={() => { dragId.current = null; setOver(null); }}
                      onKeyDown={(e) => {
                        const map: Record<string, 'up' | 'down' | 'left' | 'right'> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
                        if (map[e.key]) { e.preventDefault(); onNudge(id, map[e.key]); }
                      }}
                    >
                      <Ic d={GRIP} size={18} /><span>{labelOf(id)}</span>
                    </button>
                    {canStretch?.(id) && onStretch && (
                      <button type="button" className={'fx-round sm' + (stretched?.has(id) ? ' on' : '')} onClick={() => onStretch(id)}
                        aria-pressed={!!stretched?.has(id)} title={stretched?.has(id) ? t('panel.shrinkWidget') : t('panel.stretchWidget')}
                        aria-label={`${stretched?.has(id) ? t('panel.shrinkWidget') : t('panel.stretchWidget')}: ${labelOf(id)}`}>
                        <Ic d={stretched?.has(id) ? 'M8 4l4 4 4-4M8 20l4-4 4 4' : 'M8 8l4-4 4 4M8 16l4 4 4-4'} size={14} />
                      </button>
                    )}
                    <button type="button" className="fx-round sm" onClick={() => onRemove(id)} aria-label={`${t('panel.removeWidget')}: ${labelOf(id)}`}>
                      <Ic d={ICON.close} size={14} />
                    </button>
                  </div>
                )}
                <div className="fx-widget-body">{body}</div>
              </div>
            );
          })}
          {editing && <div className="fx-dropzone">{t('panel.dropHere')}</div>}
        </div>
      ))}
    </div>
  );
}
