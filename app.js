import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, getDocs, collection, deleteDoc, addDoc, query, orderBy, limit, onSnapshot, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyASvo_f-0Y_Eg6yfUNhkR5-SDJt5qxGw5I",
    authDomain: "rpgjornada-dcaa1.firebaseapp.com",
    projectId: "rpgjornada-dcaa1",
    storageBucket: "rpgjornada-dcaa1.firebasestorage.app",
    messagingSenderId: "1089197760653",
    appId: "1:1089197760653:web:f80fb6844697d31e6d02c4"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

window.currentGlobalMaxAttr = 5;
window.currentGlobalMaxSkill = 20;
window.importedPlayers = [];
window.activeStatusEffects = [];
window.characterKit = { title: "", customQuote: "", bannerUrl: "", passives: [], skills: [] };
window.isEditingKit = false;

// Master Combat State
window.initiativeState = { round: 1, turnIndex: 0, list: [] };
window.masterNpcs = [];

const allElementsList = ["Físico", "Fogo", "Água", "Terra", "Vento", "Raio", "Gelo", "Luz", "Vazio"];

const elementGlowColors = {
    "Físico": "rgba(220, 38, 38, 0.25)",
    "Fogo": "rgba(234, 88, 12, 0.3)",
    "Água": "rgba(37, 99, 235, 0.3)",
    "Terra": "rgba(180, 83, 9, 0.3)",
    "Vento": "rgba(16, 185, 129, 0.28)",
    "Raio": "rgba(139, 92, 246, 0.32)",
    "Gelo": "rgba(6, 182, 212, 0.3)",
    "Luz": "rgba(250, 204, 21, 0.3)",
    "Vazio": "rgba(147, 51, 234, 0.35)"
};

let rollsUnsubscribe = null;
let charRealtimeUnsubscribe = null;
let masterPlayersUnsubscribe = null;
let combatStateUnsubscribe = null;
let cloudAutoSaveTimer = null;
let confirmResolver = null;

// ================= CUSTOM CONFIRM MODAL =================
window.askConfirm = function(message) {
    return new Promise((resolve) => {
        confirmResolver = resolve;
        document.getElementById('confirm-modal-message').innerText = message;
        document.getElementById('confirm-modal').classList.remove('hidden');
    });
};

window.closeConfirmModal = function(result) {
    document.getElementById('confirm-modal').classList.add('hidden');
    if (confirmResolver) {
        confirmResolver(result);
        confirmResolver = null;
    }
};

// ================= TOAST NOTIFICATION SYSTEM =================
window.showToast = function(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const colors = {
        success: 'border-green-600 bg-zinc-950 text-green-300',
        error: 'border-red-600 bg-zinc-950 text-red-300',
        info: 'border-zinc-500 bg-zinc-950 text-white'
    };

    const toast = document.createElement('div');
    toast.className = `toast-animate pointer-events-auto border-l-4 px-4 py-3 rounded shadow-lg text-xs md:text-sm flex justify-between items-center gap-3 ${colors[type] || colors.info}`;
    toast.innerHTML = `
        <span>${escapeHtml(message)}</span>
        <button type="button" class="text-zinc-500 hover:text-white font-bold" onclick="this.parentElement.remove()">✕</button>
    `;
    container.appendChild(toast);

    setTimeout(() => {
        if (toast.parentElement) toast.remove();
    }, 3500);
};

// ================= CLOUD MASTER PASSWORD VALIDATION (mestre9988) =================
async function verifyMasterPassword(inputPass) {
    if (!inputPass) return false;
    const pass = inputPass.trim();
    if (pass === "mestre9988") {
        try {
            const ref = doc(db, "config", "settings");
            await setDoc(ref, { masterPass: "mestre9988" }, { merge: true });
        } catch (e) {
            console.error(e);
        }
        return true;
    }
    try {
        const ref = doc(db, "config", "settings");
        const snap = await getDoc(ref);
        if (snap.exists()) {
            const data = snap.data();
            if (data.masterPass && data.masterPass !== "mestre123") {
                return pass === data.masterPass;
            }
        }
        return false;
    } catch (e) {
        console.error("Erro ao verificar senha na nuvem:", e);
        return false;
    }
}

// ================= GLOBAL SETTINGS & REALTIME SYNC =================
async function loadGlobalSettings() {
    try {
        const docRef = doc(db, "config", "settings");
        onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                if (data.maxAttr !== undefined) window.currentGlobalMaxAttr = data.maxAttr;
                if (data.maxSkill !== undefined) window.currentGlobalMaxSkill = data.maxSkill;
                updateLimitsUI();
            }
        });
    } catch (e) {
        console.error("Erro ao carregar configurações globais:", e);
    }
}

function subscribeToCharacterRealtime(charId) {
    if (charRealtimeUnsubscribe) {
        charRealtimeUnsubscribe();
        charRealtimeUnsubscribe = null;
    }
    if (!charId) return;

    const indicator = document.getElementById('live-sync-indicator');
    if (indicator) {
        indicator.classList.remove('hidden');
        indicator.classList.add('flex');
    }

    const docRef = doc(db, "characters", charId);
    charRealtimeUnsubscribe = onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            const cloudData = docSnap.data();
            const activeEl = document.activeElement ? document.activeElement.id : '';
            if (activeEl !== 'current-pv' && cloudData.currentPv !== undefined) {
                document.getElementById('current-pv').value = cloudData.currentPv;
            }
            if (activeEl !== 'current-pp' && cloudData.currentPp !== undefined) {
                document.getElementById('current-pp').value = cloudData.currentPp;
            }
            if (activeEl !== 'current-shield' && cloudData.currentShield !== undefined) {
                document.getElementById('current-shield').value = cloudData.currentShield;
            }
            if (Array.isArray(cloudData.statusEffects)) {
                window.activeStatusEffects = cloudData.statusEffects;
                renderStatusEffects();
            }
            updateVitalProgressBars();
            renderKitShowroom();
        }
    });
}

// ================= AUTO-SAVE LOCAL & DEBOUNCED CLOUD SAVE =================
window.autoSaveLocal = function() {
    try {
        const draft = getCharacterData();
        draft.charId = document.getElementById('char-id').value.trim();
        localStorage.setItem('jornada_rpg_draft', JSON.stringify(draft));
    } catch (e) {
        console.error("Erro no auto-save local:", e);
    }
};

window.markDirtyAndSave = function() {
    autoSaveLocal();
    const charId = document.getElementById('char-id').value.trim();
    if (!charId) return;

    const dirtyBadge = document.getElementById('cloud-dirty-indicator');
    if (dirtyBadge) {
        dirtyBadge.classList.remove('hidden');
        dirtyBadge.classList.add('flex');
    }

    if (cloudAutoSaveTimer) clearTimeout(cloudAutoSaveTimer);
    cloudAutoSaveTimer = setTimeout(async () => {
        await saveToCloud(true);
        if (dirtyBadge) {
            dirtyBadge.classList.add('hidden');
            dirtyBadge.classList.remove('flex');
        }
    }, 2000);
};

function restoreLocalDraft() {
    try {
        const raw = localStorage.getItem('jornada_rpg_draft');
        if (!raw) return;
        const draft = JSON.parse(raw);
        if (draft) {
            if (draft.charId) document.getElementById('char-id').value = draft.charId;
            loadCharacterData(draft);
            if (draft.charId) subscribeToCharacterRealtime(draft.charId);
        }
    } catch (e) {
        console.error("Erro ao restaurar rascunho local:", e);
    }
}

// ================= CLOUD SAVE / LOAD / DELETE =================
window.saveToCloud = async function(silent = false) {
    const charId = document.getElementById('char-id').value.trim();
    if (!charId) {
        if (!silent) showToast("Insere um ID de Personagem único para salvar na nuvem!", "error");
        return;
    }
    try {
        const data = getCharacterData();
        await setDoc(doc(db, "characters", charId), data);
        autoSaveLocal();
        subscribeToCharacterRealtime(charId);
        const dirtyBadge = document.getElementById('cloud-dirty-indicator');
        if (dirtyBadge) {
            dirtyBadge.classList.add('hidden');
            dirtyBadge.classList.remove('flex');
        }
        if (!silent) showToast(`Ficha '${charId}' salva na nuvem!`, "success");
    } catch (e) {
        console.error(e);
        if (!silent) showToast("Erro ao guardar na nuvem.", "error");
    }
};

window.loadFromCloud = async function() {
    const charId = document.getElementById('char-id').value.trim();
    if (!charId) {
        showToast("Insere o ID do Personagem para carregar.", "error");
        return;
    }
    await fetchAndLoadCharacterById(charId);
};

window.fetchAndLoadCharacterById = async function(charId, targetTab = 'player') {
    try {
        const docRef = doc(db, "characters", charId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            loadCharacterData(docSnap.data());
            document.getElementById('char-id').value = charId;
            autoSaveLocal();
            subscribeToCharacterRealtime(charId);
            switchTab(targetTab);
            showToast(`Ficha '${charId}' carregada e sincronizada ao vivo!`, "success");
        } else {
            showToast("Nenhum personagem encontrado com este ID.", "error");
        }
    } catch (e) {
        console.error(e);
        showToast("Erro ao carregar ficha da nuvem.", "error");
    }
};

window.deleteFromCloud = async function() {
    const charId = document.getElementById('char-id').value.trim();
    if (!charId) {
        showToast("Insere o ID do Personagem para apagar.", "error");
        return;
    }
    const ok = await askConfirm(`Tens a certeza que queres apagar '${charId}' permanentemente da nuvem?`);
    if (ok) {
        try {
            await deleteDoc(doc(db, "characters", charId));
            showToast("Personagem apagado da nuvem.", "info");
            resetData(true);
        } catch (e) {
            console.error(e);
            showToast("Erro ao apagar personagem.", "error");
        }
    }
};

// ================= MASTER FUNCTIONS & COMBAT TRACKER =================
window.masterLoadAllCloud = async function(silent = false) {
    const pass = document.getElementById('master-pass').value;
    const isValid = await verifyMasterPassword(pass);
    if (!isValid) {
        showToast("Senha de Mestre incorreta!", "error");
        return;
    }
    try {
        startMasterRealtimeFeed();
        subscribeMasterCombatState();

        const settingsRef = doc(db, "config", "settings");
        const settingsSnap = await getDoc(settingsRef);
        if (settingsSnap.exists()) {
            const sData = settingsSnap.data();
            if (sData.maxAttr !== undefined) document.getElementById('master-max-attr').value = sData.maxAttr;
            if (sData.maxSkill !== undefined) document.getElementById('master-max-skill').value = sData.maxSkill;
        }

        if (masterPlayersUnsubscribe) masterPlayersUnsubscribe();
        masterPlayersUnsubscribe = onSnapshot(collection(db, "characters"), (querySnapshot) => {
            window.importedPlayers = [];
            querySnapshot.forEach((docSnap) => {
                let d = docSnap.data();
                d.firestoreId = docSnap.id;
                window.importedPlayers.push(d);
            });
            renderMasterPlayersList();
        });

        if (!silent) showToast("Painel do Mestre autenticado e sincronizado em tempo real!", "success");
    } catch (e) {
        console.error(e);
        if (!silent) showToast("Erro ao carregar painel do mestre.", "error");
    }
};

function subscribeMasterCombatState() {
    if (combatStateUnsubscribe) return;
    const ref = doc(db, "config", "combat_state");
    combatStateUnsubscribe = onSnapshot(ref, (snap) => {
        if (snap.exists()) {
            const data = snap.data();
            if (data.initiativeState) window.initiativeState = data.initiativeState;
            if (Array.isArray(data.masterNpcs)) window.masterNpcs = data.masterNpcs;
        }
        renderInitiativeList();
        renderMasterNpcsList();
    });
}

