/**
 * PDF工具箱 - 前端交互脚本
 */

// ==================== State ====================
const state = {
    files: [], // { id, name, filename, size, size_formatted, pages, error }
    selectedFile: null, // filename of single selected file
    mergeSelected: new Set(), // Set of filenames for merge
    mergeMode: false,
};

// ==================== DOM Refs ====================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const elements = {
    uploadZone: $("#uploadZone"),
    fileInput: $("#fileInput"),
    fileList: $("#fileList"),
    featuresSection: $("#featuresSection"),
    featureCards: $$(".feature-card"),
    resultSection: $("#resultSection"),
    resultCard: $("#resultCard"),
    loadingOverlay: $("#loadingOverlay"),
    loadingText: $("#loadingText"),
    toastContainer: $("#toastContainer"),
    rotateModal: $("#rotateModal"),
};

// ==================== Init ====================
document.addEventListener("DOMContentLoaded", () => {
    initUpload();
    initFeatures();
    initRotateModal();
});

// ==================== Upload ====================
function initUpload() {
    const { uploadZone, fileInput } = elements;

    uploadZone.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => {
        if (e.target.files.length > 0) {
            uploadFiles(e.target.files);
            fileInput.value = "";
        }
    });

    // Drag & Drop
    uploadZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        uploadZone.classList.add("drag-over");
    });
    uploadZone.addEventListener("dragleave", () => {
        uploadZone.classList.remove("drag-over");
    });
    uploadZone.addEventListener("drop", (e) => {
        e.preventDefault();
        uploadZone.classList.remove("drag-over");
        if (e.dataTransfer.files.length > 0) {
            uploadFiles(e.dataTransfer.files);
        }
    });

    // Paste
    document.addEventListener("paste", (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        const files = [];
        for (const item of items) {
            if (item.kind === "file") {
                const file = item.getAsFile();
                if (file.name.toLowerCase().endsWith(".pdf")) {
                    files.push(file);
                }
            }
        }
        if (files.length > 0) {
            e.preventDefault();
            uploadFiles(files);
        }
    });
}

async function uploadFiles(fileList) {
    const formData = new FormData();
    for (const f of fileList) {
        formData.append("files", f);
    }

    showLoading("正在上传...");

    try {
        const res = await fetch("/api/upload", { method: "POST", body: formData });
        const data = await res.json();

        if (data.files && data.files.length > 0) {
            for (const f of data.files) {
                if (f.error) {
                    showToast(f.name ? `${f.name}: ${f.error}` : f.error, "error");
                } else {
                    // Avoid duplicates by filename
                    const exists = state.files.find((sf) => sf.filename === f.filename);
                    if (!exists) {
                        state.files.push(f);
                    }
                }
            }
            // 自动选中第一个有效文件
            const validFiles = data.files.filter((f) => !f.error);
            if (validFiles.length > 0 && !state.selectedFile) {
                state.selectedFile = validFiles[0].filename;
            }
            renderFileList();
            updateFeatures();
            showToast(`成功上传 ${validFiles.length} 个文件`, "success");
        }
    } catch (err) {
        showToast("上传失败: " + err.message, "error");
    } finally {
        hideLoading();
    }
}

