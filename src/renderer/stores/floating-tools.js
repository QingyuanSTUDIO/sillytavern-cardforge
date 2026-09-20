import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useAppStore } from './app.js';

const STORAGE_KEY = 'cf_floating_tools_settings';
export const FLOATING_TOOLS = [
  { key: 'chat', short: 'AI 聊天' },
  { key: 'greeting', short: '开场白' },
  { key: 'optimize_entry', short: '改条目', onlyRoute: '/worldbook' },
  { key: 'npc_name', short: '起NPC名' },
  { key: 'explain_code', short: '解释码' },
  { key: 'enrich_desc', short: '补 desc' },
  { key: 'quick_diag', short: '去诊断', isJump: true }
];

export const useFloatingToolsStore = defineStore('floating-tools', () => {
  const visible = ref(true);
  const settingsOpen = ref(false);
  const order = ref(FLOATING_TOOLS.map(tool => tool.key));
  const hidden = ref([]);

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      visible.value = saved.visible !== false;
      const keys = new Set(order.value);
      const savedOrder = Array.isArray(saved.order) ? saved.order.filter(key => keys.has(key)) : [];
      // 保留用户顺序，新增加的工具自动补在末尾。
      order.value = [...new Set([...savedOrder, ...order.value])];
      hidden.value = Array.isArray(saved.hidden) ? [...new Set(saved.hidden.filter(key => keys.has(key)))] : [];
      if (!FLOATING_TOOLS.some(tool => !tool.isJump && !tool.onlyRoute && !hidden.value.includes(tool.key))) {
        hidden.value = hidden.value.filter(key => key !== 'chat');
      }
    }
  } catch {}

  const orderedTools = computed(() => order.value.map(key => FLOATING_TOOLS.find(tool => tool.key === key)));
  const enabledTools = computed(() => orderedTools.value.filter(tool => !hidden.value.includes(tool.key)));

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ visible: visible.value, order: order.value, hidden: hidden.value }));
    } catch {
      useAppStore().toastWarning('悬浮窗设置暂时无法保存，重启后可能恢复默认');
    }
  }

  function setVisible(value) { visible.value = value; save(); }

  function canHide(key) {
    return enabledTools.value.some(tool => tool.key !== key && !tool.isJump && !tool.onlyRoute);
  }

  function setToolVisible(key, value) {
    if (!FLOATING_TOOLS.some(tool => tool.key === key)) return;
    if (value) hidden.value = hidden.value.filter(item => item !== key);
    else if (canHide(key) && !hidden.value.includes(key)) hidden.value.push(key);
    save();
  }

  function moveTool(key, direction) {
    if (direction !== -1 && direction !== 1) return;
    const from = order.value.indexOf(key);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= order.value.length) return;
    const next = [...order.value];
    [next[from], next[to]] = [next[to], next[from]];
    order.value = next;
    save();
  }

  function resetTools() {
    order.value = FLOATING_TOOLS.map(tool => tool.key);
    hidden.value = [];
    save();
  }

  return { visible, settingsOpen, orderedTools, enabledTools, hidden,
    setVisible, setToolVisible, canHide, moveTool, resetTools };
});
