"use strict";

// Some WebKit ports expose native media playback without Web Audio. The desk
// keeps rendering its real waveforms and permits sequential blind playback.
if (!AudioEngine && data.groups.length) {
  const native = new Audio();
  let nativeUrl, nativeFrame;
  native.preload = "auto";
  const previousStop = stop;
  stop = (resetCursor = true) => {
    native.pause();
    cancelAnimationFrame(nativeFrame);
    previousStop(resetCursor);
  };
  $("bed-on").disabled = $("choose-bed").disabled = true;
  $("roll").disabled = $("burst").disabled = true;

  play = async (clip, {offset, tag=clip.label, anonymous=null}={}) => {
    stop(false);
    const request = generation;
    status("正在读取音频…");
    try {
      const key = clip.fallback || clip.media;
      const extension = clip.fallback ? "m4a" : "wav";
      const url = $("phone").checked
        ? `../../native/phone-v1/${key}.m4a`
        : `../../native/${key}.${extension}`;
      const range = mode==="compare" && $("loop").checked ? selection : null;
      const start = range?.[0] ?? offset ?? 0;
      const end = range?.[1] ?? clip.seconds;
      if (start >= clip.seconds) throw Error("定位点超出这条声音的结尾");
      const target = Math.min(clip.seconds,end);
      cursor = start;
      paintHeads();
      native.onloadedmetadata = () => { if (request === generation) native.currentTime = start; };
      native.onended = null;
      native.onerror = () => {
        if (request !== generation) return;
        stop(false);
        status("播放失败：" + (native.error?.message || "无法加载此音频"));
      };
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
        stop(false);
        status("播放失败："+error.message);
      }
    }
  };
}