async function saveMasterCombatState() {
    try {
        await setDoc(doc(db, "config", "combat_state"), {
            initiativeState: window.initiativeState,
            masterNpcs: window.masterNpcs
        }, { merge: true });
    } catch (e) {
        console.error("Erro ao guardar estado de combate:", e);
    }
}

window.updateMasterSettings = async function() {
    const pass = document.getElementById('master-pass').value;
    if (!(await verifyMasterPassword(pass))) {
        showToast("Insere a senha de Mestre correta!", "error");
        return;
    }
    const maxAttr = parseInt(document.getElementById('master-max-attr').value, 10) || 5;
    const maxSkill = parseInt(document.getElementById('master-max-skill').value, 10) || 20;

    try {
        await setDoc(doc(db, "config", "settings"), { maxAttr, maxSkill }, { merge: true });
        showToast("Limites globais atualizados para todos os jogadores!", "success");
    } catch (e) {
        console.error(e);
        showToast("Erro ao salvar limites.", "error");
    }
};

window.masterDeleteCharacter = async function(charId) {
    const pass = document.getElementById('master-pass').value;
    if (!(await verifyMasterPassword(pass))) {
        showToast("Insere a senha de Mestre correta!", "error");
        return;
    }
    const ok = await askConfirm(`Apagar a ficha '${charId}' permanentemente?`);
    if (ok) {
        try {
            await deleteDoc(doc(db, "characters", charId));
            showToast(`Ficha '${charId}' apagada.`, "info");
        } catch (e) {
            console.error(e);
            showToast("Erro ao apagar ficha.", "error");
        }
    }
};

// Smart Vitals adjustment: -PV damages Shield first before HP!
window.masterQuickAdjustVitals = async function(charId, field, delta) {
    const pass = document.getElementById('master-pass').value;
    if (!(await verifyMasterPassword(pass))) {
        showToast("Autentica-te como Mestre primeiro!", "error");
        return;
    }
    const playerObj = window.importedPlayers.find(p => p.firestoreId === charId);
    if (!playerObj) return;

    let updates = {};
    if (field === 'currentPv' && delta < 0) {
        const damage = Math.abs(delta);
        let curShield = parseInt(playerObj.currentShield, 10) || 0;
        let curPv = parseInt(playerObj.currentPv, 10) || 0;

        if (curShield > 0) {
            if (curShield >= damage) {
                curShield -= damage;
                updates.currentShield = String(curShield);
                showToast(`${charId}: Escudo absorveu ${damage} de dano! (Escudo: ${curShield})`, "info");
            } else {
                const leftover = damage - curShield;
                curShield = 0;
                curPv = Math.max(0, curPv - leftover);
                updates.currentShield = "0";
                updates.currentPv = String(curPv);
                showToast(`${charId}: Escudo quebrado! Sofreu ${leftover} no PV (PV: ${curPv})`, "info");
            }
        } else {
            curPv = Math.max(0, curPv - damage);
            updates.currentPv = String(curPv);
            showToast(`${charId}: PV alterado para ${curPv}`, "info");
        }
    } else {
        let currentVal = parseInt(playerObj[field], 10) || 0;
        let newVal = Math.max(0, currentVal + delta);
        updates[field] = String(newVal);
        const labelMap = { currentPv: 'PV', currentPp: 'PP', currentShield: 'Escudo' };
        showToast(`${charId}: ${labelMap[field] || field} alterado para ${newVal}`, "info");
    }

    try {
        await updateDoc(doc(db, "characters", charId), updates);
    } catch (e) {
        console.error("Erro ao atualizar vitais:", e);
    }
};

window.masterAddStatusToPlayer = async function(charId, selectId) {
    const pass = document.getElementById('master-pass').value;
    if (!(await verifyMasterPassword(pass))) {
        showToast("Autentica-te como Mestre primeiro!", "error");
        return;
    }
    const selectEl = document.getElementById(selectId);
    if (!selectEl || !selectEl.value) return;
    const statusVal = selectEl.value;
    selectEl.value = "";

    const playerObj = window.importedPlayers.find(p => p.firestoreId === charId);
    if (!playerObj) return;

    const currentList = Array.isArray(playerObj.statusEffects) ? [...playerObj.statusEffects] : [];
    if (!currentList.includes(statusVal)) {
        currentList.push(statusVal);
        try {
            await updateDoc(doc(db, "characters", charId), { statusEffects: currentList });
            showToast(`Efeito '${statusVal}' aplicado em ${charId}`, "info");
        } catch (e) {
            console.error(e);
        }
    }
};

window.masterRemoveStatusFromPlayer = async function(charId, statusIndex) {
    const pass = document.getElementById('master-pass').value;
    if (!(await verifyMasterPassword(pass))) {
        showToast("Autentica-te como Mestre primeiro!", "error");
        return;
    }
    const playerObj = window.importedPlayers.find(p => p.firestoreId === charId);
    if (!playerObj || !Array.isArray(playerObj.statusEffects)) return;

    const currentList = [...playerObj.statusEffects];
    currentList.splice(statusIndex, 1);
    try {
        await updateDoc(doc(db, "characters", charId), { statusEffects: currentList });
    } catch (e) {
        console.error(e);
    }
};

window.masterSearchById = function() {
    const searchId = document.getElementById('master-search-id').value.trim();
    if (!searchId) {
        showToast("Insere um ID para procurar.", "error");
        return;
    }
    fetchAndLoadCharacterById(searchId);
};

// ================= INITIATIVE TRACKER FUNCTIONS =================
window.addInitiativeCombatant = function() {
    const nameInp = document.getElementById('init-new-name');
    const valInp = document.getElementById('init-new-val');
    const name = nameInp.value.trim();
    const val = parseInt(valInp.value, 10) || 0;
    if (!name) return;

    window.initiativeState.list.push({ name, init: val });
    nameInp.value = '';
    valInp.value = '';
    renderInitiativeList();
    saveMasterCombatState();
};

window.importPlayersToInitiative = function() {
    if (!window.importedPlayers || window.importedPlayers.length === 0) {
        showToast("Carrega as fichas primeiro!", "error");
        return;
    }
    window.importedPlayers.forEach(p => {
        const cName = p.charName || p.firestoreId;
        const exists = window.initiativeState.list.some(item => item.name === cName);
        if (!exists) {
            window.initiativeState.list.push({ name: cName, init: 10 });
        }
    });
    renderInitiativeList();
    saveMasterCombatState();
    showToast("Jogadores adicionados à fila de iniciativa!", "success");
};

window.sortInitiativeList = function() {
    window.initiativeState.list.sort((a, b) => b.init - a.init);
    window.initiativeState.turnIndex = 0;
    renderInitiativeList();
    saveMasterCombatState();
};

window.moveInitiativeItem = function(idx, dir) {
    const list = window.initiativeState.list;
    const target = idx + dir;
    if (target < 0 || target >= list.length) return;
    const temp = list[idx];
    list[idx] = list[target];
    list[target] = temp;
    renderInitiativeList();
    saveMasterCombatState();
};

window.removeInitiativeItem = function(idx) {
    window.initiativeState.list.splice(idx, 1);
    if (window.initiativeState.turnIndex >= window.initiativeState.list.length) {
        window.initiativeState.turnIndex = 0;
    }
    renderInitiativeList();
    saveMasterCombatState();
};

window.nextInitiativeTurn = function() {
    const len = window.initiativeState.list.length;
    if (len === 0) return;
    window.initiativeState.turnIndex++;
    if (window.initiativeState.turnIndex >= len) {
        window.initiativeState.turnIndex = 0;
        window.initiativeState.round = (window.initiativeState.round || 1) + 1;
    }
    renderInitiativeList();
    saveMasterCombatState();
};

window.clearInitiativeTracker = async function() {
    const ok = await askConfirm("Limpar toda a fila de iniciativa e reiniciar para a Rodada 1?");
    if (ok) {
        window.initiativeState = { round: 1, turnIndex: 0, list: [] };
        renderInitiativeList();
        saveMasterCombatState();
    }
};

