import { useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical, Plus, RotateCcw, X } from 'lucide-react';
import { DEFAULT_SHORTCUTS, moveShortcut, SHORTCUT_TITLES, type ShortcutKey } from '../core/shortcuts.mjs';
import './shortcut-editor.css';

export function ShortcutEditor({ value, available, onSave, onCancel }: { value: ShortcutKey[]; available: ShortcutKey[]; onSave: (order: ShortcutKey[]) => void; onCancel: () => void }) {
  const [order, setOrder] = useState(value.filter(key => available.includes(key)));
  const move = (key: ShortcutKey, target: number) => setOrder(previous => moveShortcut(previous, key, target));
  return <div className="shortcut-editor"><p>选择常用功能，拖动或使用上下按钮调整顺序。快捷入口保存在当前账号的本机设置中。</p>
    <h3>快捷入口 <small>{order.length} 项</small></h3><ol aria-label="已选快捷入口">{order.map((key, index) => <li key={key} draggable onDragStart={event => event.dataTransfer.setData('text/plain', key)} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const dragged = event.dataTransfer.getData('text/plain') as ShortcutKey; if (order.includes(dragged)) move(dragged, index); }}><GripVertical size={16} aria-hidden="true" /><span>{SHORTCUT_TITLES[key]}</span><button className="icon-button" type="button" aria-label={'上移' + SHORTCUT_TITLES[key]} disabled={index === 0} onClick={() => move(key, index - 1)}><ArrowUp size={17} /></button><button className="icon-button" type="button" aria-label={'下移' + SHORTCUT_TITLES[key]} disabled={index === order.length - 1} onClick={() => move(key, index + 1)}><ArrowDown size={17} /></button><button className="icon-button" type="button" aria-label={'移除' + SHORTCUT_TITLES[key]} onClick={() => setOrder(previous => previous.filter(item => item !== key))}><X size={17} /></button></li>)}</ol>
    {!order.length && <p className="shortcut-empty">已隐藏快捷入口，可从更多功能重新添加。</p>}
    <h3>更多功能</h3><div className="shortcut-available">{available.filter(key => !order.includes(key)).map(key => <button className="button secondary" type="button" key={key} onClick={() => setOrder(previous => [...previous, key])}><Plus size={16} />{SHORTCUT_TITLES[key]}</button>)}</div>
    <div className="shortcut-footer"><button className="text-button" type="button" onClick={() => setOrder(DEFAULT_SHORTCUTS.filter(key => available.includes(key)))}><RotateCcw size={15} />恢复默认</button><button className="button secondary" type="button" onClick={onCancel}>取消</button><button className="button" type="button" onClick={() => onSave(order)}>完成</button></div>
  </div>;
}
