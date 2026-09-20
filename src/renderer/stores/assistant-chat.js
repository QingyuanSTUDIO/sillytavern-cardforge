import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useCardStore } from './card.js';
import { useApiStore } from './api.js';
import { useAppStore } from './app.js';
import { useAiNiangStore } from './ainiang.js';
import { useFloatingToolsStore } from './floating-tools.js';

// 完整助手与悬浮窗口共享会话，收起窗口或切换页面不会中断请求。
export const useAssistantChatStore = defineStore('assistant-chat', () => {
  const messages = ref([]);
  const inputText = ref('');
  const loading = ref(false);
  const cardStore = useCardStore();
  const apiStore = useApiStore();
  const appStore = useAppStore();
  const niangStore = useAiNiangStore();
  const toolSettings = useFloatingToolsStore();
  let initialization;

  function initialize() {
    if (!initialization) initialization = niangStore.loadConfig();
    return initialization;
  }

  async function send() {
    const text = inputText.value.trim();
    if (!text || loading.value) return;
    loading.value = true;
    let userMessage;
    try {
      await initialize();
      const niang = { ...niangStore.youxi };
      const customProvider = niang.apiKey && niang.apiBaseUrl && niang.apiModel
        ? { id: niang.id + '_custom', type: niang.apiType || 'openai', baseUrl: niang.apiBaseUrl,
          apiKey: niang.apiKey, model: niang.apiModel, enabled: true }
        : null;
      if (!customProvider && !apiStore.isConfigured) throw new Error('请先在 API 设置或 AI 助手中配置 API Key');

      userMessage = { id: crypto.randomUUID(), role: 'user', name: '你', content: text, color: '#f59e42' };
      messages.value.push(userMessage);
      // 等待配置加载时用户可能已继续输入，不覆盖新草稿。
      if (inputText.value.trim() === text) inputText.value = '';
      const history = messages.value.filter(m => m.role === 'user' || m.niangId === niang.id).slice(-10);
      const chatMessages = [
        { role: 'system', content: niangStore.buildSystemPrompt(niang, cardStore, text, toolSettings.contextLimits) },
        ...history.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }))
      ];
      const options = { temperature: 0.85,
        maxTokens: apiStore.getModelMaxTokens(customProvider?.model || apiStore.activeProvider?.model) };
      const result = customProvider
        ? await apiStore.chatWithProvider(customProvider, chatMessages, options)
        : await apiStore.chat(chatMessages, options);
      messages.value.push({ id: crypto.randomUUID(), role: 'assistant', niangId: niang.id,
        name: niang.name, content: result, color: niang.color });
    } catch (e) {
      if (userMessage) {
        messages.value = messages.value.filter(m => m.id !== userMessage.id);
        if (!inputText.value) inputText.value = text;
      }
      appStore.toastError('发送失败：' + e.message);
    } finally {
      loading.value = false;
    }
  }

  return { messages, inputText, loading, initialize, send };
});
