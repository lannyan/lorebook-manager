import { getContext } from '../../../extensions.js';
import { event_types, eventSource } from '../../../../script.js';
import { getCharaFilename } from '../../../utils.js';
import {
    world_info,
    world_names,
    selected_world_info
} from '../../../world-info.js';

const CONFIG = {
    id: 'enhanced-wb-panel-v6',
    btnId: 'wb-menu-btn-v6',
    settingsKey: 'WorldbookEditor_Metadata',
    colors: {
        accent: '#7c5cbd',
    }
};

const STATE = {
    currentView: 'editor', // 'editor' | 'binding' | 'manage'
    currentBookName: null,
    isInitialized: false,
    isManageDirty: true,

    // 數據緩存
    entries: [],
    allBookNames: [],
    metadata: {},
    boundBooksSet: {},

    bindings: {
        char: { primary: null, additional: [] },
        global: [],
        chat: null
    },

    debouncer: null,

    // === 新增：標籤系統 ===
    selectedTags: new Set(),  // 當前選中的篩選標籤
    allTags: new Set()         // 所有可用標籤
};

// ST 原生位置枚舉
const WI_POSITION_MAP = {
    0: 'before_character_definition',
    1: 'after_character_definition',
    2: 'before_author_note',
    3: 'after_author_note',
    4: 'at_depth',
    5: 'before_example_messages',
    6: 'after_example_messages'
};

const WI_POSITION_MAP_REV = Object.fromEntries(
    Object.entries(WI_POSITION_MAP).map(([k, v]) => [v, parseInt(k)])
);

/**
 * [兼容性 Polyfill] 更新角色主要世界書
 */
async function charUpdatePrimaryWorld(name) {
    const context = getContext();
    const charId = context.characterId;
    if (charId === undefined || charId === null) return;

    const character = context.characters[charId];
    if (!character) return;

    // 更新內存中的角色數據
    if (!character.data.extensions) character.data.extensions = {};
    character.data.extensions.world = name;

    // 同步更新主界面 UI
    const uiSelect = document.getElementById('character_world');
    if (uiSelect) {
        uiSelect.value = name;
        uiSelect.dispatchEvent(new Event('change'));
    }

    // 更新按鈕狀態
    const setWorldBtn = document.getElementById('set_character_world');
    if (setWorldBtn) {
        if (name) setWorldBtn.classList.add('world_set');
        else setWorldBtn.classList.remove('world_set');
    }

    // 保存
    if (context.saveCharacterDebounced) {
        context.saveCharacterDebounced();
    }
}

/**
 * [兼容性 Polyfill] 設置角色輔助世界書列表
 */
function charSetAuxWorlds(fileName, books) {
    const context = getContext();

    if (!world_info.charLore) world_info.charLore = [];

    const idx = world_info.charLore.findIndex(e => e.name === fileName);

    if (books.length === 0) {
        if (idx !== -1) world_info.charLore.splice(idx, 1);
    } else if (idx === -1) {
        world_info.charLore.push({ name: fileName, extraBooks: books });
    } else {
        world_info.charLore[idx].extraBooks = books;
    }

    if (context.saveSettingsDebounced) {
        context.saveSettingsDebounced();
    }
}

/**
 * 處理不同類型的世界書綁定
 * @param {string} type - 綁定類型: 'primary'(主要), 'auxiliary'(附加), 'chat'(聊天), 'global'(全局)
 * @param {string} worldName - 世界書名稱
 * @param {boolean} isEnabled - 是綁定(true)還是解綁(false)
 */
async function setCharBindings(type, worldName, isEnabled) {
    const context = getContext();

    // 1. 主要世界書 (Primary)
    if (type === 'primary') {
        const targetName = isEnabled ? worldName : '';
        await charUpdatePrimaryWorld(targetName);
        return;
    }

    // 2. 附加世界書 (Auxiliary)
    if (type === 'auxiliary') {
        const charId = context.characterId;
        if (!charId && charId !== 0) return;

        const charAvatar = context.characters[charId].avatar;
        const charFileName = getCharaFilename(null, { manualAvatarKey: charAvatar });

        const charLoreEntry = world_info.charLore?.find(e => e.name === charFileName);
        let currentBooks = charLoreEntry ? [...charLoreEntry.extraBooks] : [];

        if (isEnabled) {
            if (!currentBooks.includes(worldName)) {
                currentBooks.push(worldName);
            }
        } else {
            currentBooks = currentBooks.filter(name => name !== worldName);
        }

        charSetAuxWorlds(charFileName, currentBooks);
        return;
    }

    // 3. 聊天世界書 (Chat)
    if (type === 'chat') {
        if (isEnabled) {
            context.chatMetadata['world_info'] = worldName;
        } else {
            if (context.chatMetadata['world_info'] === worldName) {
                delete context.chatMetadata['world_info'];
            }
        }
        context.saveMetadataDebounced();
        return;
    }

    // 4. 全局世界書 (Global)
    if (type === 'global') {
        const command = isEnabled
            ? `/world silent=true "${worldName}"`
            : `/world state=off silent=true "${worldName}"`;

        await context.executeSlashCommands(command);
        return;
    }

    console.warn(`未知的綁定類型: ${type}`);
}

const API = {
    // === 讀取類 ===
    async getAllBookNames() {
        // 使用擴展運算符創建副本，防止污染 ST 核心變量
        return [...(world_names || [])].sort((a, b) => a.localeCompare(b));
    },

    async getCharBindings() {
        const context = getContext();
        const charId = context.characterId;
        if (charId === undefined || charId === null) {
            return { primary: null, additional: [] };
        }

        const character = context.characters[charId];
        if (!character) return { primary: null, additional: [] };

        // 獲取 Primary
        const primary = character.data?.extensions?.world || null;

        // 獲取 Auxiliary
        let additional = [];
        const fileName = character.avatar.replace(/\.[^/.]+$/, "");

        const charLore = world_info.charLore || [];
        const entry = charLore.find(e => e.name === fileName);
        if (entry && Array.isArray(entry.extraBooks)) {
            additional = [...entry.extraBooks];
        }

        return { primary, additional };
    },

    async getGlobalBindings() {
        return [...(selected_world_info || [])];
    },

    async getChatBinding() {
        const context = getContext();
        return context.chatMetadata?.world_info || null;
    },

    async loadBook(name) {
        const data = await getContext().loadWorldInfo(name);
        if (!data) throw new Error(`找不到世界書 ${name}`);

        // 深拷貝確保隔離 ST 緩存
        const safeEntries = data.entries ? structuredClone(data.entries) : {};
        const entries = Object.values(safeEntries);

        return entries.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    },

    // === 寫入/操作類 ===
    async saveBookEntries(name, entriesArray) {
        if (!name || !Array.isArray(entriesArray)) {
            console.warn("[世界書] 保存中止：無效的名稱或條目。");
            return;
        }

        const oldData = await getContext().loadWorldInfo(name) || { entries: {} };
        const newEntriesObj = {};

        entriesArray.forEach(entry => {
            const uid = entry.uid;
            const oldEntry = (oldData.entries && oldData.entries[uid]) ? oldData.entries[uid] : {};
            const safeEntry = structuredClone(entry);

            newEntriesObj[uid] = {
                ...oldEntry,
                ...safeEntry
            };
        });

        const newData = { ...oldData, entries: newEntriesObj };
        await getContext().saveWorldInfo(name, newData, false);
    },

    async createEntry(name, newEntriesArray) {
        const currentEntries = await this.loadBook(name);
        const combined = [...newEntriesArray, ...currentEntries];
        await this.saveBookEntries(name, combined);
    },

    async deleteEntries(name, uidsToDelete) {
        let currentEntries = await this.loadBook(name);
        currentEntries = currentEntries.filter(e => !uidsToDelete.includes(e.uid));
        await this.saveBookEntries(name, currentEntries);
    },

    // === 輔助查詢 ===
    async getAllBoundBookNames() {
        const context = getContext();
        const characters = context.characters || [];
        const boundMap = {};

        characters.forEach(char => {
            if (!char || !char.data) return;

            const primary = char.data.extensions?.world;

            if (primary) {
                if (!boundMap[primary]) boundMap[primary] = [];
                boundMap[primary].push(char.name);
            }
        });
        return boundMap;
    },

    // === 元數據管理 ===
    getMetadata() {
        const context = getContext();
        return context.extensionSettings[CONFIG.settingsKey] || {};
    },

    async saveMetadata(data) {
        const context = getContext();
        context.extensionSettings[CONFIG.settingsKey] = data;
        context.saveSettingsDebounced();
    },

    // === 世界書管理接口 ===
    async createWorldbook(name) {
        await getContext().saveWorldInfo(name, { entries: {} }, true);
        await getContext().updateWorldInfoList();
    },

    async deleteWorldbook(name) {
        await fetch('/api/worldinfo/delete', {
            method: 'POST',
            headers: getContext().getRequestHeaders(),
            body: JSON.stringify({ name }),
        });
        await getContext().updateWorldInfoList();
    },

    async renameWorldbook(oldName, newName) {
        const data = await getContext().loadWorldInfo(oldName);
        if (!data) return;

        // 創建新文件
        await getContext().saveWorldInfo(newName, data, true);

        // 遷移綁定關係
        try {
            const { primary, additional } = await this.getCharBindings();
            if (primary === oldName) {
                await setCharBindings('primary', newName, true);
            }

            if (additional.includes(oldName)) {
                await setCharBindings('auxiliary', oldName, false);
                await setCharBindings('auxiliary', newName, true);
            }

            const globalBindings = await this.getGlobalBindings();
            if (globalBindings.includes(oldName)) {
                await setCharBindings('global', oldName, false);
                await setCharBindings('global', newName, true);
            }

            const chatBinding = await this.getChatBinding();
            if (chatBinding === oldName) {
                await setCharBindings('chat', newName, true);
            }
        } catch (e) {
            console.error("綁定遷移失敗:", e);
            toastr.warning("重新命名成功，但在遷移綁定關係時遇到錯誤");
        }

        // 刪除舊文件
        await this.deleteWorldbook(oldName);
    }
};