if (data.groups.length) {
  function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function fold(title, ...children) {
    const panel = element("details", "desk-fold");
    panel.append(element("summary", "", title), ...children);
    return panel;
  }

  function switchControl(label, action) {
    const toggle = button(label, action);
    toggle.className = "desk-switch";
    toggle.setAttribute("role", "switch");
    toggle.append(element("i", "switch-track"));
    return toggle;
  }

  function changeSetting(field, value) {
    field.value = value;
    field.dispatchEvent(new Event("change"));
  }

  const nav = $("site-links");
  nav.hidden = false;
  const back = nav.querySelector("a");
  const home = back.getAttribute("href");
  const summaryLink = nav.querySelectorAll("a")[1];
  const position = $("review-position") || element("output", "");
  nav.replaceChildren(back, position);
  const identity = element("p", "event-id");
  const type = element("p", "desk-type");
  $("title").after(identity, type);

  const level = switchControl("响度配平", () =>
    changeSetting($("level"), $("level").value === "matched" ? "raw" : "matched"));
  const blindLevel = switchControl("响度配平", () => level.click());
  const comparePhone = element("select", "");
  comparePhone.id = "phone-output";
  comparePhone.setAttribute("aria-label", "外放模式");
  comparePhone.append(new Option("原声输出", "direct"), new Option("手机外放模拟", "phone"));
  comparePhone.onchange = () => {
    $("phone").checked = comparePhone.value === "phone";
    settingsChanged();
  };
  const compareSettings = element("div", "mix-settings");
  compareSettings.append(level, comparePhone);
  const bench = document.querySelector(".bench");
  bench.before(compareSettings);

  const moreSetup = document.querySelector(".setup");
  const extras = document.querySelector(".extras");
  const tabs = document.querySelector(".tabs");
  const download = $("download");
  const oldRange = document.querySelector(".timeline-controls");
  const more = fold("更多", moreSetup, tabs, oldRange, extras, download, summaryLink);
  more.classList.add("desk-more");
  bench.after(more);
  const reviewNav = $("review-navigation");
  const reviewNote = $("review-note-label");

  const axis = $("time-axis");
  const tracks = $("tracks");
  const scope = element("div", "shared-scope");
  axis.before(scope);
  const overlay = element("div", "scope-overlay");
  overlay.setAttribute("aria-hidden", "true");
  const range = element("div", "shared-range");
  const head = element("div", "shared-head");
  overlay.append(range, head);
  scope.append(axis, tracks, overlay);
  const legend = document.querySelector(".legend");
  const scaleReadout = legend.firstElementChild;
  scaleReadout.after(element("span", "", "65 Hz–20 kHz · 对数"));
  const compareActions = element("div", "compare-actions");
  const loopButton = button("↻  循环选区", () => {
    if (!selection) {
      selection = [0, span];
      cursorSeek = 0;
    }
    $("loop").checked = !$("loop").checked;
    $("loop").dispatchEvent(new Event("change"));
    paintRange();
  });
  loopButton.id = "loop-selection";
  const enterBlind = button("切换盲听", () => setMode("abx"));
  enterBlind.id = "enter-blind";
  compareActions.append(loopButton, enterBlind);
  legend.after(compareActions);

  const blindPanel = $("blind");
  const blindHelp = $("blind-help");
  const blindPhone = $("blind-phone");
  blindPhone.className = "desk-switch";
  blindPhone.setAttribute("role", "switch");
  blindPhone.append(element("i", "switch-track"));
  const blindModeLabel = element("div", "blind-mode-label");
  const verdict = document.querySelector(".verdict");
  const note = element("p", "status-note");
  const bottom = element("section", "blind-dock");
  bottom.setAttribute("aria-label", "盲听播放");
  const options = element("div", "dock-options");
  options.append(blindLevel, blindPhone);
  bottom.append(options, $("blind-play"));
  document.body.append(bottom);

  const attribution = $("credits");
  attribution.classList.add("desk-fold");
  const attributionList = $("credit-list");
  const attributionNote = element("p", "attribution-note", "提交判断后显示匿名候选的来源与许可。");
  attribution.append(attributionNote);
  const statusLine = $("status");
  blindPanel.prepend(blindModeLabel, blindHelp);
  if (reviewNote) blindPanel.append(reviewNote);
  blindPanel.append(attribution);
  if (reviewNav) blindPanel.append(reviewNav);
  verdict.append(note);
  document.querySelector(".blind-toolbar").hidden = true;
  bench.after(statusLine);

  const titleNames = {
    "pulse_fire_1.ogg":"声波共鸣 · 开火", "inspect_open.ogg":"锻炉 · 检视开合",
    "reload_latch.ogg":"锻炉 · 换弹扣合", "idle_wings.ogg":"蜂巢 · 待机振翅",
    "inspect_reply.ogg":"鲸骨 · 检视回声"
  };

  function chineseTitle() {
    if (group.id === "steps/snow/run/boot/L/versions") return "积雪跑步";
    if (group.id === "fivegun.legend.forge.fire.blast") return "锻炉开火";
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

  const comparisonTypes = {
    "snow":"修复前后", "repair-library":"修复前后", "design-library":"设计前后",
    "source-library":"来源对比", "ai-library":"AI 与实录",
    "boundary-library":"低质量检测边界", "ambience-library":"声景对比"
  };
  const folder = location.pathname.split("/").filter(Boolean).at(-2);
  const comparisonType = comparisonTypes[folder] || "版本对比";

  function sharedLimit() {
    let peak = 0;
    for (const {clip} of plots) {
      for (const sample of clip.wave) peak = Math.max(peak, Math.abs(sample));
    }
    return Math.max(.01, Math.ceil(peak * 100) / 100);
  }

  let waveLimit = 1;
  drawWave = (canvas, clip) => {
    const ratio = devicePixelRatio || 1;
    const width = canvas.width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = canvas.height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    const pen = canvas.getContext("2d");
    const middle = height / 2;
    pen.fillStyle = "#426479";
    pen.fillRect(0, middle, width, ratio);

    const count = clip.wave.length / 2;
    const step = width * (clip.seconds / span) / count;
    const y = sample => middle * (1 - sample / waveLimit * .92);
    pen.fillStyle = "#8fe5f6";
    for (let i = 0; i < count; i++) {
      const top = y(clip.wave[i * 2 + 1]);
      const bottom = y(clip.wave[i * 2]);
      pen.fillRect(i * step, top, Math.max(ratio, step), Math.max(ratio, bottom - top));
    }
  };

  const renderTrack = buildPlot;
  const frequencyMarks = [[20000, "20k"], [8000, "8k"], [2000, "2k"], [500, "500"], [65, "65 Hz"]];

  function drawSpectrum({spectrum, detail, preview, clip}) {
    if (!detail.naturalWidth || !spectrum.isConnected) return;
    const ratio = devicePixelRatio || 1;
    const box = spectrum.getBoundingClientRect();
    if (!box.width || !box.height) return;
    spectrum.width = Math.round(box.width * ratio);
    spectrum.height = Math.round(box.height * ratio);
    const pen = spectrum.getContext("2d");
    pen.imageSmoothingEnabled = false;
    const contentWidth = Math.round(spectrum.width * clip.seconds / span);
    pen.drawImage(detail, 0, 0, Math.max(1, contentWidth), spectrum.height);
    preview.hidden = true;
  }

  buildPlot = (slot, clip) => {
    const plot = renderTrack(slot, clip);
    const host = plot.track.querySelector(".spectrogram");
    plot.preview = host.querySelector("img");
    plot.spectrum = element("canvas", "spectrum-detail");
    plot.detail = new Image();
    plot.detail.onload = () => drawSpectrum(plot);
    plot.detail.src = `../../native/spectrum-v1/${clip.fallback || clip.media}.png`;
    const marks = element("span", "frequency-marks");
    for (const [frequency, label] of frequencyMarks) {
      const tick = element("span", "", label);
      tick.style.top = `${100 * Math.log(20000 / frequency) / Math.log(20000 / 65)}%`;
      marks.append(tick);
    }
    host.append(plot.spectrum, marks);
    const player = plot.track.querySelector(".play");
    player.textContent = "▶";
    player.onclick = () => {
      if (playback?.clip === clip) {
        stop(false);
        status("已暂停");
      } else play(clip, {offset: cursorSeek});
    };
    const picker = plot.track.querySelector("select");
    const names = ["返修前", "返修后"];
    if (folder === "snow" && group.id === "steps/snow/run/boot/L/versions") {
      for (const [index, item] of Array.from(picker.options).entries()) {
        if (names[index]) item.textContent = names[index];
      }
    }
    return plot;
  };

  const redraw = resizePlots;
  // The original resize listener holds its function reference.
  window.removeEventListener("resize", redraw);
  resizePlots = () => {
    if (mode !== "compare" || !plots.length) return;
    waveLimit = sharedLimit();
    scaleReadout.textContent = `波形 ±${waveLimit.toFixed(2)} FS`;
    redraw();
    plots.forEach(drawSpectrum);
  };
  window.addEventListener("resize", resizePlots);

  const updateHead = paintHeads;
  paintHeads = () => {
    updateHead();
    head.hidden = cursor === null;
    if (cursor !== null && span > 0) head.style.left = `${100 * clamp(cursor / span, 0, 1)}%`;
  };

  const updateRange = paintRange;
  paintRange = () => {
    updateRange();
    const active = drag?.range || selection;
    range.hidden = !active;
    if (active) {
      range.style.left = `${100 * active[0] / span}%`;
      range.style.width = `${100 * (active[1] - active[0]) / span}%`;
    }
    loopButton.setAttribute("aria-pressed", String($("loop").checked));
    loopButton.title = active ? $("range-label").textContent : "从全段开始循环，拖动图形可缩小选区";
  };

  function textIfChanged(node, value) {
    if (node.textContent !== value) node.textContent = value;
  }

  function refreshDesk() {
    const blind = mode !== "compare";
    document.body.classList.toggle("blind-mode", blind);
    textIfChanged(back, blind && group.review ? "← 返回待人判" : "← 返回试听库");
    back.href = home;
    position.hidden = !group.review;
    textIfChanged(position, group.review ? `${Number($("group").value) + 1} / ${data.groups.length}` : "");
    textIfChanged($("title"), chineseTitle());
    textIfChanged(identity, group.id.replace(/\/versions$/, ""));
    textIfChanged(type, comparisonType);
    compareSettings.hidden = blind;
    bottom.hidden = !blind;
    enterBlind.disabled = pair.length < 2;
    for (const toggle of [level, blindLevel]) {
      toggle.setAttribute("aria-checked", String($("level").value === "matched"));
    }
    blindPhone.setAttribute("aria-checked", String($("phone").checked));
    comparePhone.value = $("phone").checked ? "phone" : "direct";
    attribution.hidden = false;
    attributionNote.hidden = !blind || trial?.answered;
    attributionList.hidden = blind && !trial?.answered;

    if (!blind) {
      if (attribution.parentNode !== $("compare")) $("compare").append(attribution);
      for (const {track, clip} of plots) {
        const player = track.querySelector(".play");
        const active = playback?.clip === clip;
        textIfChanged(player, active ? "Ⅱ" : "▶");
        player.dataset.playing = String(active);
        player.setAttribute("aria-label", (active ? "暂停 " : "播放 ") + clip.label);
      }
      return;
    }
    if (attribution.parentNode !== blindPanel) {
      if (reviewNav) reviewNav.before(attribution);
      else blindPanel.append(attribution);
    }
    textIfChanged(blindModeLabel, mode === "abx" ? "A/B/X 盲听" : "A/B 盲听");
    textIfChanged(blindHelp, mode === "abx" ? "先听 A、B 和 X" : "先听 A 和 B");
    const ready = trial.heard.size === trial.choices.length;
    reviewNote?.toggleAttribute("data-ready", ready && !trial.answered);
    textIfChanged(note, trial.answered ? "已记录判听" : ready ? "全部听完，可以作答" : `听完后可作答 · ${trial.heard.size} / ${trial.choices.length}`);
    [...$("blind-answers").children].slice(0, 2).forEach((answer, index) =>
      textIfChanged(answer, "选 " + letters[index]));
    [...$("blind-play").children].forEach((player, index) => {
      const active = playback?.anonymous === index;
      const heard = trial.heard.has(index);
      const stamp = active ? "playing" : heard ? "heard" : "ready";
      if (player.dataset.state === stamp) return;
      player.dataset.state = stamp;
      const label = `播放 ${letters[index]}`;
      player.setAttribute("aria-label", label);
      player.replaceChildren(element("span", "play-mark", active ? "Ⅱ" : "▶"),
        element("span", "play-name", label),
        element("span", "play-state", active ? "播放中" : heard ? "已听完" : ""));
    });
    if (trial.answered && group.review) {
      try {
        const prior = new Set(JSON.parse(localStorage.getItem("site-reviewed") || "[]"));
        if (!prior.has(group.id)) {
          prior.add(group.id);
          localStorage.setItem("site-reviewed", JSON.stringify([...prior]));
        }
      } catch {}
    }
  }

  const selectGroup = setGroup;
  setGroup = (index, requestedMode = mode) => {
    selectGroup(index, requestedMode);
    if (requestedMode !== "compare" && requestedMode !== mode && pair.length > 1) setMode(requestedMode);
  };
  const changeMode = setMode;
  setMode = next => {
    changeMode(next);
    refreshDesk();
    if (next === "compare") resizePlots();
  };
  const monitor = new MutationObserver(refreshDesk);
  monitor.observe(statusLine, {childList:true});
  monitor.observe(tracks, {childList:true});
  const requested = new URLSearchParams(location.search).get("mode");
  if (["ab", "abx"].includes(requested) && mode !== requested && pair.length > 1) setMode(requested);
  else {
    refreshDesk();
    if (mode === "compare") renderPlots();
  }
}
