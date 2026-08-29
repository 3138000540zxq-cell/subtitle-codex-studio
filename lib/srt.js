const TIMECODE_RE = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2}),(\d{3})$/;

function normalizeNewlines(value) {
  return String(value || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

function timecodeToMs(timecode) {
  const match = String(timecode).match(TIMECODE_RE);
  if (!match) return null;

  const values = match.slice(1).map(Number);
  const start = (((values[0] * 60 + values[1]) * 60 + values[2]) * 1000) + values[3];
  const end = (((values[4] * 60 + values[5]) * 60 + values[6]) * 1000) + values[7];
  return { start, end };
}

function msToTimestamp(value) {
  const milliseconds = Math.max(0, Math.floor(value));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

function parseRawBlocks(value) {
  const normalized = normalizeNewlines(value).trim();
  if (!normalized) throw new Error("字幕文件是空的。");

  return normalized.split(/\n{2,}/).filter((block) => block.trim()).map((rawBlock, position) => {
    const lines = rawBlock.split("\n");
    const index = Number(lines[0]);
    const timecode = lines[1] || "";
    const timing = timecodeToMs(timecode);

    if (!Number.isInteger(index) || index < 1) {
      throw new Error(`第 ${position + 1} 个字幕块缺少有效序号。`);
    }
    if (!timing) {
      throw new Error(`字幕 ${index} 的时间轴格式无效：${timecode || "（空）"}`);
    }
    if (lines.slice(2).join("").trim().length === 0) {
      throw new Error(`字幕 ${index} 没有正文。`);
    }

    return {
      index,
      timecode,
      startMs: timing.start,
      endMs: timing.end,
      textLines: lines.slice(2),
    };
  });
}

function parseSrt(value) {
  const blocks = parseRawBlocks(value);
  for (const block of blocks) {
    if (block.startMs === block.endMs) {
      throw new Error(`字幕 ${block.index} 是零时长：${block.timecode}`);
    }
    if (block.startMs > block.endMs) {
      throw new Error(`字幕 ${block.index} 的结束时间早于开始时间：${block.timecode}`);
    }
  }
  return blocks;
}

function serializeSrt(blocks) {
  return `${blocks.map((block, position) => {
    const start = msToTimestamp(block.startMs);
    const end = msToTimestamp(block.endMs);
    return `${position + 1}\n${start} --> ${end}\n${block.textLines.join("\n")}`;
  }).join("\n\n")}\n`;
}

function repairSrt(value) {
  const blocks = parseRawBlocks(value);
  const repaired = [];
  const repairs = [];

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.startMs > block.endMs) {
      throw new Error(`字幕 ${block.index} 的结束时间早于开始时间，无法安全自动修复：${block.timecode}`);
    }
    if (block.startMs < block.endMs) {
      repaired.push({ ...block });
      continue;
    }

    const normalizedText = block.textLines.join("\n").trim();
    let groupEnd = index;
    while (groupEnd + 1 < blocks.length) {
      const candidate = blocks[groupEnd + 1];
      const sameText = candidate.textLines.join("\n").trim() === normalizedText;
      const nearby = candidate.startMs - block.startMs <= 100;
      if (candidate.startMs !== candidate.endMs || !sameText || !nearby) break;
      groupEnd += 1;
    }

    const nextBlock = blocks[groupEnd + 1];
    const nextStart = nextBlock ? nextBlock.startMs : block.startMs + 1000;
    const available = nextStart - block.startMs;
    if (available <= 20) {
      throw new Error(`字幕 ${block.index} 是零时长，且与下一条时间冲突，无法安全自动修复。`);
    }

    const repairedEnd = block.startMs + Math.min(500, available - 20);
    repaired.push({
      ...block,
      endMs: repairedEnd,
      timecode: `${msToTimestamp(block.startMs)} --> ${msToTimestamp(repairedEnd)}`,
    });
    repairs.push({
      type: groupEnd > index ? "merge-zero-duration-duplicates" : "extend-zero-duration",
      sourceIndices: blocks.slice(index, groupEnd + 1).map((item) => item.index),
      originalTimecode: block.timecode,
      repairedTimecode: `${msToTimestamp(block.startMs)} --> ${msToTimestamp(repairedEnd)}`,
      removedDuplicates: groupEnd - index,
    });
    index = groupEnd;
  }

  const content = serializeSrt(repaired);
  validateSrt(content);
  return {
    changed: repairs.length > 0,
    content,
    originalCueCount: blocks.length,
    repairedCueCount: repaired.length,
    repairs,
  };
}

function validateSrt(value, options = {}) {
  const blocks = parseSrt(value);

  for (let i = 0; i < blocks.length; i += 1) {
    if (blocks[i].index !== i + 1) {
      throw new Error(`输出字幕序号不连续：期望 ${i + 1}，实际为 ${blocks[i].index}。`);
    }
    if (i > 0 && blocks[i].startMs < blocks[i - 1].endMs) {
      throw new Error(`输出字幕 ${blocks[i].index} 与上一条时间重叠。`);
    }
  }

  if (options.sourceBlocks && options.strictTiming) {
    if (blocks.length !== options.sourceBlocks.length) {
      throw new Error(`严格模式条目数量不一致：原文 ${options.sourceBlocks.length}，译文 ${blocks.length}。`);
    }
    for (let i = 0; i < blocks.length; i += 1) {
      if (blocks[i].timecode !== options.sourceBlocks[i].timecode) {
        throw new Error(`严格模式下字幕 ${i + 1} 的时间轴被修改。`);
      }
    }
  }

  if (options.sourceBlocks && !options.strictTiming) {
    const sourceStart = options.sourceBlocks[0].startMs;
    const sourceEnd = options.sourceBlocks.at(-1).endMs;
    if (blocks[0].startMs < sourceStart || blocks.at(-1).endMs > sourceEnd) {
      throw new Error("智能断句后的字幕超出了原字幕总时间范围。");
    }
  }

  return blocks;
}

module.exports = {
  normalizeNewlines,
  msToTimestamp,
  parseSrt,
  repairSrt,
  serializeSrt,
  timecodeToMs,
  validateSrt,
};