const Actions = {
    // === [安全機制] 強制刷寫掛起的保存任務 ===
    async flushPendingSave() {
        if (STATE.debouncer) {
            clearTimeout(STATE.debouncer);
            STATE.debouncer = null;

            if (STATE.currentBookName && Array.isArray(STATE.entries)) {
                await API.saveBookEntries(STATE.currentBookName, STATE.entries);
            }
        }
    },

    // === 核心排序算法 ===
    getEntrySortScore(entry) {
        const context = getContext();
        const anDepth = (context.chatMetadata?.note_depth)
            ?? (context.extensionSettings?.note?.defaultDepth)
            ?? 4;

        const pos = typeof entry.position === 'number' ? entry.position : 1;

        // 靜態位置 - 永遠置頂
        if (pos === 0) return 100000; // Before Char
        if (pos === 1) return 90000;  // After Char
        if (pos === 5) return 80000;  // Before Example
        if (pos === 6) return 70000;  // After Example

        // 動態深度位置
        if (pos === 4) return entry.depth ?? 4;

        // 作者註釋相關
        if (pos === 2) return anDepth + 0.6;  // Before AN
        if (pos === 3) return anDepth + 0.4;  // After AN

        return -9999;
    },

    async init() {
        if (STATE.isInitialized) return;

        UI.initTooltips();
        this.registerCharDeleteListener();

        const es = eventSource;
        const et = event_types;

        // 監聽設置變更
        es.on(et.SETTINGS_UPDATED, () => {
            if (document.getElementById(CONFIG.id)) this.refreshAllContext();
        });

        // 監聽世界書數據變更
        es.on(et.WORLDINFO_UPDATED, (name, data) => {
            if (STATE.currentBookName === name) this.loadBook(name);
        });

        // 監聽聊天變更
        es.on(et.CHAT_CHANGED, () => {
            if (document.getElementById(CONFIG.id)) this.refreshAllContext();
        });

        // 監聽角色選擇變更
        es.on(et.CHARACTER_SELECTED, () => {
            setTimeout(() => {
                if (document.getElementById(CONFIG.id)) this.refreshAllContext();
                else this.refreshAllContext();
            }, 100);
        });

        // 監聽角色編輯
        es.on(et.CHARACTER_EDITED, () => {
            if (document.getElementById(CONFIG.id)) this.refreshAllContext();
        });

        STATE.isInitialized = true;
        await this.refreshAllContext();

        console.log("[世界書編輯器] 初始化完成 (閒置模式)。");
    },

    async refreshAllContext() {
        try {
            const [all, char, glob, chat, boundSet] = await Promise.all([
                API.getAllBookNames(),
                API.getCharBindings(),
                API.getGlobalBindings(),
                API.getChatBinding(),
                API.getAllBoundBookNames()
            ]);

            STATE.allBookNames = all.sort((a, b) => a.localeCompare(b));
            STATE.bindings.char = char;
            STATE.bindings.global = glob;
            STATE.bindings.chat = chat;
            STATE.boundBooksSet = boundSet;
            STATE.metadata = API.getMetadata();

            // === 新增：刷新標籤集合 ===
            this.refreshAllTags();

            UI.renderBookSelector();
        } catch (e) {
            console.error("刷新上下文失敗:", e);
        }
    },

    // === 新增：標籤管理方法 ===
    refreshAllTags() {
        const allTags = new Set();
        Object.values(STATE.metadata).forEach(meta => {
            if (meta.tags && Array.isArray(meta.tags)) {
                meta.tags.forEach(tag => allTags.add(tag));
            }
        });
        STATE.allTags = allTags;
    },

    async updateTags(bookName, tags) {
        await this.updateMeta(bookName, (meta) => {
            meta.tags = tags || [];
        });
        this.refreshAllTags();
        UI.renderManageView();
    },

    toggleTagFilter(tag) {
        if (STATE.selectedTags.has(tag)) {
            STATE.selectedTags.delete(tag);
        } else {
            STATE.selectedTags.add(tag);
        }
        UI.renderManageView();
    },

    clearTagFilters() {
        STATE.selectedTags.clear();
        UI.renderManageView();
    },

    switchView(viewName) {
        // 立即更新視覺層
        UI.updateGlider(viewName);
        document.querySelectorAll('.wb-tab').forEach(el => {
            el.classList.toggle('active', el.dataset.tab === viewName);
        });

        // 延遲執行邏輯層
        setTimeout(() => {
            STATE.currentView = viewName;

            document.querySelectorAll('.wb-view-section').forEach(el => el.classList.add('wb-hidden'));
            const targetView = document.getElementById(`wb-view-${viewName}`);
            if (targetView) targetView.classList.remove('wb-hidden');

            if (viewName === 'binding') {
                UI.renderBindingView();
            } else if (viewName === 'manage') {
                if (STATE.isManageDirty) {
                    UI.renderManageView();
                    STATE.isManageDirty = false;
                }
            } else if (viewName === 'editor') {
                if (STATE.currentBookName && !STATE.allBookNames.includes(STATE.currentBookName)) {
                    STATE.currentBookName = null;
                    STATE.entries = [];
                    UI.renderList();
                }
                UI.renderBookSelector();
                UI.updateHeaderInfo();
            }
        }, 10);
    },

    async loadBook(name) {
        if (!name) return;

        await this.flushPendingSave();

        STATE.currentBookName = name;

        try {
            const loadedEntries = await API.loadBook(name);

            // 防止競態條件
            if (STATE.currentBookName !== name) {
                console.warn(`[世界書] 已取消載入 ${name}，因為上下文已切換至 ${STATE.currentBookName}`);
                return;
            }

            STATE.entries = loadedEntries;

            // 自動排序
            STATE.entries.sort((a, b) => {
                const scoreA = this.getEntrySortScore(a);
                const scoreB = this.getEntrySortScore(b);
                if (scoreA !== scoreB) return scoreB - scoreA;
                return (a.order ?? 0) - (b.order ?? 0) || a.uid - b.uid;
            });

            UI.updateHeaderInfo();
            UI.renderList();

            const selector = document.getElementById('wb-book-selector');
            if (selector) selector.value = name;
        } catch (e) {
            if (STATE.currentBookName === name) {
                console.error("載入世界書失敗", e);
                toastr.error(`無法載入世界書「${name}」`);
            }
        }
    },

    updateEntry(uid, updater) {
        const entry = STATE.entries.find(e => e.uid === uid);
        if (!entry) return;

        updater(entry);

        UI.updateCardStatus(uid);
        UI.renderGlobalStats();

        if (STATE.debouncer) clearTimeout(STATE.debouncer);

        // 閉包雙重快照
        const targetBookName = STATE.currentBookName;
        const targetEntries = STATE.entries;

        STATE.debouncer = setTimeout(() => {
            STATE.debouncer = null;
            if (targetBookName && targetEntries) {
                API.saveBookEntries(targetBookName, targetEntries);
            }
        }, 300);
    },
    
    async addNewEntry() {
        if (!STATE.currentBookName) return toastr.warning("請先選擇一本世界書");

        const maxUid = STATE.entries.reduce((max, e) => Math.max(max, Number(e.uid) || 0), -1);
        const newUid = maxUid + 1;

        const newEntry = {
            uid: newUid,
            comment: '新建條目',
            disable: false,
            content: '',
            constant: false,
            key: [],
            order: 0,
            position: 0,
            depth: 4,
            probability: 100,
            selective: true,
        };
        await API.createEntry(STATE.currentBookName, [newEntry]);
        await this.loadBook(STATE.currentBookName);
    },

    async deleteEntry(uid) {
        if (!confirm("確定要刪除此條目嗎？")) return;
        await API.deleteEntries(STATE.currentBookName, [uid]);
        await this.loadBook(STATE.currentBookName);
    },

    sortByPriority() {
        STATE.entries.sort((a, b) => {
            const scoreA = this.getEntrySortScore(a);
            const scoreB = this.getEntrySortScore(b);

            if (scoreA !== scoreB) return scoreB - scoreA;

            const orderA = a.order ?? 0;
            const orderB = b.order ?? 0;
            if (orderA !== orderB) return orderA - orderB;

            return a.uid - b.uid;
        });

        UI.renderList();
        API.saveBookEntries(STATE.currentBookName, STATE.entries);

        toastr.success(`已重新按上下文邏輯重排`);
    },

    async saveBindings() {
        const view = document.getElementById('wb-view-binding');
        const charPrimary = view.querySelector('#wb-bind-char-primary').value;
        const charAddTags = view.querySelectorAll('.wb-ms-tag[data-bind-type="wb-bind-char-add"]');
        const charAdditional = Array.from(charAddTags).map(el => el.dataset.val);
        const globalTags = view.querySelectorAll('.wb-ms-tag[data-bind-type="wb-bind-global"]');
        const globalBooks = Array.from(globalTags).map(el => el.dataset.val);
        const chatBook = view.querySelector('#wb-bind-chat').value;

        try {
            await setCharBindings('primary', charPrimary || '', !!charPrimary);

            const context = getContext();
            const charId = context.characterId;
            if (charId || charId === 0) {
                const charAvatar = context.characters[charId]?.avatar;
                const charFileName = getCharaFilename(null, { manualAvatarKey: charAvatar });
                charSetAuxWorlds(charFileName, charAdditional);
            }

            const currentGlobal = await API.getGlobalBindings(); 

            const toRemove = currentGlobal.filter(b => !globalBooks.includes(b));
            const toAdd = globalBooks.filter(b => !currentGlobal.includes(b));

            for (const book of toRemove) {
                await setCharBindings('global', book, false);
            }
            for (const book of toAdd) {
                await setCharBindings('global', book, true);
            }

            await setCharBindings('chat', chatBook || '', !!chatBook);

            await this.refreshAllContext();
            toastr.success("綁定設定已儲存");
        } catch (e) {
            console.error(e);
            toastr.error('儲存失敗: ' + e.message);
        }
    },

    // === 輔助方法 ===
    getTokenCount(text) {
        if (!text) return 0;
        try {
            const ctx = getContext();
            if (ctx.getTokenCount) return ctx.getTokenCount(text);
        } catch (e) {}
        return Math.ceil(text.length / 3);
    },
    
    getExistingGroups() {
        const groups = new Set();
        Object.values(STATE.metadata).forEach(m => {
            if (m.group && m.group !== '未分組') groups.add(m.group);
        });
        return Array.from(groups).sort();
    },

    async reorderEntry(fromIndex, toIndex) {
        if (fromIndex === toIndex) return;
        const [item] = STATE.entries.splice(fromIndex, 1);
        STATE.entries.splice(toIndex, 0, item);
        UI.renderList();
        await API.saveBookEntries(STATE.currentBookName, STATE.entries);
    },

    // === Meta & Manage ===
    async updateMeta(bookName, updater) {
        if (!STATE.metadata[bookName]) {
            STATE.metadata[bookName] = { group: '', note: '', tags: [] };
        }
        updater(STATE.metadata[bookName]);
        await API.saveMetadata(STATE.metadata);
    },

    async setBookGroup(bookName, groupName) {
        await this.updateMeta(bookName, (meta) => { meta.group = groupName; });
        UI.renderManageView();
    },

    updateNote(bookName, note) {
        this.updateMeta(bookName, (meta) => { meta.note = note; });
    },

    async togglePin(bookName) {
        await this.updateMeta(bookName, (meta) => { meta.pinned = !meta.pinned; });
        UI.renderManageView();
    },

    async deleteBookDirectly(bookName) {
        if (!confirm(`確定要永久刪除世界書「${bookName}」嗎？`)) return;
        try {
            if (STATE.currentBookName === bookName && STATE.debouncer) {
                clearTimeout(STATE.debouncer);
                STATE.debouncer = null;
            }

            await API.deleteWorldbook(bookName);
            if (STATE.currentBookName === bookName) {
                STATE.currentBookName = null;
                STATE.entries = [];
            }
            await this.refreshAllContext();

            STATE.isManageDirty = true;
            UI.renderManageView();
        } catch (e) {
            toastr.error("刪除失敗: " + e.message);
        }
    },

    async jumpToEditor(bookName) {
        await this.loadBook(bookName);
        this.switchView('editor');
    },

    async toggleBindState(bookName, targetCharName, isUnbind) {
        const context = getContext();
        const currentChar = context.characters[context.characterId]?.name;

        if (isUnbind) {
            if (!confirm(`確定要解除世界書「${bookName}」與角色「${targetCharName}」的綁定嗎？`)) return;
            try {
                if (currentChar === targetCharName) {
                    await setCharBindings('primary', bookName, false);
                }
                await this.refreshAllContext();
                STATE.isManageDirty = true;
                UI.renderManageView();
            } catch (e) {
                toastr.error("解綁失敗: " + e.message);
            }
        } else {
            if (!currentChar) return toastr.warning("目前沒有載入任何角色，無法綁定。");
            if (!confirm(`確定要將世界書「${bookName}」綁定為目前角色「${currentChar}」的主要世界書嗎？`)) return;
            try {
                await setCharBindings('primary', bookName, true);
                await this.refreshAllContext();
                STATE.isManageDirty = true;

                if (bookName) {
                    await this.loadBook(bookName);
                }
                UI.renderManageView();
            } catch (e) {
                toastr.error("綁定失敗: " + e.message);
            }
        }
    },
    // === Actions 方法（續） ===

    async actionImport() {
        document.getElementById('wb-import-file').click();
    },

    async actionHandleImport(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const content = JSON.parse(e.target.result);
                let entries = content.entries ? Object.values(content.entries) : content;
                if (!Array.isArray(entries)) entries = [];

                let bookName = file.name.replace(/\.(json|wb)$/i, '');
                const name = prompt("請輸入匯入後的世界書名稱:", bookName);
                if (!name) return;

                if (STATE.allBookNames.includes(name)) {
                    if (!confirm(`世界書「${name}」已存在，是否覆蓋？`)) return;
                }

                if (!STATE.allBookNames.includes(name)) await API.createWorldbook(name);
                await API.saveBookEntries(name, entries);

                toastr.success(`匯入成功: ${name}`);
                await this.refreshAllContext();
                await this.loadBook(name);
            } catch (err) {
                console.error(err);
                toastr.error("匯入失敗: " + err.message);
            }
        };
        reader.readAsText(file);
    },

    async actionExport() {
        if (!STATE.currentBookName) return toastr.warning("請先選擇一本世界書");
        try {
            const entries = await API.loadBook(STATE.currentBookName);
            const entriesObj = {};
            entries.forEach(entry => {
                entriesObj[entry.uid] = entry;
            });
            const exportData = { entries: entriesObj };
            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${STATE.currentBookName}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            toastr.error("匯出失敗: " + e.message);
        }
    },

    async actionExportTxt() {
        if (!STATE.currentBookName) return toastr.warning("請先選擇一本世界書");

        const overlay = document.createElement('div');
        overlay.className = 'wb-sort-modal-overlay';
        overlay.style.zIndex = '25000';

        overlay.innerHTML = `
            <div class="wb-export-card">
                <div class="wb-export-header">
                    <div class="wb-export-title">匯出世界書為 TXT</div>
                    <div class="wb-export-close">×</div>
                </div>

                <div class="wb-export-section">
                    <div class="wb-export-label">匯出所有條目</div>
                    <div class="wb-export-grid">
                        <button class="wb-export-btn" data-type="all-title">含標題</button>
                        <button class="wb-export-btn" data-type="all-no-title">不含標題</button>
                    </div>
                </div>

                <div class="wb-export-section">
                    <div class="wb-export-label">僅匯出已啟用條目</div>
                    <div class="wb-export-grid">
                        <button class="wb-export-btn" data-type="enabled-title">含標題</button>
                        <button class="wb-export-btn" data-type="enabled-no-title">不含標題</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const processExport = (type) => {
            try {
                let targetEntries = [...STATE.entries];
                if (type.startsWith('enabled')) {
                    targetEntries = targetEntries.filter(e => !e.disable);
                }

                targetEntries.sort((a, b) => {
                    const scoreA = Actions.getEntrySortScore(a);
                    const scoreB = Actions.getEntrySortScore(b);
                    if (scoreA !== scoreB) return scoreB - scoreA;
                    return (a.order ?? 0) - (b.order ?? 0) || a.uid - b.uid;
                });

                if (targetEntries.length === 0) {
                    toastr.warning("沒有符合條件的條目可匯出");
                    return;
                }

                const includeTitle = !type.includes('no-title');
                let txtContent = "";
                targetEntries.forEach(entry => {
                    const title = entry.comment || '無標題條目';
                    const content = entry.content || '';
                    if (includeTitle) txtContent += `#### ${title}\n${content}\n\n`;
                    else txtContent += `${content}\n\n`;
                });

                const scopeName = type.startsWith('enabled') ? '僅啟用' : '所有';
                const formatName = includeTitle ? '含標題' : '無標題';
                const fileName = `${STATE.currentBookName}_${scopeName}_${formatName}.txt`;

                const blob = new Blob([txtContent], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = fileName;
                a.click();
                URL.revokeObjectURL(url);

                toastr.success(`匯出成功: ${fileName}`);
                overlay.remove();
            } catch (e) {
                console.error(e);
                toastr.error("匯出失敗: " + e.message);
            }
        };

        overlay.querySelector('.wb-export-close').onclick = () => overlay.remove();
        overlay.querySelectorAll('.wb-export-btn').forEach(btn => {
            btn.onclick = () => processExport(btn.dataset.type);
        });
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    },

    async actionCreateNew() {
        const name = prompt("請輸入新世界書名稱:");
        if (!name) return;
        if (STATE.allBookNames.includes(name)) return toastr.warning("該名稱已存在");
        try {
            await API.createWorldbook(name);
            await this.refreshAllContext();
            await this.loadBook(name);
        } catch (e) {
            toastr.error("建立失敗: " + e.message);
        }
    },

    async actionDelete() {
        if (!STATE.currentBookName) return;
        if (!confirm(`確定要永久刪除世界書「${STATE.currentBookName}」嗎？`)) return;

        try {
            if (STATE.debouncer) {
                clearTimeout(STATE.debouncer);
                STATE.debouncer = null;
            }

            await API.deleteWorldbook(STATE.currentBookName);
            STATE.currentBookName = null;
            STATE.entries = [];
            await this.refreshAllContext();
            await this.init();
        } catch (e) {
            toastr.error("刪除失敗: " + e.message);
        }
    },

    async actionRename() {
        if (!STATE.currentBookName) return;
        const newName = prompt("重新命名世界書為:", STATE.currentBookName);
        if (!newName || newName === STATE.currentBookName) return;
        if (STATE.allBookNames.includes(newName)) return toastr.warning("目標名稱已存在");

        try {
            await this.flushPendingSave();

            await API.renameWorldbook(STATE.currentBookName, newName);
            await this.refreshAllContext();
            await this.loadBook(newName);
        } catch (e) {
            toastr.error("重新命名失敗: " + e.message);
        }
    },
    
    // === Global Config ===
    getGlobalConfig() {
        const allMeta = API.getMetadata() || {};
        const config = allMeta['__GLOBAL_CONFIG__'] || {};
        if (config.deleteWbWithChar === undefined) config.deleteWbWithChar = true;
        return config;
    },

    async saveGlobalConfig(newConfig) {
        const allMeta = API.getMetadata() || {};
        allMeta['__GLOBAL_CONFIG__'] = { ...allMeta['__GLOBAL_CONFIG__'], ...newConfig };
        await API.saveMetadata(allMeta);
    },
    
    registerCharDeleteListener() {
        const es = eventSource;
        const et = event_types;
        if (!es) return;

        es.on(et.CHARACTER_DELETED, async (data) => {
            const config = this.getGlobalConfig();
            if (!config.deleteWbWithChar) return;

            const charName = data.character?.name || data.name;
            if (!charName) return;

            const map = await API.getAllBoundBookNames();

            let bookName = null;
            for (const [wb, chars] of Object.entries(map)) {
                if (chars.includes(charName)) {
                    bookName = wb;
                    break;
                }
            }

            if (bookName) {
                UI.showDeleteWbConfirmModal(bookName, async () => {
                    await API.deleteWorldbook(bookName);
                }, async () => {
                    await this.saveGlobalConfig({ deleteWbWithChar: false });
                    if (STATE.currentView === 'manage') UI.renderManageView();
                });
            }
        });
    },

    getTokenCount(text) { 
        if (!text) return 0;
        try {
            return getContext().getTokenCount(text);
        } catch(e) { 
            return Math.ceil(text.length / 3); 
        }
    }
};

