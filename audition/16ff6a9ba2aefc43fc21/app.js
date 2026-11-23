"use strict";

const data = window.AUDITION;
const $ = id => document.getElementById(id);
const format = value => `${value.toFixed(3)} 秒`;
const amplitude = db => 10 ** (db / 20);
const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
const letters = ["A", "B", "X"];
const modes = ["compare", "ab", "abx"];
const AudioEngine = window.AudioContext || window.webkitAudioContext;
const historyKey = `audition-v1:${data.title}:${data.groups.map(g => g.clips.map(c => c.media).join(",")).join(";")}`;
let history = [];
try { history = JSON.parse(localStorage.getItem(historyKey)) || []; } catch { /* file permissions */ }

let group, pair, span, mode = "compare", trial;
let selection, cursor = null, drag = null;
const plots = [];

let context, cueBus, bedBus, direct, highpass, lowpass, master;
let bedBuffer, bedPeak = 1, bedSource, bedName = data.bed?.label || "";
let playback, rotation, generation = 0, animation;
const scheduled = new Set();
const buffers = new Map();
const pending = new Map();

window.auditionMedia = (key, value) => pending.get(key)?.(value);

function encodedMedia(key) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const clean = () => { pending.delete(key); script.remove(); };
    pending.set(key, encoded => { clean(); resolve(encoded); });
    script.onerror = () => { clean(); reject(new Error("试听文件读取失败")); };
    script.onload = () => { clean(); reject(new Error("试听文件内容缺失")); };
    script.src = `media/${key}.js`;
    document.head.append(script);
  });
}

function decodeMedia(clip) {
  if (!buffers.has(clip.media)) {
    const load = key => encodedMedia(key).then(encoded => {
      const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
      return context.decodeAudioData(bytes.buffer);
    });
    const promise = load(clip.media).catch(error => {
      if (!clip.fallback) throw error;
      return load(clip.fallback);
    }).catch(error => { buffers.delete(clip.media); throw error; });
    buffers.set(clip.media, promise);
    if (buffers.size > 24) buffers.delete(buffers.keys().next().value);
  }
  return buffers.get(clip.media);
}

async function audioReady() {
  if (!context) {
    if (!AudioEngine) throw new Error("请在支持 Web Audio 的浏览器中打开此页");
    context = new AudioEngine();
    cueBus = context.createGain();
    bedBus = context.createGain();
    direct = context.createGain();
    highpass = context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 300;
    highpass.Q.value = Math.SQRT1_2;
    lowpass = context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 5000;
    lowpass.Q.value = Math.SQRT1_2;
    master = context.createGain();
    cueBus.connect(direct);
    bedBus.connect(direct);
    cueBus.connect(highpass);
    bedBus.connect(highpass);
    highpass.connect(lowpass);
    direct.connect(master);
    lowpass.connect(master);
    master.connect(context.destination);
    updateMix();
  }
  await context.resume();
}

function updateMix() {
  const phone = $("phone").checked;
  $("blind-phone").setAttribute("aria-pressed", String(phone));
  $("blind-phone-state").textContent = phone ? "· 开" : "· 关";
  const db = Number($("bed-gain").value);
  $("bed-db").textContent = `${db} dB`;
  if (!context) return;
  direct.gain.value = phone ? 0 : 1;
  master.gain.value = phone ? 0.8 : 1;
  lowpass.disconnect();
  if (phone) lowpass.connect(master);
  const mixed = $("bed-on").checked;
  cueBus.gain.value = mixed ? 0.74 : 1;
  bedBus.gain.value = amplitude(db) / Math.max(1, bedPeak);
}

function stopBed() {
  if (bedSource) { bedSource.stop(); bedSource = null; }
}

async function startBed(token) {
  if (!$("bed-on").checked || bedSource) return;
  if (!bedBuffer && data.bed) {
    bedBuffer = await decodeMedia(data.bed);
    bedPeak = data.bed.peak / data.bed.scale;
  }
  if (token !== generation || !$("bed-on").checked || !bedBuffer || bedSource) return;
  bedSource = context.createBufferSource();
  bedSource.buffer = bedBuffer;
  bedSource.loop = true;
  bedSource.connect(bedBus);
  updateMix();
  bedSource.start();
}