// ==================== File List Rendering ====================
function renderFileList() {
    const { fileList } = elements;

    if (state.files.length === 0) {
        fileList.innerHTML = "";
        updateFeatures();
        return;
    }

    let html = state.files
        .map((f) => {
            const isSelected = state.selectedFile === f.filename;
            const isMergeSel = state.mergeSelected.has(f.filename);
            const hasError = !!f.error;
            const cardClass = [
                "file-card",
                isSelected && !state.mergeMode ? "selected" : "",
                isMergeSel && state.mergeMode ? "merge-selected" : "",
                hasError ? "file-card-error" : "",
            ]
                .filter(Boolean)
                .join(" ");

            return `
            <div class="${cardClass}" data-filename="${f.filename}" data-error="${hasError}">
              <div class="file-card-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
              </div>
              <div class="file-card-info">
                <span class="file-card-name" title="${escHtml(f.name)}">${escHtml(f.name)}</span>
                <span class="file-card-meta">
                  ${hasError ? `<span>错误</span>` : `<span>${f.size_formatted || ""}</span><span>${f.pages || 0} 页</span>`}
                </span>
              </div>
              <button class="file-card-remove" data-action="remove" data-filename="${f.filename}">&times;</button>
              ${state.mergeMode ? `<div class="file-card-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>` : ""}
            </div>`;
        })
        .join("");

    if (state.mergeMode) {
        html += `
        <div class="merge-mode-bar">
          <span>已选 <strong>${state.mergeSelected.size}</strong> 个文件，共需至少2个</span>
          <button class="btn btn-sm btn-ghost" data-action="toggle-merge">退出合并模式</button>
        </div>`;
    } else if (state.files.length >= 2) {
        html += `
        <div class="merge-mode-enter">
          <span>需要合并多个PDF？</span>
          <button class="btn btn-sm btn-secondary" data-action="toggle-merge">进入合并模式</button>
        </div>`;
    }

    fileList.innerHTML = html;

    // Event delegation for file cards
    fileList.querySelectorAll(".file-card").forEach((card) => {
        card.addEventListener("click", (e) => {
            const filename = card.dataset.filename;
            const hasError = card.dataset.error === "true";
            if (hasError) return;

            if (e.target.closest("[data-action]")) return; // Don't handle button clicks

            if (state.mergeMode) {
                toggleMergeFile(filename);
            } else {
                selectFile(filename);
            }
        });
    });

    // Remove buttons
    fileList.querySelectorAll("[data-action='remove']").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const filename = btn.dataset.filename;
            removeFile(filename);
        });
    });

    // Toggle merge mode
    const toggleBtn = fileList.querySelector("[data-action='toggle-merge']");
    if (toggleBtn) {
        toggleBtn.addEventListener("click", () => toggleMergeMode());
    }
}

function selectFile(filename) {
    state.selectedFile = filename;
    state.mergeMode = false;
    state.mergeSelected.clear();
    renderFileList();
    updateFeatures();
}

function removeFile(filename) {
    state.files = state.files.filter((f) => f.filename !== filename);
    if (state.selectedFile === filename) state.selectedFile = null;
    state.mergeSelected.delete(filename);
    if (state.files.length === 0) {
        state.mergeMode = false;
        state.mergeSelected.clear();
    }
    renderFileList();
    updateFeatures();
    clearResult();
}

function toggleMergeMode() {
    if (state.files.length < 2) {
        showToast("至少需要2个文件才能合并", "warning");
        return;
    }

    state.mergeMode = !state.mergeMode;
    if (!state.mergeMode) {
        state.mergeSelected.clear();
    } else {
        state.selectedFile = null;
    }
    renderFileList();
    updateFeatures();
}

function toggleMergeFile(filename) {
    if (state.mergeSelected.has(filename)) {
        state.mergeSelected.delete(filename);
    } else {
        state.mergeSelected.add(filename);
    }
    renderFileList();
    updateFeatures();
}

// ==================== Features ====================
function updateFeatures() {
    const hasValidFiles = state.files.some((f) => !f.error);
    const hasSelected = !!state.selectedFile;
    const mergeReady = state.mergeMode && state.mergeSelected.size >= 2;

    elements.featureCards.forEach((card) => {
        const feature = card.dataset.feature;
        if (feature === "merge") {
            card.disabled = !mergeReady;
        } else {
            card.disabled = !hasSelected;
        }
    });

    // 更新提示文案
    const tipsBar = document.getElementById("tipsBar");
    const sectionHint = document.getElementById("sectionHint");

    if (!hasValidFiles) {
        tipsBar.style.display = "flex";
        tipsBar.querySelector(".tips-text").innerHTML =
            "上传PDF后，<strong>点击文件卡片选中</strong>即可使用单文件功能。需要合并多个PDF？上传2个以上文件后点击下方「进入合并模式」一次勾选多个文件。";
        sectionHint.textContent = "请先上传PDF文件";
    } else if (state.mergeMode) {
        tipsBar.style.display = "flex";
        tipsBar.querySelector(".tips-text").innerHTML =
            "合并模式：<strong>点击文件卡片勾选</strong>需要合并的PDF，选好后点击下方「合并PDF」功能。";
        sectionHint.textContent = `请勾选需要合并的文件（已选 ${state.mergeSelected.size} 个）`;
    } else if (hasSelected) {
        tipsBar.style.display = "flex";
        tipsBar.querySelector(".tips-text").innerHTML =
            "已选中文件（紫色高亮），<strong>点击下方功能卡片</strong>开始处理。";
        sectionHint.textContent = "选择需要的处理功能";
    } else {
        tipsBar.style.display = "flex";
        tipsBar.querySelector(".tips-text").innerHTML =
            "<strong>点击文件卡片选中</strong>一个文件，即可使用单文件功能。多文件操作请点击「进入合并模式」。";
        sectionHint.textContent = "点击文件卡片选中后再选择功能";
    }
}

function initFeatures() {
    elements.featureCards.forEach((card) => {
        card.addEventListener("click", () => {
            const feature = card.dataset.feature;
            if (card.disabled) return;
            handleFeature(feature);
        });
    });
}

async function handleFeature(feature) {
    const filename = state.selectedFile;
    const file = state.files.find((f) => f.filename === filename);
    if (!file && feature !== "merge") {
        showToast("请先选择文件", "warning");
        return;
    }

    switch (feature) {
        case "compress":
            await callAPI("/api/compress", { filename }, "压缩PDF");
            break;
        case "to-word":
            await callAPI("/api/to-word", { filename }, "PDF转Word");
            break;
        case "extract-images":
            await callAPI("/api/extract-images", { filename }, "提取图片");
            break;
        case "merge":
            await callAPI(
                "/api/merge",
                { filenames: [...state.mergeSelected] },
                "合并PDF"
            );
            break;
        case "split":
            await callAPI("/api/split", { filename }, "拆分PDF");
            break;
        case "extract-text":
            await callAPI("/api/extract-text", { filename }, "提取文字");
            break;
        case "to-images":
            await callAPI("/api/to-images", { filename, dpi: 200 }, "PDF转图片");
            break;
        case "rotate":
            showRotateModal(filename);
            break;
    }
}

// ==================== API Calls ====================
async function callAPI(url, body, actionLabel) {
    showLoading(`正在${actionLabel}...`);
    clearResult();

    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const data = await res.json();

        if (!res.ok || data.error) {
            showToast(data.error || "处理失败", "error");
            return;
        }

        showResult(data, actionLabel);
    } catch (err) {
        showToast(`${actionLabel}失败: ${err.message}`, "error");
    } finally {
        hideLoading();
    }
}

// ==================== Result Display ====================
function showResult(data, actionLabel) {
    const { resultSection, resultCard } = elements;
    let statsHtml = "";
    let downloadHtml = "";

    // Build stats
    if (data.original_size !== undefined) {
        statsHtml += `
        <div class="result-stat">
          <span>原始大小:</span><strong>${data.original_size_formatted}</strong>
        </div>
        <div class="result-stat">
          <span>压缩后:</span><strong>${data.compressed_size_formatted}</strong>
        </div>
        <div class="result-stat" style="color:var(--success)">
          <span>减小:</span><strong>${data.ratio}%</strong>
        </div>`;
    } else if (data.char_count !== undefined) {
        statsHtml += `
        <div class="result-stat">
          <span>字符数:</span><strong>${data.char_count.toLocaleString()}</strong>
        </div>`;
    } else if (data.image_count !== undefined) {
        statsHtml += `
        <div class="result-stat">
          <span>提取图片:</span><strong>${data.image_count} 张</strong>
        </div>`;
    } else if (data.file_count !== undefined) {
        statsHtml += `
        <div class="result-stat">
          <span>合并文件:</span><strong>${data.file_count} 个</strong>
        </div>
        <div class="result-stat">
          <span>总页数:</span><strong>${data.total_pages}</strong>
        </div>`;
    } else if (data.page_count !== undefined && data.total_pages !== undefined) {
        statsHtml += `
        <div class="result-stat">
          <span>拆分页数:</span><strong>${data.page_count} / ${data.total_pages}</strong>
        </div>`;
    } else if (data.page_count !== undefined && data.dpi !== undefined) {
        statsHtml += `
        <div class="result-stat">
          <span>转换页数:</span><strong>${data.page_count} 页</strong>
        </div>
        <div class="result-stat">
          <span>分辨率:</span><strong>${data.dpi} DPI</strong>
        </div>`;
    } else if (data.angle !== undefined) {
        statsHtml += `
        <div class="result-stat">
          <span>旋转角度:</span><strong>${data.angle}°</strong>
        </div>
        <div class="result-stat">
          <span>处理页数:</span><strong>${data.page_count} 页</strong>
        </div>`;
    }

    if (data.size !== undefined) {
        statsHtml += `
        <div class="result-stat">
          <span>文件大小:</span><strong>${data.size_formatted}</strong>
        </div>`;
    }

    downloadHtml = `
    <div class="result-actions">
      <a class="btn btn-primary" href="/api/download/${encodeURIComponent(data.filename)}" download>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        下载结果
      </a>
    </div>`;

    resultCard.innerHTML = `
    <div class="result-header">
      <div class="result-icon success">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>
      <div>
        <div class="result-title">${actionLabel}完成</div>
      </div>
    </div>
    <div class="result-meta">${statsHtml}</div>
    ${downloadHtml}`;

    resultSection.hidden = false;
    resultSection.scrollIntoView({ behavior: "smooth", block: "center" });
}

function clearResult() {
    elements.resultSection.hidden = true;
    elements.resultCard.innerHTML = "";
}

// ==================== Rotate Modal ====================
function initRotateModal() {
    const { rotateModal } = elements;

    rotateModal.querySelectorAll("[data-angle]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const angle = parseInt(btn.dataset.angle);
            rotateModal.hidden = true;
            handleRotate(angle);
        });
    });

    rotateModal.querySelector(".modal-cancel").addEventListener("click", () => {
        rotateModal.hidden = true;
    });

    rotateModal.addEventListener("click", (e) => {
        if (e.target === rotateModal) rotateModal.hidden = true;
    });
}

function showRotateModal(filename) {
    elements.rotateModal.hidden = false;
    elements.rotateModal.dataset.filename = filename;
}

async function handleRotate(angle) {
    const filename = elements.rotateModal.dataset.filename;
    if (!filename) return;
    await callAPI("/api/rotate", { filename, angle }, `旋转${angle}°`);
}

// ==================== Loading ====================
function showLoading(text) {
    elements.loadingText.textContent = text || "正在处理...";
    elements.loadingOverlay.hidden = false;
}

function hideLoading() {
    elements.loadingOverlay.hidden = true;
}

// ==================== Toast ====================
function showToast(message, type = "info") {
    const { toastContainer } = elements;
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span class="toast-msg">${escHtml(message)}</span>
      <button class="toast-close">&times;</button>`;

    toast.querySelector(".toast-close").addEventListener("click", () => {
        toast.remove();
    });

    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateX(40px)";
        toast.style.transition = "0.3s ease";
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ==================== Utilities ====================
function escHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

// ==================== Keyboard Shortcuts ====================
document.addEventListener("keydown", (e) => {
    // Escape to close modals
    if (e.key === "Escape") {
        elements.rotateModal.hidden = true;
        if (state.mergeMode) toggleMergeMode();
    }
    // Delete/Backspace to remove selected file
    if ((e.key === "Delete" || e.key === "Backspace") && state.selectedFile && !state.mergeMode) {
        if (document.activeElement === document.body) {
            removeFile(state.selectedFile);
        }
    }
});
