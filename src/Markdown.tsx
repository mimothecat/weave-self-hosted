import { Fragment, type CSSProperties, type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";

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

type PositionedMindNode = MindNode & {
  color: string;
  depth: number;
  height: number;
  parentId?: string;
  width: number;
  x: number;
  y: number;
};

type MindLink = {
  color: string;
  depth: number;
  from: PositionedMindNode;
  to: PositionedMindNode;
};

type MindLayout = {
  height: number;
  links: MindLink[];
  nodes: PositionedMindNode[];
  width: number;
};

const branchColors = ["#7961c8", "#d86f68", "#d49235", "#459475", "#4686b9", "#ad6299"];

function mindNodeSize(text: string, depth: number, full: boolean) {
  const fontWidth = full ? 8.2 : 7.2;
  const padding = full ? 28 : 22;
  const limits = depth === 0
    ? (full ? [142, 214] : [118, 184])
    : depth === 1
      ? (full ? [116, 190] : [98, 166])
      : (full ? [96, 164] : [80, 142]);
  return {
    width: Math.round(Math.max(limits[0], Math.min(limits[1], Array.from(text).length * fontWidth + padding))),
    height: depth === 0 ? (full ? 48 : 42) : depth === 1 ? (full ? 40 : 35) : (full ? 34 : 30),
  };
}

function layoutMindMap(root: MindNode, full: boolean): MindLayout {
  const records: Omit<PositionedMindNode, "x" | "y">[] = [];
  const branchDepth = root.children.length === 1 && root.children[0].children.length ? 2 : 1;
  const collect = (node: MindNode, depth: number, color: string, parentId?: string) => {
    const size = mindNodeSize(node.text, depth, full);
    records.push({ ...node, ...size, color, depth, parentId });
    node.children.forEach((child, index) => {
      const childColor = depth + 1 === branchDepth ? branchColors[index % branchColors.length] : color;
      collect(child, depth + 1, childColor, node.id);
    });
  };
  collect(root, 0, "#544065");

  const maxWidths: number[] = [];
  records.forEach(node => { maxWidths[node.depth] = Math.max(maxWidths[node.depth] || 0, node.width); });
  const columnX: number[] = [full ? 28 : 18];
  for (let depth = 1; depth < maxWidths.length; depth += 1) {
    columnX[depth] = columnX[depth - 1] + maxWidths[depth - 1] + (full ? 76 : 60);
  }

  const byId = new Map(records.map(node => [node.id, node]));
  const positioned = new Map<string, PositionedMindNode>();
  let cursorY = full ? 26 : 16;
  const place = (node: Omit<PositionedMindNode, "x" | "y">): PositionedMindNode => {
    const children = node.children.map(child => place(byId.get(child.id)!));
    let y: number;
    if (children.length) {
      const first = children[0];
      const last = children[children.length - 1];
      y = (first.y + first.height / 2 + last.y + last.height / 2) / 2 - node.height / 2;
    } else {
      y = cursorY;
      cursorY += node.height + (node.depth <= 1 ? (full ? 28 : 20) : (full ? 18 : 13));
    }
    const result: PositionedMindNode = { ...node, x: columnX[node.depth], y };
    positioned.set(node.id, result);
    return result;
  };
  place(records[0]);

  const nodes = records.map(node => positioned.get(node.id)!);
  const links = nodes.flatMap(node => {
    if (!node.parentId) return [];
    return [{ color: node.color, depth: node.depth, from: positioned.get(node.parentId)!, to: node }];
  });
  const width = Math.max(...nodes.map(node => node.x + node.width)) + (full ? 34 : 20);
  const height = Math.max(cursorY, ...nodes.map(node => node.y + node.height)) + (full ? 24 : 16);
  return { height, links, nodes, width };
}

function linkPath(link: MindLink) {
  const startX = link.from.x + link.from.width;
  const startY = link.from.y + link.from.height / 2;
  const endX = link.to.x;
  const endY = link.to.y + link.to.height / 2;
  const bend = Math.max(24, (endX - startX) * .52);
  return `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`;
}

export function MindMap({ title, content, full = false }: { title: string; content: string; full?: boolean }) {
  const root = useMemo(() => buildMindMap(title, content), [title, content]);
  const layout = useMemo(() => layoutMindMap(root, full), [root, full]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    if (full) { setScale(1); return; }
    const viewport = viewportRef.current;
    if (!viewport) return;
    const fit = () => {
      const availableWidth = Math.max(180, viewport.clientWidth - 16);
      setScale(Math.max(.64, Math.min(1, availableWidth / layout.width)));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [full, layout.width]);

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const rootNode = layout.nodes[0];
    if (!scroll || !rootNode) return;
    scroll.scrollTop = Math.max(0, (rootNode.y + rootNode.height / 2) * scale - scroll.clientHeight / 2);
    scroll.scrollLeft = 0;
  }, [layout, scale]);

  return <div ref={viewportRef} className={"doc-surface mindmap-view " + (full ? "full" : "")} onWheel={event => event.stopPropagation()}>
    <div ref={scrollRef} className="mindmap-scroll">
      <div className="mindmap-frame" style={{ width: layout.width * scale, height: layout.height * scale }}>
        <div className="mindmap-canvas" style={{ width: layout.width, height: layout.height, transform: `scale(${scale})` }}>
          <svg className="mindmap-links" viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
            {layout.links.map(link => <path key={link.to.id} d={linkPath(link)} style={{ stroke: link.color }} className={link.depth === 1 ? "primary" : ""} />)}
          </svg>
          {layout.nodes.map(node => <div
            key={node.id}
            className={`mind-node depth-${Math.min(node.depth, 3)} ${node.depth === 0 ? "root" : ""}`}
            style={{
              "--branch-color": node.color,
              "--branch-wash": `${node.color}18`,
              height: node.height,
              left: node.x,
              top: node.y,
              width: node.width,
            } as CSSProperties}
            title={node.text}
          >{node.text}</div>)}
          {!root.children.length && <div className="mindmap-empty" style={{ left: layout.nodes[0].x, top: layout.nodes[0].y + layout.nodes[0].height + 14 }}>使用 #、##、### 标题或缩进列表生成导图分支。</div>}
        </div>
      </div>
    </div>
  </div>;
}
