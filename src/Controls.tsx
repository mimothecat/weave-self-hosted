import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MindMapStyle } from "./Markdown";

export type CardView = "title" | "content" | "full";

type Choice<T extends string> = {
  description: string;
  icon: string;
  id: T;
  label: string;
};

function SelectButton<T extends string>({ ariaLabel, choices, onChange, value }: {
  ariaLabel: string;
  choices: Choice<T>[];
  onChange: (value: T) => void;
  value: T;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const active = choices.find(choice => choice.id === value) ?? choices[0];
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !menu.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const toggle = () => {
    if (!open) {
      const rect = root.current?.getBoundingClientRect();
      if (rect) setPosition({ left: Math.max(10, Math.min(window.innerWidth - 270, rect.right - 250)), top: Math.min(window.innerHeight - 250, rect.bottom + 6) });
    }
    setOpen(current => !current);
  };
  return <div ref={root} className="status-select">
    <button type="button" className={open ? "status-button active" : "status-button"} aria-label={ariaLabel} aria-expanded={open} title={`${ariaLabel}：${active.label}`} onPointerDown={event => event.stopPropagation()} onClick={toggle}>
      <span className="status-icon">{active.icon}</span><span className="status-current">{active.label}</span><small>⌄</small>
    </button>
    {open && createPortal(<div ref={menu} className="status-menu" role="menu" style={position} onPointerDown={event => event.stopPropagation()}>
      {choices.map(choice => <button type="button" role="menuitemradio" aria-checked={choice.id === value} className={choice.id === value ? "selected" : ""} key={choice.id} onClick={() => { onChange(choice.id); setOpen(false); }}>
        <b>{choice.icon}</b><span><strong>{choice.label}</strong><small>{choice.description}</small></span>{choice.id === value && <em>✓</em>}
      </button>)}
    </div>, document.body)}
  </div>;
}

const cardViewChoices: Choice<CardView>[] = [
  { id: "full", icon: "▣", label: "完整模式", description: "同时显示标题和内容" },
  { id: "title", icon: "▔", label: "纯标题模式", description: "收起卡片，只保留标题" },
  { id: "content", icon: "▤", label: "纯内容模式", description: "隐藏标题，专注正文" },
];

const mindStyleChoices: Choice<MindMapStyle>[] = [
  { id: "rainbow", icon: "⌁", label: "彩虹曲线", description: "右向展开，主分支自动分色" },
  { id: "balanced", icon: "↔", label: "左右发散", description: "中心主题向两侧平衡展开" },
  { id: "minimal", icon: "└", label: "极简树", description: "单色节点与直角连接" },
  { id: "org", icon: "⌂", label: "组织结构", description: "从上到下呈现层级关系" },
];


export const CardViewButton = (props: { value: CardView; onChange: (value: CardView) => void }) =>
  <SelectButton ariaLabel="卡片显示" choices={cardViewChoices} {...props} />;

export const MindStyleButton = (props: { value: MindMapStyle; onChange: (value: MindMapStyle) => void }) =>
  <SelectButton ariaLabel="导图样式" choices={mindStyleChoices} {...props} />;

export type HistoryItem = { at: number; label: string };

export function HistoryControl({ direction, entries, onStep }: {
  direction: "undo" | "redo";
  entries: HistoryItem[];
  onStep: (count?: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const undo = direction === "undo";
  const title = undo ? "撤销" : "重做";
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return <div ref={root} className="history-control">
    <button type="button" className="history-main" disabled={!entries.length} title={entries.length ? `${title}：${entries[0].label}` : `没有可${title}的操作`} onClick={() => onStep(1)}>{undo ? "↶" : "↷"}</button>
    <button type="button" className="history-more" disabled={!entries.length} aria-label={`${title}多步操作`} aria-expanded={open} onClick={() => setOpen(current => !current)}>⌄</button>
    {open && <div className={`history-menu ${undo ? "" : "redo"}`}>
      <header><strong>{title}多步操作</strong><small>选择后一次回到该位置</small></header>
      {entries.slice(0, 12).map((entry, index) => <button type="button" key={`${entry.at}-${index}`} onClick={() => { onStep(index + 1); setOpen(false); }}>
        <span>{entry.label}</span><em>{index + 1} 步</em>
      </button>)}
    </div>}
  </div>;
}
