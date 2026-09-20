<template>
  <div class="page">
    <div class="page__header"><h1>总设置</h1><p>调整应用的保存与使用偏好</p></div>
    <div class="card mb-md">
      <div class="card__header"><h3>角色卡自动保存</h3></div>
      <div class="card__body">
        <div class="form-group">
          <label for="autosave-interval">自动保存间隔（秒）</label>
          <div class="flex-row">
            <input id="autosave-interval" class="input" style="max-width:150px" type="number" min="5" max="600"
              step="1" v-model="interval" @keydown.enter="saveInterval">
            <button class="btn btn--primary" @click="saveInterval">保存设置</button>
            <button class="btn btn--secondary" @click="interval = 10; saveInterval()">恢复默认</button>
          </div>
          <p class="hint">可设置 5～600 秒，默认 10 秒。当前间隔：{{ store.autosaveInterval }} 秒。</p>
        </div>
        <p class="hint">角色卡发生修改后开始倒计时；持续输入不会反复重置倒计时。没有修改时不重复保存。</p>
        <p class="hint">自动保存包含角色卡内容、封面和原文件路径，保存在本机草稿目录，下次启动自动恢复最近草稿。关闭应用前会补存尚未保存的修改。</p>
        <p class="hint">草稿保存不会覆盖导入的 PNG / JSON 文件。需要更新原文件或分享角色卡时，请使用「打包角色卡」。</p>
        <p v-if="store.autosaveError" class="settings-error">自动保存异常：{{ store.autosaveError }}</p>
        <button class="btn btn--secondary mt-md" :disabled="store.autosaveState === 'saving'" @click="store.saveDraftNow()">立即保存草稿</button>
      </div>
    </div>
    <div class="card mb-md">
      <div class="card__header"><h3>外观</h3></div>
      <div class="card__body settings-appearance">
        <div>
          <strong>炫彩流光边框</strong>
          <p class="hint">控制窗口外圈的流光边框和按钮流光效果。</p>
        </div>
        <label class="settings-switch">
          <input type="checkbox" role="switch" aria-label="炫彩流光边框" :checked="appStore.glowEnabled"
            @change="appStore.toggleGlow()">
          <span class="settings-switch__track" aria-hidden="true"></span>
          <span>{{ appStore.glowEnabled ? '开启' : '关闭' }}</span>
        </label>
      </div>
      <AppearanceBackgroundSettings />
    </div>
    <div class="card">
      <div class="card__header"><h3>悬浮工具</h3></div>
      <div class="card__body">
        <button class="btn btn--secondary" @click="floatingTools.settingsOpen = true">打开悬浮窗设置</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useCardStore } from '../stores/card.js';
import { useAppStore } from '../stores/app.js';
import { useFloatingToolsStore } from '../stores/floating-tools.js';
import AppearanceBackgroundSettings from '../components/AppearanceBackgroundSettings.vue';
const store = useCardStore();
const appStore = useAppStore();
const floatingTools = useFloatingToolsStore();
const interval = ref(store.autosaveInterval);

function saveInterval() {
  try {
    store.setAutosaveInterval(Number(interval.value));
    appStore.toastSuccess('自动保存间隔已更新');
  } catch (error) { appStore.toastError(error.message); }
}
</script>

<style scoped>
.hint { margin-top: 10px; line-height: 1.7; }
.settings-error { margin-top: 12px; color: #fca5a5; overflow-wrap: anywhere; user-select: text; }
.settings-appearance { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
.settings-switch { display: inline-flex; align-items: center; gap: 10px; position: relative; cursor: pointer; flex-shrink: 0; }
.settings-switch input { position: absolute; width: 44px; height: 24px; opacity: 0; margin: 0; cursor: pointer; }
.settings-switch__track { display: block; width: 44px; height: 24px; border-radius: 12px; background: #4b5563; transition: background .15s; pointer-events: none; }
.settings-switch__track::after { content: ''; display: block; width: 18px; height: 18px; margin: 3px; border-radius: 50%; background: #fff; transition: transform .15s; }
.settings-switch input:checked + .settings-switch__track { background: #d99532; }
.settings-switch input:checked + .settings-switch__track::after { transform: translateX(20px); }
.settings-switch input:focus-visible + .settings-switch__track { outline: 2px solid #67e8f9; outline-offset: 3px; }
</style>