const UI = {
    // === 滑塊動畫 ===
    updateGlider(tabName) {
        const glider = document.querySelector('.wb-tab-glider');
        const targetTab = document.querySelector(`.wb-tab[data-tab="${tabName}"]`);

        if (glider && targetTab) {
            const width = targetTab.offsetWidth;
            const left = targetTab.offsetLeft;

            glider.style.width = `${width}px`;
            glider.style.transform = `translateX(${left}px)`;
        }
    },

    // === 動態定位核心 ===
    centerDialog(el) {
        if (!el) return;
        const winW = window.innerWidth;
        const winH = window.innerHeight;

        el.style.maxHeight = (winH - 40) + 'px';
        el.style.overflow = 'hidden';

        const elW = el.offsetWidth;
        const elH = el.offsetHeight;

        el.style.left = Math.max(0, (winW - elW) / 2) + 'px';
        el.style.top = Math.max(0, (winH - elH) / 2) + 'px';
        el.style.position = 'fixed';
        el.style.margin = '0';
        el.style.transform = 'none';
    },

    setupModalPositioning(el, overlay) {
        requestAnimationFrame(() => this.centerDialog(el));
        const resizeHandler = () => this.centerDialog(el);
        window.addEventListener('resize', resizeHandler);
        const originalRemove = overlay.remove.bind(overlay);
        overlay.remove = () => {
            window.removeEventListener('resize', resizeHandler);
            originalRemove();
        };
    },

    async open() {
        if (document.getElementById(CONFIG.id)) return;

        const panel = document.createElement('div');
        panel.id = CONFIG.id;
        panel.innerHTML = `
            <div class="wb-header-bar">
                <div class="wb-tabs">
                    <div class="wb-tab-glider"></div>
                    <div class="wb-tab active" data-tab="editor"><i class="fa-solid fa-pen-to-square"></i> 編輯世界書</div>
                    <div class="wb-tab" data-tab="binding"><i class="fa-solid fa-link"></i> 綁定世界書</div>
                    <div class="wb-tab" data-tab="manage"><i class="fa-solid fa-list-check"></i> 管理世界書</div>
                </div>
                <div id="wb-close" class="wb-header-close" title="關閉"><i class="fa-solid fa-xmark"></i></div>
            </div>

            <div class="wb-content">
                <!-- Loading Overlay -->
                <div id="wb-loading-layer" style="position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:100;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px);">
                    <div style="font-size:2em;color:#fff"><i class="fa-solid fa-circle-notch fa-spin"></i></div>
                </div>

                <!-- 視圖 1: 編輯器 -->
                <div id="wb-view-editor" class="wb-view-section">
                    <div class="wb-book-bar">
                        <select id="wb-book-selector" style="flex:1;">
                            <option>載入中...</option>
                        </select>
                        <div class="wb-menu-wrapper">
                            <button class="wb-btn-circle" title="分析與統計" id="btn-wb-analysis">
                                <i class="fa-solid fa-coins"></i>
                            </button>
                            <div class="wb-menu-dropdown" id="wb-analysis-menu">
                                <div class="wb-menu-item" data-type="stats"><i class="fa-solid fa-chart-pie"></i> 世界書統計與分析</div>
                                <div class="wb-menu-item" data-type="context"><i class="fa-solid fa-align-left"></i> 世界書實際上下文</div>
                                <div class="wb-menu-item" data-type="export_txt"><i class="fa-solid fa-file-lines"></i> 匯出世界書為 TXT</div>
                            </div>
                        </div>
                        <div class="wb-menu-wrapper">
                            <button class="wb-btn-circle" title="更多操作" id="btn-wb-menu-trigger">
                                <i class="fa-solid fa-magic-wand-sparkles interactable"></i>
                            </button>
                            <div class="wb-menu-dropdown" id="wb-main-menu">
                                <div class="wb-menu-item" data-action="import"><i class="fa-solid fa-file-import"></i> 匯入世界書</div>
                                <div class="wb-menu-item" data-action="export"><i class="fa-solid fa-file-export"></i> 匯出世界書</div>
                                <div class="wb-menu-item" data-action="create"><i class="fa-solid fa-plus"></i> 新建世界書</div>
                                <div class="wb-menu-item" data-action="rename"><i class="fa-solid fa-pen"></i> 重新命名世界書</div>
                                <div class="wb-menu-item danger" data-action="delete"><i class="fa-solid fa-trash"></i> 刪除世界書</div>
                            </div>
                        </div>
                        <input type="file" id="wb-import-file" accept=".json,.wb" style="display:none">
                    </div>
                    <div class="wb-stat-line">
                        <div class="wb-stat-group">
                            <div id="wb-warning-stat" class="wb-warning-badge hidden" title="點擊查看問題條目">
                                <i class="fa-solid fa-circle-exclamation"></i> <span id="wb-warning-count">0</span>
                            </div>
                            <div class="wb-stat-item" id="wb-display-count">0 條目</div>
                        </div>
                    </div>
                    <div class="wb-tool-bar">
                        <input class="wb-input-dark" id="wb-search-entry" style="flex:1; width:100%; border-radius:15px; padding-left:15px;" placeholder="搜尋條目...">
                        <button class="wb-btn-circle interactable" id="btn-group-sort" title="分組排序管理">
                            <i class="fa-solid fa-arrow-down-9-1"></i>
                        </button>
                        <button class="wb-btn-circle" id="btn-sort-priority" title="列表按優先級重排"><i class="fa-solid fa-filter"></i></button>
                        <button class="wb-btn-circle" id="btn-add-entry" title="新建條目"><i class="fa-solid fa-plus"></i></button>
                    </div>
                    <div class="wb-list" id="wb-entry-list"></div>
                </div>

                <!-- 視圖 2: 綁定管理 -->
                <div id="wb-view-binding" class="wb-view-section wb-hidden">
                    <div class="wb-bind-grid">
                        <div class="wb-bind-card">
                            <div class="wb-bind-title"><span><i class="fa-solid fa-user-tag"></i> 角色世界書</span></div>
                            <div class="wb-bind-label">主要世界書</div>
                            <div style="position:relative"><select id="wb-bind-char-primary" style="width:100%"></select></div>
                            <div class="wb-bind-label">附加世界書</div>
                            <div class="wb-scroll-list" id="wb-bind-char-list"></div>
                        </div>
                        <div class="wb-bind-card">
                            <div class="wb-bind-title"><span><i class="fa-solid fa-globe"></i> 全域世界書</span></div>
                            <div class="wb-scroll-list" id="wb-bind-global-list"></div>
                        </div>
                        <div class="wb-bind-card">
                            <div class="wb-bind-title"><span><i class="fa-solid fa-comments"></i> 聊天世界書</span></div>
                            <div style="position:relative"><select id="wb-bind-chat" style="width:100%"></select></div>
                        </div>
                    </div>
                    <div id="wb-footer-info" class="wb-footer-info"></div>
                </div>

                <!-- 視圖 3: 管理 -->
                <div id="wb-view-manage" class="wb-view-section wb-hidden">
                    <div class="wb-manage-container">
                        <div class="wb-tool-bar">
                            <input class="wb-input-dark" id="wb-manage-search" style="width:100%;border-radius:15px;padding-left:15px" placeholder="🔍 搜尋世界書名稱或備註...">
                        </div>
                        <div class="wb-manage-content" id="wb-manage-content"></div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(panel);

        const $ = (sel) => panel.querySelector(sel);
        const $$ = (sel) => panel.querySelectorAll(sel);

        $('#wb-close').onclick = () => panel.remove();
        $$('.wb-tab').forEach(el => el.onclick = () => Actions.switchView(el.dataset.tab));
        $('#wb-book-selector').addEventListener('change', (e) => Actions.loadBook(e.target.value));
        $('#wb-search-entry').oninput = (e) => UI.renderList(e.target.value);
        $('#btn-add-entry').onclick = () => Actions.addNewEntry();
        $('#btn-group-sort').onclick = () => UI.openSortingModal();
        $('#btn-sort-priority').onclick = () => Actions.sortByPriority();
        
        // 菜單
        const analysisBtn = $('#btn-wb-analysis');
        const analysisMenu = $('#wb-analysis-menu');
        analysisBtn.onclick = (e) => {
            e.stopPropagation();
            const isShow = analysisMenu.classList.contains('show');
            document.querySelectorAll('.wb-menu-dropdown.show').forEach(el => el.classList.remove('show'));
            if (!isShow) analysisMenu.classList.add('show');
        };
        analysisMenu.querySelectorAll('.wb-menu-item').forEach(item => {
            item.onclick = (e) => {
                e.stopPropagation();
                analysisMenu.classList.remove('show');
                const type = item.dataset.type;
                if (type === 'stats') UI.openAnalysisModal();
                else if (type === 'context') UI.openContextPreviewModal();
                else if (type === 'export_txt') Actions.actionExportTxt();
            };
        });

        const menuTrigger = $('#btn-wb-menu-trigger');
        const menuDropdown = $('#wb-main-menu');
        menuTrigger.onclick = (e) => {
            e.stopPropagation();
            const isShow = menuDropdown.classList.contains('show');
            document.querySelectorAll('.wb-menu-dropdown, .wb-gr-dropdown').forEach(el => el.classList.remove('show'));
            if (!isShow) menuDropdown.classList.add('show');
        };
        menuDropdown.querySelectorAll('.wb-menu-item').forEach(item => {
            item.onclick = async (e) => {
                e.stopPropagation();
                menuDropdown.classList.remove('show');
                const action = item.dataset.action;
                if (action === 'import') Actions.actionImport();
                else if (action === 'export') Actions.actionExport();
                else if (action === 'create') Actions.actionCreateNew();
                else if (action === 'rename') Actions.actionRename();
                else if (action === 'delete') Actions.actionDelete();
            };
        });

        document.addEventListener('click', (e) => {
            if (menuDropdown.classList.contains('show') && !menuTrigger.contains(e.target) && !menuDropdown.contains(e.target)) menuDropdown.classList.remove('show');
            if (analysisMenu.classList.contains('show') && !analysisBtn.contains(e.target) && !analysisMenu.contains(e.target)) analysisMenu.classList.remove('show');
        });

        const fileInput = $('#wb-import-file');
        fileInput.onchange = (e) => {
            if (e.target.files.length > 0) {
                Actions.actionHandleImport(e.target.files[0]);
                fileInput.value = '';
            }
        };

        $('#wb-entry-list').addEventListener('wb-reorder', (e) => Actions.reorderEntry(e.detail.from, e.detail.to));
        $('#wb-manage-search').oninput = (e) => UI.renderManageView(e.target.value);

        const loader = document.getElementById('wb-loading-layer');

        try {
            await Actions.refreshAllContext();

            STATE.isManageDirty = true;

            // 智能選書邏輯
            const charPrimary = STATE.bindings.char.primary;
            const chatBook = STATE.bindings.chat;
            let targetBook = null;

            if (charPrimary && STATE.allBookNames.includes(charPrimary)) {
                targetBook = charPrimary;
            } else if (chatBook && STATE.allBookNames.includes(chatBook)) {
                targetBook = chatBook;
            } else if (STATE.allBookNames.length > 0) {
                targetBook = STATE.allBookNames[0];
            }

            UI.renderBookSelector();
            UI.updateHeaderInfo();

            if (targetBook) {
                await Actions.loadBook(targetBook);
            } else {
                UI.renderList();
            }

        } catch (e) {
            console.error("面板初始化錯誤:", e);
            toastr.error("初始化面板數據失敗");
        } finally {
            if (loader) loader.style.display = 'none';
        }

        UI.updateGlider('editor');

        setTimeout(() => {
            const glider = panel.querySelector('.wb-tab-glider');
            if (glider) glider.classList.add('wb-glider-animating');
        }, 50);

        Actions.switchView('editor');
    },

    renderBookSelector() {
        const selector = document.getElementById('wb-book-selector');
        if (!selector) return;
        const { char, global, chat } = STATE.bindings;
        const allNames = STATE.allBookNames;
        const charBooks = new Set([char.primary, ...char.additional].filter(Boolean));
        const globalBooks = new Set(global);
        const chatBook = chat;

        let html = '';

        if (char.primary) {
            html += `<optgroup label="主要世界書">`;
            html += `<option value="${char.primary}">${char.primary}</option>`;
            html += `</optgroup>`;
        }

        const additionalBooks = char.additional.filter(name => name && name !== char.primary);
        if (additionalBooks.length > 0) {
            html += `<optgroup label="附加世界書">`;
            additionalBooks.forEach(name => html += `<option value="${name}">${name}</option>`);
            html += `</optgroup>`;
        }

        if (globalBooks.size > 0) {
            html += `<optgroup label="全域啟用">`;
            globalBooks.forEach(name => html += `<option value="${name}">${name}</option>`);
            html += `</optgroup>`;
        }

        if (chatBook) {
            html += `<optgroup label="目前聊天"><option value="${chatBook}">${chatBook}</option></optgroup>`;
        }
        
        html += `<optgroup label="其他">`;
        allNames.forEach(name => html += `<option value="${name}">${name}</option>`);
        html += `</optgroup>`;

        selector.innerHTML = html;
        if (STATE.currentBookName) selector.value = STATE.currentBookName;
        this.applyCustomDropdown('wb-book-selector');
    },

    renderBindingView() {
        const allNames = STATE.allBookNames;
        const { char, global, chat } = STATE.bindings;
        const view = document.getElementById('wb-view-binding');
        if (!view) return;

        const createOpts = (selectedVal) => {
            let html = '<option value="">(無)</option>';
            allNames.forEach(name => {
                const sel = name === selectedVal ? 'selected' : '';
                html += `<option value="${name}" ${sel}>${name}</option>`;
            });
            return html;
        };

        const createMultiSelect = (containerSelector, initialSelectedArray, dataClass) => {
            const container = view.querySelector(containerSelector);
            if (!container) return;
            container.innerHTML = '';
            container.className = 'wb-multi-select';
            const selectedSet = new Set(initialSelectedArray.filter(n => allNames.includes(n)));
            const dom = document.createElement('div');
            dom.innerHTML = `
                <div class="wb-ms-tags"></div>
                <div class="wb-ms-dropdown">
                    <div class="wb-ms-search"><input type="text" placeholder="搜尋選項..."></div>
                    <div class="wb-ms-list"></div>
                </div>
            `;
            container.appendChild(dom);
            const tagsEl = dom.querySelector('.wb-ms-tags');
            const dropEl = dom.querySelector('.wb-ms-dropdown');
            const inputEl = dom.querySelector('input');
            const listEl = dom.querySelector('.wb-ms-list');

            const refresh = () => {
                tagsEl.innerHTML = '';
                if (selectedSet.size === 0) tagsEl.innerHTML = `<div class="wb-ms-placeholder">點擊選擇世界書...</div>`;
                else {
                    selectedSet.forEach(name => {
                        const tag = document.createElement('div');
                        tag.className = 'wb-ms-tag';
                        tag.dataset.val = name;
                        tag.dataset.bindType = dataClass;
                        tag.innerHTML = `<span>${name}</span><span class="wb-ms-tag-close">×</span>`;
                        tag.querySelector('.wb-ms-tag-close').onclick = (e) => {
                            e.stopPropagation();
                            selectedSet.delete(name);
                            refresh();
                            Actions.saveBindings();
                        };
                        tagsEl.appendChild(tag);
                    });
                }
                listEl.innerHTML = '';
                const available = allNames.filter(n => !selectedSet.has(n));
                if (available.length === 0) listEl.innerHTML = `<div style="padding:10px;color:#666;text-align:center">沒有更多選項</div>`;
                else {
                    available.forEach(name => {
                        const item = document.createElement('div');
                        item.className = 'wb-ms-item';
                        item.textContent = name;
                        item.onclick = () => {
                            selectedSet.add(name);
                            inputEl.value = '';
                            refresh();
                            Actions.saveBindings();
                        };
                        listEl.appendChild(item);
                    });
                    filterList(inputEl.value);
                }
            };
            const filterList = (term) => {
                const items = listEl.querySelectorAll('.wb-ms-item');
                const lower = term.toLowerCase();
                items.forEach(item => {
                    if (item.textContent.toLowerCase().includes(lower)) item.classList.remove('hidden');
                    else item.classList.add('hidden');
                });
            };
            tagsEl.onclick = () => {
                const isVisible = dropEl.classList.contains('show');
                document.querySelectorAll('.wb-ms-dropdown.show').forEach(el => el.classList.remove('show'));
                if (!isVisible) {
                    dropEl.classList.add('show');
                    const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;
                    if (!isTouchDevice) {
                        inputEl.focus();
                    }
                }
            };
            inputEl.oninput = (e) => filterList(e.target.value);
            document.addEventListener('click', (e) => { if (!dom.contains(e.target)) dropEl.classList.remove('show'); });
            refresh();
        };

        view.querySelector('#wb-bind-char-primary').innerHTML = createOpts(char.primary);
        createMultiSelect('#wb-bind-char-list', char.additional, 'wb-bind-char-add');
        createMultiSelect('#wb-bind-global-list', global, 'wb-bind-global');
        view.querySelector('#wb-bind-chat').innerHTML = createOpts(chat);

        ['wb-bind-char-primary', 'wb-bind-chat'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.onchange = () => Actions.saveBindings();
                this.applyCustomDropdown(id);
            }
        });
    },

    updateHeaderInfo() {
        this.renderGlobalStats();
        const selector = document.getElementById('wb-book-selector');
        if (selector && STATE.currentBookName) selector.value = STATE.currentBookName;

        const footerEl = document.getElementById('wb-footer-info');
        if (footerEl) {
            const context = getContext();
            const charId = context.characterId;
            const charName = (context.characters && context.characters[charId]) ? context.characters[charId].name : '無';
            const avatarImgEl = document.getElementById('avatar_load_preview');
            const avatarHtml = (avatarImgEl && avatarImgEl.src) ? `<img src="${avatarImgEl.src}" class="wb-footer-avatar">` : '';
            const chatName = context.chatId ? String(context.chatId).replace(/\.json$/i, '') : '無';
            footerEl.innerHTML = `<div>目前角色為${avatarHtml}<strong>${charName}</strong></div><div>目前聊天為 <strong>${chatName}</strong></div>`;
        }
    },

    getWarningList() {
        return STATE.entries.filter(entry => entry.disable === false && entry.constant === false && !(entry.key?.length > 0));
    },

    renderGlobalStats() {
        const countEl = document.getElementById('wb-display-count');
        const warningEl = document.getElementById('wb-warning-stat');
        const warningNumEl = document.getElementById('wb-warning-count');
        if (countEl) {
            let blueTokens = 0, greenTokens = 0;
            STATE.entries.forEach(entry => {
                if (entry.disable === false) {
                    const t = Actions.getTokenCount(entry.content);
                    if (entry.constant === true) blueTokens += t;
                    else greenTokens += t;
                }
            });
            countEl.innerHTML = `<span style="margin-right:5px">${STATE.entries.length} 條目 | ${blueTokens + greenTokens} Tokens</span><span style="font-size:0.9em; color:#6b7280">( <span class="wb-text-blue" title="藍燈">${blueTokens}</span> + <span class="wb-text-green" title="綠燈">${greenTokens}</span> )</span>`;
        }
        if (warningEl && warningNumEl) {
            const warnings = this.getWarningList();
            if (warnings.length > 0) {
                warningEl.classList.remove('hidden');
                warningNumEl.textContent = warnings.length;
                warningEl.onclick = () => UI.openWarningListModal();
            } else warningEl.classList.add('hidden');
        }
    },

    updateCardStatus(uid) {
        const entry = STATE.entries.find(e => e.uid === uid);
        const card = document.querySelector(`.wb-card[data-uid="${uid}"]`);
        if (!entry || !card) return;

        card.classList.remove('disabled', 'type-green', 'type-blue');

        if (entry.disable) {
            card.classList.add('disabled');
        } else {
            if (entry.constant) {
                card.classList.add('type-blue');
            } else {
                card.classList.add('type-green');
            }
        }

        const tokenEl = card.querySelector('.wb-token-display');
        if (tokenEl) tokenEl.textContent = Actions.getTokenCount(entry.content);
        const warnContainer = card.querySelector('.wb-warning-container');
        if (warnContainer) {
            const showWarning = entry.disable === false && entry.constant === false && !(entry.key?.length > 0);
            warnContainer.innerHTML = showWarning ? `<i class="fa-solid fa-circle-exclamation" style="color:#ef4444; margin-right:6px; cursor:help;" data-wb-tooltip="警告：綠燈條目已啟用但未設置關鍵詞，將無法觸發"></i>` : '';
        }
    },

    renderList(filterText = '') {
        const list = document.getElementById('wb-entry-list');
        if (!list) return;
        list.innerHTML = '';
        const term = filterText.toLowerCase();
        STATE.entries.forEach((entry, index) => {
            const name = entry.comment || '';
            if (term && !name.toLowerCase().includes(term)) return;
            const card = this.createCard(entry, index);
            list.appendChild(card);
            this.applyCustomDropdown(`wb-pos-${entry.uid}`);
        });
    },

    createCard(entry, index) {
        const context = getContext();
        const currentAnDepth = (context.chatMetadata?.note_depth) ?? (context.extensionSettings?.note?.defaultDepth) ?? 4;

        const isEnabled = !entry.disable;
        const isConstant = !!entry.constant;
        const keys = entry.key || [];

        const card = document.createElement('div');
        let typeClass = '';
        if (isEnabled) {
            typeClass = isConstant ? 'type-blue' : 'type-green';
        }

        card.className = `wb-card ${isEnabled ? '' : 'disabled'} ${typeClass}`;
        card.dataset.uid = entry.uid;
        card.dataset.index = index;
        card.draggable = false;

        const escapeHtml = (str) => (str || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#039;'}[m]));

        const curPosInt = typeof entry.position === 'number' ? entry.position : 1;
        const curPosStr = WI_POSITION_MAP[curPosInt] || 'after_character_definition';

        const corePositions = ['before_character_definition', 'after_character_definition', 'at_depth'];
        const allPosOptions = [
            { v: 'before_character_definition', t: '角色定義之前' },
            { v: 'after_character_definition', t: '角色定義之後' },
            { v: 'before_example_messages', t: '示例訊息之前' },
            { v: 'after_example_messages', t: '示例訊息之後' },
            { v: 'before_author_note', t: `作者註釋之前` },
            { v: 'after_author_note', t: `作者註釋之後` },
            { v: 'at_depth', t: '@D' }
        ];

        const showCoreOnly = corePositions.includes(curPosStr);
        const hasKeys = keys.length > 0;
        const showWarning = isEnabled && !isConstant && !hasKeys;
        const warningIcon = showWarning ? `<i class="fa-solid fa-circle-exclamation" style="color:#ef4444; margin-right:6px; cursor:help;" data-wb-tooltip="警告：綠燈條目已啟用但未設置關鍵詞，將無法觸發"></i>` : '';

        let optionsHtml = '';
        allPosOptions.forEach(opt => {
            if (showCoreOnly && !corePositions.includes(opt.v)) return;
            const selected = opt.v === curPosStr ? 'selected' : '';
            optionsHtml += `<option value="${opt.v}" ${selected}>${opt.t}</option>`;
        });

        card.innerHTML = `
            <div class="wb-card-header">
                <div style="flex:1;display:flex;flex-direction:column;gap:8px">
                    <div class="wb-row">
                        <input class="wb-inp-title inp-name" value="${escapeHtml(entry.comment)}" placeholder="條目名稱 (Comment)">
                        <div class="wb-warning-container">${warningIcon}</div>
                        <i class="fa-solid fa-eye btn-preview" style="cursor:pointer;padding:5px;" title="編輯內容"></i>
                        <i class="fa-solid fa-trash btn-delete" style="cursor:pointer;padding:5px;margin-left:5px" title="刪除條目"></i>
                    </div>
                    <div class="wb-row" style="width: 100%;">
                        <div class="wb-ctrl-group"><label class="wb-switch"><input type="checkbox" class="inp-enable" ${isEnabled ? 'checked' : ''}><span class="wb-slider purple"></span></label></div>
                        <div class="wb-ctrl-group"><label class="wb-switch"><input type="checkbox" class="inp-type" ${isConstant ? 'checked' : ''}><span class="wb-slider blue"></span></label></div>
                        <div class="wb-pos-wrapper">
                            <select id="wb-pos-${entry.uid}" class="wb-input-dark inp-pos" style="font-size:0.85em">${optionsHtml}</select>
                            <input type="number" class="wb-inp-num inp-pos-depth" style="display: ${curPosStr === 'at_depth' ? 'block' : 'none'};" placeholder="D" value="${entry.depth ?? 4}">
                        </div>
                        <div class="wb-ctrl-group order-group" title="順序"><span>順序</span><input type="number" class="wb-inp-num inp-order" style="width:65px;height:24px;font-size:0.85em" value="${entry.order ?? 0}"></div>
                        <div class="wb-input-dark wb-token-display" title="Tokens">${Actions.getTokenCount(entry.content)}</div>
                    </div>
                </div>
            </div>
        `;

        const bind = (sel, evt, fn) => { const el = card.querySelector(sel); if(el) el.addEventListener(evt, fn); };

        bind('.inp-name', 'input', (e) => Actions.updateEntry(entry.uid, d => d.comment = e.target.value));

        bind('.inp-enable', 'change', (e) => {
            card.classList.toggle('disabled', !e.target.checked);
            Actions.updateEntry(entry.uid, d => d.disable = !e.target.checked);
        });

        bind('.inp-type', 'change', (e) => Actions.updateEntry(entry.uid, d => {
            d.constant = e.target.checked;
            if (d.constant) d.selective = false;
            else d.selective = true;
        }));

        bind('.inp-pos', 'change', (e) => {
            const val = e.target.value;
            const depthInput = card.querySelector('.inp-pos-depth');

            if (depthInput) {
                depthInput.style.display = val === 'at_depth' ? 'block' : 'none';
            }

            const intVal = WI_POSITION_MAP_REV[val] ?? 1;
            Actions.updateEntry(entry.uid, d => d.position = intVal);
        });

        bind('.inp-pos-depth', 'input', (e) => Actions.updateEntry(entry.uid, d => d.depth = Number(e.target.value)));
        bind('.inp-order', 'input', (e) => Actions.updateEntry(entry.uid, d => d.order = Number(e.target.value)));

        bind('.btn-delete', 'click', () => Actions.deleteEntry(entry.uid));
        bind('.btn-preview', 'click', (e) => UI.openContentPopup(entry, e.target));

        return card;
    },

    openContentPopup(entry, triggerBtn) {
        const old = document.getElementById('wb-content-popup-overlay');
        if (old) old.remove();

        const overlay = document.createElement('div');
        overlay.id = 'wb-content-popup-overlay';
        overlay.className = 'wb-modal-overlay';
        const popup = document.createElement('div');
        popup.className = 'wb-content-popup';

        let tempContent = entry.content || '';
        let tempKeys = (entry.key || []).map(k => String(k).replace(/，/g, ',')).join(',');
        const escapeHtml = (str) => (str || '').replace(/[&<>\"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#039;'}[m]));

        popup.innerHTML = `
            <div class="wb-popup-header"><span>${entry.comment || '未命名條目'}</span></div>
            <input class="wb-popup-input-keys" placeholder="關鍵詞 (英文逗號分隔)" value="${escapeHtml(tempKeys)}">
            <textarea class="wb-popup-textarea" placeholder="在此編輯內容...">${escapeHtml(tempContent)}</textarea>
            <div class="wb-popup-footer"><button class="wb-btn-black btn-cancel">取消</button><button class="wb-btn-black btn-save">儲存</button></div>
        `;
        overlay.appendChild(popup);
        document.body.appendChild(overlay);

        const keysInput = popup.querySelector('.wb-popup-input-keys');
        const textarea = popup.querySelector('.wb-popup-textarea');
        textarea.oninput = (e) => { tempContent = e.target.value; };
        keysInput.oninput = (e) => { tempKeys = e.target.value; };

        const close = () => overlay.remove();
        popup.querySelector('.btn-cancel').onclick = close;
        popup.querySelector('.btn-save').onclick = () => {
            Actions.updateEntry(entry.uid, d => d.content = tempContent);
            const finalKeys = tempKeys.replace(/，/g, ',').split(',').map(s => s.trim()).filter(Boolean);
            Actions.updateEntry(entry.uid, d => { d.key = finalKeys; });
            UI.updateCardStatus(entry.uid);
            UI.renderGlobalStats();
            close();
        };
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
    },

    compareGroupNames(a, b) {
        const systemOrder = {
            '角色定義之前': 10,
            '角色定義': 20,
            '角色定義之後': 30,
            '普通': 40,
            '[InitVar]1st': 45,
            '作者註釋之前': 50,
            '作者註釋': 60,
            '作者註釋之後': 70
        };

        const weightA = systemOrder[a] || 9999;
        const weightB = systemOrder[b] || 9999;

        if (weightA !== 9999 || weightB !== 9999) {
            return weightA - weightB;
        }

        const isAD = (str) => str.startsWith('@D');

        if (isAD(a) && isAD(b)) {
            const numA = parseInt(a.replace(/[^0-9]/g, '')) || 0;
            const numB = parseInt(b.replace(/[^0-9]/g, '')) || 0;
            return numA - numB;
        }

        if (isAD(a)) return 1;
        if (isAD(b)) return -1;

        return a.localeCompare(b);
    },

    renderManageView(filterText = '') {
        const container = document.getElementById('wb-manage-content');
        if (!container) return;

        const term = filterText.toLowerCase();
        const boundMap = STATE.boundBooksSet || {};
        const boundBookNames = new Set(Object.keys(boundMap));

        // === 新增：刷新標籤 ===
        Actions.refreshAllTags();

        // === 新增：標籤篩選邏輯 ===
        const filteredBooks = STATE.allBookNames.filter(name => {
            const meta = STATE.metadata[name] || {};

            // 文字搜尋
            if (term && !name.toLowerCase().includes(term) && 
                !(meta.note || '').toLowerCase().includes(term)) {
                return false;
            }

            // 標籤篩選
            if (STATE.selectedTags.size > 0) {
                const bookTags = meta.tags || [];
                const hasSelectedTag = Array.from(STATE.selectedTags).some(tag => 
                    bookTags.includes(tag)
                );
                if (!hasSelectedTag) return false;
            }

            return true;
        });

        const groups = { '已綁定角色': [], '未綁定角色': [] };
        Actions.getExistingGroups().forEach(g => groups[g] = []);

        filteredBooks.forEach(name => {
            const meta = STATE.metadata[name] || {};
            let gName = meta.group;
            if (!gName || gName === '未分組') {
                gName = boundBookNames.has(name) ? '已綁定角色' : '未綁定角色';
            }
            if (!groups[gName]) groups[gName] = [];
            groups[gName].push(name);
        });

        container.innerHTML = '';

        // === 新增：標籤篩選器 UI ===
        const tagFilterSection = document.createElement('div');
        tagFilterSection.className = 'wb-tag-filter-section';
        tagFilterSection.innerHTML = `
            <div class="wb-tag-filter-header">
                <span class="wb-tag-filter-title">
                    <i class="fa-solid fa-tags"></i> 標籤篩選
                </span>
                <button class="wb-btn-clear-tags ${STATE.selectedTags.size > 0 ? '' : 'hidden'}" 
                        id="wb-clear-tag-filter">
                    <i class="fa-solid fa-xmark"></i> 清除篩選
                </button>
            </div>
            <div class="wb-tag-filter-list" id="wb-tag-filter-list">
                ${STATE.allTags.size === 0 ? 
                    '<div class="wb-tag-empty">尚無標籤</div>' : 
                    Array.from(STATE.allTags).sort().map(tag => {
                        const isSelected = STATE.selectedTags.has(tag);
                        return `
                            <div class="wb-tag-filter-item ${isSelected ? 'selected' : ''}" 
                                 data-tag="${tag}">
                                <i class="fa-solid fa-tag"></i> ${tag}
                            </div>
                        `;
                    }).join('')
                }
            </div>
        `;
        container.appendChild(tagFilterSection);

        // 綁定標籤點擊事件
        tagFilterSection.querySelectorAll('.wb-tag-filter-item').forEach(item => {
            item.onclick = () => Actions.toggleTagFilter(item.dataset.tag);
        });

        const clearBtn = tagFilterSection.querySelector('#wb-clear-tag-filter');
        if (clearBtn) {
            clearBtn.onclick = () => Actions.clearTagFilters();
        }

        // 繼續原有的分組渲染...
        const renderGroup = (groupName, books) => {
            if (books.length === 0) return;
            books.sort((a, b) => {
                const pinA = STATE.metadata[a]?.pinned ? 1 : 0;
                const pinB = STATE.metadata[b]?.pinned ? 1 : 0;
                return pinB - pinA || a.localeCompare(b);
            });

            const groupDiv = document.createElement('div');
            groupDiv.className = 'wb-group';
            const isSystem = groupName === '已綁定角色' || groupName === '未綁定角色';
            const shouldExpand = term.length > 0 || !isSystem;

            groupDiv.innerHTML = `
                <div class="wb-group-header ${shouldExpand ? 'expanded' : ''}">
                    <span class="wb-group-title ${isSystem ? 'system' : ''}">${groupName}</span>
                    <div style="display:flex;align-items:center">
                        <span class="wb-group-count">${books.length}</span>
                        <i class="fa-solid fa-chevron-right wb-group-arrow"></i>
                    </div>
                </div>
                <div class="wb-group-body ${shouldExpand ? 'show' : ''}"></div>
            `;

            const header = groupDiv.querySelector('.wb-group-header');
            const body = groupDiv.querySelector('.wb-group-body');
            header.onclick = () => { 
                header.classList.toggle('expanded'); 
                body.classList.toggle('show'); 
            };
            
            books.forEach(bookName => {
                const meta = STATE.metadata[bookName] || {};
                const boundChars = boundMap[bookName] || [];
                const card = document.createElement('div');
                card.className = 'wb-manage-card';
                if (meta.pinned) card.style.borderLeft = `3px solid ${CONFIG.colors.accent}`;
                
                let iconsHtml = '';
                if (boundChars.length > 0) {
                    iconsHtml += `<div class="wb-icon-action link-bound" title="已綁定到: ${boundChars.join(', ')} (點擊解綁)"><i class="fa-solid fa-link"></i></div>`;
                } else {
                    iconsHtml += `<div class="wb-icon-action link-unbound" title="綁定到目前角色"><i class="fa-solid fa-link"></i></div>`;
                }
                iconsHtml += `<div class="wb-icon-action btn-view" title="跳轉到編輯"><i class="fa-solid fa-eye"></i></div>`;
                iconsHtml += `<div class="wb-icon-action btn-del" title="刪除世界書"><i class="fa-solid fa-trash"></i></div>`;
                iconsHtml += `<div class="wb-icon-action btn-pin ${meta.pinned ? 'pinned' : ''}" title="${meta.pinned ? '取消頂置' : '群組內頂置'}"><i class="fa-solid fa-thumbtack"></i></div>`;
                iconsHtml += `<div class="wb-icon-action btn-note ${meta.note ? 'active' : ''}" title="編輯備註"><i class="fa-solid fa-pencil"></i></div>`;

                // === 新增：標籤按鈕 ===
                iconsHtml += `<div class="wb-icon-action btn-tags ${meta.tags && meta.tags.length > 0 ? 'active' : ''}" title="編輯標籤"><i class="fa-solid fa-tags"></i></div>`;

                let titleHtml = `<span class="wb-card-title">${bookName}</span>`;
                if (groupName === '已綁定角色' && boundChars.length > 0) {
                    titleHtml += `<div class="wb-card-subtitle"><i class="fa-solid fa-user-tag" style="font-size:0.8em"></i> ${boundChars.join(', ')}</div>`;
                }

                // === 新增：標籤顯示區域 ===
                const tagsHtml = meta.tags && meta.tags.length > 0 ? 
                    meta.tags.map(tag => `<span class="wb-book-tag">${tag}</span>`).join('') : 
                    '';

                card.innerHTML = `
                    <div class="wb-card-top">
                        <div class="wb-card-info">${titleHtml}</div>
                        <div class="wb-manage-icons">${iconsHtml}</div>
                    </div>
                    <textarea class="wb-manage-note ${meta.note ? 'show' : ''}" placeholder="輸入備註...">${meta.note || ''}</textarea>
                    
                    <div class="wb-tags-display ${meta.tags && meta.tags.length > 0 ? 'show' : ''}">
                        ${tagsHtml}
                    </div>
                    <div class="wb-tags-editor hidden">
                        <input type="text" class="wb-tags-input" placeholder="輸入標籤，空格分隔" 
                               value="${(meta.tags || []).join(' ')}">
                        <button class="wb-btn-save-tags">儲存</button>
                    </div>
                `;
                
                const q = (s) => card.querySelector(s);
                if (boundChars.length > 0) q('.link-bound').onclick = () => Actions.toggleBindState(bookName, boundChars[0], true);
                else q('.link-unbound').onclick = () => Actions.toggleBindState(bookName, null, false);
                q('.btn-view').onclick = () => Actions.jumpToEditor(bookName);
                q('.btn-del').onclick = () => Actions.deleteBookDirectly(bookName);
                q('.btn-pin').onclick = () => Actions.togglePin(bookName);
                q('.btn-note').onclick = () => { q('.wb-manage-note').classList.toggle('show'); };
                q('.wb-manage-note').onchange = (e) => Actions.updateNote(bookName, e.target.value);

                // === 新增：標籤編輯邏輯 ===
                q('.btn-tags').onclick = () => {
                    const editor = q('.wb-tags-editor');
                    editor.classList.toggle('hidden');
                    if (!editor.classList.contains('hidden')) {
                        q('.wb-tags-input').focus();
                    }
                };

                q('.wb-btn-save-tags').onclick = () => {
                    const input = q('.wb-tags-input');
                    const tags = input.value.trim().split(/\s+/).filter(Boolean);
                    Actions.updateTags(bookName, tags);
                    q('.wb-tags-editor').classList.add('hidden');
                    
                    const display = q('.wb-tags-display');
                    if (tags.length > 0) {
                        display.innerHTML = tags.map(tag => `<span class="wb-book-tag">${tag}</span>`).join('');
                        display.classList.add('show');
                    } else {
                        display.classList.remove('show');
                    }
                };

                body.appendChild(card);
            });
            container.appendChild(groupDiv);
        };

        if (groups['未綁定角色'].length > 0) renderGroup('未綁定角色', groups['未綁定角色']);
        Object.keys(groups).sort(this.compareGroupNames.bind(this)).forEach(g => { 
            if (g !== '已綁定角色' && g !== '未綁定角色') renderGroup(g, groups[g]); 
        });
        if (groups['已綁定角色'].length > 0) renderGroup('已綁定角色', groups['已綁定角色']);

        // Settings
        const config = Actions.getGlobalConfig();
        const settingsDiv = document.createElement('div');
        settingsDiv.className = 'wb-manage-settings';
        settingsDiv.innerHTML = `
            <div class="wb-setting-row">
                <div>
                    <div class="wb-setting-label">級聯刪除主要世界書</div>
                    <div class="wb-setting-desc">刪除角色卡時，詢問是否同時刪除其綁定的主要世界書</div>
                </div>
                <div class="wb-ctrl-group">
                    <label class="wb-switch">
                        <input type="checkbox" id="wb-setting-del-wb" ${config.deleteWbWithChar ? 'checked' : ''}>
                        <span class="wb-slider purple"></span>
                    </label>
                </div>
            </div>
        `;
        settingsDiv.querySelector('#wb-setting-del-wb').onchange = async (e) => 
            await Actions.saveGlobalConfig({ deleteWbWithChar: e.target.checked });
        container.appendChild(settingsDiv);
    },
    // === 核心 UI 功能 ===
    applyCustomDropdown(selectId) {
        const originalSelect = document.getElementById(selectId);
        if (!originalSelect) return;
        let trigger = document.getElementById(`wb-trigger-${selectId}`);
        if (originalSelect.style.display !== 'none') {
            originalSelect.style.display = 'none';
            if (trigger) trigger.remove();
            trigger = document.createElement('div');
            trigger.id = `wb-trigger-${selectId}`;
            trigger.className = 'wb-gr-trigger';

            originalSelect.parentNode.insertBefore(trigger, originalSelect.nextSibling);
            trigger.onclick = (e) => { e.stopPropagation(); this.toggleCustomDropdown(selectId, trigger); };
        }
        const update = () => {
            const selectedOpt = originalSelect.options[originalSelect.selectedIndex];
            trigger.textContent = selectedOpt ? selectedOpt.text : '請選擇...';
        };
        update();
        originalSelect.addEventListener('change', update);
    },

    toggleCustomDropdown(selectId, triggerElem) {
        const existing = document.getElementById('wb-active-dropdown');
        if (existing) {
            const isSame = existing.dataset.source === selectId;
            existing.remove();
            if (isSame) return;
        }
        const originalSelect = document.getElementById(selectId);
        const dropdown = document.createElement('div');
        dropdown.id = 'wb-active-dropdown';
        dropdown.className = 'wb-gr-dropdown show';
        dropdown.dataset.source = selectId;

        const searchBox = document.createElement('div');
        searchBox.className = 'wb-gr-search-box';
        const searchInput = document.createElement('input');
        searchInput.className = 'wb-gr-search-input';
        searchInput.placeholder = '搜尋選項...';
        searchInput.onclick = (e) => e.stopPropagation();
        searchBox.appendChild(searchInput);

        const optionsContainer = document.createElement('div');
        optionsContainer.className = 'wb-gr-options-container';

        const createOption = (optNode) => {
            const div = document.createElement('div');
            div.className = 'wb-gr-option';
            div.textContent = optNode.text;
            if (optNode.selected) div.classList.add('selected');
            div.onclick = (e) => {
                e.stopPropagation();
                originalSelect.value = optNode.value;
                originalSelect.dispatchEvent(new Event('change'));
                dropdown.remove();
            };
            optionsContainer.appendChild(div);
        };

        Array.from(originalSelect.children).forEach(child => {
            if (child.tagName === 'OPTGROUP') {
                const label = document.createElement('div');
                label.className = 'wb-gr-group-label';
                label.textContent = child.label;
                optionsContainer.appendChild(label);
                Array.from(child.children).forEach(createOption);
            } else if (child.tagName === 'OPTION') createOption(child);
        });

        if (originalSelect.options.length > 8) dropdown.appendChild(searchBox);
        dropdown.appendChild(optionsContainer);
        document.body.appendChild(dropdown);

        const rect = triggerElem.getBoundingClientRect();
        dropdown.style.top = `${rect.bottom + 5}px`;
        dropdown.style.left = `${rect.left}px`;
        dropdown.style.width = `${rect.width}px`;

        const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;
        if (!isTouchDevice) {
            searchInput.focus();
        }

        searchInput.oninput = (e) => {
            const term = e.target.value.toLowerCase();
            optionsContainer.querySelectorAll('.wb-gr-option').forEach(o => o.classList.toggle('hidden', !o.textContent.toLowerCase().includes(term)));
        };

        const closeHandler = (e) => {
            if (!dropdown.contains(e.target) && e.target !== triggerElem) {
                dropdown.remove();
                document.removeEventListener('click', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 0);
    },

    openSortingModal() {
        document.getElementById('btn-group-sort')?.blur();

        if (!STATE.currentBookName) return toastr.warning("請先選擇一本世界書");

        const groups = {};
        const groupKeys = [];

        const priorityMap = {
            'before_character_definition': 10,
            'after_character_definition': 20,
            'before_author_note': 30,
            'after_author_note': 40,
            'at_depth': 50,
            'before_example_messages': 60,
            'after_example_messages': 70
        };

        const typeLabels = {
            'before_character_definition': '角色定義之前',
            'after_character_definition': '角色定義之後',
            'before_example_messages': '示例訊息之前',
            'after_example_messages': '示例訊息之後',
            'before_author_note': '作者註釋之前',
            'after_author_note': '作者註釋之後',
            'at_depth': '@D'
        };

        const sortedEntries = [...STATE.entries].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        sortedEntries.forEach(entry => {
            const posInt = typeof entry.position === 'number' ? entry.position : 1;
            const posStr = WI_POSITION_MAP[posInt] || 'after_character_definition';

            let key = posStr === 'at_depth' ? `at_depth_${entry.depth ?? 0}` : posStr;
            let label = posStr === 'at_depth' ? `@D ${entry.depth ?? 0}` : (typeLabels[key] || key);

            const rawType = posStr;
            const depthVal = entry.depth ?? 0;

            if (!groups[key]) {
                groups[key] = { label, items: [], rawType, depthVal };
                groupKeys.push(key);
            }
            groups[key].items.push(entry);
        });

        groupKeys.sort((keyA, keyB) => {
            const gA = groups[keyA];
            const gB = groups[keyB];

            const pA = priorityMap[gA.rawType] ?? 999;
            const pB = priorityMap[gB.rawType] ?? 999;

            if (pA !== pB) return pA - pB;

            if (gA.rawType === 'at_depth') {
                return gB.depthVal - gA.depthVal;
            }
            return 0;
        });

        const overlay = document.createElement('div');
        overlay.className = 'wb-sort-modal-overlay';
        overlay.innerHTML = `
            <div class="wb-sort-modal">
                <div class="wb-sort-header">
                    <span><i class="fa-solid fa-arrow-down-9-1"></i> 分組排序管理</span>
                    <div style="cursor:pointer" id="wb-sort-close"><i class="fa-solid fa-xmark"></i></div>
                </div>
                <div class="wb-sort-body" id="wb-sort-body"></div>
                <div class="wb-sort-footer" style="display:flex; justify-content:center; gap:15px;">
                    <button class="wb-btn-rect" id="wb-sort-cancel" style="font-size:0.9em;padding:8px 20px; background:#fff; color:#000; border:1px solid #e5e7eb;">取消</button>
                    <button class="wb-btn-rect" id="wb-sort-save" style="font-size:0.9em;padding:8px 20px">儲存</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const bodyEl = overlay.querySelector('#wb-sort-body');
        const getBg = (i) => `hsl(${(i * 137.5) % 360}, 70%, 95%)`;
        const getBdr = (i) => `hsl(${(i * 137.5) % 360}, 60%, 80%)`;
        const getTxt = (i) => `hsl(${(i * 137.5) % 360}, 80%, 30%)`;

        groupKeys.forEach((key, i) => {
            const group = groups[key];
            const container = document.createElement('div');
            container.className = 'wb-sort-group-container';
            container.style.backgroundColor = getBg(i);
            container.style.borderColor = getBdr(i);

            container.innerHTML = `
                <div class="wb-sort-group-title" style="color:${getTxt(i)}">
                    <span>${group.label} <span style="font-weight:normal;font-size:0.8em;opacity:0.8">(${group.items.length})</span></span>
                    <i class="fa-solid fa-chevron-down wb-sort-arrow"></i>
                </div>
                <div class="wb-sort-group-list" data-group-key="${key}"></div>
            `;

            const titleEl = container.querySelector('.wb-sort-group-title');
            const listEl = container.querySelector('.wb-sort-group-list');

            titleEl.onclick = () => {
                const isCollapsed = listEl.classList.contains('collapsed');
                if (isCollapsed) {
                    listEl.classList.remove('collapsed');
                    titleEl.classList.remove('collapsed');
                } else {
                    listEl.classList.add('collapsed');
                    titleEl.classList.add('collapsed');
                }
            };

            const itemsHtml = group.items.map(entry => {
                const safeTitle = (entry.comment || '無標題').replace(/&/g, '&amp;').replace(/</g, '&lt;');
                return `
                <div class="wb-sort-item" data-uid="${entry.uid}" data-group="${key}" draggable="true">
                    <div class="wb-sort-item-order">${entry.order ?? 0}</div>
                    <div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none;">${safeTitle}</div>
                    <div class="wb-sort-handle">
                        <i class="fa-solid fa-bars" style="color:#ccc; pointer-events:none;"></i>
                    </div>
                </div>`;
            }).join('');

            listEl.innerHTML = itemsHtml;

            this.initSortableGroup(listEl, key);

            bodyEl.appendChild(container);
        });

        overlay.querySelector('#wb-sort-close').onclick = () => overlay.remove();
        overlay.querySelector('#wb-sort-cancel').onclick = () => overlay.remove();

        overlay.querySelector('#wb-sort-save').onclick = async () => {
            await API.saveBookEntries(STATE.currentBookName, STATE.entries);
            Actions.sortByPriority();
            overlay.remove();
        };
    },

    initSortableGroup(listEl, groupKey) {
        const updateOrder = () => {
            [...listEl.querySelectorAll('.wb-sort-item')].forEach((el, idx) => {
                const newOrder = idx + 1;
                el.querySelector('.wb-sort-item-order').textContent = newOrder;
                const entry = STATE.entries.find(e => e.uid === Number(el.dataset.uid));
                if (entry) { entry.order = newOrder; }
            });
        };

        listEl.addEventListener('dragstart', (e) => {
            const item = e.target.closest('.wb-sort-item');
            if (!item) return;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/uid', item.dataset.uid);
            e.dataTransfer.setData('text/group', groupKey);
            item.classList.add('pc-dragging');
        });

        listEl.addEventListener('dragend', (e) => {
            const item = e.target.closest('.wb-sort-item');
            if (item) item.classList.remove('pc-dragging');
            updateOrder();
        });

        listEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            const dragging = listEl.querySelector('.pc-dragging');
            if (!dragging) return;

            const siblings = [...listEl.querySelectorAll('.wb-sort-item:not(.pc-dragging)')];
            const next = siblings.find(s => {
                const rect = s.getBoundingClientRect();
                return e.clientY <= rect.top + rect.height / 2;
            });
            listEl.insertBefore(dragging, next);
        });

        let touchItem = null;
        let touchTimer = null;
        let startX = 0, startY = 0;
        const TOUCH_TOLERANCE = 10;
        let rAF = null;

        listEl.addEventListener('touchstart', (e) => {
            const handle = e.target.closest('.wb-sort-handle');
            if (!handle) return;

            e.preventDefault();

            const item = handle.closest('.wb-sort-item');
            if (!item) return;

            const touch = e.touches[0];
            startX = touch.clientX;
            startY = touch.clientY;
            touchItem = item;

            touchTimer = setTimeout(() => {
                if (touchItem) {
                    touchItem.classList.add('mobile-dragging');
                    if (navigator.vibrate) navigator.vibrate(50);
                    document.body.style.overflow = 'hidden';
                }
            }, 150);
        }, { passive: false });

        listEl.addEventListener('touchmove', (e) => {
            if (!touchItem) return;
            const touch = e.touches[0];

            if (!touchItem.classList.contains('mobile-dragging')) {
                const diffX = Math.abs(touch.clientX - startX);
                const diffY = Math.abs(touch.clientY - startY);
                if (diffX > TOUCH_TOLERANCE || diffY > TOUCH_TOLERANCE) {
                    clearTimeout(touchTimer);
                    touchItem = null;
                }
                return;
            }

            e.preventDefault();

            if (rAF) return;

            rAF = requestAnimationFrame(() => {
                rAF = null;

                const target = document.elementFromPoint(touch.clientX, touch.clientY);
                if (!target) return;

                const swapItem = target.closest('.wb-sort-item');

                if (swapItem && swapItem !== touchItem && listEl.contains(swapItem)) {
                    const rect = swapItem.getBoundingClientRect();
                    const next = (touch.clientY - rect.top) / rect.height > 0.5;

                    const sibling = next ? swapItem.nextSibling : swapItem;
                    if (sibling !== touchItem && sibling !== touchItem.nextSibling) {
                        listEl.insertBefore(touchItem, sibling);
                    }
                }
            });
        }, { passive: false });

        const endDrag = () => {
            if (touchTimer) clearTimeout(touchTimer);
            if (touchItem) {
                touchItem.classList.remove('mobile-dragging');
                touchItem = null;
                document.body.style.overflow = '';
                updateOrder();
            }
        };

        listEl.addEventListener('touchend', endDrag);
        listEl.addEventListener('touchcancel', endDrag);
    },

    openAnalysisModal() {
        if (!STATE.currentBookName) return toastr.warning("請先選擇一本世界書");

        let showAll = false;

        const overlay = document.createElement('div');
        overlay.className = 'wb-sort-modal-overlay';
        overlay.innerHTML = `
            <div class="wb-sort-modal" id="wb-analysis-box" style="width:550px; height:auto; max-height:90vh;">
                <div class="wb-sort-header" style="background:#2d2d2d; padding: 15px 20px;">
                    <span style="font-size:1.1em; display:flex; align-items:center; gap:10px;">
                        <i class="fa-solid fa-chart-pie" style="color:#e5e5e5;"></i>
                        <span id="wb-analysis-title">${STATE.currentBookName}</span>
                    </span>
                    <div style="display:flex; gap:15px; align-items:center;">
                        <i class="fa-solid fa-repeat wb-action-icon" id="wb-analysis-toggle" title="切換：僅已啟用 / 所有條目"></i>
                        <div style="cursor:pointer" class="wb-close-modal"><i class="fa-solid fa-xmark"></i></div>
                    </div>
                </div>
                <div class="wb-sort-body" style="background:#1a1a1a; padding:0; overflow:hidden !important;">
                    <div id="wb-analysis-content" class="wb-stats-container"></div>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        UI.setupModalPositioning(overlay.querySelector('#wb-analysis-box'), overlay);

        const render = () => {
            const sourceEntries = STATE.entries;
            const targetEntries = showAll ? sourceEntries : sourceEntries.filter(e => e.disable === false);

            const titleEl = overlay.querySelector('#wb-analysis-title');
            titleEl.innerHTML = `<span style="color:#e5e5e5;">${STATE.currentBookName}</span> <span style="font-size:0.8em; font-weight:normal; color:#a0a0a0;">(${showAll ? '所有條目' : '僅已啟用'})</span>`;

            if (targetEntries.length === 0) {
                overlay.querySelector('#wb-analysis-content').innerHTML = `<div style="text-align:center; color:#9ca3af; padding:40px;">暫無資料</div>`;
                return;
            }

            let blueTokens = 0, greenTokens = 0, blueCount = 0, greenCount = 0;
            const rankList = [];

            targetEntries.forEach(entry => {
                const t = Actions.getTokenCount(entry.content);
                const isBlue = !!entry.constant;

                if (isBlue) {
                    blueTokens += t;
                    blueCount++;
                } else {
                    greenTokens += t;
                    greenCount++;
                }

                rankList.push({
                    name: entry.comment || '未命名',
                    tokens: t,
                    isBlue: isBlue,
                    uid: entry.uid
                });
            });

            const totalTokens = blueTokens + greenTokens;
            const totalCount = blueCount + greenCount;
            const bluePercent = totalTokens > 0 ? (blueTokens / totalTokens * 100).toFixed(1) : 0;
            const greenPercent = totalTokens > 0 ? (greenTokens / totalTokens * 100).toFixed(1) : 0;

            const blueCountPercent = totalCount > 0 ? (blueCount / totalCount * 100).toFixed(1) : 0;
            const greenCountPercent = totalCount > 0 ? (greenCount / totalCount * 100).toFixed(1) : 0;

            rankList.sort((a, b) => {
                if (a.isBlue !== b.isBlue) return a.isBlue ? -1 : 1;
                return b.tokens - a.tokens;
            });

            const progressHtml = `
                <div class="wb-stats-row">
                    <div class="wb-stats-label">
                        <span>Token 占比</span>
                        <span class="wb-stats-total">總計: ${totalTokens}</span>
                    </div>
                    <div class="wb-progress-bar">
                        <div class="wb-bar-seg wb-bg-blue" style="width:${bluePercent}%">${blueTokens > 0 ? blueTokens : ''}</div>
                        <div class="wb-bar-seg wb-bg-green" style="width:${greenPercent}%">${greenTokens > 0 ? greenTokens : ''}</div>
                    </div>
                    <div class="wb-bar-legend">
                        <span><span class="wb-legend-dot wb-dot-blue"></span>藍燈: ${bluePercent}%</span>
                        <span><span class="wb-legend-dot wb-dot-green"></span>綠燈: ${greenPercent}%</span>
                    </div>
                </div>
            `;

            const pieGradient = `conic-gradient(#3b82f6 0% ${blueCountPercent}%, #22c55e ${blueCountPercent}% 100%)`;
            const pieHtml = `
                <div class="wb-pie-row">
                    <div class="wb-pie-chart" style="background: ${pieGradient};"></div>
                    <div class="wb-pie-legend">
                        <div class="wb-pie-legend-item">
                            <span class="wb-legend-dot wb-dot-blue"></span> 藍燈條目: <strong>${blueCount}</strong> <span style="font-size:0.9em;color:#6b7280;margin-left:4px">(${blueCountPercent}%)</span>
                        </div>
                        <div class="wb-pie-legend-item">
                            <span class="wb-legend-dot wb-dot-green"></span> 綠燈條目: <strong>${greenCount}</strong> <span style="font-size:0.9em;color:#6b7280;margin-left:4px">(${greenCountPercent}%)</span>
                        </div>
                        <div class="wb-pie-sub">共 ${totalCount} 條</div>
                    </div>
                </div>
            `;

            let rankHtmlItems = '';
            rankList.forEach(item => {
                const percent = totalTokens > 0 ? (item.tokens / totalTokens * 100).toFixed(1) : 0;
                const barColor = item.isBlue ? '#dbeafe' : '#dcfce7';
                const bgStyle = `background: linear-gradient(to right, ${barColor} ${percent}%, #f8fafc ${percent}%);`;

                rankHtmlItems += `
                    <div class="wb-rank-pill" style="${bgStyle}">
                        <div class="wb-rank-pill-name" title="${item.name}">${item.name}</div>
                        <div class="wb-rank-pill-val">${item.tokens}</div>
                    </div>
                `;
            });

            const rankHtml = `
                <div class="wb-stats-row" style="flex:1; min-height:0;">
                    <div class="wb-stats-label">
                        <span>Token 排行 (藍前綠後)</span>
                        <span class="wb-stats-total">${totalTokens}</span>
                    </div>
                    <div class="wb-rank-list">
                        ${rankHtmlItems}
                    </div>
                </div>
            `;

            overlay.querySelector('#wb-analysis-content').innerHTML = progressHtml + pieHtml + rankHtml;
        };

        const toggleBtn = overlay.querySelector('#wb-analysis-toggle');
        toggleBtn.onclick = () => {
            showAll = !showAll;
            render();
        };

        overlay.querySelector('.wb-close-modal').onclick = () => overlay.remove();
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

        render();
    },

    openWarningListModal() {
        const warnings = this.getWarningList();
        if (warnings.length === 0) return toastr.info("沒有警告條目");

        const overlay = document.createElement('div');
        overlay.className = 'wb-sort-modal-overlay';

        let listHtml = '';
        warnings.forEach(entry => {
            listHtml += `
            <div class="wb-warning-list-item">
                <div style="display:flex; align-items:center; gap:10px; overflow:hidden;">
                    <i class="fa-solid fa-circle-exclamation" style="color:#ef4444;"></i>
                    <span style="font-weight:bold; color:#ffffff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${entry.comment || '未命名條目'}</span>
                </div>
                <i class="fa-solid fa-eye" style="cursor:pointer; color:#6b7280; padding:5px;" title="查看/編輯" data-edit="${entry.uid}"></i>
            </div>`;
        });

        overlay.innerHTML = `
            <div class="wb-sort-modal" id="wb-warning-box" style="width:500px; height:auto; max-height:80vh; background:#f9fafb;">
                <div class="wb-sort-header" style="background:#fff; border-bottom:1px solid #e5e7eb;">
                    <div class="wb-warning-header-red">
                        <i class="fa-solid fa-triangle-exclamation"></i>
                        <span>關鍵詞缺失警告 (${warnings.length})</span>
                    </div>
                    <div style="cursor:pointer; color:#4b5563;" class="wb-close-modal"><i class="fa-solid fa-xmark"></i></div>
                </div>

                <div class="wb-sort-body" style="padding:20px;">
                    <div class="wb-warning-alert-box">
                        以下綠燈條目已啟用，但未設置任何關鍵詞，因此屬於無效條目。它們在聊天中將永遠不會被觸發。
                    </div>
                    <div style="display:flex; flex-direction:column;">
                        ${listHtml}
                    </div>
                </div>
            </div>`;

        document.body.appendChild(overlay);

        UI.setupModalPositioning(overlay.querySelector('.wb-sort-modal'), overlay);

        overlay.addEventListener('click', (e) => {
            if (e.target.dataset.edit) {
                const entry = STATE.entries.find(en => en.uid === Number(e.target.dataset.edit));
                if (entry) {
                    UI.openContentPopup(entry);
                    overlay.remove();
                }
            }
        });

        overlay.querySelector('.wb-close-modal').onclick = () => overlay.remove();
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    },

    async openContextPreviewModal() {
        if (!STATE.currentBookName) return toastr.warning("請先選擇一本世界書");

        const loadingToast = toastr.info("正在分析上下文...", "請稍候", { timeOut: 0, extendedTimeOut: 0 });

        try {
            const context = getContext();

            const charId = context.characterId;
            const charData = context.characters[charId] || {};
            let fullText = (charData.description || '') + '\n' + (charData.persona || '') + '\n';
            const chat = context.chat || [];
            const recentChat = chat.slice(-30);
            fullText += recentChat.map(c => (c.name || '') + ': ' + (c.mes || '')).join('\n');
            const searchContext = fullText.toLowerCase();

            let activatedEntries = STATE.entries.filter(entry => {
                if (entry.disable) return false;
                if (entry.constant) return true;
                if (!entry.key || entry.key.length === 0) return false;
                return entry.key.some(k => {
                    const keyStr = String(k).trim();
                    if (!keyStr) return false;
                    if (keyStr.startsWith('/') && keyStr.endsWith('/') && keyStr.length > 2) {
                        try {
                            const regexBody = keyStr.substring(1, keyStr.lastIndexOf('/'));
                            const flags = keyStr.substring(keyStr.lastIndexOf('/') + 1) + 'i';
                            const regex = new RegExp(regexBody, flags);
                            return regex.test(fullText);
                        } catch (e) { return false; }
                    } else {
                        return searchContext.includes(keyStr.toLowerCase());
                    }
                });
            });

            toastr.clear(loadingToast);

            activatedEntries.sort((a, b) => {
                const scoreA = Actions.getEntrySortScore(a);
                const scoreB = Actions.getEntrySortScore(b);
                if (scoreA !== scoreB) return scoreB - scoreA;

                const orderA = a.order ?? 0;
                const orderB = b.order ?? 0;
                return (orderA - orderB) || (a.uid - b.uid);
            });

            let sidebarHtml = '';
            let contentHtml = '';

            const originalContentMap = new Map();

            const posMapping = {
                0: '角色定義之前',
                1: '角色定義之後',
                2: 'AN 之前',
                3: 'AN 之後',
                4: '@D',
                5: '示例訊息之前',
                6: '示例訊息之後'
            };

            if (activatedEntries.length === 0) {
                sidebarHtml = `<div style="padding:20px 15px;color:#9ca3af;text-align:center;font-size:0.9em;">無激活條目</div>`;
                contentHtml = `
                    <div style="display:flex;height:100%;align-items:center;justify-content:center;color:#9ca3af;flex-direction:column">
                        <i class="fa-solid fa-ghost" style="font-size:3em;margin-bottom:15px;opacity:0.5"></i>
                        <div>目前上下文未激活任何條目</div>
                    </div>`;
            } else {
                activatedEntries.forEach((entry, idx) => {
                    const title = entry.comment || (entry.key && entry.key.length ? entry.key[0] : `Entry #${entry.uid}`);

                    const isConstant = !!entry.constant;
                    const itemTypeClass = isConstant ? 'type-blue' : 'type-green';
                    const barColorClass = isConstant ? 'wb-bar-blue' : 'wb-bar-green';

                    let posVal = typeof entry.position === 'number' ? entry.position : 1;
                    let posText = posMapping[posVal] || '未知位置';
                    if (posVal === 4) {
                        posText = `@D ${entry.depth ?? 4}`;
                    }

                    const typeLabel = isConstant ? '藍燈' : '綠燈';
                    const orderVal = entry.order ?? 0;
                    const tooltipText = `${typeLabel} ${posText} ${orderVal}`;
                    const colorMode = isConstant ? 'blue' : 'green';

                    const rawContent = (entry.content || '').replace(/</g, '&lt;');
                    originalContentMap.set(`ctx-block-${idx}`, { title, content: rawContent });

                    sidebarHtml += `
                        <div class="wb-ctx-sidebar-item ${itemTypeClass}" data-target="ctx-block-${idx}" id="sidebar-item-${idx}" title="${tooltipText}" data-color-mode="${colorMode}">
                            <div class="wb-ctx-bar ${barColorClass}"></div>
                            <div class="wb-ctx-info">
                                <span class="wb-ctx-name">${title}</span>
                            </div>
                        </div>`;

                    contentHtml += `
                        <div id="ctx-block-${idx}" class="wb-ctx-block" data-idx="${idx}">
                            <div class="wb-ctx-block-title">
                                <span class="title-text">${title}</span>
                                <span style="font-size:0.8em; font-weight:normal; color:#9ca3af; margin-left:auto; font-family: 'Segoe UI', sans-serif;">
                                    ${posText}
                                </span>
                            </div>
                            <div class="wb-ctx-block-content">${rawContent}</div>
                        </div>`;
                });
            }

            const overlay = document.createElement('div');
            overlay.className = 'wb-sort-modal-overlay';
            overlay.style.zIndex = '22000';

            const isSidebarCollapsed = localStorage.getItem('wb_ctx_sidebar_collapsed') === 'true';

            overlay.innerHTML = `
                <div class="wb-sort-modal" style="width:1000px; height:85vh; max-width:95vw; border-radius:12px; overflow:hidden; display:flex; flex-direction:column; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);">
                    <div class="wb-sort-header" style="background:#2d2d2d; border-bottom:1px solid #404040; padding:10px 20px; height:60px;">
                        <span style="font-size:1.1em; font-weight:bold; color:#e5e5e5; display:flex; align-items:center; gap:15px;">
                            <i class="fa-solid fa-align-left" id="wb-ctx-toggle-sidebar" style="cursor:pointer; color:#a0a0a0; transition:0.2s" title="切換側邊欄"></i>
                            <span class="wb-ctx-header-title-text">實際上下文預覽</span>
                        </span>
                        <div style="display:flex; align-items:center;">
                            <div class="wb-ctx-search-container">
                                <i class="fa-solid fa-magnifying-glass" style="color:#9ca3af; font-size:0.9em;"></i>
                                <input type="text" class="wb-ctx-search-input" placeholder="檢索關鍵詞...">
                                <div class="wb-ctx-nav-controls">
                                    <div class="wb-ctx-nav-btn" id="wb-search-up"><i class="fa-solid fa-arrow-up"></i></div>
                                    <div class="wb-ctx-nav-btn" id="wb-search-down"><i class="fa-solid fa-arrow-down"></i></div>
                                    <div class="wb-ctx-nav-info">0/0</div>
                                </div>
                            </div>
                            <i class="fa-solid fa-heading" id="wb-ctx-toggle-clean" style="cursor:pointer; color:#9ca3af; font-size:1.2em; padding:5px; margin-left:10px;" title="切換純淨模式 (僅顯示內容)"></i>
                            <div class="wb-close-btn" style="cursor:pointer; color:#9ca3af; font-size:1.2em; padding:5px; margin-left:10px;"><i class="fa-solid fa-xmark"></i></div>
                        </div>
                    </div>
                    <div class="wb-ctx-layout-container">
                        <div class="wb-ctx-sidebar-panel ${isSidebarCollapsed ? 'collapsed' : ''}" id="wb-ctx-sidebar">${sidebarHtml}</div>
                        <div class="wb-ctx-viewer-panel" id="wb-ctx-viewer">${contentHtml}</div>
                    </div>
                </div>`;

            document.body.appendChild(overlay);
            UI.setupModalPositioning(overlay.querySelector('.wb-sort-modal'), overlay);

            const sidebar = overlay.querySelector('#wb-ctx-sidebar');
            const viewer = overlay.querySelector('#wb-ctx-viewer');
            const sidebarItems = Array.from(sidebar.querySelectorAll('.wb-ctx-sidebar-item'));
            const blocks = Array.from(viewer.querySelectorAll('.wb-ctx-block'));
            const toggleBtn = overlay.querySelector('#wb-ctx-toggle-sidebar');
            const searchInput = overlay.querySelector('.wb-ctx-search-input');
            const navControls = overlay.querySelector('.wb-ctx-nav-controls');
            const navInfo = overlay.querySelector('.wb-ctx-nav-info');
            const btnUp = overlay.querySelector('#wb-search-up');
            const btnDown = overlay.querySelector('#wb-search-down');
            const cleanBtn = overlay.querySelector('#wb-ctx-toggle-clean');

            cleanBtn.onclick = () => {
                viewer.classList.toggle('wb-clean-mode');
                const isClean = viewer.classList.contains('wb-clean-mode');
                cleanBtn.style.color = isClean ? '#3b82f6' : '#9ca3af';
            };

            toggleBtn.onclick = () => {
                sidebar.classList.toggle('collapsed');
                const isCollapsed = sidebar.classList.contains('collapsed');
                toggleBtn.style.color = isCollapsed ? '#d1d5db' : '#6b7280';
                localStorage.setItem('wb_ctx_sidebar_collapsed', isCollapsed);
            };

            const scrollToBlock = (targetId) => {
                const targetEl = viewer.querySelector(`#${targetId}`);
                if (targetEl) {
                    const topPos = targetEl.offsetTop - 20;
                    viewer.scrollTo({ top: topPos, behavior: 'smooth' });
                }
            };

            sidebarItems.forEach(item => {
                item.onclick = () => {
                    sidebarItems.forEach(i => i.classList.remove('active'));
                    item.classList.add('active');
                    scrollToBlock(item.dataset.target);
                };
            });

            let scrollTimeout;
            viewer.addEventListener('scroll', () => {
                if (scrollTimeout) clearTimeout(scrollTimeout);
                scrollTimeout = setTimeout(() => {
                    const viewerTop = viewer.scrollTop;
                    const viewerHeight = viewer.clientHeight;

                    let activeId = null;
                    const visibleBlocks = blocks.filter(b => b.style.display !== 'none');

                    for (let block of visibleBlocks) {
                        if (block.offsetTop <= viewerTop + 100) {
                            activeId = block.id;
                        } else {
                            if (!activeId) activeId = block.id;
                            break;
                        }
                    }

                    if (activeId) {
                        sidebarItems.forEach(i => {
                            if (i.dataset.target === activeId) i.classList.add('active');
                            else i.classList.remove('active');
                        });
                        const activeItem = sidebar.querySelector(`.active`);
                        if (activeItem) {
                            activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                        }
                    }
                }, 100);
            });
            viewer.dispatchEvent(new Event('scroll'));

            let searchDebounce;
            let currentMatches = [];
            let currentMatchIndex = -1;

            const updateNavInfo = () => {
                if (currentMatches.length > 0) {
                    navControls.classList.add('show');
                    navInfo.textContent = `${currentMatchIndex + 1}/${currentMatches.length}`;
                } else {
                    navControls.classList.remove('show');
                    navInfo.textContent = "0/0";
                }
            };

            const jumpToMatch = (index) => {
                if (index < 0 || index >= currentMatches.length) return;
                currentMatchIndex = index;

                currentMatches.forEach(el => el.classList.remove('active'));

                const target = currentMatches[index];
                target.classList.add('active');
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                updateNavInfo();
            };

            searchInput.addEventListener('input', (e) => {
                const term = e.target.value.trim();

                if (searchDebounce) clearTimeout(searchDebounce);
                searchDebounce = setTimeout(() => {
                    currentMatches = [];
                    currentMatchIndex = -1;

                    if (!term) {
                        blocks.forEach(block => {
                            const data = originalContentMap.get(block.id);
                            if (data) {
                                block.querySelector('.wb-ctx-block-content').innerHTML = data.content;
                                block.querySelector('.title-text').innerHTML = data.title;
                            }
                            block.classList.remove('filtered-out');
                        });
                        sidebarItems.forEach(item => item.classList.remove('filtered-out'));
                        navControls.classList.remove('show');
                        viewer.dispatchEvent(new Event('scroll'));
                        return;
                    }

                    const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');

                    blocks.forEach((block, i) => {
                        const data = originalContentMap.get(block.id);
                        if (!data) return;

                        const titleMatch = regex.test(data.title);
                        const contentMatch = regex.test(data.content);
                        const hasMatch = titleMatch || contentMatch;

                        if (hasMatch) {
                            block.classList.remove('filtered-out');
                            sidebarItems[i].classList.remove('filtered-out');

                            if (contentMatch) {
                                block.querySelector('.wb-ctx-block-content').innerHTML = data.content.replace(regex, '<span class="wb-search-highlight">$1</span>');
                            } else {
                                block.querySelector('.wb-ctx-block-content').innerHTML = data.content;
                            }

                            if (titleMatch) {
                                block.querySelector('.title-text').innerHTML = data.title.replace(regex, '<span class="wb-search-highlight">$1</span>');
                            } else {
                                block.querySelector('.title-text').innerHTML = data.title;
                            }

                        } else {
                            block.classList.add('filtered-out');
                            sidebarItems[i].classList.add('filtered-out');
                        }
                    });

                    currentMatches = Array.from(viewer.querySelectorAll('.wb-search-highlight'));
                    if (currentMatches.length > 0) {
                        jumpToMatch(0);
                    } else {
                        updateNavInfo();
                    }

                }, 300);
            });

            btnUp.onclick = () => {
                let next = currentMatchIndex - 1;
                if (next < 0) next = currentMatches.length - 1;
                jumpToMatch(next);
            };
            btnDown.onclick = () => {
                let next = currentMatchIndex + 1;
                if (next >= currentMatches.length) next = 0;
                jumpToMatch(next);
            };

            const close = () => overlay.remove();
            overlay.querySelector('.wb-close-btn').onclick = close;
            overlay.onclick = (e) => { if (e.target === overlay) close(); };

        } catch (e) {
            toastr.clear(loadingToast);
            console.error(e);
            toastr.error("計算上下文失敗: " + e.message);
        }
    },

    showDeleteWbConfirmModal(bookName, onConfirm, onDisable) {
        const overlay = document.createElement('div');
        overlay.className = 'wb-sort-modal-overlay';
        overlay.style.zIndex = '25000';
        overlay.innerHTML = `
            <div class="wb-sort-modal" id="wb-del-confirm-box" style="width:400px; height:auto; border-radius:12px; overflow:hidden;">
                <div style="padding:20px; text-align:center;">
                    <div style="font-size:3em; color:#f59e0b; margin-bottom:10px;"><i class="fa-solid fa-triangle-exclamation"></i></div>
                    <h3 style="margin:0 0 10px 0; color:#1f2937;">關聯刪除</h3>
                    <p style="color:#4b5563;">是否同時刪除角色綁定的主要世界書<br><strong>${bookName}</strong>?</p>
                    <div style="margin-top:15px; border-top:1px solid #f3f4f6; padding-top:10px;">
                         <button class="wb-btn-modal btn-disable" style="color:#9ca3af; background:none; border:none; cursor:pointer; text-decoration:underline; font-size:0.9em;">禁用該功能</button>
                    </div>
                </div>
                <div style="background:#f9fafb; padding:15px; display:flex; justify-content:center; gap:20px; border-top:1px solid #e5e7eb;">
                    <button class="wb-btn-modal btn-cancel" style="padding:8px 25px; border-radius:6px; border:1px solid #000; background:#000; color:#fff; cursor:pointer;">取消</button>
                    <button class="wb-btn-modal btn-confirm" style="padding:8px 25px; border-radius:6px; border:none; background:#ef4444; color:#fff; cursor:pointer;">刪除</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        this.setupModalPositioning(overlay.querySelector('.wb-sort-modal'), overlay);
        overlay.querySelector('.btn-cancel').onclick = () => overlay.remove();
        overlay.querySelector('.btn-confirm').onclick = () => {
            onConfirm();
            toastr.success(`已刪除世界書：${bookName}`);
            overlay.remove();
        };
        overlay.querySelector('.btn-disable').onclick = () => { onDisable(); overlay.remove(); };
    },

    initTooltips() {
        if (this._tooltipInited) return;
        this._tooltipInited = true;
        const tipEl = document.createElement('div');
        tipEl.className = 'wb-tooltip';
        document.body.appendChild(tipEl);

        const show = (text, x, y, colorMode) => {
            tipEl.textContent = text;
            tipEl.classList.remove('blue', 'green');
            if (colorMode) tipEl.classList.add(colorMode);
            tipEl.classList.add('show');

            const rect = tipEl.getBoundingClientRect();
            let left = x + 15;
            let top = y + 15;
            if (left + rect.width > window.innerWidth) left = x - rect.width - 5;
            if (top + rect.height > window.innerHeight) top = y - rect.height - 5;

            tipEl.style.left = left + 'px';
            tipEl.style.top = top + 'px';
        };
        const hide = () => {
            tipEl.classList.remove('show', 'blue', 'green');
        };

        let isTouchInteraction = false;
        document.body.addEventListener('mouseover', (e) => {
            if (isTouchInteraction) return;

            const container = e.target.closest(`#${CONFIG.id}, .wb-modal-overlay, .wb-sort-modal-overlay`);
            if (!container) return;

            const target = e.target.closest('[title], [data-wb-tooltip]');
            if (target) {
                const text = target.getAttribute('title') || target.getAttribute('data-wb-tooltip');
                const colorMode = target.dataset.colorMode;
                if (target.getAttribute('title')) { 
                    target.setAttribute('data-wb-tooltip', text); 
                    target.removeAttribute('title'); 
                }
                if (text) show(text, e.clientX, e.clientY, colorMode);
            }
        });
        document.body.addEventListener('mouseout', hide);

        let touchTimer = null;
        document.body.addEventListener('touchstart', (e) => {
            isTouchInteraction = true;
            hide();

            const container = e.target.closest(`#${CONFIG.id}, .wb-modal-overlay, .wb-sort-modal-overlay`);
            if (!container) return;

            const target = e.target.closest('[title], [data-wb-tooltip]');
            if (!target) return;

            const text = target.getAttribute('title') || target.getAttribute('data-wb-tooltip');
            const colorMode = target.dataset.colorMode;
            if (target.getAttribute('title')) { 
                target.setAttribute('data-wb-tooltip', text); 
                target.removeAttribute('title'); 
            }

            if (text) {
                touchTimer = setTimeout(() => {
                    const touch = e.touches[0];
                    show(text, touch.clientX, touch.clientY, colorMode);
                }, 500);
            }
        }, { passive: true });

        const cancelTouch = () => {
            if (touchTimer) {
                clearTimeout(touchTimer);
                touchTimer = null;
            }
            setTimeout(() => { isTouchInteraction = false; }, 500);
            hide();
        };

        document.body.addEventListener('touchend', cancelTouch);
        document.body.addEventListener('touchmove', () => {
            if (touchTimer) clearTimeout(touchTimer);
        });
    }
};

