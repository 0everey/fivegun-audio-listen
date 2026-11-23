"use strict";

const $ = id => document.getElementById(id);
const data = window.SOUND_LIBRARY;
const byKey = new Map(data.rows.map(row => [row.key, row]));
const audio = new Audio();
audio.preload = "none";
audio.volume = .8;
const ios = /iPhone|iPad|iPod/.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const formats = (ios ? ["m4a","ogg"] : ["ogg","m4a"]).filter(format =>
  audio.canPlayType(format === "ogg" ? 'audio/ogg; codecs="vorbis"' : 'audio/mp4; codecs="mp4a.40.2"'));
const labels = {
  weapon:"M2 7h20v4h-7l-2 3h-3l-2 5H4l2-8H2zM13 11v3",
  hit:"M12 2v5m0 10v5M2 12h5m10 0h5m-4 0a6 6 0 1 1-12 0 6 6 0 0 1 12 0z",
  character:"M13 3a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM4 11l5-4 6 1 3 5h3M12 8l-2 7 5 3v4m-6-7-4 6H2",
  ambience:"M2 12h2m3-4v8m5-13v18m5-13v8m3-4h2",
  ui:"M3 4h18v13H3zm5 17h8m-4-4v4",
  vehicle:"M3 16v-5l3-5h12l3 5v5zm1 0v3m16-3v3M5 12h3m8 0h3",
  magic:"M3 5l5 3 4-2 4 2 5-3v9a9 7 0 1 1-18 0zm4 8 3 1m7-1-3 1",
  music:"M9 17V5l12-2v12M9 17a3 2 0 1 1-6 0 3 2 0 1 1 6 0zm12-2a3 2 0 1 1-6 0 3 2 0 1 1 6 0z"
};
const weatherLabels = ["原速切换","白天 · 晴","夜间 · 晴","白天 · 下雨","夜间 · 下雨"];
const pageSize = 24;
let current, activeList, activeIndex = 0, rolling = false, token = 0;
let limit = pageSize, category, technical, legacy, searchTerm = "";
let formatQueue = [], transport = "idle", volumeGain, volumeContext;

function node(tag, text, cls) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (cls) el.className = cls;
  return el;
}

function itemLink(text, href, cls) {
  const a = node("a", text, cls);
  if (href) a.href = href;
  return a;
}

function action(text, handler, cls) {
  const button = node("button", text, cls);
  button.type = "button";
  button.onclick = handler;
  return button;
}

function hrefOf(row) {
  return row.compare || "";
}

function matches(row) {
  return (!$("project").value || row.project === $("project").value)
    && (!$("status-filter").value || row.status === $("status-filter").value);
}

