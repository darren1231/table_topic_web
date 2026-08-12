(function attachSpeechEvaluation(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SpeechEvaluation = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSpeechEvaluation() {
  "use strict";

  const STATUS_VALUES = new Set(["strong", "developing", "missing"]);
  const FILLER_PATTERN = /嗯+|呃+|然後|就是|其實|那個|\bum+\b|\buh+\b|\byou know\b|\bi mean\b/giu;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number(value) || 0));
  }

  function round(value, digits = 1) {
    const scale = 10 ** digits;
    return Math.round((Number(value) || 0) * scale) / scale;
  }

  function canonicalFiller(value) {
    const word = String(value || "").trim();
    if (/^嗯+$/u.test(word)) return "嗯";
    if (/^呃+$/u.test(word)) return "呃";
    return word.toLocaleLowerCase();
  }

  function fallbackWordSegments(text) {
    const segments = [];
    const pattern = /[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*|[\u3400-\u9fff]|[\u3040-\u30ff]+/gu;
    for (const match of String(text || "").matchAll(pattern)) {
      segments.push({ token: match[0], index: match.index, end: match.index + match[0].length });
    }
    return segments;
  }

  function segmentWords(text, language = "zh-TW") {
    const source = String(text || "");
    if (!source) return [];
    // Mandarin pace is conventionally easier to understand as spoken characters
    // per minute. Mixed Latin phrases still count as one word each.
    if (String(language).toLocaleLowerCase().startsWith("zh")) return fallbackWordSegments(source);
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      try {
        const segmenter = new Intl.Segmenter(language, { granularity: "word" });
        return [...segmenter.segment(source)]
          .filter((item) => item.isWordLike)
          .map((item) => ({
            token: item.segment,
            index: item.index,
            end: item.index + item.segment.length,
          }));
      } catch {}
    }
    return fallbackWordSegments(source);
  }

  function compactWithIndex(text) {
    const compact = [];
    const indices = [];
    const source = String(text || "");
    for (let offset = 0; offset < source.length; ) {
      const char = String.fromCodePoint(source.codePointAt(offset));
      if (!/[^\p{L}\p{N}]/u.test(char)) {
        compact.push(char.toLocaleLowerCase());
        indices.push(offset);
      }
      offset += char.length;
    }
    return { value: compact.join(""), indices };
  }

  function findApproximateRange(text, snippet, cursor = 0) {
    const source = String(text || "");
    const needle = String(snippet || "").trim();
    if (!needle) return null;
    const direct = source.indexOf(needle, cursor);
    if (direct >= 0) return { start: direct, end: direct + needle.length };

    const sourceCompact = compactWithIndex(source);
    const needleCompact = compactWithIndex(needle).value;
    if (!needleCompact) return null;
    const compactCursor = sourceCompact.indices.findIndex((index) => index >= cursor);
    const found = sourceCompact.value.indexOf(needleCompact, Math.max(0, compactCursor));
    if (found < 0) return null;
    const start = sourceCompact.indices[found];
    const endIndex = sourceCompact.indices[found + needleCompact.length - 1];
    const endLength = String.fromCodePoint(source.codePointAt(endIndex)).length;
    return { start, end: Math.min(source.length, endIndex + endLength) };
  }

  function normalizeTimeline(timeline, transcript) {
    const source = String(transcript || "");
    let cursor = 0;
    return (Array.isArray(timeline) ? timeline : [])
      .map((entry) => {
        const text = String(entry?.text ?? entry?.word ?? "").trim();
        const startSeconds = Number(entry?.startSeconds ?? entry?.start);
        const endSeconds = Number(entry?.endSeconds ?? entry?.end);
        if (!text || !Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds <= startSeconds) return null;
        let startOffset = Number(entry.startOffset);
        let endOffset = Number(entry.endOffset);
        if (!Number.isFinite(startOffset) || !Number.isFinite(endOffset)) {
          const range = findApproximateRange(source, text, cursor);
          startOffset = range?.start;
          endOffset = range?.end;
        }
        if (Number.isFinite(endOffset)) cursor = Math.max(cursor, endOffset);
        return {
          text,
          startSeconds: Math.max(0, startSeconds),
          endSeconds: Math.max(0, endSeconds),
          startOffset: Number.isFinite(startOffset) ? startOffset : null,
          endOffset: Number.isFinite(endOffset) ? endOffset : null,
          source: entry.source || "transcription",
          approximate: entry.approximate === true,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.startSeconds - b.startSeconds);
  }

  function timeForOffset(offset, timeline, transcriptLength, durationSeconds) {
    const exact = timeline.find(
      (segment) =>
        Number.isFinite(segment.startOffset) &&
        Number.isFinite(segment.endOffset) &&
        offset >= segment.startOffset &&
        offset <= segment.endOffset,
    );
    if (exact) {
      const span = Math.max(1, exact.endOffset - exact.startOffset);
      const ratio = clamp((offset - exact.startOffset) / span, 0, 1);
      return {
        seconds: round(exact.startSeconds + (exact.endSeconds - exact.startSeconds) * ratio),
        estimated: exact.approximate,
      };
    }
    if (durationSeconds > 0 && transcriptLength > 0) {
      return {
        seconds: round((clamp(offset, 0, transcriptLength) / transcriptLength) * durationSeconds),
        estimated: true,
      };
    }
    return { seconds: null, estimated: false };
  }

  function findFillers(text, timeline, durationSeconds) {
    const source = String(text || "");
    const occurrences = [];
    FILLER_PATTERN.lastIndex = 0;
    for (const match of source.matchAll(FILLER_PATTERN)) {
      const timing = timeForOffset(match.index, timeline, source.length, durationSeconds);
      occurrences.push({
        id: `filler-${occurrences.length + 1}`,
        word: canonicalFiller(match[0]),
        displayWord: match[0],
        index: match.index,
        end: match.index + match[0].length,
        order: occurrences.length + 1,
        timeSeconds: timing.seconds,
        timeEstimated: timing.estimated,
      });
    }
    const grouped = new Map();
    occurrences.forEach((item) => {
      const group = grouped.get(item.word) || {
        word: item.word,
        count: 0,
        occurrenceIds: [],
        firstOrder: item.order,
      };
      group.count += 1;
      group.occurrenceIds.push(item.id);
      grouped.set(item.word, group);
    });
    return {
      total: occurrences.length,
      groups: [...grouped.values()]
        .sort((a, b) => b.count - a.count || a.firstOrder - b.firstOrder)
        .map(({ firstOrder, ...group }) => group),
      occurrences,
    };
  }

  function normalizeIntervals(intervals, durationSeconds) {
    return (Array.isArray(intervals) ? intervals : [])
      .map((item) => ({
        startSeconds: clamp(item?.startSeconds ?? item?.start, 0, durationSeconds || Infinity),
        endSeconds: clamp(item?.endSeconds ?? item?.end, 0, durationSeconds || Infinity),
      }))
      .filter((item) => item.endSeconds > item.startSeconds)
      .sort((a, b) => a.startSeconds - b.startSeconds);
  }

  function findLongPauses(timeline, voiceIntervals, durationSeconds, thresholdSeconds = 2) {
    const spoken = normalizeIntervals(voiceIntervals, durationSeconds);
    const source = spoken.length > 1 ? spoken : timeline;
    const pauses = [];
    for (let index = 1; index < source.length; index += 1) {
      const previous = source[index - 1];
      const next = source[index];
      const gap = next.startSeconds - previous.endSeconds;
      if (gap < thresholdSeconds) continue;
      pauses.push({
        startSeconds: round(previous.endSeconds),
        endSeconds: round(next.startSeconds),
        durationSeconds: round(gap),
        beforeOffset: Number.isFinite(previous.endOffset) ? previous.endOffset : null,
        afterOffset: Number.isFinite(next.startOffset) ? next.startOffset : null,
      });
    }
    return pauses.sort((a, b) => b.durationSeconds - a.durationSeconds).slice(0, 8);
  }

  function paceWindows(timeline, language) {
    const windows = [];
    let current = null;
    timeline.forEach((segment) => {
      if (segment.approximate) return;
      if (!current || segment.startSeconds - current.endSeconds > 1.4 || current.endSeconds - current.startSeconds >= 8) {
        if (current) windows.push(current);
        current = { ...segment, text: segment.text };
        return;
      }
      current.text = `${current.text} ${segment.text}`.trim();
      current.endSeconds = Math.max(current.endSeconds, segment.endSeconds);
      if (Number.isFinite(segment.endOffset)) current.endOffset = segment.endOffset;
    });
    if (current) windows.push(current);
    return windows
      .map((window) => {
        const duration = window.endSeconds - window.startSeconds;
        const wordCount = segmentWords(window.text, language).length;
        return {
          ...window,
          durationSeconds: round(duration),
          wordCount,
          wpm: duration > 0 ? Math.round(wordCount / (duration / 60)) : 0,
        };
      })
      .filter((window) => window.durationSeconds >= 2.5 && window.wordCount >= 5);
  }

  function findFastSegments(timeline, language, thresholdWpm) {
    return paceWindows(timeline, language)
      .filter((window) => window.wpm > thresholdWpm)
      .sort((a, b) => b.wpm - a.wpm)
      .slice(0, 6)
      .map((window) => ({
        startSeconds: round(window.startSeconds),
        endSeconds: round(window.endSeconds),
        durationSeconds: window.durationSeconds,
        wpm: window.wpm,
        text: window.text,
        startOffset: Number.isFinite(window.startOffset) ? window.startOffset : null,
        endOffset: Number.isFinite(window.endOffset) ? window.endOffset : null,
      }));
  }

  function splitSentences(text) {
    return String(text || "")
      .split(/(?<=[。！？!?\.])|\n+/u)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function meaningfulTerms(text, language) {
    const stop = new Set([
      "我", "你", "他", "她", "它", "的", "了", "是", "在", "和", "也", "就", "都", "而", "很", "這", "那",
      "i", "you", "he", "she", "it", "we", "they", "the", "a", "an", "is", "are", "was", "were", "and", "or", "to", "of", "in", "that", "this",
    ]);
    return new Set(
      segmentWords(text, language)
        .map((item) => item.token.toLocaleLowerCase())
        .filter((token) => token.length > 1 && !stop.has(token)),
    );
  }

  function normalizeStatus(status) {
    const value = String(status || "").toLocaleLowerCase();
    if (STATUS_VALUES.has(value)) return value;
    if (/完整|清楚|有力|strong|good|clear/.test(value)) return "strong";
    if (/缺少|沒有|missing|absent|weak/.test(value)) return "missing";
    return "developing";
  }

  function normalizeAiStructure(aiStructure) {
    if (!aiStructure || typeof aiStructure !== "object") return null;
    const keys = ["opening", "body", "closing"];
    const result = {};
    for (const key of keys) {
      const item = aiStructure[key];
      if (!item) return null;
      result[key] = {
        status: normalizeStatus(typeof item === "string" ? item : item.status),
        reason: String(typeof item === "string" ? item : item.reason || item.detail || "").trim(),
      };
    }
    return result;
  }

  function inferStructure(text, language = "zh-TW", aiStructure) {
    const normalizedAi = normalizeAiStructure(aiStructure);
    if (normalizedAi && Object.values(normalizedAi).every((item) => item.reason)) return normalizedAi;

    const sentences = splitSentences(text);
    const openingText = sentences[0] || String(text || "").slice(0, 80);
    const closingText = sentences.at(-1) || openingText;
    const isEnglish = language === "en-US";
    const openingDirect = isEnglish
      ? /\b(i think|i believe|in my view|my answer|for me|i would|today i)\b/i.test(openingText)
      : /我認為|我覺得|在我看來|對我來說|我的答案|我會選|我相信|今天我想/.test(openingText);
    const openingHook = isEnglish
      ? /\b(imagine|what if|have you ever|once|let me tell)\b/i.test(openingText) || /\?/.test(openingText)
      : /想像|你有沒有|有一次|曾經|讓我先說|故事/.test(openingText) || /？/.test(openingText);
    const supportMatches = String(text || "").match(
      isEnglish
        ? /\b(because|for example|for instance|first|second|then|when|once|therefore)\b/gi
        : /因為|所以|例如|比如|首先|第二|接著|當時|記得|有一次|數字/g,
    ) || [];
    const closingMarker = isEnglish
      ? /\b(in conclusion|to conclude|ultimately|finally|therefore|that is why|so i believe)\b/i.test(closingText)
      : /總而言之|總結|最後|因此|所以|這就是|這也是為什麼|我希望|我相信/.test(closingText);
    const openingTerms = meaningfulTerms(openingText, language);
    const closingTerms = meaningfulTerms(closingText, language);
    const echoed = [...openingTerms].some((term) => closingTerms.has(term));

    const opening = openingDirect || openingHook
      ? {
          status: "strong",
          reason: isEnglish
            ? openingDirect
              ? "The opening states a clear direction immediately."
              : "The opening uses a hook that invites the listener in."
            : openingDirect
              ? "開場很快亮出立場，聽眾能立即掌握方向。"
              : "開場有鉤子，能把聽眾帶進你的回答。",
        }
      : {
          status: sentences.length > 1 ? "developing" : "missing",
          reason: isEnglish
            ? "The first sentence starts the topic, but the main position could be clearer."
            : "第一句已進入主題，但主要立場還可以說得更直接。",
        };

    const body = supportMatches.length >= 2 || (supportMatches.length >= 1 && sentences.length >= 3)
      ? {
          status: "strong",
          reason: isEnglish
            ? "The body uses reasons, sequencing, or examples to develop the point."
            : "主體有理由、順序或例子支撐，不只是停留在結論。",
        }
      : {
          status: sentences.length >= 2 ? "developing" : "missing",
          reason: isEnglish
            ? "The central idea is present, but it needs one concrete example or clearer reasoning."
            : "核心想法已經出現，但還需要一個具體例子或更清楚的推進。",
        };

    const closing = closingMarker || (echoed && sentences.length >= 3)
      ? {
          status: "strong",
          reason: isEnglish
            ? closingMarker
              ? "The closing clearly signals completion and reinforces the message."
              : "The closing echoes the opening idea and creates a sense of completion."
            : closingMarker
              ? "結尾有明確收束語，並再次強化核心訊息。"
              : "結尾呼應了開場的重點，形成完整的收束。",
        }
      : {
          status: sentences.length >= 3 ? "developing" : "missing",
          reason: isEnglish
            ? "The answer stops after the last point; add one sentence that returns to the main message."
            : "回答在最後一個論點後就結束了，可以再用一句話扣回核心訊息。",
        };

    return { opening, body, closing };
  }

  function normalizeAiFocus(aiFocus, isEnglish) {
    if (!aiFocus) return null;
    if (typeof aiFocus === "string") {
      return { title: isEnglish ? "One focus for next time" : "下一次只練這一件事", action: aiFocus };
    }
    const title = String(aiFocus.title || aiFocus.focus || "").trim();
    const action = String(aiFocus.action || aiFocus.detail || aiFocus.suggestion || "").trim();
    return action ? { title: title || (isEnglish ? "One focus for next time" : "下一次只練這一件事"), action } : null;
  }

  function chooseNextFocus(evaluation, aiFocus) {
    const isEnglish = evaluation.language === "en-US";
    const fillerRate = evaluation.durationSeconds > 0
      ? evaluation.fillers.total / (evaluation.durationSeconds / 60)
      : evaluation.fillers.total;
    const mostFrequent = evaluation.fillers.groups[0];
    if (mostFrequent && (mostFrequent.count >= 3 || fillerRate >= 4)) {
      const targetCount = Math.max(0, mostFrequent.count - Math.max(1, Math.ceil(mostFrequent.count / 2)));
      return {
        title: isEnglish ? `Replace “${mostFrequent.word}” with silence` : `把「${mostFrequent.word}」換成安靜停頓`,
        action: isEnglish
          ? `In the next answer, pause for one beat whenever “${mostFrequent.word}” is about to come out. Aim for no more than ${targetCount} occurrence${targetCount === 1 ? "" : "s"}.`
          : `下一次一想說「${mostFrequent.word}」時，先停一拍再繼續；目標從 ${mostFrequent.count} 次降到 ${targetCount} 次以內。`,
      };
    }
    if (evaluation.wpm && evaluation.wpm > evaluation.fastThresholdWpm) {
      return {
        title: isEnglish ? "Slow the first 30 seconds by 10%" : "前 30 秒刻意慢 10%",
        action: isEnglish
          ? "After each complete sentence, leave one short beat before continuing. Keep the opening under your target pace."
          : "每說完一個完整句子就停一拍，先把開場控制在目標語速內。",
      };
    }
    if (evaluation.fastSegments.length) {
      const segment = evaluation.fastSegments[0];
      return {
        title: isEnglish ? "Rehearse the fastest fragment once" : "只重練最快的那一段",
        action: isEnglish
          ? `Repeat the fragment around ${Math.round(segment.startSeconds)} seconds at about 80% of its current speed, adding one pause at the key point.`
          : `把約 ${Math.round(segment.startSeconds)} 秒處的片段用目前 80% 的速度再說一次，並在重點前加一個停頓。`,
      };
    }
    if (evaluation.structure.closing.status !== "strong") {
      return {
        title: isEnglish ? "Prepare one closing sentence" : "先準備一句收尾句",
        action: isEnglish
          ? "End the next answer with: “So the one thing I want you to remember is …” and restate your main message in one sentence."
          : "下一次最後加上「所以，我最想讓大家記住的是……」，用一句話重申核心訊息。",
      };
    }
    if (evaluation.structure.opening.status !== "strong") {
      return {
        title: isEnglish ? "Give the answer in sentence one" : "第一句就直接回答",
        action: isEnglish
          ? "Start with “My answer is … because …” before giving any background."
          : "先用「我的答案是……，因為……」開場，再補背景與故事。",
      };
    }
    if (evaluation.longPauses.length) {
      return {
        title: isEnglish ? "Turn the longest pause into a planned pause" : "把最長停頓變成有意識的停頓",
        action: isEnglish
          ? "Before recording, write the next section’s first keyword. Pause, breathe, say that keyword, and continue."
          : "錄音前先寫下下一段的第一個關鍵字；停頓時先呼吸、說出關鍵字，再繼續。",
      };
    }
    const normalizedAi = normalizeAiFocus(aiFocus, isEnglish);
    if (normalizedAi) return normalizedAi;
    return {
      title: isEnglish ? "Add one concrete scene" : "只補一個具體場景",
      action: isEnglish
        ? "In the next answer, include one person, place, and action so the listener can picture the moment."
        : "下一次只多補一個「人物＋地點＋動作」的場景，讓聽眾能在腦中看見它。",
    };
  }

  function build(text, options = {}) {
    const transcript = String(text || "");
    const language = options.language || "zh-TW";
    const durationSeconds = Math.max(0, Number(options.durationSeconds) || 0);
    const words = segmentWords(transcript, language);
    const timeline = normalizeTimeline(options.timeline, transcript);
    const fastThresholdWpm = Number(options.fastThresholdWpm) || (language === "zh-TW" ? 260 : language === "ja-JP" ? 200 : 180);
    const fillers = findFillers(transcript, timeline, durationSeconds);
    const evaluation = {
      version: 1,
      language,
      durationSeconds: round(durationSeconds),
      wordCount: words.length,
      wpm: durationSeconds > 0 ? Math.round(words.length / (durationSeconds / 60)) : null,
      paceUnit: language === "zh-TW" ? "characters" : "words",
      fastThresholdWpm,
      fillers,
      longPauses: findLongPauses(timeline, options.voiceIntervals, durationSeconds, options.longPauseSeconds || 2),
      fastSegments: findFastSegments(timeline, language, fastThresholdWpm),
      structure: inferStructure(transcript, language, options.aiStructure),
      timingStatus: timeline.some((item) => !item.approximate)
        ? "timestamped"
        : durationSeconds > 0
          ? "duration-only"
          : "none",
      transcriptLength: transcript.length,
    };
    evaluation.nextFocus = chooseNextFocus(evaluation, options.aiNextFocus);
    return evaluation;
  }

  return {
    build,
    findFillers,
    inferStructure,
    normalizeTimeline,
    segmentWords,
  };
});