function status(message) { $("status").textContent = message; }

function stop(resetCursor = true) {
  generation += 1;
  for (const node of scheduled) node.stop();
  scheduled.clear();
  if (rotation) clearInterval(rotation.timer);
  rotation = null;
  playback = null;
  if (resetCursor) cursor = null;
  cancelAnimationFrame(animation);
  paintHeads();
}

function schedule(buffer, gain, when, offset, options = {}) {
  const node = context.createBufferSource();
  const trim = context.createGain();
  trim.gain.value = gain;
  node.buffer = buffer;
  node.connect(trim);
  trim.connect(cueBus);
  if (options.loop) {
    node.loop = true;
    node.loopStart = options.loop[0];
    node.loopEnd = options.loop[1];
  }
  scheduled.add(node);
  node.onended = () => { scheduled.delete(node); node.disconnect(); trim.disconnect(); };
  node.start(when, offset);
}

function playGain(clip) { return clip[$("level").value] * clip.scale; }

function loopBuffer(buffer, start, end) {
  const length = Math.max(1, Math.round((end - start) * buffer.sampleRate));
  const first = Math.round(start * buffer.sampleRate);
  const out = context.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    out.copyToChannel(buffer.getChannelData(channel).subarray(first, first + length), channel);
  }
  return out;
}

async function play(clip, {offset, tag = clip.label, anonymous = null} = {}) {
  stop(false);
  const token = generation;
  status("正在读取音频…");
  try {
    await audioReady();
    if (token !== generation) return;
    if (anonymous !== null && !trial.ready) trial.ready = Promise.all(trial.choices.map(decodeMedia));
    const buffer = anonymous === null ? await decodeMedia(clip) : (await trial.ready)[anonymous];
    await startBed(token);
    if (token !== generation) return;
    const range = mode === "compare" && $("loop").checked ? selection : null;
    const start = range?.[0] ?? offset ?? 0;
    if (!range && start >= buffer.duration) {
      status("定位点超出这条声音的结尾");
      return;
    }
    const end = range?.[1] ?? buffer.duration;
    const when = context.currentTime + 0.018;
    if (range && end >= buffer.duration) {
      const loop = loopBuffer(buffer, start, end);
      schedule(loop, playGain(clip), when, 0, {loop: [0, loop.duration]});
    } else {
      schedule(buffer, playGain(clip), when, start, {loop: range});
    }
    playback = {clip, when, start, end, loop: Boolean(range), tag, anonymous};
    cursor = start;
    animate();
  } catch (error) { if (token === generation) status(`播放失败：${error.message}`); }
}

function animate() {
  if (!playback && !rotation) return;
  if (rotation) {
    const active = rotation.fires.filter(fire => fire.when <= context.currentTime).at(-1);
    if (active) {
      const elapsed = context.currentTime - active.when;
      cursor = Math.min(active.clip.seconds, elapsed);
      status(`轮播 · ${active.clip.label} · 第 ${active.count} 发`);
    }
  } else {
    const {when, start, end, loop, tag, anonymous} = playback;
    const elapsed = Math.max(0, context.currentTime - when);
    cursor = loop ? start + elapsed % (end - start) : Math.min(end, start + elapsed);
    if (anonymous !== null && elapsed >= end - start) {
      trial.heard.add(anonymous);
      setAnswerAvailability();
    }
    if (!loop && cursor >= end) { playback = null; status(`已播完 · ${tag}`); }
    else status(`${loop ? "循环" : "播放"} ${tag} · ${format(cursor)}`);
  }
  paintHeads();
  if (playback || rotation) animation = requestAnimationFrame(animate);
}

