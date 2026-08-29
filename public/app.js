const fileInput = document.querySelector("#fileInput");
const dropZone = document.querySelector("#dropZone");
const fileMeta = document.querySelector("#fileMeta");
const cueCount = document.querySelector("#cueCount");
const sourcePreview = document.querySelector("#sourcePreview");
const translateButton = document.querySelector("#translateButton");
const buttonLabel = document.querySelector("#buttonLabel");
const runtimeStatus = document.querySelector("#runtimeStatus");
const segmentationNote = document.querySelector("#segmentationNote");
const styleNotes = document.querySelector("#styleNotes");
const resultsBand = document.querySelector("#resultsBand");
const resultList = document.querySelector("#resultList");
const validationCopy = document.querySelector("#validationCopy");
const errorBand = document.querySelector("#errorBand");
const errorMessage = document.querySelector("#errorMessage");

let selectedFile = null;
let selectedContent = "";
let isBusy = false;

function selectedValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`).value;
}

function countCues(content) {
  return content
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n{2,}/)
    .filter(Boolean).length;
}

function updateButton() {
  translateButton.disabled = !selectedFile || isBusy || !runtimeStatus.classList.contains("ready");
}

function showError(message) {
  errorMessage.textContent = message;
  errorBand.hidden = false;
  errorBand.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function clearMessages() {
  errorBand.hidden = true;
  resultsBand.hidden = true;
  resultList.replaceChildren();
}

async function loadFile(file) {
  clearMessages();
  if (!file || !file.name.toLowerCase().endsWith(".srt")) {
    showError("请选择扩展名为 .srt 的字幕文件。");
    return;
  }

  selectedFile = file;
  selectedContent = await file.text();
  const cues = countCues(selectedContent);
  const kb = Math.max(1, Math.round(file.size / 1024));
  fileMeta.textContent = `${file.name} · ${kb} KB`;
  cueCount.textContent = `${cues} 条`;
  sourcePreview.textContent = selectedContent.slice(0, 12_000) + (selectedContent.length > 12_000 ? "\n\n……预览已截断" : "");
  updateButton();
}

function downloadText(filename, content) {
  const blob = new Blob(["\uFEFF", content], { type: "application/x-subrip;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderResults(data) {
  resultList.replaceChildren();
  for (const file of data.files) {
    const item = document.createElement("article");
    item.className = "result-item";

    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = file.filename;
    const meta = document.createElement("span");
    meta.textContent = `${file.kind} · ${file.cueCount} 条 · 已校验`;
    copy.append(title, meta);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "download-button";
    button.title = `下载 ${file.filename}`;
    button.setAttribute("aria-label", `下载 ${file.filename}`);
    button.textContent = "↓";
    button.addEventListener("click", () => downloadText(file.filename, file.content));

    item.append(copy, button);
    resultList.append(item);
  }

  const modeLabel = data.segmentation === "strict" ? "严格时间轴" : "智能断句";
  const repairLabel = data.repairs.length
    ? `自动修复 ${data.repairs.reduce((total, item) => total + item.sourceIndices.length, 0)} 条异常字幕 · `
    : "";
  validationCopy.textContent = `${repairLabel}源字幕 ${data.sourceCueCount} 条 · ${modeLabel} · SRT 校验通过`;
  resultsBand.hidden = false;
  resultsBand.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function translate() {
  if (!selectedFile || isBusy) return;

  clearMessages();
  isBusy = true;
  buttonLabel.textContent = "Codex 正在翻译，请保持页面开启";
  translateButton.classList.add("loading");
  updateButton();

  try {
    const response = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: selectedFile.name,
        content: selectedContent,
        segmentation: selectedValue("segmentation"),
        outputKind: selectedValue("outputKind"),
        styleNotes: styleNotes.value,
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "翻译失败。");
    renderResults(data);
  } catch (error) {
    showError(error.message || "翻译失败。");
  } finally {
    isBusy = false;
    buttonLabel.textContent = "调用 Codex 翻译";
    translateButton.classList.remove("loading");
    updateButton();
  }
}

fileInput.addEventListener("change", () => loadFile(fileInput.files[0]));
dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("dragging");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragging"));
dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("dragging");
  loadFile(event.dataTransfer.files[0]);
});
translateButton.addEventListener("click", translate);

document.querySelectorAll('input[name="segmentation"]').forEach((input) => {
  input.addEventListener("change", () => {
    segmentationNote.textContent = input.value === "smart"
      ? "按标点合并或拆分，更适合直接观看。"
      : "条目数量和每条时间轴完全不变，适合剪辑工程。";
  });
});

fetch("/api/health")
  .then((response) => response.json())
  .then((data) => {
    if (!data.ok || !data.skillInstalled) throw new Error();
    runtimeStatus.classList.add("ready");
    runtimeStatus.querySelector("span:last-child").textContent = `Codex Skill 已就绪 · ${data.model} · ${data.reasoningEffort}`;
  })
  .catch(() => {
    runtimeStatus.classList.add("error");
    runtimeStatus.querySelector("span:last-child").textContent = "缺少字幕翻译 Skill";
  })
  .finally(updateButton);
