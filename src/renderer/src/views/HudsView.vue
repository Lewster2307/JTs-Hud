<script setup lang="ts">
import { ref } from 'vue';
import { useHudsView } from '../features/huds/composables/useHudsView';
import HudsPageHeader from '../features/huds/components/HudsPageHeader.vue';
import HudCard from '../features/huds/components/HudCard.vue';
import BaseButton from '@renderer/components/base/BaseButton.vue';
import CopyIcon from '@renderer/assets/icons/CopyIcon.vue';
import CheckIcon from '@renderer/assets/icons/CheckIcon.vue';

const { huds, isLoading, fetchHuds, deleteHud, importing, importError, handleZipImport } = useHudsView();

const singleLineCommands = 'cl_draw_only_deathnotices 1; cl_drawhud_force_teamid_overhead 1; cl_trueview_show_status 0; cl_demo_predict 0; engine_no_focus_sleep 0';

const isCopied = ref(false);

const copyCommands = async () => {
  try {
    await navigator.clipboard.writeText(singleLineCommands);
    isCopied.value = true;
    setTimeout(() => {
      isCopied.value = false;
    }, 2000);
  } catch (err) {
    console.error('Failed to copy commands:', err);
  }
};
</script>

<template>
  <div class="p-6 bg-surface text-zinc-200 min-h-screen">
    <HudsPageHeader
      :importing="importing"
      :import-error="importError"
      @import-file="handleZipImport"
      @refresh="fetchHuds"
    />

    <!-- Recommended Settings Banner -->
    <div class="mb-6 bg-zinc-800 rounded-xl border border-zinc-700 overflow-hidden shadow-lg">
      <div class="p-4 border-b border-zinc-700 bg-surface/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="flex items-start sm:items-center gap-3">
          <div class="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 shrink-0 mt-0.5 sm:mt-0">
            <svg xmlns="http://www.w3.org/2000/svg" class="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <div class="text-sm font-semibold text-zinc-100">
              The game <span class="font-bold text-amber-400">must</span> be in <span class="font-bold text-text-main underline decoration-amber-500/60 underline-offset-2">"Fullscreen Windowed"</span> Mode (otherwise the HUD will not appear in front).
            </div>
            <div class="text-xs text-zinc-400 mt-0.5">
              The following console commands are also recommended:
            </div>
          </div>
        </div>

        <BaseButton
          @click="copyCommands"
          size="sm"
          :variant="isCopied ? 'primary' : 'secondary'"
          class="shrink-0 self-start sm:self-auto"
          title="Copy all commands to clipboard"
        >
          <CheckIcon v-if="isCopied" class="size-3.5 mr-1.5" />
          <CopyIcon v-else class="size-3.5 mr-1.5" />
          {{ isCopied ? 'Copied!' : 'Copy Commands' }}
        </BaseButton>
      </div>

      <div class="p-4 bg-zinc-950/80">
        <pre
          @click="copyCommands"
          class="font-mono text-xs text-zinc-300 leading-relaxed overflow-x-auto select-all cursor-pointer hover:text-white transition-colors"
          title="Click to copy commands"
        >cl_draw_only_deathnotices 1;
cl_drawhud_force_teamid_overhead 1;
cl_trueview_show_status 0;
cl_demo_predict 0;
engine_no_focus_sleep 0</pre>
      </div>
    </div>

    <!-- HUDs List -->
    <div class="bg-zinc-800 p-6 rounded-xl border border-zinc-700">
      <div v-if="isLoading" class="text-center py-12 text-zinc-400">Scanning for HUDs...</div>

      <div v-else-if="huds.length === 0" class="text-center py-12 flex flex-col items-center">
        <div class="text-zinc-400 mb-2">No HUDs found in the directory.</div>
        <div class="text-sm text-zinc-500">Extract a React HUD into the `huds/` folder to get started.</div>
      </div>

      <div v-else class="grid gap-4">
        <HudCard v-for="hud in huds" :key="hud.id" :hud="hud" @delete="deleteHud" />
      </div>
    </div>
  </div>
</template>
