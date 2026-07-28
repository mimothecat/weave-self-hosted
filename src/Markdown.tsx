import { type CSSProperties, useLayoutEffect, useMemo, useRef, useState } from "react";

export type MindMapStyle = "rainbow" | "balanced" | "minimal" | "org";

type MindNode = {
  children: MindNode[];
  id: string;
  kind?: "heading" | "list";
  level: number;
  sourceLine?: number;
  text: string;
};

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
    let kind: MindNode["kind"];
    if (heading) {
      level = heading[1].length;
      currentHeadingLevel = level;
      text = heading[2];
      kind = "heading";
      if (!root.children.length && level === 1 && plainText(text) === root.text) return;
    } else if (listItem) {
      level = Math.min(8, Math.max(1, currentHeadingLevel + 1 + Math.floor(listItem[1].replace(/\t/g, "  ").length / 2)));
      text = listItem[2];
      kind = "list";
    } else return;
    const node: MindNode = { id: "node-" + index, kind, level, sourceLine: index, text: plainText(text), children: [] };
    while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  });
  return root;
}

function flattenMindMap(root: MindNode) {
  const result: MindNode[] = [];
  const walk = (node: MindNode) => {
    result.push(node);
    node.children.forEach(walk);
  };
  walk(root);
  return result;
}

function mindNodeRange(root: MindNode, node: MindNode, lineCount: number) {
  if (node.sourceLine === undefined) return [lineCount, lineCount] as const;
  const ordered = flattenMindMap(root).filter(item => item.sourceLine !== undefined).sort((a, b) => a.sourceLine! - b.sourceLine!);
  const next = ordered.find(item => item.sourceLine! > node.sourceLine! && item.level <= node.level);
  return [node.sourceLine, next?.sourceLine ?? lineCount] as const;
}

