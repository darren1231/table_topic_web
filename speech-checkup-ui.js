(function attachSpeechCheckupUI(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SpeechCheckupUI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSpeechCheckupUI() {
  "use strict";

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatTimer(seconds) {
    const value = Math.max(0, Math.round(Number(seconds) || 0));
    return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  }

  function timeLabel(seconds, estimated, copy) {
    if (seconds === null || seconds === undefined || seconds === "") return copy.noTime;
    const numeric = Number(seconds);
    if (!Number.isFinite(numeric)) return copy.noTime;
    return `${estimated ? "≈" : ""}${formatTimer(numeric)}`;
  }

  function statusCopy(status, copy) {
    if (status === "strong") return copy.clear;
    if (status === "missing") return copy.missing;
    return copy.developing;
  }

  function transcriptPosition(text, offset) {
    return [...String(text || "").slice(0, offset)].length + 1;
  }

  function annotatedTranscript(text, occurrences, prefix) {
    let cursor = 0;
    let html = "";
    [...(occurrences || [])]
      .sort((left, right) => left.index - right.index)
      .forEach((item) => {
        if (item.index < cursor) return;
        html += escapeHtml(text.slice(cursor, item.index));
        html += `<mark id="${prefix}-${escapeHtml(item.id)}" data-checkup-mark="${escapeHtml(item.id)}" tabindex="0">${escapeHtml(text.slice(item.index, item.end))}</mark>`;
        cursor = item.end;
      });
    return `${html}${escapeHtml(text.slice(cursor))}`;
  }

  function focusMarkedOccurrence(container, occurrence, prefix) {
    if (!occurrence) return;
    const mark = container.ownerDocument.getElementById(`${prefix}-${occurrence.id}`);
    if (!mark) return;
    const details = mark.closest("details");
    if (details) details.open = true;
    mark.scrollIntoView({ behavior: "smooth", block: "center" });
    mark.classList.remove("speech-checkup-mark-flash");
    requestAnimationFrame(() => mark.classList.add("speech-checkup-mark-flash"));
    setTimeout(() => mark.classList.remove("speech-checkup-mark-flash"), 1600);
    mark.focus({ preventScroll: true });
  }

  function jumpToTranscript(transcriptElement, occurrence) {
    if (!transcriptElement || !occurrence) return false;
    transcriptElement.focus({ preventScroll: true });
    transcriptElement.setSelectionRange(occurrence.index, occurrence.end);
    const availableScroll = Math.max(0, transcriptElement.scrollHeight - transcriptElement.clientHeight);
    const ratio = transcriptElement.value.length ? occurrence.index / transcriptElement.value.length : 0;
    transcriptElement.scrollTop = availableScroll * ratio;
    transcriptElement.scrollIntoView({ behavior: "smooth", block: "center" });
    transcriptElement.classList.remove("speech-checkup-transcript-target");
    requestAnimationFrame(() => transcriptElement.classList.add("speech-checkup-transcript-target"));
    setTimeout(() => transcriptElement.classList.remove("speech-checkup-transcript-target"), 1600);
    return true;
  }

  function render({ evaluation, transcript = "", transcriptElement = null, container, language = "zh-TW", sourceId = "current" }) {
    if (!container) return;
    if (!evaluation) {
      container.replaceChildren();
      return;
    }

    const isEnglish = language === "en-US";
    const copy = isEnglish
      ? {
          title: "Speech Checkup", calculated: "Calculated from transcript and recording", duration: "Duration",
          totalCharacters: "Total characters", totalWords: "Total words", characterPace: "Characters per minute",
          wordPace: "Words per minute", fillers: "Potential fillers", fillerDistribution: "Filler distribution",
          jump: "Click to jump to the transcript", noFillers: "No configured filler words detected.",
          pace: "Pace and pauses", longPauses: "Long pauses (≥ 2 sec)", noPauses: "No long pauses detected.",
          fast: "Fast fragments", noFast: "No fast fragments detected.", timestampsNeeded: "Sentence timestamps are required for a reliable result.",
          structure: "Opening, body, and closing", opening: "Opening", body: "Body", closing: "Closing",
          next: "Improve only one thing next time", transcript: "View marked transcript", noTime: "No time",
          character: "character", second: "sec", clear: "Clear", missing: "Missing", developing: "Developing",
          timestamped: "Pauses and fast fragments use the recording or transcription timeline.",
          durationOnly: "Only total duration is available. Filler times are estimates, so local fast fragments cannot be judged reliably.",
          noTiming: "This was typed without recording time, so pace and pauses are not invented.", charsPerMinute: "chars/min",
        }
      : {
          title: "演講健檢", calculated: "依逐字稿與錄音計算", duration: "演講時間",
          totalCharacters: "總字數", totalWords: "總詞數", characterPace: "每分鐘語速（中文按字）",
          wordPace: "每分鐘語速 WPM", fillers: "疑似贅詞", fillerDistribution: "贅詞分布",
          jump: "點擊可跳到逐字稿", noFillers: "沒有偵測到指定贅詞。",
          pace: "節奏與停頓", longPauses: "過長停頓（≥ 2 秒）", noPauses: "沒有偵測到過長停頓。",
          fast: "過快片段", noFast: "沒有偵測到過快片段。", timestampsNeeded: "需要逐句時間戳才能可靠判斷。",
          structure: "開場、主體、結尾", opening: "開場", body: "主體", closing: "結尾",
          next: "下一次只改善一件事", transcript: "查看有標記的逐字稿", noTime: "無時間",
          character: "第", second: "秒", clear: "清楚", missing: "缺少", developing: "可加強",
          timestamped: "停頓與快語片段依錄音／轉錄時間軸判斷。",
          durationOnly: "本次只有總錄音時間；贅詞時間為估算，無法可靠判斷局部過快片段。",
          noTiming: "這次是手動輸入，沒有錄音時間；系統不會虛構語速或停頓。", charsPerMinute: "字／分",
        };

    const paceInCharacters = evaluation.paceUnit === "characters";
    const paceUnit = paceInCharacters ? copy.charsPerMinute : "WPM";
    const occurrences = evaluation.fillers?.occurrences || [];
    const occurrenceMap = new Map(occurrences.map((item) => [item.id, item]));
    const prefix = `speech-checkup-${String(sourceId).replace(/[^a-z0-9_-]/gi, "-")}`;
    const fillerGroups = (evaluation.fillers?.groups || []).map((group) =>
      `<button type="button" class="speech-checkup-filler-chip" data-checkup-jump="${escapeHtml(group.occurrenceIds[0])}"><span>${escapeHtml(group.word)}</span><b>× ${group.count}</b></button>`,
    ).join("");
    const fillerPositions = occurrences.map((item) => {
      const position = transcriptPosition(transcript, item.index);
      const positionLabel = isEnglish ? `${copy.character} ${position}` : `${copy.character} ${position} 字`;
      return `<button type="button" class="speech-checkup-filler-position" data-checkup-jump="${escapeHtml(item.id)}"><span>${escapeHtml(item.displayWord)}</span><small>${timeLabel(item.timeSeconds, item.timeEstimated, copy)} · ${positionLabel}</small></button>`;
    }).join("");
    const pauses = (evaluation.longPauses || []).map((item) =>
      `<li><span>${timeLabel(item.startSeconds, false, copy)}–${timeLabel(item.endSeconds, false, copy)}</span><b>${Number(item.durationSeconds).toFixed(1)} ${copy.second}</b></li>`,
    ).join("");
    const fast = (evaluation.fastSegments || []).map((item) =>
      `<article class="speech-checkup-fast-fragment"><span>${timeLabel(item.startSeconds, false, copy)}–${timeLabel(item.endSeconds, false, copy)}</span><b>${item.wpm} ${paceUnit}</b><small>${escapeHtml(item.text.slice(0, 80))}${item.text.length > 80 ? "…" : ""}</small></article>`,
    ).join("");
    const structure = [
      ["opening", copy.opening], ["body", copy.body], ["closing", copy.closing],
    ].map(([key, label]) => {
      const item = evaluation.structure?.[key] || { status: "developing", reason: "" };
      const status = ["strong", "developing", "missing"].includes(item.status) ? item.status : "developing";
      return `<article class="speech-checkup-structure-result speech-checkup-status-${status}"><header><span>${label}</span><b>${statusCopy(status, copy)}</b></header><p>${escapeHtml(item.reason)}</p></article>`;
    }).join("");
    const timingNote = evaluation.timingStatus === "timestamped"
      ? copy.timestamped
      : evaluation.durationSeconds > 0 ? copy.durationOnly : copy.noTiming;
    const fastEmpty = evaluation.timingStatus === "timestamped" ? copy.noFast : copy.timestampsNeeded;
    const duration = evaluation.durationSeconds > 0 ? formatTimer(evaluation.durationSeconds) : "--";
    const pace = Number.isFinite(evaluation.wpm) ? evaluation.wpm : "--";

    container.innerHTML = `<section class="speech-checkup-card">
      <header class="speech-checkup-card__head"><div><p class="eyebrow">SPEECH CHECKUP</p><h2>${copy.title}</h2></div><span>${copy.calculated}</span></header>
      <div class="speech-checkup-metrics">
        <article class="speech-checkup-metric"><span>◷</span><b>${duration}</b><small>${copy.duration}</small></article>
        <article class="speech-checkup-metric"><span>字</span><b>${evaluation.wordCount}</b><small>${paceInCharacters ? copy.totalCharacters : copy.totalWords}</small></article>
        <article class="speech-checkup-metric"><span>↗</span><b>${pace}</b><small>${paceInCharacters ? copy.characterPace : copy.wordPace}</small></article>
        <article class="speech-checkup-metric"><span>…</span><b>${evaluation.fillers?.total || 0}</b><small>${copy.fillers}</small></article>
      </div>
      <div class="speech-checkup-detail-grid">
        <section class="speech-checkup-section"><div class="speech-checkup-section__title"><div><span>01</span><h3>${copy.fillerDistribution}</h3></div><small>${copy.jump}</small></div>${fillerGroups ? `<div class="speech-checkup-filler-chips">${fillerGroups}</div><div class="speech-checkup-filler-positions">${fillerPositions}</div>` : `<p class="speech-checkup-empty-copy">${copy.noFillers}</p>`}</section>
        <section class="speech-checkup-section"><div class="speech-checkup-section__title"><div><span>02</span><h3>${copy.pace}</h3></div></div><div class="speech-checkup-pace-columns"><div><h4>${copy.longPauses}</h4>${pauses ? `<ul class="speech-checkup-pause-list">${pauses}</ul>` : `<p class="speech-checkup-empty-copy">${copy.noPauses}</p>`}</div><div><h4>${copy.fast}（&gt;${evaluation.fastThresholdWpm} ${paceUnit}）</h4>${fast ? `<div class="speech-checkup-fast-list">${fast}</div>` : `<p class="speech-checkup-empty-copy">${fastEmpty}</p>`}</div></div><p class="speech-checkup-timing-note">ⓘ ${timingNote}</p></section>
      </div>
      <section class="speech-checkup-section speech-checkup-structure"><div class="speech-checkup-section__title"><div><span>03</span><h3>${copy.structure}</h3></div></div><div class="speech-checkup-structure-grid">${structure}</div></section>
      <aside class="speech-checkup-next-focus"><span>${copy.next}</span><h3>${escapeHtml(evaluation.nextFocus?.title || "")}</h3><p>${escapeHtml(evaluation.nextFocus?.action || "")}</p></aside>
      <details class="speech-checkup-transcript"><summary>${copy.transcript}</summary><div class="speech-checkup-transcript__text">${annotatedTranscript(transcript, occurrences, prefix)}</div></details>
    </section>`;

    const handleJump = (target) => {
      const id = target?.dataset.checkupJump || target?.dataset.checkupMark;
      if (!id) return;
      const occurrence = occurrenceMap.get(id);
      if (target.matches("[data-checkup-jump]") && jumpToTranscript(transcriptElement, occurrence)) return;
      focusMarkedOccurrence(container, occurrence, prefix);
    };
    container.onclick = (event) => handleJump(event.target.closest("[data-checkup-jump], [data-checkup-mark]"));
    container.onkeydown = (event) => {
      if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-checkup-mark]")) {
        event.preventDefault();
        handleJump(event.target);
      }
    };
  }

  return { render };
});
