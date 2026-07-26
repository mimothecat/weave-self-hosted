import { ChangeEvent, DragEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Kind = "block" | "doc";
type Color = "paper" | "lavender" | "mint" | "sun" | "rose" | "sky";
type Card = { id:string; kind:Kind; title:string; content:string; color:Color; createdAt:number; updatedAt:number };
type Board = { id:string; title:string; createdAt:number };
type Place = { id:string; boardId:string; cardId:string; x:number; y:number; w:number; h:number; compact:boolean };
type Link = { id:string; from:string; to:string; label:string };
type Data = { version:1; boards:Board[]; cards:Card[]; places:Place[]; links:Link[]; activeBoardId:string; updatedAt:number };
type Move = null | { mode:"pan"; cx:number; cy:number; x:number; y:number } | { mode:"card"; cx:number; cy:number; origins:Record<string,{x:number;y:number}> } | { mode:"resize"; cx:number; cy:number; id:string; w:number; h:number };

const colors:Color[]=["paper","lavender","mint","sun","rose","sky"];
const id=(p:string)=>`${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;
const clone=(d:Data)=>JSON.parse(JSON.stringify(d)) as Data;
const label=(c:Card)=>c.title.trim()||c.content.trim().split(/\r?\n/)[0]?.slice(0,46)||"无标题卡片";

function seed():Data{
  const t=Date.now();
  return {version:1,activeBoardId:"board-home",updatedAt:t,
    boards:[{id:"board-home",title:"我的第一个思考空间",createdAt:t},{id:"board-ideas",title:"灵感收集",createdAt:t+1}],
    cards:[
      {id:"welcome",kind:"doc",title:"欢迎来到 Weave",content:"这是一个完全本地的视觉知识库。\n\n拖动卡片组织思路；双击空白处创建 Block；点击顶部「连线」建立双向关系。",color:"lavender",createdAt:t,updatedAt:t},
      {id:"principle",kind:"block",title:"",content:"一个想法，可以出现在多个白板。",color:"sun",createdAt:t+1,updatedAt:t+1},
      {id:"try",kind:"doc",title:"试试这些操作",content:"1. 双击画布新建 Block\n2. 点击连线，再选择两张卡片\n3. 输入 [[欢迎来到 Weave]]\n4. 从资料库拖入已有卡片",color:"mint",createdAt:t+2,updatedAt:t+2}],
    places:[
      {id:"p-welcome",boardId:"board-home",cardId:"welcome",x:150,y:100,w:330,h:270,compact:false},
      {id:"p-principle",boardId:"board-home",cardId:"principle",x:555,y:150,w:260,h:150,compact:true},
      {id:"p-try",boardId:"board-home",cardId:"try",x:880,y:310,w:320,h:250,compact:false}],
    links:[{id:"l1",from:"welcome",to:"principle",label:"核心原则"},{id:"l2",from:"principle",to:"try",label:"开始探索"}]};
}
const valid=(v:unknown):v is Data=>!!v&&typeof v==="object"&&(v as Data).version===1&&Array.isArray((v as Data).cards)&&Array.isArray((v as Data).boards);

type WorkspaceResponse={workspace:Data|null;revision:number;updatedAt:string|null};
async function loadFromServer():Promise<WorkspaceResponse>{
  const response=await fetch("/api/workspace",{headers:{Accept:"application/json"},cache:"no-store"});
  if(!response.ok)throw new Error(`加载失败：${response.status}`);
  return response.json();
}
async function saveToServer(workspace:Data,baseRevision:number):Promise<WorkspaceResponse>{
  const response=await fetch("/api/workspace",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({workspace,baseRevision})});
  const result=await response.json();
  if(response.status===409)throw new Error("服务器上已有更新，请刷新页面后重试");
  if(!response.ok)throw new Error(result?.message||`保存失败：${response.status}`);
  return result;
}

export default function App(){
  const [data,setData]=useState<Data|null>(null);
  const [selected,setSelected]=useState<string[]>([]);
  const [pan,setPan]=useState({x:0,y:0});
  const [zoom,setZoom]=useState(1);
  const [query,setQuery]=useState("");
  const [connect,setConnect]=useState(false);
  const [linkFrom,setLinkFrom]=useState<string|null>(null);
  const [leftOpen,setLeftOpen]=useState(true);
  const [rightOpen,setRightOpen]=useState(true);
  const [full,setFull]=useState<string|null>(null);
  const [status,setStatus]=useState<"saved"|"saving"|"error">("saved");
  const [toast,setToast]=useState("");
  const [ready,setReady]=useState(false);
  const canvas=useRef<HTMLDivElement>(null), importer=useRef<HTMLInputElement>(null), search=useRef<HTMLInputElement>(null);
  const moving=useRef<Move>(null), undoStack=useRef<Data[]>([]), redoStack=useRef<Data[]>([]), timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const revision=useRef(0),skipFirstSave=useRef(true),saveQueue=useRef<Promise<void>>(Promise.resolve());

  useEffect(()=>{let active=true;(async()=>{try{const result=await loadFromServer();if(!active)return;const initial=result.workspace&&valid(result.workspace)?result.workspace:seed();revision.current=result.revision;if(!result.workspace){const created=await saveToServer(initial,result.revision);revision.current=created.revision}skipFirstSave.current=true;setData(initial);setReady(true)}catch(error){if(!active)return;setStatus("error");setToast(error instanceof Error?error.message:"无法连接服务器")}})();return()=>{active=false}},[]);
  useEffect(()=>{if(!data||!ready)return;if(skipFirstSave.current){skipFirstSave.current=false;return}setStatus("saving");if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>{const snapshot={...data,updatedAt:Date.now()};saveQueue.current=saveQueue.current.catch(()=>undefined).then(async()=>{const saved=await saveToServer(snapshot,revision.current);revision.current=saved.revision;setStatus("saved")}).catch(error=>{setStatus("error");setToast(error instanceof Error?error.message:"保存到服务器失败")})},350);return()=>{if(timer.current)clearTimeout(timer.current)}},[data,ready]);
  useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(""),2200);return()=>clearTimeout(t)},[toast]);
  const commit=useCallback((fn:(d:Data)=>void)=>setData(cur=>{if(!cur)return cur;undoStack.current.push(clone(cur));if(undoStack.current.length>60)undoStack.current.shift();redoStack.current=[];const n=clone(cur);fn(n);n.updatedAt=Date.now();return n}),[]);
  const undo=useCallback(()=>setData(cur=>{if(!cur||!undoStack.current.length)return cur;redoStack.current.push(clone(cur));return undoStack.current.pop()!}),[]);
  const redo=useCallback(()=>setData(cur=>{if(!cur||!redoStack.current.length)return cur;undoStack.current.push(clone(cur));return redoStack.current.pop()!}),[]);

  const board=useMemo(()=>data?.boards.find(b=>b.id===data.activeBoardId),[data]);
  const places=useMemo(()=>data?.places.filter(p=>p.boardId===data.activeBoardId)??[],[data]);
  const placeByCard=useMemo(()=>new Map(places.map(p=>[p.cardId,p])),[places]);
  const links=useMemo(()=>data?.links.filter(l=>placeByCard.has(l.from)&&placeByCard.has(l.to))??[],[data,placeByCard]);
  const results=useMemo(()=>{const q=query.toLowerCase().trim();return (data?.cards??[]).filter(c=>!q||`${c.title} ${c.content}`.toLowerCase().includes(q)).sort((a,b)=>b.updatedAt-a.updatedAt)},[data,query]);
  const chosenPlace=selected.length===1?data?.places.find(p=>p.id===selected[0]):undefined;
  const chosen=chosenPlace?data?.cards.find(c=>c.id===chosenPlace.cardId):undefined;
  const linked=useCallback((cardId:string)=>{if(!data)return[];const ids=new Set<string>();data.links.forEach(l=>{if(l.from===cardId)ids.add(l.to);if(l.to===cardId)ids.add(l.from)});const c=data.cards.find(x=>x.id===cardId);data.cards.forEach(x=>{if(c?.title&&(x.content.includes(`[[${c.title}]]`)||x.content.includes(`@${c.title}`)))ids.add(x.id);if(x.title&&(c?.content.includes(`[[${x.title}]]`)||c?.content.includes(`@${x.title}`)))ids.add(x.id)});return data.cards.filter(x=>ids.has(x.id))},[data]);
  const world=useCallback((cx:number,cy:number)=>{const r=canvas.current?.getBoundingClientRect();return r?{x:(cx-r.left-pan.x)/zoom,y:(cy-r.top-pan.y)/zoom}:{x:400,y:250}},[pan,zoom]);
  const center=useCallback(()=>{const r=canvas.current?.getBoundingClientRect();return r?{x:(r.width/2-pan.x)/zoom,y:(r.height/2-pan.y)/zoom}:{x:400,y:250}},[pan,zoom]);

  const addCard=useCallback((kind:Kind,point?:{x:number;y:number})=>{if(!data)return;const at=point??center(),cardId=id("card"),placeId=id("place"),now=Date.now();commit(d=>{d.cards.push({id:cardId,kind,title:kind==="doc"?"无标题文档":"",content:"",color:kind==="doc"?"paper":"sun",createdAt:now,updatedAt:now});d.places.push({id:placeId,boardId:d.activeBoardId,cardId,x:at.x-(kind==="doc"?160:125),y:at.y-75,w:kind==="doc"?320:250,h:kind==="doc"?240:150,compact:kind==="block"})});setSelected([placeId])},[center,commit,data]);
  const placeCard=useCallback((cardId:string,point?:{x:number;y:number})=>{if(!data)return;const old=data.places.find(p=>p.boardId===data.activeBoardId&&p.cardId===cardId);if(old){setSelected([old.id]);setToast("这张卡片已经在当前白板");return}const c=data.cards.find(x=>x.id===cardId);if(!c)return;const at=point??center(),pid=id("place");commit(d=>d.places.push({id:pid,boardId:d.activeBoardId,cardId,x:at.x-150,y:at.y-80,w:c.kind==="doc"?320:250,h:c.kind==="doc"?230:150,compact:c.kind==="block"}));setSelected([pid])},[center,commit,data]);
  const newBoard=()=>{const bid=id("board");commit(d=>{d.boards.push({id:bid,title:"新白板",createdAt:Date.now()});d.activeBoardId=bid});setSelected([]);setPan({x:0,y:0});setZoom(1)};
  const switchBoard=(bid:string)=>{commit(d=>{d.activeBoardId=bid});setSelected([]);setConnect(false);setLinkFrom(null);setPan({x:0,y:0});setZoom(1)};
  const removeSelected=useCallback(()=>{if(!selected.length)return;commit(d=>{d.places=d.places.filter(p=>!selected.includes(p.id))});setSelected([]);setToast("已从白板移除，卡片仍在资料库")},[commit,selected]);
  const updateCard=(cid:string,patch:Partial<Card>)=>setData(d=>d?{...d,cards:d.cards.map(c=>c.id===cid?{...c,...patch,updatedAt:Date.now()}:c)}:d);
  const updatePlace=(pid:string,patch:Partial<Place>)=>commit(d=>{const p=d.places.find(x=>x.id===pid);if(p)Object.assign(p,patch)});
  const toggleKind=(c:Card,p:Place)=>commit(d=>{const dc=d.cards.find(x=>x.id===c.id),dp=d.places.find(x=>x.id===p.id);if(!dc||!dp)return;dc.kind=dc.kind==="doc"?"block":"doc";if(dc.kind==="doc"&&!dc.title)dc.title=dc.content.split(/\r?\n/)[0]?.slice(0,40)||"无标题文档";dp.compact=dc.kind==="block";dp.w=dc.kind==="doc"?320:250;dp.h=dc.kind==="doc"?230:150});

  const choose=(p:Place,e:ReactPointerEvent)=>{if(connect){if(!linkFrom){setLinkFrom(p.cardId);setToast("请选择第二张卡片");return}if(linkFrom===p.cardId){setLinkFrom(null);return}const exists=data!.links.some(l=>(l.from===linkFrom&&l.to===p.cardId)||(l.to===linkFrom&&l.from===p.cardId));if(!exists)commit(d=>d.links.push({id:id("link"),from:linkFrom,to:p.cardId,label:""}));setConnect(false);setLinkFrom(null);setToast(exists?"两张卡片已经有关联":"已建立双向知识链接");return}setSelected(cur=>e.shiftKey?(cur.includes(p.id)?cur.filter(x=>x!==p.id):[...cur,p.id]):[p.id])};
  const startCard=(e:ReactPointerEvent,p:Place)=>{if(connect||e.button!==0||!data)return;e.preventDefault();e.stopPropagation();const ids=selected.includes(p.id)?selected:[p.id],origins:Record<string,{x:number;y:number}>={};data.places.forEach(x=>{if(ids.includes(x.id))origins[x.id]={x:x.x,y:x.y}});if(!selected.includes(p.id))setSelected([p.id]);undoStack.current.push(clone(data));redoStack.current=[];moving.current={mode:"card",cx:e.clientX,cy:e.clientY,origins}};
  const startResize=(e:ReactPointerEvent,p:Place)=>{if(!data)return;e.preventDefault();e.stopPropagation();undoStack.current.push(clone(data));redoStack.current=[];moving.current={mode:"resize",cx:e.clientX,cy:e.clientY,id:p.id,w:p.w,h:p.h}};
  const startPan=(e:ReactPointerEvent<HTMLDivElement>)=>{if(e.target!==e.currentTarget||e.button>1)return;setSelected([]);moving.current={mode:"pan",cx:e.clientX,cy:e.clientY,x:pan.x,y:pan.y}};
  useEffect(()=>{const move=(e:PointerEvent)=>{const m=moving.current;if(!m)return;if(m.mode==="pan")setPan({x:m.x+e.clientX-m.cx,y:m.y+e.clientY-m.cy});else if(m.mode==="card"){const dx=(e.clientX-m.cx)/zoom,dy=(e.clientY-m.cy)/zoom;setData(d=>d?{...d,places:d.places.map(p=>m.origins[p.id]?{...p,x:m.origins[p.id].x+dx,y:m.origins[p.id].y+dy}:p)}:d)}else{const dx=(e.clientX-m.cx)/zoom,dy=(e.clientY-m.cy)/zoom;setData(d=>d?{...d,places:d.places.map(p=>p.id===m.id?{...p,w:Math.max(210,m.w+dx),h:Math.max(116,m.h+dy)}:p)}:d)}};const up=()=>moving.current=null;window.addEventListener("pointermove",move);window.addEventListener("pointerup",up);return()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",up)}},[zoom]);
  const wheel=(e:React.WheelEvent)=>{if(!e.ctrlKey&&!e.metaKey){setPan(v=>({x:v.x-e.deltaX,y:v.y-e.deltaY}));return}e.preventDefault();const r=canvas.current?.getBoundingClientRect();if(!r)return;const mx=e.clientX-r.left,my=e.clientY-r.top,nz=Math.min(1.8,Math.max(.35,zoom*(e.deltaY>0?.9:1.1))),wx=(mx-pan.x)/zoom,wy=(my-pan.y)/zoom;setZoom(nz);setPan({x:mx-wx*nz,y:my-wy*nz})};

  useEffect(()=>{const key=(e:KeyboardEvent)=>{const el=e.target as HTMLElement,editing=el.tagName==="INPUT"||el.tagName==="TEXTAREA"||el.isContentEditable;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();search.current?.focus()}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();e.shiftKey?redo():undo()}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="y"){e.preventDefault();redo()}else if(!editing){if(e.key==="Delete"||e.key==="Backspace")removeSelected();if(e.key.toLowerCase()==="n")addCard("block");if(e.key==="Escape"){setConnect(false);setLinkFrom(null);setFull(null)}}};window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key)},[addCard,redo,removeSelected,undo]);
  const fit=()=>{if(!places.length||!canvas.current){setPan({x:0,y:0});setZoom(1);return}const b=places.reduce((a,p)=>({x1:Math.min(a.x1,p.x),y1:Math.min(a.y1,p.y),x2:Math.max(a.x2,p.x+p.w),y2:Math.max(a.y2,p.y+p.h)}),{x1:Infinity,y1:Infinity,x2:-Infinity,y2:-Infinity}),r=canvas.current.getBoundingClientRect(),z=Math.min(1,Math.max(.35,Math.min((r.width-120)/(b.x2-b.x1),(r.height-120)/(b.y2-b.y1))));setZoom(z);setPan({x:r.width/2-(b.x1+b.x2)/2*z,y:r.height/2-(b.y1+b.y2)/2*z})};
  const backup=()=>{if(!data)return;const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"})),a=document.createElement("a");a.href=url;a.download=`weave-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url);setToast("完整备份已导出")};
  const restore=async(e:ChangeEvent<HTMLInputElement>)=>{const f=e.target.files?.[0];e.target.value="";if(!f)return;try{const v=JSON.parse(await f.text());if(!valid(v))throw 0;if(!v.boards.some((b:Board)=>b.id===v.activeBoardId))v.activeBoardId=v.boards[0]?.id??"";if(data)undoStack.current.push(clone(data));setData(v);setSelected([]);setToast("备份恢复成功")}catch{setToast("备份文件格式不正确")}};
  const deleteCard=(cid:string)=>{const c=data?.cards.find(x=>x.id===cid);if(!c||!confirm(`确定彻底删除「${label(c)}」？`))return;commit(d=>{d.cards=d.cards.filter(x=>x.id!==cid);d.places=d.places.filter(x=>x.cardId!==cid);d.links=d.links.filter(x=>x.from!==cid&&x.to!==cid)});setSelected([])};

  if(!data)return <main className="loading"><b>W</b><span>{status==="error"?"无法连接 Weave 服务器":"正在从服务器加载知识库…"}</span></main>;
  const fullCard=data.cards.find(c=>c.id===full);
  return <main className="app">
    <aside className={`left ${leftOpen?"":"closed"}`}>
      <header className="brand"><b>W</b><div><strong>Weave</strong><small>自托管视觉知识库</small></div><button onClick={()=>setLeftOpen(false)}>‹</button></header>
      <div className="left-body">
        <button className="new-block" onClick={()=>addCard("block")}><span>＋</span> 新建 Block <kbd>N</kbd></button>
        <label className="search"><span>⌕</span><input ref={search} value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索所有卡片…"/><kbd>⌘K</kbd></label>
        <section><div className="section-title"><span>白板</span><button onClick={newBoard}>＋</button></div><div className="boards">{data.boards.map(b=><button key={b.id} className={b.id===data.activeBoardId?"active":""} onClick={()=>switchBoard(b.id)}><span>◇</span><strong>{b.title}</strong><em>{data.places.filter(p=>p.boardId===b.id).length}</em></button>)}</div></section>
        <section className="library"><div className="section-title"><span>资料库</span><em>{results.length}</em></div><div className="library-list">{results.map(c=><div className="library-card" key={c.id} draggable onDragStart={e=>{e.dataTransfer.setData("application/x-weave",c.id);e.dataTransfer.effectAllowed="copy"}} onDoubleClick={()=>placeCard(c.id)}><i className={c.color}/><div><strong>{label(c)}</strong><small>{c.kind==="doc"?"Doc":"Block"} · {new Set(data.places.filter(p=>p.cardId===c.id).map(p=>p.boardId)).size} 个白板</small></div><button onClick={()=>deleteCard(c.id)}>×</button></div>)}{!results.length&&<p className="empty-result">没有找到相关卡片</p>}</div></section>
        <footer className="storage"><div><i className={status}/>{status==="saved"?"已保存到服务器":status==="saving"?"正在同步服务器…":"服务器保存失败"}</div><span><button onClick={backup}>导出备份</button><button onClick={()=>importer.current?.click()}>恢复</button></span><input ref={importer} hidden type="file" accept=".json,application/json" onChange={restore}/></footer>
      </div>
    </aside>
    {!leftOpen&&<button className="open-left" onClick={()=>setLeftOpen(true)}>W</button>}
    <section className="work">
      <header className="top"><div><span>白板 /</span><input value={board?.title??""} onChange={e=>setData(d=>d?{...d,boards:d.boards.map(b=>b.id===d.activeBoardId?{...b,title:e.target.value}:b)}:d)}/></div><nav><button onClick={undo}>↶</button><button onClick={redo}>↷</button><i/><button className={connect?"connect active":"connect"} onClick={()=>{setConnect(v=>!v);setLinkFrom(null)}}>⌁ {connect?(linkFrom?"选择第二张":"选择起点"):"连线"}</button><button className="new-doc" onClick={()=>addCard("doc")}>＋ 新建 Doc</button><button onClick={()=>setRightOpen(v=>!v)}>ⓘ</button></nav></header>
      <div ref={canvas} className={connect?"canvas connecting":"canvas"} onPointerDown={startPan} onDoubleClick={e=>{if(e.target===e.currentTarget)addCard("block",world(e.clientX,e.clientY))}} onWheel={wheel} onDragOver={e=>{if(e.dataTransfer.types.includes("application/x-weave")){e.preventDefault();e.dataTransfer.dropEffect="copy"}}} onDrop={(e:DragEvent<HTMLDivElement>)=>{e.preventDefault();const cid=e.dataTransfer.getData("application/x-weave");if(cid)placeCard(cid,world(e.clientX,e.clientY))}}>
        <div className="grid" style={{backgroundPosition:`${pan.x}px ${pan.y}px`,backgroundSize:`${24*zoom}px ${24*zoom}px`}}/>
        {!places.length&&<div className="empty-canvas"><b>✦</b><strong>这是一个空白思考空间</strong><p>双击任意位置创建 Block，或从资料库拖入已有卡片。</p><button onClick={()=>addCard("block")}>创建第一个想法</button></div>}
        <div className="stage" style={{transform:`translate(${pan.x}px,${pan.y}px) scale(${zoom})`}}>
          <svg className="wires"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z"/></marker></defs>{links.map(l=>{const a=placeByCard.get(l.from)!,b=placeByCard.get(l.to)!,x1=a.x+a.w/2,y1=a.y+a.h/2,x2=b.x+b.w/2,y2=b.y+b.h/2,k=Math.max(40,Math.abs(x2-x1)*.38),path=`M ${x1} ${y1} C ${x1+k} ${y1}, ${x2-k} ${y2}, ${x2} ${y2}`;return <g key={l.id}><path className="wire" d={path} markerEnd="url(#arrow)"/>{l.label&&<text x={(x1+x2)/2} y={(y1+y2)/2-9}>{l.label}</text>}</g>})}</svg>
          {places.map(p=>{const c=data.cards.find(x=>x.id===p.cardId);if(!c)return null;const isSelected=selected.includes(p.id),source=linkFrom===c.id,related=linked(c.id);return <article key={p.id} className={`card ${c.kind} ${c.color} ${p.compact?"compact":"full"} ${isSelected?"selected":""} ${source?"source":""}`} style={{left:p.x,top:p.y,width:p.w,height:p.h}} onPointerDown={e=>choose(p,e)}><header onPointerDown={e=>startCard(e,p)}><span>⠿</span><small>{c.kind.toUpperCase()}</small><nav>{related.length>0&&<em>⌁ {related.length}</em>}<button onPointerDown={e=>e.stopPropagation()} onClick={()=>toggleKind(c,p)}>{c.kind==="doc"?"▣":"▤"}</button>{c.kind==="doc"&&<button onPointerDown={e=>e.stopPropagation()} onClick={()=>setFull(c.id)}>↗</button>}<button onPointerDown={e=>e.stopPropagation()} onClick={()=>{commit(d=>{d.places=d.places.filter(x=>x.id!==p.id)});setSelected([]);setToast("已移除，资料库中仍保留")}}>×</button></nav></header>{c.kind==="doc"&&!p.compact&&<input className="card-title" value={c.title} onPointerDown={e=>e.stopPropagation()} onChange={e=>updateCard(c.id,{title:e.target.value})} placeholder="无标题文档"/>}<textarea className={p.compact?"compact-text":"card-text"} value={c.content} onPointerDown={e=>e.stopPropagation()} onChange={e=>updateCard(c.id,{content:e.target.value})} placeholder={c.kind==="doc"?"开始写作… 使用 [[卡片标题]] 建立链接":"写下一个想法…"}/><i className="resize" onPointerDown={e=>startResize(e,p)}/></article>})}
        </div>
        <div className="zoom"><button onClick={()=>setZoom(v=>Math.max(.35,v-.1))}>−</button><button onClick={()=>setZoom(1)}>{Math.round(zoom*100)}%</button><button onClick={()=>setZoom(v=>Math.min(1.8,v+.1))}>＋</button><i/><button onClick={fit}>⛶</button></div><div className="hint">双击创建 · 拖动空白平移 · Ctrl + 滚轮缩放</div>
      </div>
    </section>
    {rightOpen&&<aside className="right"><header><div><small>详情</small><strong>{chosen?label(chosen):"当前白板"}</strong></div><button onClick={()=>setRightOpen(false)}>×</button></header>{!chosen||!chosenPlace?<div className="right-empty"><b>◇</b><strong>{board?.title}</strong><span>{places.length} 张卡片 · {links.length} 条可见连接</span><hr/><p>选择一张卡片，查看样式、所在白板和双向链接。</p></div>:<div className="details"><section><label>卡片类型</label><div className="segments"><button className={chosen.kind==="block"?"active":""} onClick={()=>{if(chosen.kind!=="block")toggleKind(chosen,chosenPlace)}}>Block</button><button className={chosen.kind==="doc"?"active":""} onClick={()=>{if(chosen.kind!=="doc")toggleKind(chosen,chosenPlace)}}>Doc</button></div></section><section><label>当前白板显示</label><div className="segments"><button className={chosenPlace.compact?"active":""} onClick={()=>updatePlace(chosenPlace.id,{compact:true})}>折叠</button><button className={!chosenPlace.compact?"active":""} onClick={()=>updatePlace(chosenPlace.id,{compact:false})}>展开</button></div></section><section><label>卡片颜色</label><div className="colors">{colors.map(x=><button key={x} className={`${x} ${chosen.color===x?"active":""}`} onClick={()=>updateCard(chosen.id,{color:x})}/>)}</div></section><section><label>双向链接</label><div className="relations">{linked(chosen.id).map(c=>{const p=placeByCard.get(c.id);return <button key={c.id} onClick={()=>p?setSelected([p.id]):placeCard(c.id)}><i className={c.color}/><span>{label(c)}</span><em>{p?"定位":"放入"}</em></button>})}{!linked(chosen.id).length&&<p>暂无链接。使用顶部「连线」，或在正文输入 [[卡片标题]]。</p>}</div></section><section><label>出现于白板</label><div className="appearances">{data.boards.filter(b=>data.places.some(p=>p.boardId===b.id&&p.cardId===chosen.id)).map(b=><button key={b.id} onClick={()=>switchBoard(b.id)}>◇ {b.title}</button>)}</div></section><footer>最近编辑 {new Intl.DateTimeFormat("zh-CN",{hour:"2-digit",minute:"2-digit"}).format(chosen.updatedAt)}</footer></div>}</aside>}
    {fullCard&&<div className="modal" onPointerDown={e=>{if(e.target===e.currentTarget)setFull(null)}}><div className={`full-editor ${fullCard.color}`}><header><span>DOC · 服务器自动保存</span><button onClick={()=>setFull(null)}>完成</button></header><input value={fullCard.title} onChange={e=>updateCard(fullCard.id,{title:e.target.value})} autoFocus/><textarea value={fullCard.content} onChange={e=>updateCard(fullCard.id,{content:e.target.value})}/><footer><span>{fullCard.content.trim().length} 字符</span><span>使用 [[卡片标题]] 创建双向链接</span></footer></div></div>}
    {toast&&<div className="toast">{toast}</div>}
  </main>
}