function renameMindNode(content: string, node: MindNode, text: string) {
  if (node.sourceLine === undefined) return content;
  const lines = content.replace(/\r/g, "").split("\n");
  const line = lines[node.sourceLine] ?? "";
  if (node.kind === "heading") lines[node.sourceLine] = line.replace(/^(#{1,6}\s+).+$/, (_, prefix: string) => prefix + text);
  else lines[node.sourceLine] = line.replace(/^(\s*(?:[-*+]|\d+[.)])\s+).+$/, (_, prefix: string) => prefix + text);
  return lines.join("\n");
}

function newMindNodeLine(content: string, node: MindNode, relation: "child" | "sibling") {
  if (node.sourceLine === undefined) return "# 新节点";
  const lines = content.replace(/\r/g, "").split("\n");
  const source = lines[node.sourceLine] ?? "";
  if (node.kind === "list") {
    const indent = source.match(/^(\s*)/)?.[1] ?? "";
    return `${relation === "child" ? indent + "  " : indent}- 新节点`;
  }
  const level = node.level + (relation === "child" ? 1 : 0);
  return level <= 6 ? `${"#".repeat(Math.max(1, level))} 新节点` : `${"  ".repeat(level - 6)}- 新节点`;
}

function addMindNode(content: string, root: MindNode, node: MindNode, relation: "child" | "sibling") {
  const lines = content.replace(/\r/g, "").split("\n");
  const line = newMindNodeLine(content, node, relation);
  if (node.sourceLine === undefined) {
    if (lines.length === 1 && !lines[0]) return line;
    if (lines.at(-1)?.trim()) lines.push("");
    lines.push(line);
    return lines.join("\n");
  }
  const [, rangeEnd] = mindNodeRange(root, node, lines.length);
  const at = relation === "child" ? node.sourceLine + 1 : rangeEnd;
  lines.splice(at, 0, line);
  return lines.join("\n");
}

function deleteMindNode(content: string, root: MindNode, node: MindNode) {
  if (node.sourceLine === undefined) return content;
  const lines = content.replace(/\r/g, "").split("\n");
  const [start, end] = mindNodeRange(root, node, lines.length);
  lines.splice(start, Math.max(1, end - start));
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
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
  orientation: "horizontal" | "vertical";
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

function collectMindNodes(root: MindNode, full: boolean) {
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
  return records;
}

function finishMindLayout(nodes: PositionedMindNode[], orientation: MindLayout["orientation"], full: boolean): MindLayout {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const links = nodes.flatMap(node => node.parentId ? [{ color: node.color, depth: node.depth, from: byId.get(node.parentId)!, to: node }] : []);
  const width = Math.max(...nodes.map(node => node.x + node.width)) + (full ? 34 : 20);
  const height = Math.max(...nodes.map(node => node.y + node.height)) + (full ? 28 : 18);
  return { height, links, nodes, orientation, width };
}

function layoutHorizontal(root: MindNode, records: Omit<PositionedMindNode, "x" | "y">[], full: boolean, balanced: boolean) {
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
  let nodes = records.map(node => positioned.get(node.id)!);

  if (balanced && root.children.length > 1) {
    const sideById = new Map<string, number>();
    const assign = (node: MindNode, side: number) => {
      sideById.set(node.id, side);
      node.children.forEach(child => assign(child, side));
    };
    root.children.forEach((child, index) => assign(child, index % 2 === 0 ? 1 : -1));
    const originalRoot = nodes[0];
    let leftExtent = 0;
    nodes.forEach(node => {
      if ((sideById.get(node.id) ?? 1) < 0) {
        const delta = node.x - originalRoot.x - originalRoot.width;
        leftExtent = Math.max(leftExtent, delta + node.width);
      }
    });
    const centerX = (full ? 34 : 22) + leftExtent;
    nodes = nodes.map(node => {
      if (node.id === originalRoot.id) return { ...node, x: centerX };
      const delta = node.x - originalRoot.x - originalRoot.width;
      return (sideById.get(node.id) ?? 1) < 0
        ? { ...node, x: centerX - delta - node.width }
        : { ...node, x: centerX + originalRoot.width + delta };
    });
  }
  return finishMindLayout(nodes, "horizontal", full);
}

function layoutVertical(records: Omit<PositionedMindNode, "x" | "y">[], full: boolean) {
  const maxHeights: number[] = [];
  records.forEach(node => { maxHeights[node.depth] = Math.max(maxHeights[node.depth] || 0, node.height); });
  const rowY: number[] = [full ? 28 : 18];
  for (let depth = 1; depth < maxHeights.length; depth += 1) {
    rowY[depth] = rowY[depth - 1] + maxHeights[depth - 1] + (full ? 70 : 54);
  }
  const byId = new Map(records.map(node => [node.id, node]));
  const positioned = new Map<string, PositionedMindNode>();
  let cursorX = full ? 28 : 18;
  const place = (node: Omit<PositionedMindNode, "x" | "y">): PositionedMindNode => {
    const children = node.children.map(child => place(byId.get(child.id)!));
    let x: number;
    if (children.length) {
      const first = children[0];
      const last = children[children.length - 1];
      x = (first.x + first.width / 2 + last.x + last.width / 2) / 2 - node.width / 2;
    } else {
      x = cursorX;
      cursorX += node.width + (full ? 30 : 20);
    }
    const result: PositionedMindNode = { ...node, x, y: rowY[node.depth] };
    positioned.set(node.id, result);
    return result;
  };
  place(records[0]);
  return finishMindLayout(records.map(node => positioned.get(node.id)!), "vertical", full);
}

function layoutMindMap(root: MindNode, full: boolean, style: MindMapStyle): MindLayout {
  const records = collectMindNodes(root, full);
  return style === "org" ? layoutVertical(records, full) : layoutHorizontal(root, records, full, style === "balanced");
}

function linkPath(link: MindLink, style: MindMapStyle) {
  if (style === "org") {
    const startX = link.from.x + link.from.width / 2;
    const startY = link.from.y + link.from.height;
    const endX = link.to.x + link.to.width / 2;
    const endY = link.to.y;
    const bend = Math.max(22, (endY - startY) * .5);
    return `M ${startX} ${startY} C ${startX} ${startY + bend}, ${endX} ${endY - bend}, ${endX} ${endY}`;
  }
  const rightward = link.to.x >= link.from.x;
  const startX = rightward ? link.from.x + link.from.width : link.from.x;
  const startY = link.from.y + link.from.height / 2;
  const endX = rightward ? link.to.x : link.to.x + link.to.width;
  const endY = link.to.y + link.to.height / 2;
  const direction = rightward ? 1 : -1;
  const bend = Math.max(24, Math.abs(endX - startX) * .52);
  if (style === "minimal") {
    const middle = (startX + endX) / 2;
    return `M ${startX} ${startY} H ${middle} V ${endY} H ${endX}`;
  }
  return `M ${startX} ${startY} C ${startX + bend * direction} ${startY}, ${endX - bend * direction} ${endY}, ${endX} ${endY}`;
}

export function MindMap({ title, content, full = false, style = "rainbow", onChange, onTitleChange }: {
  content: string;
  full?: boolean;
  onChange?: (content: string) => void;
  onTitleChange?: (title: string) => void;
  style?: MindMapStyle;
  title: string;
}) {
  const root = useMemo(() => buildMindMap(title, content), [title, content]);
  const layout = useMemo(() => layoutMindMap(root, full, style), [root, full, style]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  useLayoutEffect(() => {
    if (full) { setScale(1); return; }
    const viewport = viewportRef.current;
    if (!viewport) return;
    const fit = () => {
      const availableWidth = Math.max(180, viewport.clientWidth - 16);
      setScale(Math.max(.64, Math.min(1, availableWidth / layout.width)));
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [full, layout.width]);

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const rootNode = layout.nodes[0];
    if (!scroll || !rootNode) return;
    if (layout.orientation === "vertical") {
      scroll.scrollLeft = Math.max(0, (rootNode.x + rootNode.width / 2) * scale - scroll.clientWidth / 2);
      scroll.scrollTop = 0;
    } else {
      scroll.scrollTop = Math.max(0, (rootNode.y + rootNode.height / 2) * scale - scroll.clientHeight / 2);
      scroll.scrollLeft = style === "balanced" ? Math.max(0, (rootNode.x + rootNode.width / 2) * scale - scroll.clientWidth / 2) : 0;
    }
  }, [layout, scale, style]);

  const selectedNode = layout.nodes.find(node => node.id === selectedId);
  const beginRename = (node: PositionedMindNode) => {
    setSelectedId(node.id);
    setEditingId(node.id);
    setDraft(node.text);
  };
  const saveRename = (node: PositionedMindNode) => {
    const next = draft.trim();
    setEditingId(null);
    if (!next || next === node.text) return;
    if (node.id === "root") onTitleChange?.(next);
    else onChange?.(renameMindNode(content, node, next));
  };
  const editable = Boolean(onChange || onTitleChange);

  return <div ref={viewportRef} className={`doc-surface mindmap-view style-${style} ${full ? "full" : ""}`} onWheel={event => event.stopPropagation()}>
    <div ref={scrollRef} className="mindmap-scroll">
      <div className="mindmap-frame" style={{ width: layout.width * scale, height: layout.height * scale }}>
        <div className="mindmap-canvas" style={{ width: layout.width, height: layout.height, transform: `scale(${scale})` }} onPointerDown={event => { event.stopPropagation(); if (event.target === event.currentTarget) setSelectedId(null); }}>
          <svg className="mindmap-links" viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
            {layout.links.map(link => <path key={link.to.id} d={linkPath(link, style)} style={{ stroke: link.color }} className={link.depth === 1 ? "primary" : ""} />)}
          </svg>
          {layout.nodes.map(node => <div
            key={node.id}
            className={`mind-node depth-${Math.min(node.depth, 3)} ${node.depth === 0 ? "root" : ""} ${selectedId === node.id ? "selected" : ""}`}
            style={{
              "--branch-color": node.color,
              "--branch-wash": `${node.color}18`,
              height: node.height,
              left: node.x,
              top: node.y,
              width: node.width,
            } as CSSProperties}
            title={editable ? `${node.text}（双击编辑）` : node.text}
            onPointerDown={event => event.stopPropagation()}
            onClick={() => editable && setSelectedId(node.id)}
            onDoubleClick={() => editable && beginRename(node)}
          >{editingId === node.id
            ? <input autoFocus value={draft} onChange={event => setDraft(event.target.value)} onFocus={event => event.currentTarget.select()} onBlur={() => saveRename(node)} onKeyDown={event => { if (event.key === "Enter") saveRename(node); if (event.key === "Escape") setEditingId(null); }} />
            : node.text}</div>)}
          {editable && selectedNode && editingId !== selectedNode.id && <div className="mindmap-node-actions" style={{ left: selectedNode.x, top: Math.max(2, selectedNode.y - (full ? 38 : 42 / scale)), transform: `scale(${1 / scale})`, transformOrigin: "bottom left" }}>
            <button type="button" title="重命名节点" onPointerDown={event => event.stopPropagation()} onClick={() => beginRename(selectedNode)}>✎</button>
            <button type="button" title="新增子节点" onPointerDown={event => event.stopPropagation()} onClick={() => onChange?.(addMindNode(content, root, selectedNode, "child"))}>＋子</button>
            {selectedNode.id !== "root" && <button type="button" title="新增同级节点" onPointerDown={event => event.stopPropagation()} onClick={() => onChange?.(addMindNode(content, root, selectedNode, "sibling"))}>＋同</button>}
            {selectedNode.id !== "root" && <button type="button" className="danger" title="删除节点及其子节点" onPointerDown={event => event.stopPropagation()} onClick={() => { onChange?.(deleteMindNode(content, root, selectedNode)); setSelectedId(null); }}>×</button>}
          </div>}
          {!root.children.length && <div className="mindmap-empty" style={{ left: layout.nodes[0].x, top: layout.nodes[0].y + layout.nodes[0].height + 14 }}>点击中心主题后选择“＋子”，继续添加分支。</div>}
        </div>
      </div>
    </div>
  </div>;
}
