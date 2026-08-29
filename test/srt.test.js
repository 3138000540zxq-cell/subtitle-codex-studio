const test = require("node:test");
const assert = require("node:assert/strict");
const { parseSrt, repairSrt, validateSrt } = require("../lib/srt");

const SOURCE = `1
00:00:01,000 --> 00:00:03,000
こんにちは。

2
00:00:03,200 --> 00:00:05,000
元気ですか？`;

test("parses a valid SRT", () => {
  const blocks = parseSrt(SOURCE);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].startMs, 1000);
  assert.deepEqual(blocks[1].textLines, ["元気ですか？"]);
});

test("strict validation preserves source timing", () => {
  const sourceBlocks = parseSrt(SOURCE);
  const translated = SOURCE.replace("こんにちは。", "你好。").replace("元気ですか？", "你好吗？");
  assert.equal(validateSrt(translated, { sourceBlocks, strictTiming: true }).length, 2);
});

test("rejects overlapping cues", () => {
  const overlapping = SOURCE.replace("00:00:03,200", "00:00:02,900");
  assert.throws(() => validateSrt(overlapping), /时间重叠/);
});

test("smart validation accepts re-segmentation inside the source range", () => {
  const sourceBlocks = parseSrt(SOURCE);
  const merged = `1
00:00:01,000 --> 00:00:05,000
你好，你好吗？`;
  assert.equal(validateSrt(merged, { sourceBlocks, strictTiming: false }).length, 1);
});

test("repairs and merges nearby duplicate zero-duration cues", () => {
  const broken = `1
00:00:01,000 --> 00:00:01,000
ん?

2
00:00:01,020 --> 00:00:01,020
ん?

3
00:00:02,000 --> 00:00:03,000
次です。`;
  const result = repairSrt(broken);
  const blocks = parseSrt(result.content);
  assert.equal(result.changed, true);
  assert.equal(result.originalCueCount, 3);
  assert.equal(result.repairedCueCount, 2);
  assert.deepEqual(result.repairs[0].sourceIndices, [1, 2]);
  assert.equal(blocks[0].timecode, "00:00:01,000 --> 00:00:01,500");
});

test("repairs a single zero-duration cue without touching the next cue", () => {
  const broken = `1
00:00:01,000 --> 00:00:01,000
短い字幕

2
00:00:01,300 --> 00:00:02,000
次です。`;
  const result = repairSrt(broken);
  const blocks = parseSrt(result.content);
  assert.equal(blocks[0].timecode, "00:00:01,000 --> 00:00:01,280");
  assert.equal(blocks[1].timecode, "00:00:01,300 --> 00:00:02,000");
});

test("does not guess when an end time is earlier than the start", () => {
  const reversed = `1
00:00:02,000 --> 00:00:01,000
倒序时间`;
  assert.throws(() => repairSrt(reversed), /无法安全自动修复/);
});