jQuery(async () => {

    const injectButton = () => {
        if (document.getElementById(CONFIG.btnId)) return;

        const container = document.querySelector('#options .options-content');

        if (container) {
            const targetClasses = 'interactable';

            const html = `
                <a id="${CONFIG.btnId}" class="${targetClasses}" title="世界書管理" tabindex="0">
                    <i class="fa-lg fa-solid fa-book-journal-whills"></i>
                    <span>世界書</span>
                </a>
            `;

            $(container).append(html);

            $(`#${CONFIG.btnId}`).on('click', (e) => {
                e.preventDefault();
                $('#options').hide();
                UI.open();
            });

            console.log("[世界書編輯器] 按鈕已成功注入到 .options-content。");
        } else {
            console.warn("[世界書編輯器] 找不到目標容器 #options .options-content。跳過按鈕注入。");
        }
    };

    injectButton();

    const performInit = async () => {
        try {
            await Actions.init();
            console.log("[世界書編輯器] 預載入完成。");
        } catch (e) {
            console.error("[世界書編輯器] 預載入失敗:", e);
        }
    };

    if (typeof world_names === 'undefined') {
        console.log("[世界書編輯器] 等待 APP_READY...");
        eventSource.on(event_types.APP_READY, performInit);
    } else {
        performInit();
    }

    console.log("世界書編輯器增強腳本已載入");
});