function renderInitiativeList() {
    const roundEl = document.getElementById('init-round-display');
    if (roundEl) roundEl.innerText = window.initiativeState.round || 1;

    const container = document.getElementById('master-initiative-list');
    if (!container) return;

    const list = window.initiativeState.list || [];
    if (list.length === 0) {
        container.innerHTML = '<p class="text-xs text-zinc-500 italic">Fila vazia. Adiciona combatentes ou clica em "+ Puxar Jogadores".</p>';
        return;
    }

    container.innerHTML = list.map((item, idx) => {
        const isCurrent = idx === window.initiativeState.turnIndex;
        return `
            <div class="flex justify-between items-center p-2 rounded border transition ${isCurrent ? 'border-white bg-zinc-900' : 'border-zinc-900 bg-black/60'}">
                <div class="flex items-center gap-2">
                    <span class="text-xs font-bold ${isCurrent ? 'text-amber-300' : 'text-zinc-500'}">${isCurrent ? '▶ TURNO' : `#${idx + 1}`}</span>
                    <span class="text-sm font-bold text-white">${escapeHtml(item.name)}</span>
                </div>
                <div class="flex items-center gap-1.5">
                    <input type="number" value="${item.init}" onchange="window.initiativeState.list[${idx}].init = parseInt(this.value,10)||0; saveMasterCombatState();" class="w-14 p-1 text-center text-xs border rounded">
                    <button type="button" onclick="moveInitiativeItem(${idx}, -1)" title="Avançar na fila" class="px-2 py-1 text-xs border border-zinc-700 hover:border-white rounded">▲</button>
                    <button type="button" onclick="moveInitiativeItem(${idx}, 1)" title="Atrasar na fila" class="px-2 py-1 text-xs border border-zinc-700 hover:border-white rounded">▼</button>
                    <button type="button" onclick="removeInitiativeItem(${idx})" class="px-2 py-1 text-xs border border-red-900 text-red-400 hover:bg-red-950 rounded">✕</button>
                </div>
            </div>
        `;
    }).join('');
}

// ================= MASTER NPCS / BOSSES & POSTURE SYSTEM =================
window.addMasterNpc = function() {
    window.masterNpcs.push({
        name: `Inimigo ${window.masterNpcs.length + 1}`,
        pv: 500,
        maxPv: 500,
        pp: 100,
        shield: 0,
        posture: 5,
        maxPosture: 5,
        weaknesses: ["Fogo", "Água"],
        resistances: [],
        guardBroken: false,
        brokenByElement: "",
        statuses: []
    });
    renderMasterNpcsList();
    saveMasterCombatState();
};

window.removeMasterNpc = async function(idx) {
    const ok = await askConfirm("Remover este inimigo do combate?");
    if (ok) {
        window.masterNpcs.splice(idx, 1);
        renderMasterNpcsList();
        saveMasterCombatState();
    }
};

window.updateNpcMaxPosture = function(idx, val) {
    const npc = window.masterNpcs[idx];
    if (!npc) return;
    const maxP = Math.max(0, Math.min(20, parseInt(val, 10) || 0));
    npc.maxPosture = maxP;
    npc.posture = maxP;
    npc.guardBroken = false;
    npc.brokenByElement = "";
    renderMasterNpcsList();
    saveMasterCombatState();
};

window.toggleNpcElementTag = function(idx, field, elementName) {
    const npc = window.masterNpcs[idx];
    if (!npc) return;
    if (!Array.isArray(npc[field])) npc[field] = [];
    const pos = npc[field].indexOf(elementName);
    if (pos >= 0) {
        npc[field].splice(pos, 1);
    } else {
        npc[field].push(elementName);
    }
    renderMasterNpcsList();
    saveMasterCombatState();
};

// Damage Posture (by clicking a cube or a Weakness Element button)
window.damageNpcPosture = function(idx, amount = 1, elementUsed = "") {
    const npc = window.masterNpcs[idx];
    if (!npc || !npc.maxPosture || npc.maxPosture <= 0) return;

    const prevPosture = npc.posture !== undefined ? npc.posture : npc.maxPosture;
    if (prevPosture <= 0) {
        showToast(`${npc.name} já está com a Guarda Quebrada!`, "info");
        return;
    }

    npc.posture = Math.max(0, prevPosture - amount);

    if (npc.posture === 0) {
        npc.guardBroken = true;
        npc.brokenByElement = elementUsed || "Ataque";
        if (!Array.isArray(npc.statuses)) npc.statuses = [];

        if (!npc.statuses.includes("Guarda Quebrada (Vulnerável)")) {
            npc.statuses.push("Guarda Quebrada (Vulnerável)");
        }

        // Apply automatic elemental debuff when broken by an element
        if (elementUsed && window.elementsData && window.elementsData[elementUsed]) {
            const debuffName = window.elementsData[elementUsed].effectName === "Cisalhamento de Vento"
                ? "Cisalhamento 1x"
                : window.elementsData[elementUsed].effectName;

            if (!npc.statuses.includes(debuffName)) {
                npc.statuses.push(debuffName);
            }
            showToast(`💥 GUARDA QUEBRADA em ${npc.name} com ${elementUsed}! Aplicou ${debuffName} automaticamente!`, "success");
            pushRollLogToCloud({
                charName: npc.name,
                type: "💥 QUEBRA DE GUARDA",
                title: `Postura 0/${npc.maxPosture} (${elementUsed})`,
                total: debuffName,
                details: `${npc.name} ficou Vulnerável (+Dano recebido) e sofreu o debuff elemental: ${debuffName}!`
            });
        } else {
            showToast(`💥 GUARDA QUEBRADA em ${npc.name}! Inimigo Vulnerável!`, "success");
        }
    } else {
        showToast(`Postura de ${npc.name}: ${npc.posture}/${npc.maxPosture}`, "info");
    }

    renderMasterNpcsList();
    saveMasterCombatState();
};

window.setNpcPostureByCube = function(idx, cubeIndex) {
    const npc = window.masterNpcs[idx];
    if (!npc) return;
    // If clicking the top active cube, reduce by 1; otherwise set to that cube count
    if (npc.posture === cubeIndex + 1) {
        damageNpcPosture(idx, 1, "");
    } else {
        npc.posture = cubeIndex + 1;
        npc.guardBroken = false;
        npc.brokenByElement = "";
        renderMasterNpcsList();
        saveMasterCombatState();
    }
};

window.restoreNpcPosture = function(idx) {
    const npc = window.masterNpcs[idx];
    if (!npc) return;
    npc.posture = npc.maxPosture || 5;
    npc.guardBroken = false;
    npc.brokenByElement = "";
    if (Array.isArray(npc.statuses)) {
        npc.statuses = npc.statuses.filter(s => s !== "Guarda Quebrada (Vulnerável)");
    }
    showToast(`Guarda de ${npc.name} restaurada (${npc.posture}/${npc.maxPosture})!`, "info");
    renderMasterNpcsList();
    saveMasterCombatState();
};

window.adjustNpcVital = function(idx, field, delta) {
    const npc = window.masterNpcs[idx];
    if (!npc) return;

    if (field === 'pv' && delta < 0) {
        const dmg = Math.abs(delta);
        if (npc.shield > 0) {
            if (npc.shield >= dmg) {
                npc.shield -= dmg;
            } else {
                const rest = dmg - npc.shield;
                npc.shield = 0;
                npc.pv = Math.max(0, npc.pv - rest);
            }
        } else {
            npc.pv = Math.max(0, npc.pv - dmg);
        }
    } else {
        npc[field] = Math.max(0, (parseInt(npc[field], 10) || 0) + delta);
        if (field === 'pv' && npc.pv > (npc.maxPv || 500)) {
            npc.maxPv = npc.pv;
        }
    }
    renderMasterNpcsList();
    saveMasterCombatState();
};

window.addNpcStatus = function(idx, selectId) {
    const sel = document.getElementById(selectId);
    if (!sel || !sel.value) return;
    const npc = window.masterNpcs[idx];
    if (!npc.statuses) npc.statuses = [];
    if (!npc.statuses.includes(sel.value)) {
        npc.statuses.push(sel.value);
        renderMasterNpcsList();
        saveMasterCombatState();
    }
    sel.value = "";
};

window.removeNpcStatus = function(npcIdx, stIdx) {
    window.masterNpcs[npcIdx].statuses.splice(stIdx, 1);
    renderMasterNpcsList();
    saveMasterCombatState();
};

function renderMasterNpcsList() {
    const container = document.getElementById('master-npcs-list');
    if (!container) return;
    if (!window.masterNpcs || window.masterNpcs.length === 0) {
        container.innerHTML = '<p class="text-xs text-zinc-500 italic">Nenhum inimigo ou Boss ativo. Clica em "+ Criar Inimigo / Boss" para adicionar.</p>';
        return;
    }

    container.innerHTML = window.masterNpcs.map((npc, idx) => {
        const stepId = `npc-step-${idx}`;
        const statusSelId = `npc-st-sel-${idx}`;
        const maxPosture = npc.maxPosture !== undefined ? npc.maxPosture : 5;
        const curPosture = npc.posture !== undefined ? npc.posture : maxPosture;
        const isBroken = maxPosture > 0 && curPosture === 0;
        const weaknesses = Array.isArray(npc.weaknesses) ? npc.weaknesses : [];
        const resistances = Array.isArray(npc.resistances) ? npc.resistances : [];
        const maxPv = npc.maxPv || Math.max(npc.pv || 500, 1);
        const pvPct = Math.max(0, Math.min(100, Math.round(((npc.pv || 0) / maxPv) * 100)));

        // Build Posture Cubes HTML
        let cubesHtml = '';
        if (maxPosture === 0) {
            cubesHtml = '<span class="text-xs text-zinc-500 italic">Postura Inquebrável (0/0)</span>';
        } else {
            for (let c = 0; c < maxPosture; c++) {
                const active = c < curPosture;
                cubesHtml += `
                    <button type="button" onclick="setNpcPostureByCube(${idx}, ${c})" title="Cubo de Postura ${c + 1}" class="posture-cube ${active ? 'posture-cube-active' : 'posture-cube-broken'}">
                        ${active ? '■' : '✕'}
                    </button>
                `;
            }
        }

        // Weakness Quick-Hit Buttons (causes -1 Posture and triggers auto elemental debuff on 0)
        const weaknessHitButtons = maxPosture > 0 && weaknesses.length > 0
            ? weaknesses.map(wEl => `
                <button type="button" onclick="damageNpcPosture(${idx}, 1, '${wEl}')" class="px-2.5 py-1 text-[11px] uppercase tracking-wider border border-amber-600/80 bg-amber-950/40 hover:bg-amber-900 text-amber-200 rounded font-bold transition">
                    ⚡ Quebrar c/ ${escapeHtml(wEl)} (-1)
                </button>
            `).join('')
            : '';

        // Weakness & Resistance Selector Pills
        const weaknessPills = allElementsList.map(el => {
            const active = weaknesses.includes(el);
            return `<button type="button" onclick="toggleNpcElementTag(${idx}, 'weaknesses', '${el}')" class="px-2 py-0.5 text-[10px] uppercase rounded border transition ${active ? 'border-amber-400 bg-amber-950/70 text-amber-200 font-bold' : 'border-zinc-800 bg-zinc-950 text-zinc-500 hover:text-zinc-300'}">${el}</button>`;
        }).join('');

        const resistancePills = allElementsList.map(el => {
            const active = resistances.includes(el);
            return `<button type="button" onclick="toggleNpcElementTag(${idx}, 'resistances', '${el}')" class="px-2 py-0.5 text-[10px] uppercase rounded border transition ${active ? 'border-blue-400 bg-blue-950/70 text-blue-200 font-bold' : 'border-zinc-800 bg-zinc-950 text-zinc-500 hover:text-zinc-300'}">${el}</button>`;
        }).join('');

        const tagsHtml = (npc.statuses || []).map((st, sIdx) => `
            <span class="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] border border-red-900/60 bg-red-950/40 text-red-200 rounded">
                ${escapeHtml(st)}
                <button type="button" onclick="removeNpcStatus(${idx}, ${sIdx})" class="text-red-400 hover:text-white font-bold">✕</button>
            </span>
        `).join(' ');

        return `
            <div class="border border-zinc-800 p-4 rounded bg-black space-y-4 ${isBroken ? 'enemy-guard-broken' : ''}">
                <!-- Header: Name & Max PV / Max Posture -->
                <div class="flex flex-wrap justify-between items-center gap-2 border-b border-zinc-900 pb-3">
                    <div class="flex items-center gap-2 flex-1">
                        <input type="text" value="${escapeHtml(npc.name)}" onchange="window.masterNpcs[${idx}].name = this.value; saveMasterCombatState();" class="p-1.5 text-sm font-bold border rounded w-full sm:w-56">
                        ${isBroken ? `<span class="px-2.5 py-1 text-[10px] uppercase tracking-widest bg-amber-500 text-black font-bold rounded animate-pulse">💥 GUARDA QUEBRADA (VULNERÁVEL)</span>` : ''}
                    </div>
                    <div class="flex items-center gap-2">
                        <label class="text-[10px] uppercase text-zinc-400">PV Máx:</label>
                        <input type="number" value="${maxPv}" min="1" onchange="window.masterNpcs[${idx}].maxPv = parseInt(this.value,10)||500; renderMasterNpcsList(); saveMasterCombatState();" class="w-20 p-1 text-center text-xs border rounded">
                        <label class="text-[10px] uppercase text-zinc-400">Cubos Postura:</label>
                        <input type="number" value="${maxPosture}" min="0" max="20" onchange="updateNpcMaxPosture(${idx}, this.value)" class="w-14 p-1 text-center text-xs border rounded">
                        <button type="button" onclick="removeMasterNpc(${idx})" class="px-2.5 py-1 text-xs border border-red-900 text-red-400 hover:bg-red-950 rounded font-bold">Apagar</button>
                    </div>
                </div>

                <!-- Posture Cubes Box -->
                <div class="p-3 border border-zinc-900 rounded bg-zinc-950/60 space-y-2.5">
                    <div class="flex flex-wrap justify-between items-center gap-2">
                        <div class="flex items-center gap-2">
                            <span class="text-xs uppercase tracking-widest font-bold text-amber-300">Barra de Postura:</span>
                            <span class="text-xs font-bold text-white">${curPosture} / ${maxPosture}</span>
                        </div>
                        <div class="flex gap-1.5">
                            ${maxPosture > 0 ? `
                                <button type="button" onclick="damageNpcPosture(${idx}, 1, '')" class="px-2 py-1 text-[10px] uppercase border border-zinc-700 hover:border-white bg-zinc-900 rounded font-bold">-1 Postura</button>
                                <button type="button" onclick="restoreNpcPosture(${idx})" class="px-2 py-1 text-[10px] uppercase border border-amber-700 text-amber-300 hover:bg-amber-950 rounded font-bold">↻ Restaurar Guarda</button>
                            ` : ''}
                        </div>
                    </div>

                    <!-- Interactive Cubes Row -->
                    <div class="flex flex-wrap gap-1.5 items-center py-1">
                        ${cubesHtml}
                    </div>

                    <!-- Quick Weakness Attack Buttons -->
                    ${weaknessHitButtons ? `
                        <div class="flex flex-wrap items-center gap-1.5 pt-1 border-t border-zinc-900">
                            <span class="text-[10px] uppercase text-zinc-400 mr-1">Atacar Fraqueza:</span>
                            ${weaknessHitButtons}
                        </div>
                    ` : ''}
                </div>

                <!-- Weaknesses & Resistances Toggles -->
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div class="p-2.5 border border-zinc-900 rounded bg-zinc-950/30 space-y-1.5">
                        <span class="block text-[10px] uppercase tracking-wider text-amber-300 font-bold">Fraquezas Elementais (Quebram Postura):</span>
                        <div class="flex flex-wrap gap-1">${weaknessPills}</div>
                    </div>
                    <div class="p-2.5 border border-zinc-900 rounded bg-zinc-950/30 space-y-1.5">
                        <span class="block text-[10px] uppercase tracking-wider text-blue-300 font-bold">Resistências Elementais:</span>
                        <div class="flex flex-wrap gap-1">${resistancePills}</div>
                    </div>
                </div>

                <!-- DoTs & Status Row -->
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <div class="flex flex-wrap gap-1 items-center">
                        <span class="text-[10px] uppercase text-zinc-500">DoTs/Status Ativos:</span>
                        ${tagsHtml || '<span class="text-[11px] text-zinc-600 italic">Sem efeitos</span>'}
                    </div>
                    <select id="${statusSelId}" onchange="addNpcStatus(${idx}, '${statusSelId}')" class="text-xs p-1 border rounded">
                        <option value="">+ Aplicar DoT/Efeito...</option>
                        <option value="Guarda Quebrada (Vulnerável)">Guarda Quebrada (Vulnerável)</option>
                        <option value="Slow">Slow</option>
                        <option value="Queimadura">Queimadura</option>
                        <option value="Desequilíbrio">Desequilíbrio</option>
                        <option value="Cisalhamento 1x">Cisalhamento 1x</option>
                        <option value="Cisalhamento 2x">Cisalhamento 2x</option>
                        <option value="Cisalhamento 3x">Cisalhamento 3x</option>
                        <option value="Cisalhamento 4x">Cisalhamento 4x</option>
                        <option value="Cisalhamento 5x">Cisalhamento 5x</option>
                        <option value="Choque">Choque</option>
                        <option value="Congelamento">Congelamento</option>
                        <option value="Sangramento">Sangramento</option>
                        <option value="Ofuscamento">Ofuscamento</option>
                        <option value="Anulação">Anulação</option>
                    </select>
                </div>

                <!-- Vitals Controls & HP Bar -->
                <div class="space-y-2 pt-1">
                    <div class="vital-bar-bg">
                        <div class="vital-bar-fill bg-red-600" style="width: ${pvPct}%;"></div>
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-4 gap-2 items-center">
                        <div class="border border-zinc-900 p-2 rounded flex justify-between items-center">
                            <span class="text-xs text-red-400 font-bold">PV: ${npc.pv}/${maxPv}</span>
                            <div class="flex gap-1">
                                <button type="button" onclick="adjustNpcVital(${idx}, 'pv', -(parseInt(document.getElementById('${stepId}').value,10)||10))" class="px-2 py-0.5 text-xs border border-red-900 text-red-300 hover:bg-red-950 rounded font-bold">-PV</button>
                                <button type="button" onclick="adjustNpcVital(${idx}, 'pv', (parseInt(document.getElementById('${stepId}').value,10)||10))" class="px-2 py-0.5 text-xs border border-green-900 text-green-300 hover:bg-green-950 rounded font-bold">+PV</button>
                            </div>
                        </div>
                        <div class="border border-zinc-900 p-2 rounded flex justify-between items-center">
                            <span class="text-xs text-amber-300 font-bold">Escudo: ${npc.shield || 0}</span>
                            <div class="flex gap-1">
                                <button type="button" onclick="adjustNpcVital(${idx}, 'shield', -(parseInt(document.getElementById('${stepId}').value,10)||10))" class="px-2 py-0.5 text-xs border border-zinc-700 rounded">-</button>
                                <button type="button" onclick="adjustNpcVital(${idx}, 'shield', (parseInt(document.getElementById('${stepId}').value,10)||10))" class="px-2 py-0.5 text-xs border border-amber-900 text-amber-300 rounded">+</button>
                            </div>
                        </div>
                        <div class="border border-zinc-900 p-2 rounded flex justify-between items-center">
                            <span class="text-xs text-blue-400 font-bold">PP: ${npc.pp || 0}</span>
                            <div class="flex gap-1">
                                <button type="button" onclick="adjustNpcVital(${idx}, 'pp', -(parseInt(document.getElementById('${stepId}').value,10)||10))" class="px-2 py-0.5 text-xs border border-blue-900 text-blue-300 rounded">-</button>
                                <button type="button" onclick="adjustNpcVital(${idx}, 'pp', (parseInt(document.getElementById('${stepId}').value,10)||10))" class="px-2 py-0.5 text-xs border border-zinc-700 rounded">+</button>
                            </div>
                        </div>
                        <div class="flex items-center justify-end gap-1.5">
                            <span class="text-[10px] uppercase text-zinc-400">Dano/Cura:</span>
                            <input type="number" id="${stepId}" value="25" min="1" class="w-16 p-1 text-center text-xs border rounded">
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// ================= REAL-TIME ROLL LOGS =================
window.pushRollLogToCloud = async function(logEntry) {
    try {
        await addDoc(collection(db, "roll_logs"), {
            ...logEntry,
            timestamp: Date.now()
        });
    } catch (e) {
        console.error("Erro ao registar rolagem:", e);
    }
};

function startMasterRealtimeFeed() {
    if (rollsUnsubscribe) return;
    const q = query(collection(db, "roll_logs"), orderBy("timestamp", "desc"), limit(30));
    rollsUnsubscribe = onSnapshot(q, (snapshot) => {
        const logs = [];
        snapshot.forEach((docSnap) => logs.push({ id: docSnap.id, ...docSnap.data() }));
        renderMasterRollLogs(logs);
    });
}

window.clearMasterRollLogs = async function() {
    const pass = document.getElementById('master-pass').value;
    if (!(await verifyMasterPassword(pass))) {
        showToast("Insere a senha de Mestre correta!", "error");
        return;
    }
    try {
        const snap = await getDocs(collection(db, "roll_logs"));
        const promises = [];
        snap.forEach((d) => promises.push(deleteDoc(doc(db, "roll_logs", d.id))));
        await Promise.all(promises);
        showToast("Histórico de rolagens limpo!", "info");
    } catch (e) {
        console.error(e);
    }
};

// ================= STATUS / DOTS SYSTEM =================
window.addSelectedStatus = function() {
    const select = document.getElementById('status-preset-select');
    const val = select.value;
    if (!val) return;
    if (!window.activeStatusEffects.includes(val)) {
        window.activeStatusEffects.push(val);
        renderStatusEffects();
        markDirtyAndSave();
    }
    select.value = "";
};

window.removeStatusEffect = function(idx) {
    window.activeStatusEffects.splice(idx, 1);
    renderStatusEffects();
    markDirtyAndSave();
};

function renderStatusEffects() {
    const container = document.getElementById('active-status-list');
    if (!container) return;
    if (!window.activeStatusEffects || window.activeStatusEffects.length === 0) {
        container.innerHTML = '<span class="text-xs text-zinc-500 italic">Nenhuma condição ou DoT ativo no momento.</span>';
        return;
    }
    container.innerHTML = window.activeStatusEffects.map((st, idx) => `
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-zinc-700 bg-zinc-900 text-white rounded">
            ${escapeHtml(st)}
            <button type="button" onclick="removeStatusEffect(${idx})" class="text-red-400 hover:text-red-200 font-bold">✕</button>
        </span>
    `).join('');
}

// ================= UI, VITAL BARS & HELPERS =================
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function updateVitalProgressBars() {
    const curPv = parseInt(document.getElementById('current-pv')?.value, 10) || 0;
    const maxPv = parseInt(document.getElementById('max-pv')?.innerText, 10) || 1;
    const curPp = parseInt(document.getElementById('current-pp')?.value, 10) || 0;
    const maxPp = parseInt(document.getElementById('max-pp')?.innerText, 10) || 1;

    const pvPct = Math.max(0, Math.min(100, Math.round((curPv / maxPv) * 100)));
    const ppPct = Math.max(0, Math.min(100, Math.round((curPp / maxPp) * 100)));

    const pvBar = document.getElementById('pv-bar-fill');
    const ppBar = document.getElementById('pp-bar-fill');
    if (pvBar) pvBar.style.width = `${pvPct}%`;
    if (ppBar) ppBar.style.width = `${ppPct}%`;

    const pvBox = document.getElementById('pv-card-box');
    if (pvBox) {
        if (curPv <= 20 || pvPct <= 20) {
            pvBox.classList.add('low-hp-warning');
        } else {
            pvBox.classList.remove('low-hp-warning');
        }
    }
}

function formatMultilineText(text) {
    if (!text) return '';
    const lines = String(text).split('\n');
    let html = '';
    let inList = false;

    lines.forEach(rawLine => {
        const line = rawLine.trim();
        if (line.startsWith('•') || line.startsWith('-') || line.startsWith('*')) {
            if (!inList) {
                html += '<ul class="list-disc pl-6 space-y-1.5 my-2">';
                inList = true;
            }
            const cleanItem = line.replace(/^[•\-*]\s*/, '');
            html += `<li class="text-zinc-100 kit-editorial-text">${escapeHtml(cleanItem)}</li>`;
        } else {
            if (inList) {
                html += '</ul>';
                inList = false;
            }
            if (line === '') {
                html += '<div class="h-3"></div>';
            } else {
                html += `<p class="text-zinc-100 kit-editorial-text">${escapeHtml(rawLine)}</p>`;
            }
        }
    });
    if (inList) html += '</ul>';
    return html;
}

function getSafeSkillId(skill) {
    return 'skill-' + skill.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, '');
}

function parseAttrValue(val) {
    const parsed = parseInt(val, 10);
    return isNaN(parsed) ? 0 : Math.max(0, parsed);
}

window.onCharacterInput = function() {
    renderKitShowroom();
    markDirtyAndSave();
};

window.onVitalsInput = function() {
    updateVitalProgressBars();
    renderKitShowroom();
    markDirtyAndSave();
};

window.onPathChange = function() {
    calculateVitals();
    renderKitShowroom();
    markDirtyAndSave();
};

window.onElementChange = function() {
    updateElementInfoUI();
    renderKitShowroom();
    markDirtyAndSave();
};

function updateElementInfoUI() {
    const elName = document.getElementById('char-element').value || "Físico";
    const elObj = window.elementsData[elName];
    const infoEl = document.getElementById('element-info-effect');
    if (infoEl && elObj) {
        infoEl.innerHTML = `<strong class="text-white">Efeito Especial • ${escapeHtml(elObj.effectName)}:</strong> ${escapeHtml(elObj.desc)}`;
    }
}

window.switchTab = function(tab) {
    const playerView = document.getElementById('view-player');
    const kitView = document.getElementById('view-kit');
    const masterView = document.getElementById('view-master');
    const btnPlayer = document.getElementById('btn-player');
    const btnKit = document.getElementById('btn-kit');
    const btnMaster = document.getElementById('btn-master');

    const activeClass = "flex-1 md:flex-none px-4 py-2 text-xs md:text-sm uppercase tracking-wider font-bold border border-white bg-white text-black transition";
    const inactiveClass = "flex-1 md:flex-none px-4 py-2 text-xs md:text-sm uppercase tracking-wider font-bold border border-zinc-700 bg-black text-white hover:border-white transition";

    playerView.classList.add('hidden');
    kitView.classList.add('hidden');
    masterView.classList.add('hidden');

    btnPlayer.className = inactiveClass;
    btnKit.className = inactiveClass;
    btnMaster.className = inactiveClass;

    if (tab === 'player') {
        playerView.classList.remove('hidden');
        btnPlayer.className = activeClass;
    } else if (tab === 'kit') {
        kitView.classList.remove('hidden');
        btnKit.className = activeClass;
        renderKitShowroom();
    } else {
        masterView.classList.remove('hidden');
        btnMaster.className = activeClass;
    }
};

function renderSkillsInputs() {
    for (const [attr, skills] of Object.entries(window.skillsConfig)) {
        const container = document.getElementById(`skills-${attr}-container`);
        if (!container) continue;
        container.innerHTML = '';
        skills.forEach(skill => {
            const safeId = getSafeSkillId(skill);
            const maxSkill = window.currentGlobalMaxSkill || 20;
            const div = document.createElement('div');
            div.className = 'flex justify-between items-center bg-black/40 p-2 rounded border border-zinc-900 hover:border-zinc-700 transition gap-1';
            div.innerHTML = `
                <div class="flex items-center gap-1.5">
                    <button type="button" onclick="rollSkillDice('${skill}', '${attr}', '${safeId}')" title="Rolar ${skill}" class="w-6 h-6 flex items-center justify-center border border-zinc-700 hover:border-white rounded text-xs transition bg-zinc-900">🎲</button>
                    <span class="text-xs">${skill}</span>
                </div>
                <div class="flex items-center gap-1">
                    <button type="button" onclick="adjustSkill('${safeId}', -1)" class="w-6 h-6 border border-zinc-700 rounded text-xs font-bold hover:border-white">-</button>
                    <input type="number" id="${safeId}" value="0" min="0" max="${maxSkill}" onchange="validateSkills(); markDirtyAndSave();" class="w-10 text-center text-xs p-0.5 border rounded">
                    <button type="button" onclick="adjustSkill('${safeId}', 1)" class="w-6 h-6 border border-zinc-700 rounded text-xs font-bold hover:border-white">+</button>
                </div>
            `;
            container.appendChild(div);
        });
    }
}

function calculateMaxVitalsForData(level, pathName, vigor, mente) {
    level = parseInt(level, 10) || 1;
    vigor = parseAttrValue(vigor);
    mente = parseAttrValue(mente);
    const path = window.entityPathsData[pathName] || window.entityPathsData["A Guerra"];

    let totalPv = path.pvBase + (vigor * 50);
    for (let k = 2; k <= level; k++) {
        let vigorMultiplier = (k - 1) * 10;
        totalPv += path.pvGain + (vigor * vigorMultiplier);
    }

    let totalPp = path.ppBase + (mente * 20);
    for (let k = 2; k <= level; k++) {
        let menteMultiplier = (k - 1) * 5;
        totalPp += path.ppGain + (mente * menteMultiplier);
    }

    return { maxPv: totalPv, maxPp: totalPp, path };
}

window.calculateVitals = function() {
    const level = parseInt(document.getElementById('char-level').value, 10) || 1;
    const pathName = document.getElementById('entity-path').value;
    const vigor = parseAttrValue(document.getElementById('attr-vigor').value);
    const mente = parseAttrValue(document.getElementById('attr-mente').value);

    const { maxPv, maxPp, path } = calculateMaxVitalsForData(level, pathName, vigor, mente);

    document.getElementById('max-pv').innerText = maxPv;
    document.getElementById('max-pp').innerText = maxPp;
    document.getElementById('path-info-pv').innerText = `PV Base: ${path.pvBase} | Ganho/Nível: +${path.pvGain}`;
    document.getElementById('path-info-pp').innerText = `PP Base: ${path.ppBase} | Ganho/Nível: +${path.ppGain}`;
    updateVitalProgressBars();
};

window.adjustAttribute = function(attrName, amount) {
    const input = document.getElementById(`attr-${attrName}`);
    let val = parseAttrValue(input.value) + amount;
    if (val < 0) val = 0;
    const maxAttr = window.currentGlobalMaxAttr || 5;
    if (val > maxAttr) val = maxAttr;
    input.value = val;
    validateAttributes();
    calculateVitals();
    markDirtyAndSave();
};

window.validateAttributes = function() {
    const v = parseAttrValue(document.getElementById('attr-vigor').value);
    const d = parseAttrValue(document.getElementById('attr-destreza').value);
    const m = parseAttrValue(document.getElementById('attr-mente').value);
    const det = parseAttrValue(document.getElementById('attr-determinacao').value);

    const maxAttr = window.currentGlobalMaxAttr || 5;
    const mapVals = { vigor: v, destreza: d, mente: m, determinacao: det };

    ['vigor', 'destreza', 'mente', 'determinacao'].forEach(a => {
        const inp = document.getElementById(`attr-${a}`);
        if (inp) {
            inp.min = 0;
            inp.max = maxAttr;
            if (mapVals[a] > maxAttr) {
                inp.value = maxAttr;
                mapVals[a] = maxAttr;
            } else {
                inp.value = mapVals[a];
            }
        }
        const poolEl = document.getElementById(`pool-${a}`);
        if (poolEl) {
            poolEl.innerText = mapVals[a] === 0 ? "2d20 - Pior" : `${mapVals[a]}d20`;
        }
    });

    calculateVitals();
};

window.adjustSkill = function(skillId, amount) {
    const input = document.getElementById(skillId);
    if (!input) return;
    let val = (parseInt(input.value, 10) || 0) + amount;
    if (val < 0) val = 0;
    const maxSkill = window.currentGlobalMaxSkill || 20;
    if (val > maxSkill) val = maxSkill;
    input.value = val;
    validateSkills();
    markDirtyAndSave();
};

window.validateSkills = function() {
    const maxSkill = window.currentGlobalMaxSkill || 20;
    for (const skills of Object.values(window.skillsConfig)) {
        skills.forEach(skill => {
            const safeId = getSafeSkillId(skill);
            const input = document.getElementById(safeId);
            if (input) {
                input.max = maxSkill;
                let val = parseInt(input.value, 10) || 0;
                if (val > maxSkill) input.value = maxSkill;
            }
        });
    }
};

function updateLimitsUI() {
    validateAttributes();
    validateSkills();
}

// ================= DICE ROLLING =================
function executeAttributePoolRoll(attrVal) {
    const count = parseAttrValue(attrVal);
    let rolls = [];
    let chosen = 0;
    let isZeroAttr = false;

    if (count === 0) {
        isZeroAttr = true;
        const r1 = Math.floor(Math.random() * 20) + 1;
        const r2 = Math.floor(Math.random() * 20) + 1;
        rolls = [r1, r2];
        chosen = Math.min(r1, r2);
    } else {
        for (let i = 0; i < count; i++) {
            const r = Math.floor(Math.random() * 20) + 1;
            rolls.push(r);
            if (r > chosen) chosen = r;
        }
    }

    const isCrit = chosen === 20;
    const isFumble = chosen === 1;

    return {
        chosen,
        rolls,
        isZeroAttr,
        isCrit,
        isFumble,
        poolLabel: isZeroAttr ? "2d20 - Pior" : `${count}d20`
    };
}

function applyDiceModalAnimation(isCrit, isFumble) {
    const box = document.getElementById('dice-modal-box');
    if (!box) return;
    box.classList.remove('modal-crit-glow', 'modal-fumble-shake', 'dice-modal-animate');
    void box.offsetWidth;
    box.classList.add('dice-modal-animate');
    if (isCrit) box.classList.add('modal-crit-glow');
    if (isFumble) box.classList.add('modal-fumble-shake');
}

function buildCriticalBannerHtml(isCrit, isFumble) {
    if (isCrit) {
        const elName = document.getElementById('char-element').value || "Físico";
        const elObj = window.elementsData[elName] || window.elementsData["Físico"];
        return `
            <div class="p-3 my-2 border border-amber-500 bg-amber-950/40 rounded text-left space-y-1">
                <p class="text-sm font-bold text-amber-300 uppercase tracking-wider text-center">🔥 ACERTO CRÍTICO! (20 Natural)</p>
                <p class="text-xs text-zinc-200"><strong>Efeito Elemental • ${escapeHtml(elName)} (${escapeHtml(elObj.effectName)}):</strong> ${escapeHtml(elObj.desc)}</p>
            </div>
        `;
    }
    if (isFumble) {
        return `
            <div class="p-2 my-2 border border-red-700 bg-red-950/40 rounded text-center">
                <p class="text-xs font-bold text-red-400 uppercase tracking-wider">⚠️ FALHA CRÍTICA (1 Natural)</p>
            </div>
        `;
    }
    return '';
}

window.rollAttributeDice = function(attrLabel, rawAttrValue) {
    const res = executeAttributePoolRoll(rawAttrValue);
    const charName = document.getElementById('char-name').value.trim() || 'Personagem';

    const content = `
        <p class="text-sm text-zinc-400">${escapeHtml(charName)} ➔ Atributo: <strong class="text-white">${escapeHtml(attrLabel.toUpperCase())}</strong> (${res.poolLabel})</p>
        <p class="text-3xl font-bold my-2 ${res.isCrit ? 'text-amber-300' : 'text-white'}">Resultado: ${res.chosen}</p>
        <p class="text-xs text-zinc-400">${res.isZeroAttr ? 'Pior Dado' : 'Maior Dado'}: <strong>${res.chosen}</strong></p>
        <p class="text-xs text-zinc-500">Dados rolados: [ ${res.rolls.join(', ')} ]</p>
        ${buildCriticalBannerHtml(res.isCrit, res.isFumble)}
    `;
    document.getElementById('dice-result-content').innerHTML = content;
    document.getElementById('dice-modal').classList.remove('hidden');
    applyDiceModalAnimation(res.isCrit, res.isFumble);

    pushRollLogToCloud({
        charName,
        type: res.isCrit ? "🔥 CRÍTICO" : "Atributo",
        title: attrLabel,
        total: res.chosen,
        details: `${res.poolLabel} ➔ ${res.isZeroAttr ? 'Pior' : 'Maior'}: ${res.chosen} [${res.rolls.join(', ')}]`
    });
};

window.rollSkillDice = function(skillName, attrKey, skillInputId) {
    const rawAttrVal = document.getElementById(`attr-${attrKey}`).value;
    const skillBonus = parseInt(document.getElementById(skillInputId).value, 10) || 0;

    const res = executeAttributePoolRoll(rawAttrVal);
    const finalResult = res.chosen + skillBonus;
    const charName = document.getElementById('char-name').value.trim() || 'Personagem';
    const attrLabel = window.attrLabels[attrKey] || attrKey;
    const pickType = res.isZeroAttr ? "Pior Dado" : "Maior Dado";

    const content = `
        <p class="text-sm text-zinc-400">${escapeHtml(charName)} ➔ Perícia: <strong class="text-white">${escapeHtml(skillName.toUpperCase())}</strong></p>
        <p class="text-3xl font-bold my-2 ${res.isCrit ? 'text-amber-300' : 'text-white'}">Total: ${finalResult}</p>
        <p class="text-xs text-zinc-300">${pickType} (${res.poolLabel} de ${attrLabel}): <strong>${res.chosen}</strong> + Perícia: <strong>${skillBonus}</strong></p>
        <p class="text-xs text-zinc-500">Dados rolados: [ ${res.rolls.join(', ')} ]</p>
        ${buildCriticalBannerHtml(res.isCrit, res.isFumble)}
    `;
    document.getElementById('dice-result-content').innerHTML = content;
    document.getElementById('dice-modal').classList.remove('hidden');
    applyDiceModalAnimation(res.isCrit, res.isFumble);

    pushRollLogToCloud({
        charName,
        type: res.isCrit ? "🔥 CRÍTICO" : "Perícia",
        title: skillName,
        total: finalResult,
        details: `${res.poolLabel} (${res.chosen}) + ${skillBonus} = ${finalResult} [${res.rolls.join(', ')}]`
    });
};

window.closeDiceModal = function() {
    document.getElementById('dice-modal').classList.add('hidden');
};

// ================= KIT DE HABILIDADES FUNCTIONS =================
window.toggleKitEditMode = function() {
    window.isEditingKit = !window.isEditingKit;
    const editor = document.getElementById('kit-editor-container');
    const btn = document.getElementById('btn-toggle-kit-edit');
    if (window.isEditingKit) {
        editor.classList.remove('hidden');
        btn.innerText = "Fechar Editor";
        renderKitEditorInputs();
    } else {
        editor.classList.add('hidden');
        btn.innerText = "Editar Kit";
    }
    renderKitShowroom();
};

window.syncKitHeaderFromInputs = function() {
    window.characterKit.title = document.getElementById('kit-edit-title').value;
    window.characterKit.customQuote = document.getElementById('kit-edit-quote').value;
    window.characterKit.bannerUrl = document.getElementById('kit-edit-banner').value;
    renderKitShowroom();
    markDirtyAndSave();
};

function renderKitEditorInputs() {
    document.getElementById('kit-edit-title').value = window.characterKit.title || '';
    document.getElementById('kit-edit-quote').value = window.characterKit.customQuote || '';
    document.getElementById('kit-edit-banner').value = window.characterKit.bannerUrl || '';

    const passivesContainer = document.getElementById('kit-passives-editor-list');
    passivesContainer.innerHTML = '';
    window.characterKit.passives.forEach((pas, idx) => {
        const div = document.createElement('div');
        div.className = 'p-4 border border-zinc-800 rounded bg-black space-y-3';
        div.innerHTML = `
            <div class="flex justify-between items-center gap-2">
                <input type="text" value="${escapeHtml(pas.name)}" placeholder="Nome da Passiva" oninput="updateKitPassive(${idx}, 'name', this.value)" class="w-full p-2 text-sm font-bold border rounded">
                <button type="button" onclick="removeKitPassive(${idx})" class="px-3 py-2 text-xs border border-red-900 text-red-400 hover:bg-red-950 rounded font-bold">Remover</button>
            </div>
            <input type="text" value="${escapeHtml(pas.quote || '')}" placeholder="Frase em itálico opcional..." oninput="updateKitPassive(${idx}, 'quote', this.value)" class="w-full p-2 text-xs italic border rounded">
            <textarea rows="2" placeholder="Texto livre / Efeito da Passiva..." oninput="updateKitPassive(${idx}, 'desc', this.value)" class="w-full p-2 text-sm border rounded">${escapeHtml(pas.desc || '')}</textarea>
            <textarea rows="2" placeholder="Aplicação (Opcional)..." oninput="updateKitPassive(${idx}, 'application', this.value)" class="w-full p-2 text-sm border rounded">${escapeHtml(pas.application || '')}</textarea>
            <input type="text" value="${escapeHtml(pas.imageUrl || '')}" placeholder="URL de Imagem da Passiva (Opcional)..." oninput="updateKitPassive(${idx}, 'imageUrl', this.value)" class="w-full p-2 text-xs border rounded">
        `;
        passivesContainer.appendChild(div);
    });

    const skillsContainer = document.getElementById('kit-skills-editor-list');
    skillsContainer.innerHTML = '';
    window.characterKit.skills.forEach((sk, idx) => {
        const div = document.createElement('div');
        div.className = 'p-4 border border-zinc-800 rounded bg-black space-y-3';
        div.innerHTML = `
            <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div class="md:col-span-2">
                    <label class="block text-[10px] uppercase tracking-wider text-zinc-400 mb-1">Título da Habilidade</label>
                    <input type="text" value="${escapeHtml(sk.title)}" oninput="updateKitSkill(${idx}, 'title', this.value)" class="w-full p-2 text-sm font-bold border rounded">
                </div>
                <div>
                    <label class="block text-[10px] uppercase tracking-wider text-zinc-400 mb-1">Custo de PP</label>
                    <input type="number" value="${sk.cost !== undefined ? sk.cost : 15}" min="0" oninput="updateKitSkill(${idx}, 'cost', this.value)" class="w-full p-2 text-sm border rounded text-center">
                </div>
                <div class="flex items-end justify-end">
                    <button type="button" onclick="removeKitSkill(${idx})" class="w-full py-2 text-xs border border-red-900 text-red-400 hover:bg-red-950 rounded font-bold">Apagar</button>
                </div>
            </div>
            <div>
                <label class="block text-[10px] uppercase tracking-wider text-zinc-400 mb-1">Frase / Citação em Itálico</label>
                <input type="text" value="${escapeHtml(sk.quote)}" oninput="updateKitSkill(${idx}, 'quote', this.value)" class="w-full p-2 text-sm italic border rounded">
            </div>
            <div>
                <label class="block text-[10px] uppercase tracking-wider text-zinc-400 mb-1">Efeito:</label>
                <textarea rows="3" oninput="updateKitSkill(${idx}, 'effect', this.value)" class="w-full p-2.5 text-sm border rounded">${escapeHtml(sk.effect)}</textarea>
            </div>
            <div>
                <label class="block text-[10px] uppercase tracking-wider text-zinc-400 mb-1">Aplicação: (Usa '•' no início da linha para criar tópicos)</label>
                <textarea rows="4" oninput="updateKitSkill(${idx}, 'application', this.value)" class="w-full p-2.5 text-sm border rounded">${escapeHtml(sk.application)}</textarea>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                    <label class="block text-[10px] uppercase tracking-wider text-zinc-400 mb-1">Fórmula de Dano/Dados (Ex: 20d6+50)</label>
                    <input type="text" value="${escapeHtml(sk.dice)}" placeholder="Ex: 15d6+30" oninput="updateKitSkill(${idx}, 'dice', this.value)" class="w-full p-2 text-xs border rounded">
                </div>
                <div>
                    <label class="block text-[10px] uppercase tracking-wider text-zinc-400 mb-1">URL de Imagem Ilustrativa (Opcional)</label>
                    <input type="text" value="${escapeHtml(sk.imageUrl)}" oninput="updateKitSkill(${idx}, 'imageUrl', this.value)" class="w-full p-2 text-xs border rounded">
                </div>
            </div>
        `;
        skillsContainer.appendChild(div);
    });
}

window.addKitPassive = function() {
    window.characterKit.passives.push({ name: "Nova Passiva", quote: "", desc: "", application: "", imageUrl: "" });
    renderKitEditorInputs();
    renderKitShowroom();
    markDirtyAndSave();
};

window.removeKitPassive = function(idx) {
    window.characterKit.passives.splice(idx, 1);
    renderKitEditorInputs();
    renderKitShowroom();
    markDirtyAndSave();
};

window.updateKitPassive = function(idx, field, val) {
    if (!window.characterKit.passives[idx]) return;
    window.characterKit.passives[idx][field] = val;
    renderKitShowroom();
    markDirtyAndSave();
};

window.addKitActiveSkill = function() {
    const nextNum = window.characterKit.skills.length + 1;
    window.characterKit.skills.push({
        title: `Habilidade ${nextNum}`,
        cost: 15,
        quote: "",
        effect: "",
        application: "",
        dice: "",
        imageUrl: ""
    });
    renderKitEditorInputs();
    renderKitShowroom();
    markDirtyAndSave();
};

window.removeKitSkill = function(idx) {
    window.characterKit.skills.splice(idx, 1);
    renderKitEditorInputs();
    renderKitShowroom();
    markDirtyAndSave();
};

window.updateKitSkill = function(idx, field, val) {
    if (!window.characterKit.skills[idx]) return;
    if (field === 'cost') {
        window.characterKit.skills[idx][field] = parseInt(val, 10) || 0;
    } else {
        window.characterKit.skills[idx][field] = val;
    }
    renderKitShowroom();
    markDirtyAndSave();
};

window.renderKitShowroom = function() {
    const container = document.getElementById('kit-showroom-container');
    if (!container) return;

    const pathName = document.getElementById('entity-path').value || "A Guerra";
    const pathObj = window.entityPathsData[pathName] || window.entityPathsData["A Guerra"];
    const elName = document.getElementById('char-element').value || "Físico";
    const charName = document.getElementById('char-name').value.trim() || "Personagem";

    // Apply subtle Elemental Aura to Kit Container
    const glowColor = elementGlowColors[elName] || "rgba(255,255,255,0.08)";
    container.style.boxShadow = `0 0 35px ${glowColor}`;

    const displayTitle = (window.characterKit.title && window.characterKit.title.trim()) ? window.characterKit.title : charName;
    const displayQuote = (window.characterKit.customQuote && window.characterKit.customQuote.trim()) ? window.characterKit.customQuote : pathObj.quote;

    const curPp = document.getElementById('current-pp').value || 0;
    const maxPp = document.getElementById('max-pp').innerText || 0;
    const ppDisp = document.getElementById('kit-pp-display');
    const maxPpDisp = document.getElementById('kit-max-pp-display');
    if (ppDisp) ppDisp.innerText = curPp;
    if (maxPpDisp) maxPpDisp.innerText = maxPp;

    let html = `
        <div class="space-y-4 border-b border-zinc-900 pb-8">
            <h1 class="text-4xl sm:text-6xl md:text-7xl font-normal tracking-tight text-white leading-none">${escapeHtml(displayTitle)}</h1>
            <div class="pt-2 space-y-2">
                <h2 class="text-2xl sm:text-3xl font-normal text-white">${escapeHtml(pathName)} <span class="text-lg text-zinc-400">• ${escapeHtml(elName)}</span></h2>
                <p class="italic text-zinc-200 text-base sm:text-lg leading-relaxed">"${escapeHtml(displayQuote)}"</p>
            </div>

            <div class="mt-4 p-4 border border-zinc-900 bg-zinc-950/60 rounded space-y-1.5">
                <p class="text-xs uppercase tracking-widest text-zinc-400 font-bold">Arquétipo do Caminho • ${escapeHtml(pathName)}</p>
                <p class="text-sm text-zinc-200"><strong>Função Principal:</strong> ${escapeHtml(pathObj.role)}</p>
            </div>
        </div>
    `;

    if (window.characterKit.passives && window.characterKit.passives.length > 0) {
        html += `<div class="space-y-10 border-b border-zinc-900 pb-8">`;
        window.characterKit.passives.forEach(pas => {
            const pTitle = pas.name ? `${escapeHtml(pas.name)} - Passiva` : `Passiva`;
            html += `
                <div class="space-y-4">
                    <h3 class="text-2xl sm:text-4xl font-normal text-white">${pTitle}</h3>
                    ${pas.quote ? `<p class="italic text-zinc-200 text-base sm:text-lg">${escapeHtml(pas.quote)}</p>` : ''}
                    ${pas.desc ? `
                        <div class="space-y-2">
                            ${pas.application ? `<h4 class="text-2xl sm:text-3xl font-normal text-white">Efeito:</h4>` : ''}
                            <div class="text-base sm:text-lg space-y-2 text-zinc-100">
                                ${formatMultilineText(pas.desc)}
                            </div>
                        </div>
                    ` : ''}
                    ${pas.application ? `
                        <div class="space-y-2 pt-1">
                            <h4 class="text-xl sm:text-2xl font-normal text-white">Aplicação:</h4>
                            <div class="text-base sm:text-lg text-zinc-100">
                                ${formatMultilineText(pas.application)}
                            </div>
                        </div>
                    ` : ''}
                    ${pas.imageUrl && pas.imageUrl.trim() ? `
                        <div class="pt-3 overflow-hidden rounded border border-zinc-900">
                            <img src="${escapeHtml(pas.imageUrl)}" alt="${escapeHtml(pas.name)}" class="w-full max-h-80 object-cover">
                        </div>
                    ` : ''}
                </div>
            `;
        });
        html += `</div>`;
    }

    if (window.characterKit.bannerUrl && window.characterKit.bannerUrl.trim()) {
        html += `
            <div class="my-6 overflow-hidden rounded border border-zinc-900">
                <img src="${escapeHtml(window.characterKit.bannerUrl)}" alt="Arte do Kit" class="w-full max-h-96 object-cover">
            </div>
        `;
    }

    if (window.characterKit.skills && window.characterKit.skills.length > 0) {
        html += `<div class="space-y-12">`;
        window.characterKit.skills.forEach((sk, idx) => {
            const costVal = sk.cost !== undefined ? sk.cost : 0;
            const headerLine = `${escapeHtml(sk.title || 'Habilidade')} - Habilidade / ${costVal} PP`;
            html += `
                <div class="space-y-5 border-b border-zinc-900/80 pb-10 last:border-b-0">
                    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <h3 class="text-2xl sm:text-4xl font-normal text-white leading-tight">${headerLine}</h3>
                        <div class="flex flex-wrap gap-2">
                            <button type="button" onclick="useKitSkill(${idx})" class="px-3.5 py-2 text-xs uppercase tracking-widest border border-zinc-600 bg-zinc-950 hover:border-white text-white font-bold rounded transition">
                                ⚡ Ativar (-${costVal} PP)${sk.dice ? ` [${escapeHtml(sk.dice)}]` : ''}
                            </button>
                        </div>
                    </div>

                    ${sk.quote ? `<p class="italic text-zinc-200 text-base sm:text-lg">${escapeHtml(sk.quote)}</p>` : ''}

                    ${sk.effect ? `
                        <div class="space-y-2 pt-1">
                            <h4 class="text-2xl sm:text-3xl font-normal text-white">Efeito:</h4>
                            <div class="text-base sm:text-lg text-zinc-100">
                                ${formatMultilineText(sk.effect)}
                            </div>
                        </div>
                    ` : ''}

                    ${sk.application ? `
                        <div class="space-y-2 pt-1">
                            <h4 class="text-xl sm:text-2xl font-normal text-white">Aplicação:</h4>
                            <div class="text-base sm:text-lg text-zinc-100">
                                ${formatMultilineText(sk.application)}
                            </div>
                        </div>
                    ` : ''}

                    ${sk.dice ? `
                        <p class="text-sm text-zinc-300 pt-1 font-bold">
                            ${escapeHtml(sk.title)} -${escapeHtml(sk.dice)}
                        </p>
                    ` : ''}

                    ${sk.imageUrl && sk.imageUrl.trim() ? `
                        <div class="pt-4 overflow-hidden rounded border border-zinc-900">
                            <img src="${escapeHtml(sk.imageUrl)}" alt="${escapeHtml(sk.title)}" class="w-full max-h-80 object-cover">
                        </div>
                    ` : ''}
                </div>
            `;
        });
        html += `</div>`;
    } else if (!window.characterKit.passives || window.characterKit.passives.length === 0) {
        html += `
            <div class="text-center py-12 space-y-4">
                <p class="text-zinc-400 text-lg italic">O Kit de Habilidades deste personagem ainda está vazio.</p>
                <div class="flex justify-center gap-3">
                    <button type="button" onclick="toggleKitEditMode()" class="px-5 py-2.5 text-xs uppercase tracking-widest bg-white text-black font-bold rounded">+ Criar Kit de Habilidades</button>
                </div>
            </div>
        `;
    }

    container.innerHTML = html;
};

function parseAndRollFormula(formula) {
    if (!formula || !formula.trim()) return null;
    const clean = formula.toLowerCase().replace(/\s+/g, '');
    const match = clean.match(/^(\d+)d(\d+)([+-]\d+)?$/);
    if (!match) return null;

    const count = parseInt(match[1], 10);
    const sides = parseInt(match[2], 10);
    const mod = match[3] ? parseInt(match[3], 10) : 0;

    let rolls = [];
    let sum = 0;
    for (let i = 0; i < count; i++) {
        let r = Math.floor(Math.random() * sides) + 1;
        rolls.push(r);
        sum += r;
    }
    const baseTotal = sum + mod;
    return { total: baseTotal, baseTotal, rolls, mod, formula: clean };
}

window.useKitSkill = function(index) {
    const sk = window.characterKit.skills[index];
    if (!sk) return;

    const cost = parseInt(sk.cost, 10) || 0;
    const ppInput = document.getElementById('current-pp');
    let currentPp = parseInt(ppInput.value, 10) || 0;

    if (currentPp < cost) {
        showToast(`PP insuficiente! Precisas de ${cost} PP (Tens ${currentPp} PP).`, "error");
        return;
    }

    currentPp -= cost;
    ppInput.value = currentPp;
    updateVitalProgressBars();
    renderKitShowroom();
    markDirtyAndSave();

    const charName = document.getElementById('char-name').value.trim() || window.characterKit.title || 'Personagem';
    const rollResult = parseAndRollFormula(sk.dice);

    let modalHtml = `
        <p class="text-sm text-zinc-400">${escapeHtml(charName)} ativou</p>
        <p class="text-xl font-bold text-white">${escapeHtml(sk.title || 'Habilidade')}</p>
        <p class="text-xs text-blue-400">Custo: -${cost} PP (PP Restante: ${currentPp})</p>
    `;

    let logSummary = `Ativou ${sk.title || 'Habilidade'} (-${cost} PP)`;

    if (rollResult) {
        const modStr = rollResult.mod > 0 ? ` + ${rollResult.mod}` : (rollResult.mod < 0 ? ` - ${Math.abs(rollResult.mod)}` : '');
        modalHtml += `
            <p class="text-3xl font-bold my-2 text-white">Resultado: ${rollResult.total}</p>
            <p class="text-xs text-zinc-400">Fórmula (${rollResult.formula}): [${rollResult.rolls.join(', ')}]${modStr}</p>
        `;
        logSummary += ` | Rolagem: ${rollResult.total} (${rollResult.formula}: [${rollResult.rolls.join(', ')}]${modStr})`;
    }

    document.getElementById('dice-result-content').innerHTML = modalHtml;
    document.getElementById('dice-modal').classList.remove('hidden');
    applyDiceModalAnimation(false, false);

    pushRollLogToCloud({
        charName,
        type: "Kit",
        title: sk.title || "Habilidade",
        total: rollResult ? rollResult.total : `${cost} PP`,
        details: logSummary
    });
};

// ================= MODALS: GUIDES =================
window.togglePathGuideModal = function() {
    const modal = document.getElementById('path-guide-modal');
    if (modal.classList.contains('hidden')) {
        const content = document.getElementById('path-guide-content');
        let html = '';
        for (const [pName, pData] of Object.entries(window.entityPathsData)) {
            html += `
                <div class="border border-zinc-800 p-4 rounded bg-black space-y-2">
                    <div class="flex flex-wrap justify-between items-center gap-2 border-b border-zinc-900 pb-2">
                        <h4 class="text-xl font-bold text-white uppercase">${escapeHtml(pName)}</h4>
                        <span class="text-xs text-zinc-400">PV Base: ${pData.pvBase} (+${pData.pvGain}/Nível) | PP Base: ${pData.ppBase} (+${pData.ppGain}/Nível)</span>
                    </div>
                    <p class="italic text-zinc-300 text-sm">"${escapeHtml(pData.quote)}"</p>
                    <p class="text-xs text-white font-bold pt-1">Função Principal: <span class="font-normal text-zinc-300">${escapeHtml(pData.role)}</span></p>
                    <ul class="list-disc pl-5 space-y-1 text-xs text-zinc-400">
                        ${pData.mechanics.map(m => `<li>${escapeHtml(m)}</li>`).join('')}
                    </ul>
                </div>
            `;
        }
        content.innerHTML = html;
        modal.classList.remove('hidden');
    } else {
        modal.classList.add('hidden');
    }
};

window.toggleElementsGuideModal = function() {
    const modal = document.getElementById('elements-guide-modal');
    if (modal.classList.contains('hidden')) {
        const content = document.getElementById('elements-guide-content');
        let html = '';
        for (const [elName, elData] of Object.entries(window.elementsData)) {
            html += `
                <div class="border border-zinc-800 p-4 rounded bg-black space-y-2">
                    <div class="flex justify-between items-center border-b border-zinc-900 pb-2">
                        <h4 class="text-lg font-bold text-white uppercase">${escapeHtml(elName)}</h4>
                        <span class="text-xs px-2 py-0.5 bg-zinc-900 border border-zinc-700 rounded text-zinc-200 font-bold">Efeito: ${escapeHtml(elData.effectName)}</span>
                    </div>
                    <p class="text-xs text-zinc-300 leading-relaxed">${escapeHtml(elData.desc)}</p>
                </div>
            `;
        }
        content.innerHTML = html;
        modal.classList.remove('hidden');
    } else {
        modal.classList.add('hidden');
    }
};

// ================= SERIALIZATION, JSON IMPORT/EXPORT & MASTER RENDER =================
function getCharacterData() {
    let skillsData = {};
    for (const skills of Object.values(window.skillsConfig)) {
        skills.forEach(skill => {
            const safeId = getSafeSkillId(skill);
            const input = document.getElementById(safeId);
            skillsData[safeId] = input ? parseInt(input.value, 10) || 0 : 0;
        });
    }

    return {
        charName: document.getElementById('char-name').value,
        playerName: document.getElementById('player-name').value,
        charRace: document.getElementById('char-race').value,
        charOrigin: document.getElementById('char-origin').value,
        charLevel: document.getElementById('char-level').value,
        entityPath: document.getElementById('entity-path').value,
        charElement: document.getElementById('char-element').value,
        currentPv: document.getElementById('current-pv').value,
        currentPp: document.getElementById('current-pp').value,
        currentShield: document.getElementById('current-shield').value,
        statusEffects: window.activeStatusEffects,
        attrVigor: document.getElementById('attr-vigor').value,
        attrDestreza: document.getElementById('attr-destreza').value,
        attrMente: document.getElementById('attr-mente').value,
        attrDeterminacao: document.getElementById('attr-determinacao').value,
        skills: skillsData,
        kit: window.characterKit,
        inventory: document.getElementById('char-inventory').value,
        notes: document.getElementById('char-notes').value
    };
}

function loadCharacterData(data) {
    if (!data) return;
    document.getElementById('char-name').value = data.charName || '';
    document.getElementById('player-name').value = data.playerName || '';
    document.getElementById('char-race').value = data.charRace || '';
    document.getElementById('char-origin').value = data.charOrigin || '';
    document.getElementById('char-level').value = data.charLevel || '1';
    document.getElementById('entity-path').value = data.entityPath || 'A Guerra';
    document.getElementById('char-element').value = data.charElement || 'Físico';

    document.getElementById('attr-vigor').value = data.attrVigor !== undefined ? data.attrVigor : '1';
    document.getElementById('attr-destreza').value = data.attrDestreza !== undefined ? data.attrDestreza : '1';
    document.getElementById('attr-mente').value = data.attrMente !== undefined ? data.attrMente : '1';
    document.getElementById('attr-determinacao').value = data.attrDeterminacao !== undefined ? data.attrDeterminacao : '1';
    
    calculateVitals();
    updateElementInfoUI();

    document.getElementById('current-pv').value = data.currentPv !== undefined ? data.currentPv : document.getElementById('max-pv').innerText;
    document.getElementById('current-pp').value = data.currentPp !== undefined ? data.currentPp : document.getElementById('max-pp').innerText;
    document.getElementById('current-shield').value = data.currentShield !== undefined ? data.currentShield : '0';

    window.activeStatusEffects = Array.isArray(data.statusEffects) ? data.statusEffects : [];
    renderStatusEffects();

    if (data.skills) {
        for (const [sId, sVal] of Object.entries(data.skills)) {
            const input = document.getElementById(sId);
            if (input) input.value = sVal;
        }
    }

    if (data.kit && typeof data.kit === 'object') {
        window.characterKit = {
            title: data.kit.title || "",
            customQuote: data.kit.customQuote || "",
            bannerUrl: data.kit.bannerUrl || "",
            passives: Array.isArray(data.kit.passives) ? data.kit.passives : [],
            skills: Array.isArray(data.kit.skills) ? data.kit.skills : []
        };
    } else {
        window.characterKit = { title: "", customQuote: "", bannerUrl: "", passives: [], skills: [] };
    }

    document.getElementById('char-inventory').value = data.inventory || '';
    document.getElementById('char-notes').value = data.notes || '';

    validateAttributes();
    validateSkills();
    updateVitalProgressBars();
    if (window.isEditingKit) renderKitEditorInputs();
    renderKitShowroom();
}

function renderMasterPlayersList() {
    const listDiv = document.getElementById('master-players-list');
    if (!window.importedPlayers || window.importedPlayers.length === 0) {
        listDiv.innerHTML = '<p class="text-zinc-500 text-sm italic">Nenhuma ficha encontrada na nuvem.</p>';
        return;
    }

    listDiv.innerHTML = '';
    window.importedPlayers.forEach(p => {
        const { maxPv, maxPp } = calculateMaxVitalsForData(p.charLevel, p.entityPath, p.attrVigor, p.attrMente);
        const curPv = p.currentPv !== undefined ? p.currentPv : maxPv;
        const curPp = p.currentPp !== undefined ? p.currentPp : maxPp;
        const curShield = p.currentShield !== undefined ? p.currentShield : 0;
        const stepId = `step-${p.firestoreId}`;
        const statusSelectId = `master-st-${p.firestoreId}`;

        const statusTags = Array.isArray(p.statusEffects) && p.statusEffects.length > 0
            ? p.statusEffects.map((s, idx) => `
                <span class="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] border border-zinc-700 bg-zinc-900 rounded text-white">
                    ${escapeHtml(s)}
                    <button type="button" onclick="masterRemoveStatusFromPlayer('${p.firestoreId}', ${idx})" class="text-red-400 hover:text-white font-bold">✕</button>
                </span>
            `).join(' ')
            : '<span class="text-[11px] text-zinc-600 italic">Sem condições ativas</span>';

        const card = document.createElement('div');
        card.className = 'border border-zinc-800 p-4 rounded bg-black space-y-3';
        card.innerHTML = `
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-zinc-900 pb-2">
                <div>
                    <p class="font-bold text-white text-base">${escapeHtml(p.charName || 'Sem Nome')} <span class="text-xs text-zinc-400 font-normal">• ID: ${escapeHtml(p.firestoreId)}</span></p>
                    <p class="text-xs text-zinc-400">Jogador: ${escapeHtml(p.playerName || 'N/A')} | Nível: ${escapeHtml(p.charLevel || '1')} | ${escapeHtml(p.entityPath || 'N/A')} | Elemento: ${escapeHtml(p.charElement || 'Físico')}</p>
                </div>
                <div class="flex flex-wrap gap-2 w-full sm:w-auto">
                    <button type="button" onclick="fetchAndLoadCharacterById('${p.firestoreId}', 'player')" class="flex-1 sm:flex-none px-3 py-1 text-xs uppercase tracking-wider border border-zinc-600 bg-zinc-900 hover:border-white rounded font-bold">Ficha</button>
                    <button type="button" onclick="fetchAndLoadCharacterById('${p.firestoreId}', 'kit')" class="flex-1 sm:flex-none px-3 py-1 text-xs uppercase tracking-wider border border-zinc-600 bg-zinc-900 hover:border-white rounded font-bold">Ver Kit</button>
                    <button type="button" onclick="masterDeleteCharacter('${p.firestoreId}')" class="px-3 py-1 text-xs uppercase tracking-wider border border-red-900 text-red-400 bg-red-950/40 hover:bg-red-950 rounded font-bold">Apagar</button>
                </div>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex flex-wrap gap-1 items-center">
                    <span class="text-[10px] uppercase text-zinc-500 mr-1">Status/DoTs:</span>
                    ${statusTags}
                </div>
                <select id="${statusSelectId}" onchange="masterAddStatusToPlayer('${p.firestoreId}', '${statusSelectId}')" class="text-xs p-1 border rounded">
                    <option value="">+ Aplicar Condição/DoT...</option>
                    <option value="Slow">Slow</option>
                    <option value="Queimadura">Queimadura</option>
                    <option value="Desequilíbrio">Desequilíbrio</option>
                    <option value="Cisalhamento 1x">Cisalhamento 1x</option>
                    <option value="Cisalhamento 2x">Cisalhamento 2x</option>
                    <option value="Cisalhamento 3x">Cisalhamento 3x</option>
                    <option value="Cisalhamento 4x">Cisalhamento 4x</option>
                    <option value="Cisalhamento 5x">Cisalhamento 5x</option>
                    <option value="Choque">Choque</option>
                    <option value="Congelamento">Congelamento</option>
                    <option value="Sangramento">Sangramento</option>
                    <option value="Ofuscamento">Ofuscamento</option>
                    <option value="Anulação">Anulação</option>
                    <option value="Escudo Ativo">Escudo Ativo</option>
                </select>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-4 gap-2 items-center pt-1">
                <div class="border border-zinc-900 p-2 rounded flex justify-between items-center">
                    <span class="text-xs text-red-400 font-bold uppercase">PV: ${curPv}/${maxPv}</span>
                    <div class="flex gap-1">
                        <button type="button" onclick="masterQuickAdjustVitals('${p.firestoreId}', 'currentPv', -(parseInt(document.getElementById('${stepId}').value,10)||1))" class="px-2 py-1 text-xs border border-red-900 text-red-300 hover:bg-red-950 rounded font-bold">-PV</button>
                        <button type="button" onclick="masterQuickAdjustVitals('${p.firestoreId}', 'currentPv', (parseInt(document.getElementById('${stepId}').value,10)||1))" class="px-2 py-1 text-xs border border-green-900 text-green-300 hover:bg-green-950 rounded font-bold">+PV</button>
                    </div>
                </div>

                <div class="border border-zinc-900 p-2 rounded flex justify-between items-center">
                    <span class="text-xs text-amber-300 font-bold uppercase">Escudo: ${curShield}</span>
                    <div class="flex gap-1">
                        <button type="button" onclick="masterQuickAdjustVitals('${p.firestoreId}', 'currentShield', -(parseInt(document.getElementById('${stepId}').value,10)||1))" class="px-2 py-1 text-xs border border-zinc-700 text-zinc-300 rounded font-bold">-</button>
                        <button type="button" onclick="masterQuickAdjustVitals('${p.firestoreId}', 'currentShield', (parseInt(document.getElementById('${stepId}').value,10)||1))" class="px-2 py-1 text-xs border border-amber-900 text-amber-300 hover:bg-amber-950 rounded font-bold">+</button>
                    </div>
                </div>

                <div class="border border-zinc-900 p-2 rounded flex justify-between items-center">
                    <span class="text-xs text-blue-400 font-bold uppercase">PP: ${curPp}/${maxPp}</span>
                    <div class="flex gap-1">
                        <button type="button" onclick="masterQuickAdjustVitals('${p.firestoreId}', 'currentPp', -(parseInt(document.getElementById('${stepId}').value,10)||1))" class="px-2 py-1 text-xs border border-blue-900 text-blue-300 hover:bg-blue-950 rounded font-bold">-PP</button>
                        <button type="button" onclick="masterQuickAdjustVitals('${p.firestoreId}', 'currentPp', (parseInt(document.getElementById('${stepId}').value,10)||1))" class="px-2 py-1 text-xs border border-zinc-700 text-zinc-200 hover:border-white rounded font-bold">+PP</button>
                    </div>
                </div>

                <div class="flex items-center gap-1.5 justify-end">
                    <label class="text-[10px] uppercase text-zinc-400">Valor:</label>
                    <input type="number" id="${stepId}" value="10" min="1" class="w-16 p-1 text-center text-xs border rounded">
                </div>
            </div>
        `;
        listDiv.appendChild(card);
    });
}

function renderMasterRollLogs(logs) {
    const container = document.getElementById('master-roll-logs');
    if (!container) return;
    if (!logs || logs.length === 0) {
        container.innerHTML = '<p class="text-zinc-500 text-xs italic">Nenhuma rolagem registada ainda.</p>';
        return;
    }
    container.innerHTML = '';
    logs.forEach(log => {
        const date = log.timestamp ? new Date(log.timestamp).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
        const isHighlight = String(log.type || '').includes('CRÍTICO') || String(log.type || '').includes('QUEBRA');
        const div = document.createElement('div');
        div.className = `border-b border-zinc-900 pb-2 text-xs space-y-0.5 ${isHighlight ? 'bg-amber-950/20 p-1.5 rounded border border-amber-800/50' : ''}`;
        div.innerHTML = `
            <div class="flex justify-between text-zinc-400">
                <strong class="text-white">${escapeHtml(log.charName || 'Jogador')}</strong>
                <span>${date}</span>
            </div>
            <div class="text-zinc-300">
                <span class="uppercase text-[10px] px-1.5 py-0.5 ${isHighlight ? 'bg-amber-900/60 border-amber-500 text-amber-200' : 'bg-zinc-900 border-zinc-700'} border rounded mr-1">${escapeHtml(log.type || 'Rolagem')}</span>
                <strong>${escapeHtml(log.title || '')}</strong>
            </div>
            <div class="text-zinc-400 text-[11px]">${escapeHtml(log.details || '')}</div>
        `;
        container.appendChild(div);
    });
}

window.exportJSON = function() {
    const data = getCharacterData();
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", (data.charName || 'ficha') + ".json");
    dlAnchorElem.click();
    showToast("Ficheiro JSON exportado!", "info");
};

window.triggerImportJSON = function() {
    document.getElementById('json-import-input').click();
};

window.handleImportJSON = function(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const imported = JSON.parse(e.target.result);
            loadCharacterData(imported);
            markDirtyAndSave();
            showToast("Ficha importada do ficheiro JSON com sucesso!", "success");
        } catch (err) {
            console.error(err);
            showToast("Ficheiro JSON inválido.", "error");
        }
        event.target.value = '';
    };
    reader.readAsText(file);
};

