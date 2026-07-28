import { ClipboardEvent, DragEvent, FormEvent, PointerEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MindStyleButton } from "./Controls";
import { MindMap, type MindMapStyle } from "./Markdown";

type TextBlock = { html: string; id: string; type: "text" };
type ImageBlock = { alt: string; id: string; src: string; type: "image" };
type MindMapBlock = {
  content: string;
  id: string;
  style: MindMapStyle;
  title: string;
  type: "mindmap";
};
type DocumentBlock = TextBlock | ImageBlock | MindMapBlock;
type DocumentPayload = { blocks: DocumentBlock[]; version: 1 };

const documentPrefix = "WEAVE_DOCUMENT_V1:";
const allowedStyles = new Set<MindMapStyle>(["rainbow", "balanced", "minimal", "org"]);
const blockId = () => `block_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sanitizeHtml(value: string) {
  if (typeof document === "undefined") return value;
  const template = document.createElement("template");
  template.innerHTML = value;
  const allowed = new Set(["B", "BR", "DIV", "H1", "H2", "H3", "LI", "OL", "P", "STRONG", "UL"]);
  Array.from(template.content.querySelectorAll("*")).reverse().forEach(element => {
    if (element.tagName === "SCRIPT" || element.tagName === "STYLE") {
      element.remove();
      return;
    }
    if (!allowed.has(element.tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      return;
    }
    Array.from(element.attributes).forEach(attribute => element.removeAttribute(attribute.name));
  });
  return template.innerHTML;
}

function legacyTextBlock(content: string): TextBlock {
  return {
    id: "legacy-text",
    type: "text",
    html: escapeHtml(content).replace(/\r?\n/g, "<br>"),
  };
}

function validBlock(value: unknown): value is DocumentBlock {
  if (!value || typeof value !== "object") return false;
  const block = value as Partial<DocumentBlock>;
  if (typeof block.id !== "string" || typeof block.type !== "string") return false;
  if (block.type === "text") return typeof block.html === "string";
  if (block.type === "image") return typeof block.src === "string" && typeof block.alt === "string";
  if (block.type === "mindmap") {
    return typeof block.title === "string" && typeof block.content === "string" && allowedStyles.has(block.style as MindMapStyle);
  }
  return false;
}

export function decodeDocument(content: string): DocumentBlock[] {
  if (!content.startsWith(documentPrefix)) return [legacyTextBlock(content)];
  try {
    const payload = JSON.parse(content.slice(documentPrefix.length)) as DocumentPayload;
    const blocks = payload.version === 1 && Array.isArray(payload.blocks)
      ? payload.blocks.filter(validBlock).map(block => block.type === "text"
        ? { ...block, html: sanitizeHtml(block.html) }
        : block)
      : [];
    return blocks.length ? blocks : [{ id: blockId(), type: "text", html: "" }];
  } catch {
    return [legacyTextBlock(content)];
  }
}

export function encodeDocument(blocks: DocumentBlock[]) {
  const safeBlocks = blocks.map(block => block.type === "text"
    ? { ...block, html: sanitizeHtml(block.html) }
    : block);
  return documentPrefix + JSON.stringify({ version: 1, blocks: safeBlocks } satisfies DocumentPayload);
}

function textFromHtml(html: string) {
  if (typeof document === "undefined") return html.replace(/<[^>]+>/g, " ");
  const node = document.createElement("div");
  node.innerHTML = html;
  return node.textContent ?? "";
}

export function documentPlainText(content: string) {
  return decodeDocument(content).map(block => {
    if (block.type === "text") return textFromHtml(block.html);
    if (block.type === "image") return block.alt;
    return [block.title, block.content.replace(/^#+\s*/gm, "")].join(" ");
  }).join(" ").replace(/\s+/g, " ").trim();
}

function ToolbarButton({ children, label, onRun }: {
  children: React.ReactNode;
  label: string;
  onRun: () => void;
}) {
  return <button
    type="button"
    title={label}
    aria-label={label}
    onPointerDown={event => {
      event.preventDefault();
      event.stopPropagation();
      onRun();
    }}
  >{children}</button>;
}

function EditableTextBlock({ block, onFocusBlock, onNode, onPasteBlock, onSync }: {
  block: TextBlock;
  onFocusBlock: () => void;
  onNode: (node: HTMLDivElement | null) => void;
  onPasteBlock: (event: ClipboardEvent<HTMLDivElement>) => void;
  onSync: (node: HTMLDivElement) => void;
}) {
  const nodeRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const node = nodeRef.current;
    if (node && node.innerHTML !== block.html) node.innerHTML = block.html;
  }, [block.html]);

  return <div
    ref={node => {
      nodeRef.current = node;
      onNode(node);
    }}
    className="rich-text-block"
    data-block-id={block.id}
    data-placeholder="输入内容，或粘贴一张图片…"
    contentEditable
    suppressContentEditableWarning
    onFocus={onFocusBlock}
    onInput={(event: FormEvent<HTMLDivElement>) => onSync(event.currentTarget)}
    onBlur={event => onSync(event.currentTarget)}
    onPaste={onPasteBlock}
  />;
}

export function RichDocumentEditor({ content, full = false, onChange, onImageUpload, onUploadMessage }: {
  content: string;
  full?: boolean;
  onChange: (content: string, label: string) => void;
  onImageUpload: (file: File) => Promise<{ name: string; url: string }>;
  onUploadMessage?: (message: string) => void;
}) {
  const [blocks, setBlocks] = useState<DocumentBlock[]>(() => decodeDocument(content));
  const [activeTextId, setActiveTextId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const textNodes = useRef(new Map<string, HTMLDivElement>());
  const lastEmitted = useRef(content);

  useEffect(() => {
    if (content === lastEmitted.current) return;
    lastEmitted.current = content;
    setBlocks(decodeDocument(content));
  }, [content]);

  const snapshotBlocks = () => blocks.map(block => {
    if (block.type !== "text") return block;
    const node = textNodes.current.get(block.id);
    return node ? { ...block, html: sanitizeHtml(node.innerHTML) } : block;
  });

  const emit = (next: DocumentBlock[], label: string, structural = true) => {
    if (structural) setBlocks(next);
    const encoded = encodeDocument(next);
    lastEmitted.current = encoded;
    onChange(encoded, label);
  };

  const syncText = (id: string, node: HTMLDivElement) => {
    const next = snapshotBlocks().map(block => block.id === id && block.type === "text"
      ? { ...block, html: sanitizeHtml(node.innerHTML) }
      : block);
    emit(next, "编辑文档内容", false);
  };

  const activeText = () => activeTextId ?? blocks.find(block => block.type === "text")?.id ?? null;
  const runCommand = (command: string, value?: string) => {
    const id = activeText();
    if (!id) return;
    const node = textNodes.current.get(id);
    if (!node) return;
    node.focus();
    document.execCommand(command, false, value);
    requestAnimationFrame(() => syncText(id, node));
  };

  const insertAfter = (afterId: string | null, inserted: DocumentBlock, label: string) => {
    const current = snapshotBlocks();
    const index = afterId ? current.findIndex(block => block.id === afterId) : current.length - 1;
    const following: TextBlock = { id: blockId(), type: "text", html: "" };
    current.splice(Math.max(0, index + 1), 0, inserted, following);
    emit(current, label);
    setActiveTextId(following.id);
    requestAnimationFrame(() => textNodes.current.get(following.id)?.focus());
  };

  const insertMindMap = () => insertAfter(activeText(), {
    id: blockId(),
    type: "mindmap",
    title: "中心主题",
    content: "## 新节点",
    style: "rainbow",
  }, "插入思维导图");

  const insertImage = async (file: File, afterId: string | null) => {
    if (!file.type.startsWith("image/")) return;
    try {
      setUploading(true);
      onUploadMessage?.("正在上传图片…");
      const asset = await onImageUpload(file);
      insertAfter(afterId, { id: blockId(), type: "image", src: asset.url, alt: asset.name }, "粘贴图片");
      onUploadMessage?.("图片已插入文档");
    } catch (error) {
      onUploadMessage?.(error instanceof Error ? error.message : "图片上传失败");
    } finally {
      setUploading(false);
    }
  };

  const paste = (event: ClipboardEvent<HTMLDivElement>, id: string) => {
    const file = Array.from(event.clipboardData.files).find(item => item.type.startsWith("image/"));
    if (file) {
      event.preventDefault();
      void insertImage(file, id);
      return;
    }
    event.preventDefault();
    document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
    requestAnimationFrame(() => {
      const node = textNodes.current.get(id);
      if (node) syncText(id, node);
    });
  };

  const drop = (event: DragEvent<HTMLDivElement>) => {
    const file = Array.from(event.dataTransfer.files).find(item => item.type.startsWith("image/"));
    if (!file) return;
    event.preventDefault();
    event.stopPropagation();
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-block-id]");
    void insertImage(file, target?.dataset.blockId ?? activeText());
  };

  const replaceBlock = (id: string, patch: Partial<MindMapBlock>, label: string) => {
    const next = snapshotBlocks().map(block => block.id === id && block.type === "mindmap"
      ? { ...block, ...patch }
      : block);
    emit(next, label);
  };

  const removeBlock = (id: string, label: string) => {
    const next = snapshotBlocks().filter(block => block.id !== id);
    if (!next.some(block => block.type === "text")) next.push({ id: blockId(), type: "text", html: "" });
    emit(next, label);
  };

  const stopPointer = (event: PointerEvent<HTMLDivElement>) => event.stopPropagation();

  return <div
    className={`doc-surface rich-document ${full ? "full" : ""}`}
    onPointerDown={stopPointer}
    onWheel={event => event.stopPropagation()}
    onDragOver={event => {
      if (Array.from(event.dataTransfer.types).includes("Files")) event.preventDefault();
    }}
    onDrop={drop}
  >
    <div className="rich-toolbar" role="toolbar" aria-label="文档格式">
      <ToolbarButton label="正文" onRun={() => runCommand("formatBlock", "p")}>P</ToolbarButton>
      <ToolbarButton label="一级标题" onRun={() => runCommand("formatBlock", "h1")}>H1</ToolbarButton>
      <ToolbarButton label="二级标题" onRun={() => runCommand("formatBlock", "h2")}>H2</ToolbarButton>
      <ToolbarButton label="三级标题" onRun={() => runCommand("formatBlock", "h3")}>H3</ToolbarButton>
      <i />
      <ToolbarButton label="加粗" onRun={() => runCommand("bold")}><strong>B</strong></ToolbarButton>
      <ToolbarButton label="项目列表" onRun={() => runCommand("insertUnorderedList")}>•</ToolbarButton>
      <i />
      <ToolbarButton label="插入思维导图" onRun={insertMindMap}><span className="mindmap-insert-icon">⌘</span><span className="mindmap-insert-label">导图</span></ToolbarButton>
      <small>{uploading ? "上传中…" : "粘贴图片"}</small>
    </div>
    <div className="rich-blocks">
      {blocks.map(block => {
        if (block.type === "text") return <EditableTextBlock
          key={block.id}
          block={block}
          onNode={node => {
            if (node) textNodes.current.set(block.id, node);
            else textNodes.current.delete(block.id);
          }}
          onFocusBlock={() => setActiveTextId(block.id)}
          onSync={node => syncText(block.id, node)}
          onPasteBlock={event => paste(event, block.id)}
        />;
        if (block.type === "image") return <figure key={block.id} className="rich-image-block" data-block-id={block.id} contentEditable={false}>
          <img src={block.src} alt={block.alt} loading="lazy" />
          <figcaption>{block.alt}</figcaption>
          <button type="button" title="删除图片" aria-label="删除图片" onClick={() => removeBlock(block.id, "删除图片")}>×</button>
        </figure>;
        return <section key={block.id} className="rich-mindmap-block" data-block-id={block.id} contentEditable={false}>
          <header>
            <span><b>⌘</b> 思维导图</span>
            <MindStyleButton value={block.style} onChange={style => replaceBlock(block.id, { style }, "切换导图样式")} />
            <button type="button" title="删除思维导图" aria-label="删除思维导图" onClick={() => removeBlock(block.id, "删除思维导图")}>×</button>
          </header>
          <MindMap
            title={block.title}
            content={block.content}
            full={full}
            style={block.style}
            onTitleChange={title => replaceBlock(block.id, { title }, "重命名中心主题")}
            onChange={next => replaceBlock(block.id, { content: next }, "编辑导图")}
          />
        </section>;
      })}
    </div>
  </div>;
}