function shuffled(items) {
  const result = [...items];
  const values = crypto.getRandomValues(new Uint32Array(Math.max(1, result.length)));
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(values[index] / 2 ** 32 * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

async function roll(burst) {
  stop();
  const token = generation;
  const pause = clamp(Number($("interval").value) || 0, 0, 10);
  const rate = clamp(Number($("rate").value) || 6, 0.5, 20);
  const clips = group.clips;
  status("正在读取轮播变体…");
  try {
    await audioReady();
    const decoded = new Map();
    for (const clip of clips) {
      if (token !== generation) return;
      decoded.set(clip, await decodeMedia(clip));
    }
    await startBed(token);
    if (token !== generation) return;
    const longest = Math.max(...[...decoded.values()].map(buffer => buffer.duration));
    const attenuation = burst ? 1 / Math.max(1, Math.ceil(longest * rate)) : 1;
    const run = {next: context.currentTime + 0.05, count: 0, bag: [], previous: null, fires: []};
    rotation = run;
    const queue = () => {
      run.next = Math.max(run.next, context.currentTime + 0.009);
      while (run.next <= context.currentTime + 0.12) {
        if (!run.bag.length) {
          run.bag = shuffled(clips);
          if (run.bag.length > 1 && run.bag[0] === run.previous) {
            [run.bag[0], run.bag[1]] = [run.bag[1], run.bag[0]];
          }
        }
        const clip = run.bag.shift();
        const buffer = decoded.get(clip);
        run.previous = clip;
        schedule(buffer, playGain(clip) * attenuation, run.next, 0);
        run.fires.push({clip, when: run.next, count: ++run.count});
        run.next += burst ? 1 / rate : buffer.duration + pause;
      }
      // One earlier marker suffices between firings, even while earlier tails overlap.
      while (run.fires.length > 1 && run.fires[1].when <= context.currentTime) run.fires.shift();
    };
    queue();
    run.timer = setInterval(queue, 25);
    animate();
  } catch (error) { if (token === generation) status(`轮播失败：${error.message}`); }
}

function option(value, name) { return new Option(name, value); }

function setGroup(index, requestedMode) {
  stop();
  group = data.groups[index];
  pair = group.clips.length > 1 ? [0, 1] : [0];
  selection = null;
  $("loop").checked = false;
  $("group").value = index;
  $("review-navigation").hidden = !group.review;
  $("review-position").textContent = `第 ${index + 1} / ${data.groups.length} 项`;
  $("previous-review").disabled = index === 0;
  $("next-review").disabled = index === data.groups.length - 1;
  setMode(group.review && pair.length > 1 ? (requestedMode === "abx" ? "abx" : "ab") : "compare");
  addCredits();
}

function setMode(next) {
  stop();
  mode = next;
  for (const key of modes) $(`${key}-mode`).setAttribute("aria-pressed", key === mode);
  $("compare").hidden = mode !== "compare";
  $("blind").hidden = mode === "compare";
  $("compare-phone").hidden = mode !== "compare";
  $("rotation").hidden = mode !== "compare";
  $("credits").hidden = mode !== "compare";
  $("ab-mode").disabled = pair.length < 2;
  $("abx-mode").disabled = pair.length < 2;
  if (mode === "compare") {
    renderPlots();
    const meter = group.meter;
    status(meter.target === null ? "这一组为静音" : `配平窗口 ${meter.seconds} 秒 · 目标 ${meter.target.toFixed(1)} LUFS`);
  } else newTrial();
}

function drawWave(target, clip) {
  const ratio = devicePixelRatio || 1;
  const width = Math.max(1, Math.round(target.clientWidth * ratio));
  const height = Math.max(1, Math.round(target.clientHeight * ratio));
  target.width = width;
  target.height = height;
  const pen = target.getContext("2d");
  const middle = height / 2;
  pen.fillStyle = "#263549";
  pen.fillRect(0, middle, width, ratio);
  const traceWidth = width * clip.seconds / span;
  const count = clip.wave.length / 2;
  const step = traceWidth / count;
  pen.fillStyle = "#8ce9d8";
  for (let i = 0; i < count; i++) {
    const top = middle * (1 - clamp(clip.wave[i * 2 + 1], -1, 1));
    const bottom = middle * (1 - clamp(clip.wave[i * 2], -1, 1));
    pen.fillRect(i * step, top, Math.max(ratio, step), Math.max(ratio, bottom - top));
  }
}

function buildPlot(slot, clip) {
  const track = $("track-template").content.firstElementChild.cloneNode(true);
  const picker = track.querySelector("select");
  const name = slot === 0 ? "上方候选" : "下方候选";
  track.querySelector(".sr-only").textContent = name;
  picker.append(...group.clips.map((item, index) => option(index, item.label)));
  picker.value = pair[slot];
  picker.addEventListener("change", () => {
    const other = 1 - slot;
    const choice = Number(picker.value);
    if (pair[other] === choice) pair[other] = pair[slot];
    pair[slot] = choice;
    stop();
    renderPlots();
    plots[slot].track.querySelector("select").focus();
  });
  track.querySelector(".play").setAttribute("aria-label", `播放${name}`);
  track.querySelector(".play").onclick = () => play(clip, {offset: cursorSeek});
  const level = clip.lufs === null ? "静音" : `${clip.lufs.toFixed(1)} LUFS`;
  track.querySelector(".readout").textContent = `${format(clip.seconds)} · ${level}`;
  const plot = track.querySelector(".plot");
  plot.setAttribute("aria-label", `${name}波形和频谱，方向键定位，空格播放`);
  const image = plot.querySelector("img");
  image.src = `media/${clip.media}.png`;
  image.style.width = `${100 * clip.seconds / span}%`;
  connectPlot(plot, clip);
  return {track, clip, wave: plot.querySelector("canvas"), shade: plot.querySelector(".selection"),
          head: plot.querySelector(".head")};
}

let cursorSeek = 0;

function renderPlots() {
  const shown = pair.map(i => group.clips[i]);
  span = Math.max(...shown.map(clip => clip.seconds));
  cursorSeek = 0;
  if (selection && selection[1] > span) selection = null;
  plots.splice(0, plots.length, ...shown.map((clip, slot) => buildPlot(slot, clip)));
  $("tracks").replaceChildren(...plots.map(plot => plot.track));
  $("time-axis").replaceChildren(...[0, 0.25, 0.5, 0.75, 1].map(fraction => {
    const tick = document.createElement("span");
    tick.style.left = `${fraction * 100}%`;
    tick.textContent = (span * fraction).toFixed(span < 0.1 ? 3 : 2) + (fraction === 1 ? " 秒" : "");
    return tick;
  }));
  resizePlots();
  paintRange();
  paintHeads();
}

function resizePlots() {
  if (mode === "compare") plots.forEach(({wave, clip}) => drawWave(wave, clip));
}

function paintHeads() {
  for (const plot of plots) {
    plot.head.hidden = cursor === null;
    if (cursor !== null) plot.head.style.left = `min(${100 * clamp(cursor / span, 0, 1)}%, calc(100% - 2px))`;
  }
}

function paintRange() {
  const range = drag?.range || selection;
  $("range-label").textContent = range ? `${range[0].toFixed(3)}–${format(range[1])}` : "全段";
  $("loop").disabled = !selection;
  $("clear-range").disabled = !selection && !cursorSeek;
  if (!selection) $("loop").checked = false;
  for (const {shade} of plots) {
    shade.hidden = !range;
    if (range) {
      shade.style.left = `${100 * range[0] / span}%`;
      shade.style.width = `${100 * (range[1] - range[0]) / span}%`;
    }
  }
}

function connectPlot(plot, clip) {
  const point = event => {
    const box = plot.getBoundingClientRect();
    return span * clamp((event.clientX - box.left) / box.width, 0, 1);
  };
  const seek = seconds => {
    cursor = cursorSeek = seconds;
    paintHeads();
    paintRange();
    if (playback) play(playback.clip, {offset: seconds});
  };
  plot.addEventListener("pointerdown", event => {
    if (!event.isPrimary || event.button !== 0) return;
    drag = {id: event.pointerId, x: event.clientX, first: point(event), range: null};
    plot.setPointerCapture(event.pointerId);
  });
  plot.addEventListener("pointermove", event => {
    if (drag?.id !== event.pointerId || Math.abs(event.clientX - drag.x) < 4) return;
    const current = point(event);
    drag.range = [Math.min(drag.first, current), Math.max(drag.first, current)];
    paintRange();
  });
  plot.addEventListener("pointerup", event => {
    if (drag?.id !== event.pointerId) return;
    const range = drag.range;
    drag = null;
    if (range && range[1] - range[0] >= 0.01) {
      const active = playback?.clip;
      selection = range;
      $("loop").checked = true;
      cursor = cursorSeek = range[0];
      if (active) play(active);
    } else {
      selection = null;
      $("loop").checked = false;
      seek(point(event));
    }
    paintRange();
    paintHeads();
  });
  plot.addEventListener("pointercancel", () => { drag = null; paintRange(); });
  plot.addEventListener("keydown", event => {
    if (event.key === " ") { event.preventDefault(); play(clip, {offset: cursorSeek}); }
    if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      selection = null;
      seek(clamp(cursorSeek + (event.key === "ArrowLeft" ? -1 : 1) * span / 20, 0, span));
    }
  });
}

function button(label, click) {
  const element = document.createElement("button");
  element.textContent = label;
  element.onclick = click;
  return element;
}

function newTrial() {
  stop();
  const choices = shuffled(pair.map(i => group.clips[i]));
  const correct = shuffled([0, 1])[0];
  if (mode === "abx") choices.push(choices[correct]);
  const ready = group.review ? null : audioReady().then(() => Promise.all(choices.map(decodeMedia)));
  ready?.catch(() => {});
  trial = {choices, correct, heard: new Set(), answered: false, ready};
  $("blind-help").textContent = mode === "abx" ? "先听 A、B 和 X，再判断 X 对应哪条。" : "先听两条匿名候选，再记录你的偏好。";
  $("verdict-label").textContent = mode === "abx" ? "X 与哪一条相同？" : "你更喜欢哪一条？";
  $("blind-play").replaceChildren(...choices.map((clip, index) =>
    button(`播放 ${letters[index]}`, () => play(clip, {tag: letters[index], anonymous: index}))));
  $("blind-answers").replaceChildren(...(mode === "abx" ? ["A", "B"] : ["A", "B", "无偏好"])
    .map((name, index) => button(name, () => answer(index))));
  $("blind-result").hidden = true;
  $("review-focus").hidden = !group.review;
  $("review-focus").textContent = group.review?.focus || "";
  $("review-note-label").hidden = !group.review;
  $("review-note").value = "";
  $("review-details").hidden = true;
  $("review-details").open = false;
  $("next-trial").hidden = true;
  setAnswerAvailability();
  status("已随机分配候选");
}

function setAnswerAvailability() {
  const disabled = trial.answered || trial.heard.size !== trial.choices.length;
  for (const control of $("blind-answers").children) control.disabled = disabled;
}

function settingsChanged() {
  stop();
  updateMix();
  if (mode !== "compare" && !trial.answered) {
    trial.heard.clear();
    setAnswerAvailability();
    status("试听设置已更改，请重新听匿名候选");
  } else status("试听设置已更新");
}

function answer(index) {
  if (trial.answered || trial.heard.size !== trial.choices.length) return;
  stop();
  trial.answered = true;
  setAnswerAvailability();
  const guess = index === 2 ? "tie" : letters[index];
  const mapping = Object.fromEntries(trial.choices.map(({id, label, media, fileSha256, originSha256, raw, matched}, i) =>
    [letters[i], {id, label, media, fileSha256, originSha256, gainDb: 20 * Math.log10($("level").value === "raw" ? raw : matched)}]));
  const record = {at: new Date().toISOString(), group: group.id, mode, answer: guess, mapping,
    level: $("level").value, meter: group.meter, phone: $("phone").checked,
    bed: $("bed-on").checked ? {name: bedName, db: Number($("bed-gain").value)} : null};
  if (mode === "abx") Object.assign(record, {correct: letters[trial.correct], passed: index === trial.correct});
  if (group.review) {
    record.note = $("review-note").value.trim();
    $("review-details-text").textContent = [group.review.path, group.review.shape, group.review.quality, group.review.note].join("\n");
    $("review-details").hidden = false;
  }
  history.push(record);
  try { localStorage.setItem(historyKey, JSON.stringify(history)); } catch { /* export remains available */ }
  $("download").disabled = false;
  $("blind-result").textContent = `${mode === "abx" ? `X 是 ${record.correct}，${record.passed ? "答对" : "答错"}。` : "已记录偏好。"} A · ${mapping.A.label} / B · ${mapping.B.label}`;
  $("blind-result").hidden = false;
  $("next-trial").hidden = false;
  status("判听已记录");
}

function addCredits() {
  const unique = new Map();
  for (const clip of [...group.clips, ...(data.bed ? [data.bed] : [])]) {
    for (const entry of clip.credits) unique.set(entry.sha256 || JSON.stringify(entry), entry);
  }
  const items = [...unique.values()].map(entry => {
    const line = document.createElement("li");
    const label = [entry.title || entry.source, entry.author, entry.licenseTag || entry.license].filter(Boolean).join(" · ");
    line.textContent = label || "来源记录";
    for (const [name, href] of [["来源", entry.page || entry.url], ["许可", entry.licenseUrl || entry.license]]) {
      if (!href || !/^https?:\/\//i.test(href)) continue;
      const link = document.createElement("a");
      link.href = href;
      link.textContent = name;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      line.append(" · ", link);
    }
    if (entry.attribution) line.append(` · ${entry.attribution}`);
    if (entry.modifications) line.append(` · ${entry.modifications}`);
    return line;
  });
  if (!items.length) {
    const empty = document.createElement("li");
    empty.textContent = "这组输入没有提供来源及许可记录。";
    items.push(empty);
  }
  $("credit-list").replaceChildren(...items);
}

function wire() {
  $("group").append(...data.groups.map((item, i) => option(i, item.label)));
  $("group").onchange = event => setGroup(Number(event.target.value));
  $("previous-review").onclick = () => setGroup(Number($("group").value) - 1);
  $("next-review").onclick = () => setGroup(Number($("group").value) + 1);
  for (const key of modes) $(`${key}-mode`).onclick = () => setMode(key);
  $("clear-range").onclick = () => {
    stop(); selection = null; cursorSeek = 0; paintRange(); status("全段");
  };
  $("loop").onchange = () => { if (playback) play(playback.clip, {offset: cursorSeek}); };
  $("stop").onclick = () => { stop(); stopBed(); status("已停止"); };
  $("level").onchange = settingsChanged;
  $("phone").onchange = settingsChanged;
  $("blind-phone").onclick = () => {
    $("phone").checked = !$("phone").checked;
    settingsChanged();
  };
  $("roll").onclick = () => roll(false);
  $("burst").onclick = () => roll(true);
  $("next-trial").onclick = newTrial;
  $("download").disabled = !history.length;
  $("download").onclick = () => {
    const blob = new Blob([JSON.stringify({version: 1, title: data.title, trials: history}, null, 2)], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "audition-results.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $("choose-bed").onclick = () => $("bed-file").click();
  $("bed-on").disabled = !data.bed;
  $("bed-name").textContent = bedName;
  $("bed-gain").oninput = updateMix;
  $("bed-gain").onchange = settingsChanged;
  $("bed-on").onchange = async () => {
    settingsChanged();
    if (!$("bed-on").checked) { stopBed(); return; }
    const token = generation;
    try { await audioReady(); await startBed(token); }
    catch (error) { if (token === generation) status(`底声无法播放：${error.message}`); }
  };
  $("bed-file").onchange = async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      await audioReady();
      const buffer = await context.decodeAudioData(await file.arrayBuffer());
      let peak = 0;
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        for (const sample of buffer.getChannelData(channel)) peak = Math.max(peak, Math.abs(sample));
      }
      stopBed();
      bedBuffer = buffer;
      bedPeak = peak;
      bedName = file.name;
      $("bed-name").textContent = bedName;
      $("bed-on").disabled = false;
      $("bed-on").checked = true;
      settingsChanged();
      await startBed(generation);
    } catch (error) { status(`底声无法解码：${error.message}`); }
    finally { event.target.value = ""; }
  };
  window.addEventListener("resize", resizePlots);
}

$("title").textContent = document.title = data.title;
$("empty").hidden = Boolean(data.groups.length);
$("site-links").hidden = !data.site;
if (data.groups.length) {
  $("desk").hidden = false;
  wire();
  const query = new URLSearchParams(location.search);
  const requested = query.get("group");
  const index = Math.max(0, data.groups.findIndex(item => item.id === requested));
  setGroup(index, query.get("mode"));
}