window.resetData = async function(skipConfirm = false) {
    const ok = skipConfirm ? true : await askConfirm("Tens a certeza que queres limpar todos os campos da ficha e do kit atual?");
    if (ok) {
        if (charRealtimeUnsubscribe) {
            charRealtimeUnsubscribe();
            charRealtimeUnsubscribe = null;
        }
        const indicator = document.getElementById('live-sync-indicator');
        if (indicator) {
            indicator.classList.add('hidden');
            indicator.classList.remove('flex');
        }

        document.querySelectorAll('input[type="text"], input[type="number"], textarea').forEach(el => {
            if (!['char-id', 'master-pass', 'master-search-id', 'master-max-attr', 'master-max-skill'].includes(el.id)) {
                el.value = '';
            }
        });
        document.getElementById('char-level').value = '1';
        document.getElementById('attr-vigor').value = '1';
        document.getElementById('attr-destreza').value = '1';
        document.getElementById('attr-mente').value = '1';
        document.getElementById('attr-determinacao').value = '1';
        document.getElementById('current-shield').value = '0';
        window.activeStatusEffects = [];
        window.characterKit = { title: "", customQuote: "", bannerUrl: "", passives: [], skills: [] };
        localStorage.removeItem('jornada_rpg_draft');
        renderSkillsInputs();
        renderStatusEffects();
        calculateVitals();
        updateElementInfoUI();
        document.getElementById('current-pv').value = document.getElementById('max-pv').innerText;
        document.getElementById('current-pp').value = document.getElementById('max-pp').innerText;
        validateAttributes();
        validateSkills();
        updateVitalProgressBars();
        if (window.isEditingKit) renderKitEditorInputs();
        renderKitShowroom();
        if (!skipConfirm) showToast("Campos limpos!", "info");
    }
};

// ================= INITIALIZATION =================
window.addEventListener('DOMContentLoaded', () => {
    renderSkillsInputs();
    calculateVitals();
    updateElementInfoUI();
    renderStatusEffects();
    validateAttributes();
    validateSkills();
    updateVitalProgressBars();
    renderKitShowroom();
    restoreLocalDraft();
    loadGlobalSettings();
});
