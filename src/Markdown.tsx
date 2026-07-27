import { Fragment, type ReactNode } from "react";

export type DocMode = "edit" | "preview" | "mindmap";

const modes: { id: DocMode; label: string }[] = [
  { id: "edit", label: "编辑" },
  { id: "preview", label: "预览" },
  { id: "mindmap", label: "导图" },
];

export function DocModeTabs({ mode, onChange }: { mode: DocMode; onChange: (mode: DocMode) => void }) {
  return <div className="doc-modes" role="tablist" aria-label="文档显示方式">
    {modes.map(item => <button key={item.id} type="button" role="tab" aria-selected={mode === item.id} className={mode === item.id ? "active" : ""} onPointerDown={event => event.stopPropagation()} onClick={() => onChange(item.id)}>{item.label}</button>)}
  </div>;
}

function inlineMarkdown(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={index}>{part.slice(1, -1)}</em>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}

type MarkdownBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph" | "quote"; text: string }
  | { type: "ul" | "ol"; items: string[] }
  | { type: "hr" };

function parseMarkdown(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r/g, "").split("\n");
  const blocks: MarkdownBlock[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { blocks.push({ type: "heading", level: heading[1].length, text: heading[2].trim() }); index += 1; continue; }
    if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line)) { blocks.push({ type: "hr" }); index += 1; continue; }
    if (/^\s*>\s?/.test(line)) {
      const text: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) text.push(lines[index++].replace(/^\s*>\s?/, ""));
      blocks.push({ type: "quote", text: text.join(" ") });
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = lines[index].match(/^\s*[-*+]\s+(.+)$/);
        if (!match) break;
        items.push(match[1]);
        index += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = lines[index].match(/^\s*\d+[.)]\s+(.+)$/);
        if (!match) break;
        items.push(match[1]);
        index += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }
    const paragraph: string[] = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^(#{1,6})\s+|^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s?|---+\s*$)/.test(lines[index])) paragraph.push(lines[index++].trim());
    blocks.push({ type: "paragraph", text: paragraph.join(" ") });
  }
  return blocks;
}

export function MarkdownView({ content, full = false }: { content: string; full?: boolean }) {
  const blocks = parseMarkdown(content);
  return <div className={"doc-surface markdown-view " + (full ? "full" : "")} onWheel={event => event.stopPropagation()}>
    {!blocks.length && <div className="markdown-empty"><strong>还没有正文</strong><span>在编辑模式输入 #、##、### 创建分级标题。</span></div>}
    {blocks.map((block, index) => {
      if (block.type === "heading") return <div key={index} className={"md-heading md-h" + block.level} role="heading" aria-level={block.level}>{inlineMarkdown(block.text)}</div>;
      if (block.type === "paragraph") return <p key={index}>{inlineMarkdown(block.text)}</p>;
      if (block.type === "quote") return <blockquote key={index}>{inlineMarkdown(block.text)}</blockquote>;
      if (block.type === "hr") return <hr key={index} />;
      const List = block.type === "ol" ? "ol" : "ul";
      return <List key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{inlineMarkdown(item)}</li>)}</List>;
    })}
  </div>;
}

type MindNode = { id: string; level: number; text: string; children: MindNode[] };

function plainText(text: string) {
  return text.replace(/\*\*|\*|`/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();
}

function buildMindMap(title: string, content: string): MindNode {
  const root: MindNode = { id: "root", level: 0, text: title.trim() || "无标题文档", children: [] };
  const stack: MindNode[] = [root];
  let currentHeadingLevel = 0;
  content.replace(/\r/g, "").split("\n").forEach((line, index) => {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    const listItem = line.match(/^(\s*)(?:[-*+]|\d+[.)])\s+(.+)$/);
    let level = 0;
    let text = "";
    if (heading) {
      level = heading[1].length;
      currentHeadingLevel = level;
      text = heading[2];
      if (!root.children.length && level === 1 && plainText(text) === root.text) return;
    } else if (listItem) {
      level = Math.min(8, Math.max(1, currentHeadingLevel + 1 + Math.floor(listItem[1].replace(/\t/g, "  ").length / 2)));
      text = listItem[2];
    } else return;
    const node: MindNode = { id: "node-" + index, level, text: plainText(text), children: [] };
    while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  });
  return root;
}

function MindBranch({ node, root = false }: { node: MindNode; root?: boolean }) {
  return <li>
    <div className={root ? "mind-node root" : "mind-node"}>{node.text}</div>
    {!!node.children.length && <ul>{node.children.map(child => <MindBranch key={child.id} node={child} />)}</ul>}
  </li>;
}

export function MindMap({ title, content, full = false }: { title: string; content: string; full?: boolean }) {
  const root = buildMindMap(title, content);
  return <div className={"doc-surface mindmap-view " + (full ? "full" : "")} onWheel={event => event.stopPropagation()}>
    <div className="mindmap-scroll">
      <ul className="mindmap-tree"><MindBranch node={root} root /></ul>
      {!root.children.length && <div className="mindmap-empty">使用 #、##、### 标题或缩进列表生成导图分支。</div>}
    </div>
  </div>;
}