function buildNavigation() {
  const tiles = [];
  const wish = $("wish-entry");
  for (const [id, title] of Object.entries(data.categories)) {
    const link = itemLink("", "#category/" + id, "tile");
    const uri = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(uri, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(uri, "path");
    path.setAttribute("d", labels[id] || labels.ui);
    path.setAttribute("fill","none");
    path.setAttribute("stroke","currentColor");
    path.setAttribute("stroke-width","1.5");
    path.setAttribute("stroke-linecap","round");
    path.setAttribute("stroke-linejoin","round");
    svg.append(path);
    const count = data.rows.filter(row => row.category === id && matches(row)).length;
    const quantity = node("small", count);
    if (id === "wish" && wish) {
      const label = node("span", title, "wish-label");
      label.append(node("span", "试听一句话生成的成品"));
      quantity.textContent = count + " 项";
      link.append(svg, label, quantity);
      wish.replaceChildren(link);
    } else {
      link.append(svg, node("span", title), quantity);
      tiles.push(link);
    }
  }
  $("categories").replaceChildren(...tiles);
  $("tech").replaceChildren(...Object.entries(data.technical).map(([key, title]) =>
    itemLink(title, "#technical/" + key, "button")));
}

function clearDetails(container, source) {
  container.replaceChildren();
  if (!source.length) {
    container.append(node("p","逐条来源见录音署名与该批许可台账。","meta"));
  } else {
    const list = node("ul",undefined,"credit-list");
    for (const c of source) {
      const li = node("li",[c.title || c.source, c.author, c.licenseTag].filter(Boolean).join(" · ") || "来源记录");
      for (const [label, url] of [["来源",c.page || c.url],["许可",c.licenseUrl || c.license]]) {
        if (url && /^https?:\/\//i.test(url)) {
          const link = itemLink(label,url);
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          li.append(" · ",link);
        } else if (url) li.append(" · " + url);
      }
      list.append(li);
    }
    container.append(list);
  }
}

function variantIndex(row) {
  const wanted = $("weather").hidden ? "" : $("weather").value;
  return Math.max(0, (row.variants || []).indexOf(wanted));
}

function available(row) {
  return !category && !technical && !legacy ||
    (category && row.category === category) ||
    (technical && data.tech[technical]?.includes(row.key)) ||
    (legacy && row.legacy === legacy);
}

function makeRow(row) {
  const card = node("article",undefined,"list-item");
  card.dataset.event = row.id;
  const h = node("h3",row.name,"list-title");
  const badge = node("span",row.status,"badge");
  badge.dataset.status = row.status;
  h.append(badge);
  card.append(h,node("code",row.id));
  if (row.wave?.length) {
    const wave = node("canvas",undefined,"row-wave");
    wave.width = 320;
    wave.height = 32;
    wave.setAttribute("aria-label","波形缩略");
    drawThumbnail(wave,row.wave);
    card.append(wave);
  }
  if (row.note) card.append(node("div", row.note, "meta"));
  const controls = node("div",undefined,"actions");
  if (row.new.length) controls.append(action(row.old.length ? "新版" : "播放单发",
    () => start(row, row.new, variantIndex(row)), "primary"));
  if (row.old.length) controls.append(action("旧版",() => start(row,row.old,0)));
  if ((row.new.length || row.old.length) > 1) controls.append(action("变体连播",() => start(row,row.new.length ? row.new : row.old,0,true)));
  if (row.compare) controls.append(itemLink("进入对比",row.compare,"button"));
  card.append(controls);
  if (row.variants?.length > 1) {
    const pick = node("select");
    pick.setAttribute("aria-label","试听变体");
    pick.replaceChildren(...row.variants.map((name,index)=>new Option(name,index)));
    pick.value = String(variantIndex(row));
    pick.onchange = () => start(row,row.new,Number(pick.value));
    card.append(pick);
  }
  const fold = node("details");
  fold.append(node("summary","来源与许可"));
  fold.addEventListener("toggle",() => {
    if (fold.open && fold.children.length === 1) {
      const body = node("div");
      clearDetails(body,row.credits);
      fold.append(body);
    }
  });
  card.append(fold);
  return card;
}

function matchingRows() {
  const sub = $("subgroup").value;
  return data.rows.filter(row => available(row) && matches(row) &&
    (!sub || sub === row.sub) &&
    (!searchTerm || [row.name,row.id,row.sub].join(" ").toLowerCase().includes(searchTerm)));
}

function renderRows() {
  if ($("browse").hidden) return;
  const found = matchingRows();
  $("result").textContent = found.length ? `显示 ${Math.min(found.length,limit)} / ${found.length} 条` : "当前筛选没有条目";
  $("items").replaceChildren(...found.slice(0,limit).map(makeRow));
  $("more").hidden = found.length <= limit;
}

function route() {
  const [type,key] = location.hash.slice(1).split("/");
  category = type === "category" && data.categories[key] ? key : "";
  technical = type === "technical" && data.technical[key] ? key : "";
  legacy = type === "group" && data.rows.some(row => row.legacy === key) ? key : "";
  const open = Boolean(category || technical || legacy);
  if ($("wish-entry")) $("wish-entry").hidden = open || !data.categories.wish;
  $("home").hidden = open;
  $("browse").hidden = !open;
  limit = pageSize;
  searchTerm = "";
  $("search").value = "";
  if (open) {
    $("heading").textContent = data.categories[category] || data.technical[technical] || key;
    const subs = [...new Set(data.rows.filter(available).map(row => row.sub).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"zh"));
    $("subgroup").replaceChildren(new Option("全部细分",""), ...subs.map(value => new Option(value)));
    $("subgroup").hidden = !subs.length;
    $("weather").hidden = category !== "ambience";
    renderRows();
    $("heading").focus({preventScroll:true});
  }
  window.scrollTo(0,0);
}

function thumb(row) {
  const canvas = $("thumbnail");
  canvas.width = Math.max(canvas.clientWidth,1)*2;
  canvas.height = 42;
  drawThumbnail(canvas,row?.wave || []);
}

function drawThumbnail(canvas,samples) {
  const pen = canvas.getContext("2d");
  const middle = canvas.height/2;
  pen.strokeStyle = "#57768b";
  pen.beginPath();
  pen.moveTo(0,middle);
  pen.lineTo(canvas.width,middle);
  pen.stroke();
  if (!samples.length) return;
  const step = canvas.width / samples.length;
  pen.fillStyle = "#6ee1f2";
  samples.forEach((gain,i)=> {
    const size = Math.max(2,2*gain*(middle-1));
    pen.fillRect(i*step,middle-size/2,Math.max(1,step/2),size);
  });
}

function select(row) {
  current = row;
  $("now").textContent = row.name;
  thumb(row);
  if (hrefOf(row)) $("compare").href = hrefOf(row);
  else $("compare").removeAttribute("href");
  $("roll").disabled = Math.max(row.new.length,row.old.length) < 2;
  $("play").disabled = !row.new.length && !row.old.length;
  $("credits").open = false;
  clearDetails($("credits").lastElementChild,row.credits);
}

function paint(next, message) {
  transport = next;
  $("state").textContent = message;
  $("play").querySelector("span").textContent = next === "loading" || next === "playing" ? "Ⅱ" : "▶";
  $("play").setAttribute("aria-label",next === "playing" || next === "loading" ? "暂停" : "播放单发");
  $("roll").setAttribute("aria-pressed",String(rolling));
}

function setVolume() {
  const value = Number($("volume").value)/100;
  audio.muted = value === 0;
  if (volumeGain) volumeGain.gain.value = value;
  else audio.volume = value;
}

function unlockVolume() {
  if (volumeContext) {
    volumeContext.resume().catch(()=>{});
    return;
  }
  if (!ios) return;
  const AudioEngine = window.AudioContext || window.webkitAudioContext;
  audio.volume = .43;
  const locked = Math.abs(audio.volume-.43) > .01;
  setVolume();
  if (!AudioEngine || !locked) return;
  try {
    const context = new AudioEngine();
    volumeContext = context;
    context.resume().then(()=>{
      volumeGain = context.createGain();
      context.createMediaElementSource(audio).connect(volumeGain);
      volumeGain.connect(context.destination);
      setVolume();
    }).catch(()=>{volumeContext = undefined; context.close().catch(()=>{});});
  } catch { volumeContext = undefined; }
}

function start(row,list,index,repeat=false) {
  if (!list[index]) return;
  unlockVolume();
  ++token;
  audio.pause();
  select(row);
  activeList = list;
  activeIndex = index;
  rolling = repeat;
  $("progress").value = 0;
  const stem = list[index];
  formatQueue = /\.(m4a|ogg|flac|wav|mp3)$/i.test(stem)
    ? [stem] : formats.map(ext => stem + "." + ext);
  loadNext();
}

function loadNext() {
  const src = formatQueue.shift();
  if (!src) {
    rolling = false;
    paint("error","无法载入该音频，请重试");
    return;
  }
  const currentToken = ++token;
  audio.src = src;
  paint("loading","加载中");
  audio.play().catch(err=>{
    if (currentToken !== token) return;
    if (err.name === "NotAllowedError") {
      paint("paused","轻点播放继续");
    } else if (err.name !== "AbortError") loadNext();
  });
}

audio.addEventListener("error",()=>{
  if (transport !== "loading" && transport !== "playing") return;
  loadNext();
});
audio.addEventListener("playing",()=>{
  paint("playing", (rolling ? "连播 " + (activeIndex+1) + "/" + activeList.length : "播放中") + " · " + current.status);
});
audio.addEventListener("timeupdate",()=>{
  if (audio.duration) $("progress").value = Math.min(1,audio.currentTime/audio.duration);
});
audio.addEventListener("ended",()=>{
  if (rolling && activeIndex+1 < activeList.length) {
    const next = token;
    setTimeout(()=>{if (next === token) start(current,activeList,activeIndex+1,true);},280);
    return;
  }
  rolling = false;
  $("progress").value = 1;
  paint("ended","已播完 · "+current.status);
});
$("play").onclick = () => {
  if (!current) return;
  if (["loading","playing"].includes(transport)) {
    ++token;
    rolling = false;
    audio.pause();
    paint("paused","已暂停");
    return;
  }
  const list = current.new.length ? current.new : current.old;
  start(current,list,variantIndex(current));
};
$("roll").onclick = () => {
  if (!current) return;
  const list = current.new.length ? current.new : current.old;
  start(current,list,0,true);
};
$("volume").oninput = setVolume;
for (const id of ["project","status-filter"]) $(id).onchange = () => {limit=pageSize; buildNavigation(); renderRows();};
for (const id of ["subgroup","weather"]) $(id).onchange = () => {limit=pageSize; renderRows();};
$("search").oninput = () => {searchTerm=$("search").value.trim().toLowerCase(); limit=pageSize; renderRows();};
$("more").onclick = () => {limit+=pageSize; renderRows();};
$("weather").replaceChildren(...weatherLabels.map(name=>new Option(name)));
function updateQueue() {
  let reviewed = new Set();
  try { reviewed = new Set(JSON.parse(localStorage.getItem("site-reviewed") || "[]")); } catch {}
  const pending = data.queue.filter(item=>!reviewed.has(item.id));
  $("count").textContent = pending.length;
  const entry = pending[0] || data.queue[0];
  if (entry) $("blind-start").href = entry.href.replace(/([?&])mode=ab(?:&|$)/,"$1mode=abx");
}
updateQueue();
window.addEventListener("pageshow",updateQueue);
window.addEventListener("storage",updateQueue);
buildNavigation();
const wishProject = data.rows.find(row => row.category === "wish")?.project;
if (wishProject && ![...$("project").options].some(option => option.value === wishProject)) {
  $("project").add(new Option(wishProject));
}
const initial = byKey.get("ambience:abandoned_hospital") || byKey.get("game:carbine:fivegun.carbine.fire") || data.rows[0];
if (initial) {select(initial); paint("idle",initial.status+" · 待播放");}
route();
window.addEventListener("hashchange",route);
window.addEventListener("resize",()=>thumb(current));
window.addEventListener("pagehide",()=>{++token; audio.pause();});
