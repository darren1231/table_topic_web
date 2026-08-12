const assert = require("node:assert/strict");
const SpeechEvaluation = require("../evaluation.js");

function test(name, run) {
  try {
    run();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

test("calculates duration, word count, and WPM", () => {
  const transcript = Array.from({ length: 120 }, (_, index) => `word${index}`).join(" ");
  const result = SpeechEvaluation.build(transcript, {
    language: "en-US",
    durationSeconds: 60,
  });
  assert.equal(result.durationSeconds, 60);
  assert.equal(result.wordCount, 120);
  assert.equal(result.wpm, 120);
});

test("counts Mandarin pace by spoken characters while keeping Latin words intact", () => {
  const result = SpeechEvaluation.build("我喜歡 AI", {
    language: "zh-TW",
    durationSeconds: 60,
  });
  assert.equal(result.wordCount, 4);
  assert.equal(result.wpm, 4);
  assert.equal(result.paceUnit, "characters");
  assert.equal(result.fastThresholdWpm, 260);
});

test("finds every requested Chinese filler and preserves its character position", () => {
  const transcript = "嗯，我其實想說，然後就是那個例子，呃，最後再說一次。";
  const result = SpeechEvaluation.build(transcript, {
    language: "zh-TW",
    durationSeconds: 30,
  });
  assert.equal(result.fillers.total, 6);
  assert.deepEqual(
    result.fillers.occurrences.map((item) => item.word),
    ["嗯", "其實", "然後", "就是", "那個", "呃"],
  );
  result.fillers.occurrences.forEach((item) => {
    assert.equal(transcript.slice(item.index, item.end), item.displayWord);
  });
});

test("keeps original offsets and leaves filler time unknown without a recording", () => {
  const transcript = "  嗯，從保留空白的位置開始。";
  const result = SpeechEvaluation.build(transcript, { language: "zh-TW" });
  assert.equal(result.fillers.occurrences[0].index, 2);
  assert.equal(result.fillers.occurrences[0].timeSeconds, null);
});

test("detects pauses of at least two seconds", () => {
  const result = SpeechEvaluation.build("第一段。第二段。第三段。", {
    language: "zh-TW",
    durationSeconds: 18,
    voiceIntervals: [
      { start: 0, end: 4 },
      { start: 7.5, end: 11 },
      { start: 13, end: 18 },
    ],
  });
  assert.deepEqual(
    result.longPauses.map((item) => item.durationSeconds),
    [3.5, 2],
  );
});

test("detects a timestamped fast fragment", () => {
  const fastText = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty";
  const result = SpeechEvaluation.build(fastText, {
    language: "en-US",
    durationSeconds: 12,
    timeline: [{ text: fastText, start: 0, end: 4 }],
  });
  assert.equal(result.timingStatus, "timestamped");
  assert.equal(result.fastSegments.length, 1);
  assert.equal(result.fastSegments[0].wpm, 300);
});

test("judges an opening, supported body, and closing", () => {
  const transcript =
    "我認為勇氣就是在害怕時仍然行動。首先，因為我曾經害怕上台，所以我從一次短講開始。例如，第一次我只說了一分鐘。最後，我相信勇氣不是不害怕，而是願意跨出下一步。";
  const result = SpeechEvaluation.build(transcript, { language: "zh-TW" });
  assert.equal(result.structure.opening.status, "strong");
  assert.equal(result.structure.body.status, "strong");
  assert.equal(result.structure.closing.status, "strong");
});

test("returns exactly one concrete next focus", () => {
  const result = SpeechEvaluation.build(
    "然後我開始。然後我舉例。然後我說完。",
    { language: "zh-TW", durationSeconds: 30 },
  );
  assert.deepEqual(Object.keys(result.nextFocus).sort(), ["action", "title"]);
  assert.match(result.nextFocus.title, /然後/);
  assert.match(result.nextFocus.action, /3 次/);
});

test("does not invent WPM when no recording duration exists", () => {
  const result = SpeechEvaluation.build("這是手動輸入的逐字稿。", {
    language: "zh-TW",
  });
  assert.equal(result.durationSeconds, 0);
  assert.equal(result.wpm, null);
  assert.equal(result.timingStatus, "none");
});

console.log("All speech evaluation tests passed.");
