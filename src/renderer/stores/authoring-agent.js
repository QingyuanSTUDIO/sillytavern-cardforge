import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useCardStore } from './card.js';
import { useApiStore } from './api.js';
import { useFloatingToolsStore } from './floating-tools.js';
import { buildAuthoringContext, parseAuthoringProposal, AUTHORING_SYSTEM_PROMPT, cloneAgentData } from '../utils/authoring-agent.js';

export const useAuthoringAgentStore = defineStore('authoring-agent', () => {
  const card = useCardStore();
  const api = useApiStore();
  const settings = useFloatingToolsStore();
  const task = ref('');
  const modes = ref({});
  const busy = ref(false);
  const error = ref('');
  const rawReply = ref('');
  const round = ref(null);
  const history = ref([]);
  // Agent 的预设选择只保存在本机，不写入角色卡，也不切换全局 API。
  const selectedProviderId = ref('');
  const requestProvider = ref(null);
  try { selectedProviderId.value = localStorage.getItem('cf_agent_provider_id') || ''; } catch {}
  watch(selectedProviderId, value => {
    try { localStorage.setItem('cf_agent_provider_id', value); } catch {}
  });
  const selectedProvider = computed(() => selectedProviderId.value
    ? api.providers.find(provider => provider.id === selectedProviderId.value)
    : api.activeProvider);
  const providerError = computed(() => {
    if (!api.settingsLoaded) return 'API 预设尚未加载，请先到 API 设置检查。';
    const provider = selectedProvider.value;
    if (!provider) return selectedProviderId.value ? '所选 API 预设已被删除，请重新选择。' : '暂无可用 API，请在 API 设置中配置预设。';
    if (!provider.enabled) return '所选 API 预设已停用，请重新选择或在 API 设置中启用。';
    if (!api.isProviderReady(provider)) return '所选 API 预设配置不完整，请填写地址、Key 和模型。';
    return '';
  });
  let requestVersion = 0;

  const brief = computed({
    get: () => card.cardData.extensions?.cfCreativeBrief || '',
    set(value) {
      card.cardData.extensions ||= {};
      card.cardData.extensions.cfCreativeBrief = value;
      card.markDirty();
    }
  });
  const strictWording = computed({
    get: () => card.cardData.extensions?.cfStrictWording || '',
    set(value) {
      card.cardData.extensions ||= {};
      card.cardData.extensions.cfStrictWording = value;
      card.markDirty();
    }
  });
  const context = computed(() => buildAuthoringContext(card.cardData, task.value, modes.value, settings.contextLimits));
  const selectedCount = computed(() => round.value?.changes.filter(change => change.selected && change.status === 'pending').length || 0);

  // 切换角色卡时隔离审阅方案和撤销记录；旧请求返回也不能写入新卡。
  watch(() => card.card, () => {
    requestVersion++;
    task.value = ''; modes.value = {}; busy.value = false; error.value = '';
    rawReply.value = ''; round.value = null; history.value = []; requestProvider.value = null;
  }, { flush: 'sync' });

  function setReferenceMode(id, mode) {
    if (['auto', 'include', 'exclude'].includes(mode)) modes.value[String(id)] = mode;
  }

  function focusEntry(id, direction = '') {
    const entry = card.worldEntries.find(entry => String(entry.id) === String(id));
    if (!entry) return;
    setReferenceMode(entry.id, 'include');
    task.value = `请改写「${entry.comment || '未命名条目'}」，${direction.trim() || '保留核心设定，改善表达，并检查与其他人物和世界设定的关联。'}`;
  }

  async function generate() {
    if (busy.value || !task.value.trim()) return;
    if (providerError.value) { error.value = providerError.value; return; }
    // 固定本轮使用的完整配置，避免请求期间编辑预设或切换全局 API 影响本轮。
    const provider = cloneAgentData(selectedProvider.value);
    const providerInfo = { id: provider.id, name: provider.name || '未命名预设', model: provider.model };
    const version = ++requestVersion;
    const document = card.card;
    const snapshot = cloneAgentData(context.value);
    const request = task.value.trim();
    busy.value = true;
    requestProvider.value = providerInfo;
    error.value = '';
    rawReply.value = '';
    try {
      const response = await api.chatWithProvider(provider, [
        { role: 'system', content: AUTHORING_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify({ task: request, ...snapshot.payload }) }
      ], { temperature: 0.65, maxTokens: api.getModelMaxTokens(provider.model) });
      if (version !== requestVersion || document !== card.card) return;
      rawReply.value = response;
      const proposal = parseAuthoringProposal(response, snapshot);
      round.value = { ...proposal, task: request, createdAt: new Date().toISOString(),
        provider: providerInfo,
        brief: snapshot.payload.creativeBrief, strictWording: snapshot.payload.strictWording,
        references: snapshot.references.filter(reference => reference.wanted),
        usedChars: snapshot.usedChars, totalChars: snapshot.totalChars };
    } catch (e) {
      if (version === requestVersion) error.value = e.message || String(e);
    } finally {
      if (version === requestVersion) { busy.value = false; requestProvider.value = null; }
    }
  }

  function conflict(change) {
    if (change.kind === 'create') return '';
    if (change.kind === 'field') {
      return (card.cardData[change.target] || '') === change.before ? '' : '原文已变更，请重新生成方案';
    }
    const entry = card.worldEntries.find(entry => entry.id === change.target);
    if (!entry) return '原条目已删除';
    return (entry.content || '') === change.before ? '' : '条目正文已变更，请重新生成方案';
  }

  function applyChanges(ids) {
    if (busy.value || !round.value) return;
    error.value = '';
    const wanted = new Set(ids);
    const changes = round.value.changes.filter(change => wanted.has(change.id) && change.status === 'pending');
    if (!changes.length) return;
    const conflicts = changes.map(change => [change, conflict(change)]).filter(([, message]) => message);
    if (conflicts.length) {
      error.value = conflicts.map(([change, message]) => `「${change.title}」：${message}`).join('；');
      return;
    }
    if (changes.some(change => change.kind === 'create' && !change.after.trim())) {
      error.value = '新增条目的正文不能为空'; return;
    }
    // 先准备全部副本，再写入，避免一项失败造成半批采纳。
    const nextEntries = cloneAgentData(card.worldEntries);
    const usedIds = new Set(nextEntries.map(entry => String(entry.id)));
    let nextId = 0;
    let sortKey = nextEntries.reduce((max, entry) => Math.max(max,
      Number.isFinite(entry.extensions?.cfSortKey) ? entry.extensions.cfSortKey : 0), 0);
    const patches = changes.map(change => {
      const patch = { proposalId: change.id, kind: change.kind, title: change.title, target: change.target,
        before: change.before, after: change.after };
      if (change.kind === 'field') {
        patch.beforeExists = Object.hasOwn(card.cardData, change.target);
      } else if (change.kind === 'entry') {
        const entry = nextEntries.find(entry => entry.id === change.target);
        patch.beforeExists = Object.hasOwn(entry, 'content');
        entry.content = change.after;
      } else {
        while (usedIds.has(String(nextId))) nextId++;
        const entry = card.createEmptyWorldEntry(nextId++);
        usedIds.add(String(entry.id));
        entry.comment = change.title;
        entry.content = change.after;
        entry.keys = [...change.keys];
        entry.constant = change.constant;
        entry.insertion_order = change.order;
        entry.extensions.cfSortKey = ++sortKey;
        nextEntries.push(entry);
        patch.target = entry.id;
        patch.created = cloneAgentData(entry);
      }
      return patch;
    });
    for (const patch of patches.filter(patch => patch.kind === 'field')) card.cardData[patch.target] = patch.after;
    if (patches.some(patch => patch.kind !== 'field')) card.cardData.character_book.entries = nextEntries;
    changes.forEach(change => { change.status = 'applied'; change.selected = false; });
    history.value.unshift({ id: crypto.randomUUID(), roundId: round.value.id, task: round.value.task,
      at: new Date().toISOString(), patches, undone: false });
    card.markDirty();
  }

  function applySelected() {
    applyChanges(round.value?.changes.filter(change => change.selected).map(change => change.id) || []);
  }

  function undo(batch) {
    if (busy.value || batch.undone) return;
    error.value = '';
    const conflicts = batch.patches.filter(patch => {
      if (patch.kind === 'field') return card.cardData[patch.target] !== patch.after;
      const entry = card.worldEntries.find(entry => entry.id === patch.target);
      if (!entry) return true;
      return patch.kind === 'create' ? JSON.stringify(entry) !== JSON.stringify(patch.created) : entry.content !== patch.after;
    });
    if (conflicts.length) {
      error.value = `无法撤销：「${conflicts.map(patch => patch.title).join('、')}」在采纳后发生了修改或已被删除。请先撤销后续改动。`;
      return;
    }
    let nextEntries = cloneAgentData(card.worldEntries);
    for (const patch of batch.patches) {
      if (patch.kind === 'create') nextEntries = nextEntries.filter(entry => entry.id !== patch.target);
      else if (patch.kind === 'entry') {
        const entry = nextEntries.find(entry => entry.id === patch.target);
        if (patch.beforeExists) entry.content = patch.before;
        else delete entry.content;
      }
    }
    for (const patch of batch.patches.filter(patch => patch.kind === 'field')) {
      if (patch.beforeExists) card.cardData[patch.target] = patch.before;
      else delete card.cardData[patch.target];
    }
    if (batch.patches.some(patch => patch.kind !== 'field')) card.cardData.character_book.entries = nextEntries;
    batch.undone = true;
    if (round.value?.id === batch.roundId) {
      for (const patch of batch.patches) {
        const change = round.value.changes.find(change => change.id === patch.proposalId);
        if (change) change.status = 'undone';
      }
    }
    card.markDirty();
  }

  return { task, modes, busy, error, rawReply, round, history, brief, strictWording, context, selectedCount,
    selectedProviderId, selectedProvider, providerError, requestProvider,
    setReferenceMode, focusEntry, generate, conflict, applyChanges, applySelected, undo };
});
