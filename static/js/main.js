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
        case "page-sort":
            showPageEditor("sort", filename);
            break;
        case "page-delete":
            showPageEditor("delete", filename);
            break;
        case "watermark":
            showWatermarkModal(filename);
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
    } else if (data.deleted !== undefined) {
        statsHtml += `
        <div class="result-stat">
          <span>已删除:</span><strong style="color:var(--danger)">${data.deleted} 页</strong>
        </div>
        <div class="result-stat">
          <span>保留:</span><strong>${data.kept} 页</strong>
        </div>`;
    } else if (data.text !== undefined) {
        statsHtml += `
        <div class="result-stat">
          <span>水印文字:</span><strong>${escHtml(data.text)}</strong>
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

// ==================== Page Editor Modal ====================
let pageEditorState = {
    mode: "sort", // "sort" | "delete"
    filename: null,
    pages: [], // thumbnail data URLs
    order: [], // current page order (0-based indices)
    deleted: new Set(), // pages marked for deletion
    dragIdx: null,
};

function initPageEditModal() {
    const el = document.getElementById("pageEditModal");

    document.getElementById("pageEditCancel").addEventListener("click", () => {
        el.hidden = true;
    });

    document.getElementById("pageEditConfirm").addEventListener("click", () => {
        el.hidden = true;
        confirmPageEdit();
    });

    el.addEventListener("click", (e) => {
        if (e.target === el) el.hidden = true;
    });

    // Mode toggle buttons
    el.querySelectorAll(".page-mode-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            pageEditorState.mode = btn.dataset.mode;
            el.querySelectorAll(".page-mode-btn").forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");

            const title = document.getElementById("pageEditTitle");
            const hint = document.getElementById("pageEditHint");
            const confirm = document.getElementById("pageEditConfirm");

            if (pageEditorState.mode === "sort") {
                title.textContent = "页面排序";
                hint.textContent = "拖拽缩略图调整页面顺序，拖动后点击确认排序";
                confirm.textContent = "确认排序";
            } else {
                title.textContent = "删除页面";
                hint.textContent = "点击缩略图选中要删除的页面，然后确认删除";
                confirm.textContent = "确认删除";
                confirm.classList.add("btn-danger");
            }
            renderThumbnails();
        });
    });
}

async function showPageEditor(mode, filename) {
    pageEditorState.mode = mode;
    pageEditorState.filename = filename;
    pageEditorState.deleted = new Set();
    pageEditorState.dragIdx = null;

    const el = document.getElementById("pageEditModal");
    const title = document.getElementById("pageEditTitle");
    const hint = document.getElementById("pageEditHint");
    const confirm = document.getElementById("pageEditConfirm");

    if (mode === "sort") {
        title.textContent = "页面排序";
        hint.textContent = "拖拽缩略图调整页面顺序，拖动后点击确认排序";
        confirm.textContent = "确认排序";
        confirm.classList.remove("btn-danger");
        el.querySelector(".page-mode-btn[data-mode='sort']").classList.add("active");
        el.querySelector(".page-mode-btn[data-mode='delete']").classList.remove("active");
    } else {
        title.textContent = "删除页面";
        hint.textContent = "点击缩略图选中要删除的页面，然后确认删除";
        confirm.textContent = "确认删除";
        confirm.classList.add("btn-danger");
        el.querySelector(".page-mode-btn[data-mode='delete']").classList.add("active");
        el.querySelector(".page-mode-btn[data-mode='sort']").classList.remove("active");
    }

    el.hidden = false;
    showLoading("加载缩略图...");

    try {
        const res = await fetch(`/api/thumbnails/${encodeURIComponent(filename)}`);
        const data = await res.json();

        if (data.error) {
            showToast(data.error, "error");
            el.hidden = true;
            return;
        }

        pageEditorState.pages = data.pages;
        pageEditorState.order = data.pages.map((_, i) => i);
        pageEditorState.deleted = new Set();
        renderThumbnails();
    } catch (err) {
        showToast("加载失败: " + err.message, "error");
        el.hidden = true;
    } finally {
        hideLoading();
    }
}

function renderThumbnails() {
    const grid = document.getElementById("pageThumbnailGrid");
    const { pages, order, deleted, mode } = pageEditorState;

    grid.innerHTML = "";

    const displayOrder = mode === "sort" ? order : pages.map((_, i) => i);

    displayOrder.forEach((pageIdx, displayPos) => {
        const item = document.createElement("div");
        item.className = "thumbnail-item";
        item.draggable = mode === "sort";
        item.dataset.idx = pageIdx;

        if (mode === "delete" && deleted.has(pageIdx)) {
            item.classList.add("mark-delete");
        }

        item.innerHTML = `
            <img src="${pages[pageIdx]}" alt="第 ${pageIdx + 1} 页">
            <span class="thumbnail-number">${pageIdx + 1}</span>
            <span class="thumbnail-delete-icon">✕</span>
        `;

        // Click handler
        item.addEventListener("click", (e) => {
            e.stopPropagation();
            if (mode === "delete") {
                if (deleted.has(pageIdx)) {
                    deleted.delete(pageIdx);
                } else {
                    deleted.add(pageIdx);
                }
                renderThumbnails();
            }
        });

        // Drag handlers for sort mode
        if (mode === "sort") {
            item.addEventListener("dragstart", (e) => {
                pageEditorState.dragIdx = pageIdx;
                item.style.opacity = "0.4";
            });
            item.addEventListener("dragend", () => {
                item.style.opacity = "1";
                document.querySelectorAll(".thumbnail-item").forEach((t) => t.classList.remove("drag-over"));
            });
            item.addEventListener("dragover", (e) => {
                e.preventDefault();
                item.classList.add("drag-over");
            });
            item.addEventListener("dragleave", () => {
                item.classList.remove("drag-over");
            });
            item.addEventListener("drop", (e) => {
                e.preventDefault();
                item.classList.remove("drag-over");
                const targetIdx = parseInt(item.dataset.idx);
                const srcIdx = pageEditorState.dragIdx;
                if (srcIdx !== null && srcIdx !== targetIdx) {
                    const srcPos = order.indexOf(srcIdx);
                    const tgtPos = order.indexOf(targetIdx);
                    order.splice(srcPos, 1);
                    order.splice(tgtPos, 0, srcIdx);
                    pageEditorState.dragIdx = null;
                    renderThumbnails();
                }
            });
        }

        grid.appendChild(item);
    });
}

async function confirmPageEdit() {
    const { mode, filename, order, deleted } = pageEditorState;
    const el = document.getElementById("pageEditModal");

    if (mode === "sort") {
        const origOrder = pageEditorState.pages.map((_, i) => i);
        if (JSON.stringify(order) === JSON.stringify(origOrder)) {
            showToast("页面顺序未改变", "warning");
            return;
        }
        await callAPI("/api/reorder", { filename, order }, "页面排序");
    } else if (mode === "delete") {
        if (deleted.size === 0) {
            showToast("未选择要删除的页面", "warning");
            return;
        }
        if (deleted.size >= pageEditorState.pages.length) {
            showToast("不能删除所有页面", "warning");
            return;
        }
        const keep = pageEditorState.pages
            .map((_, i) => i)
            .filter((i) => !deleted.has(i));
        await callAPI("/api/delete-pages", { filename, keep }, "删除页面");
    }

    el.hidden = true;
}

// ==================== Watermark Modal ====================
function initWatermarkModal() {
    const el = document.getElementById("watermarkModal");

    // Cancel
    el.querySelector(".modal-cancel").addEventListener("click", () => {
        el.hidden = true;
    });
    el.addEventListener("click", (e) => {
        if (e.target === el) el.hidden = true;
    });

    // Opacity slider
    const opacitySlider = document.getElementById("watermarkOpacity");
    opacitySlider.addEventListener("input", () => {
        document.getElementById("opacityVal").textContent = opacitySlider.value + "%";
    });

    // Font size slider
    const fontSizeSlider = document.getElementById("watermarkFontSize");
    fontSizeSlider.addEventListener("input", () => {
        document.getElementById("fontSizeVal").textContent = fontSizeSlider.value;
    });

    // Rotation slider
    const rotationSlider = document.getElementById("watermarkRotation");
    rotationSlider.addEventListener("input", () => {
        document.getElementById("rotateVal").textContent = rotationSlider.value + "°";
    });

    // Spacing slider
    const spacingSlider = document.getElementById("watermarkSpacing");
    const spacingLabels = ["极密", "较密", "适中", "较疏", "稀疏", "极疏"];
    spacingSlider.addEventListener("input", () => {
        document.getElementById("spacingVal").textContent = spacingLabels[spacingSlider.value - 1];
    });

    // Color dots
    document.querySelectorAll("#colorOptions .color-dot").forEach((dot) => {
        dot.addEventListener("click", () => {
            document.querySelectorAll("#colorOptions .color-dot").forEach((d) => d.classList.remove("selected"));
            dot.classList.add("selected");
        });
    });

    // Apply
    document.getElementById("watermarkApply").addEventListener("click", async () => {
        await applyWatermark();
        el.hidden = true;
    });
}

function showWatermarkModal(filename) {
    document.getElementById("watermarkText").value = "";
    document.getElementById("watermarkOpacity").value = 20;
    document.getElementById("opacityVal").textContent = "20%";
    document.getElementById("watermarkFontSize").value = 60;
    document.getElementById("fontSizeVal").textContent = "60";
    document.getElementById("watermarkRotation").value = 0;
    document.getElementById("rotateVal").textContent = "0°";
    document.getElementById("watermarkSpacing").value = 3;
    document.getElementById("spacingVal").textContent = "适中";
    document.querySelectorAll("#colorOptions .color-dot").forEach((d) => d.classList.remove("selected"));
    document.querySelector("#colorOptions .color-dot[data-color='#cccccc']").classList.add("selected");

    document.getElementById("watermarkModal").hidden = false;
    document.getElementById("watermarkModal").dataset.filename = filename;
}

async function applyWatermark() {
    const modal = document.getElementById("watermarkModal");
    const filename = modal.dataset.filename;

    const text = document.getElementById("watermarkText").value.trim();
    if (!text) {
        showToast("请输入水印文字", "warning");
        return;
    }

    const opacity = parseInt(document.getElementById("watermarkOpacity").value) / 100;
    const fontSize = parseInt(document.getElementById("watermarkFontSize").value);
    const color = document.querySelector("#colorOptions .color-dot.selected").dataset.color;
    const rotation = parseInt(document.getElementById("watermarkRotation").value);
    const spacing = parseInt(document.getElementById("watermarkSpacing").value);

    await callAPI(
        "/api/watermark",
        { filename, text, opacity, fontSize, color, rotation, spacing },
        "添加水印"
    );
}

// Add init calls
document.addEventListener("DOMContentLoaded", () => {
    initPageEditModal();
    initWatermarkModal();
});

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
        document.getElementById("pageEditModal").hidden = true;
        document.getElementById("watermarkModal").hidden = true;
        if (state.mergeMode) toggleMergeMode();
    }
    // Delete/Backspace to remove selected file
    if ((e.key === "Delete" || e.key === "Backspace") && state.selectedFile && !state.mergeMode) {
        if (document.activeElement === document.body) {
            removeFile(state.selectedFile);
        }
    }
});
