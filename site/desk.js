"use strict";

// Some WebKit ports expose native media playback without Web Audio. The desk
// keeps rendering its real waveforms and permits sequential blind playback.
if (!AudioEngine && data.groups.length) {
  const native = new Audio();
  let nativeUrl, nativeFrame;
  const previousStop = stop;
  stop = (resetCursor = true) => {
    native.pause();
    cancelAnimationFrame(nativeFrame);
    previousStop(resetCursor);
  };
  $("phone").disabled = $("blind-phone").disabled = true;
  $("bed-on").disabled = $("choose-bed").disabled = true;
  $("roll").disabled = $("burst").disabled = true;
  $("phone").title = $("blind-phone").title = "此浏览器组件没有 Web Audio，无法模拟外放频带。";
  $("blind-phone").textContent = "外放模拟不可用";

  play = async (clip, {offset, tag=clip.label, anonymous=null}={}) => {
    stop(false);
    const request = generation;
    status("正在读取音频…");
    try {
      const key = clip.fallback || clip.media;
      const extension = clip.fallback ? "m4a" : "wav";
      const url = `../../native/${key}.${extension}`;
      const range = mode==="compare" && $("loop").checked ? selection : null;
      const start = range?.[0] ?? offset ?? 0;
      const end = range?.[1] ?? clip.seconds;
      if (start >= clip.seconds) throw Error("定位点超出这条声音的结尾");
      const target = Math.min(clip.seconds,end);
      native.onloadedmetadata = () => { native.currentTime = start; };
      native.onended = null;
      if (nativeUrl !== url) { native.src=url; nativeUrl=url; }
      else native.currentTime=start;
      native.volume=Math.min(1,playGain(clip));
      playback={clip,tag,anonymous};
      native.onended = () => {
        if (request!==generation) return;
        if (range) {
          native.currentTime=start;
          native.play().catch(error=>status("播放失败："+error.message));
          return;
        }
        if (anonymous!==null) { trial.heard.add(anonymous); setAnswerAvailability(); }
        playback=null;
        cursor=clip.seconds;
        paintHeads();
        status("已播完 · "+tag);
      };
      await native.play();
      const tick = () => {
        if (request!==generation || !playback) return;
        if (range && native.currentTime>=target) native.currentTime=start;
        cursor=Math.min(clip.seconds,native.currentTime);
        paintHeads();
        status((range?"循环 ":"播放 ")+tag+" · "+format(cursor));
        nativeFrame=requestAnimationFrame(tick);
      };
      tick();
    } catch (error) {
      if (request===generation) {
        playback=null;
        status("播放失败："+error.message);
      }
    }
  };
}

if (data.groups.length) {
  const bottom = document.createElement("section");
  bottom.className = "blind-dock";
  bottom.setAttribute("aria-label","盲听播放");
  const options = document.createElement("div");
  options.className = "dock-options";
  const levelButton = document.createElement("button");
  levelButton.onclick = () => {
    $("level").value = $("level").value === "raw" ? "matched" : "raw";
    $("level").dispatchEvent(new Event("change"));
  };
  options.append(levelButton,$("blind-phone"));
  bottom.append(options,$("blind-play"));
  document.body.append(bottom);
  const identity = document.createElement("p");
  identity.className = "event-id";
  $("title").after(identity);
  const note = document.createElement("p");
  note.className = "status-note";
  $("blind-answers").after(note);
  const attribution = document.createElement("details");
  attribution.className = "attribution";
  const summary = document.createElement("summary");
  summary.textContent = "来源与许可";
  const para = document.createElement("p");
  para.textContent = "提交判语后可查看候选身份。";
  attribution.append(summary,para);
  $("blind").append(attribution);
  $("blind").append($("review-note-label"));
  const titleNames = {
    "pulse_fire_1.ogg":"声波共鸣 · 开火", "inspect_open.ogg":"锻炉 · 检视开合",
    "reload_latch.ogg":"锻炉 · 换弹扣合", "idle_wings.ogg":"蜂巢 · 待机振翅",
    "inspect_reply.ogg":"鲸骨 · 检视回声"
  };

  function chineseTitle() {
    if (group.id === "steps/snow/run/boot/L/versions") return "积雪跑步";
    if (!group.review) return group.label;
    const filename = group.id.split("/").at(-1);
    if (titleNames[filename]) return titleNames[filename];
    const level = filename.match(/^level-([1-7])\.ogg$/);
    if (level) return "炉边慢板 · "+level[1]+" 级";
    if (group.id.includes("/music/")) {
      const folder = group.id.split("/").at(-2);
      const stage = {panel:"面板曲",medium:"中段升级",ceremony:"终锤演出"}[folder] || "配乐";
      const part = {"mix.ogg":"全编制","strings.ogg":"弦乐","horn.ogg":"圆号","anvil.ogg":"铁砧"}[filename] || filename;
      return stage+" · "+part;
    }
    return group.label;
  }

  function refreshDesk() {
    const blindMode = mode !== "compare";
    document.body.classList.toggle("blind-mode",blindMode);
    bottom.hidden = !blindMode;
    identity.textContent = group.id;
    $("title").textContent = chineseTitle();
    levelButton.textContent = $("level").value === "matched" ? "响度配平 · 开" : "原电平";
    if (!blindMode || !trial) return;
    $("review-note-label").toggleAttribute("data-ready",trial.heard.size === trial.choices.length);
    note.textContent = trial.answered ? "判听已记录" : "听完所有候选后可作答";
    if (trial.answered) para.textContent = "返回对照可逐条展开来源与许可。";
    else para.textContent = "提交判语后可查看候选身份。";
    [...$("blind-play").children].forEach((button,index)=>{
      const active = playback?.anonymous === index;
      const heard = trial.heard.has(index);
      const text = active ? "Ⅱ " + letters[index] : "▶ 播放 " + letters[index];
      const detail = active ? "播放中" : heard ? "已听完" : "";
      const stamp = text + "|" + detail;
      if (button.dataset.label === stamp) return;
      button.dataset.label = stamp;
      button.dataset.playing = String(active);
      button.textContent = text;
      if (detail) {
        const stamp = document.createElement("span");
        stamp.textContent = detail;
        button.append(stamp);
      }
    });
    if (trial.answered && group.review) {
      try {
        const prior = new Set(JSON.parse(localStorage.getItem("site-reviewed") || "[]"));
        if (!prior.has(group.id)) {
          prior.add(group.id);
          localStorage.setItem("site-reviewed",JSON.stringify([...prior]));
        }
      } catch {}
    }
  }
  const listener = new MutationObserver(refreshDesk);
  listener.observe($("blind-play"),{childList:true});
  listener.observe($("status"),{childList:true});
  listener.observe($("compare"),{attributes:true,attributeFilter:["hidden"]});
  refreshDesk();
}

