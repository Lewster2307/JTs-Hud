<script setup lang="ts">
import CheckIcon from '@renderer/assets/icons/CheckIcon.vue';
import CopyIcon from '@renderer/assets/icons/CopyIcon.vue';
import BaseButton from '@renderer/components/base/BaseButton.vue';
import { ref } from 'vue';

const props = defineProps<{
  previewCommand: string;
  buildCommand: () => string;
}>();

const resetBindsCommand =
  'spec_usenumberkeys_nobinds true; unbind 1; unbind 2; unbind 3; unbind 4; unbind 5; unbind 6; unbind 7; unbind 8; unbind 9; unbind 0; bind "1" "slot1"; bind "2" "slot2"; bind "3" "slot3"; bind "4" "slot4"; bind "5" "slot5"; bind "6" "slot6"; bind "7" "slot7"; bind "8" "slot8"; bind "9" "slot9"; bind "0" "slot10"';

const copiedPreview = ref(false);
const copyPreview = async () => {
  const consoleLine = props.buildCommand().split('\n').join('; ');
  await navigator.clipboard.writeText(consoleLine);
  copiedPreview.value = true;
  setTimeout(() => { copiedPreview.value = false; }, 2000);
};

const copiedReset = ref(false);
const copyReset = async () => {
  await navigator.clipboard.writeText(resetBindsCommand);
  copiedReset.value = true;
  setTimeout(() => { copiedReset.value = false; }, 2000);
};
</script>

<template>
  <div class="mt-4">
    <div class="flex items-center justify-between mb-1.5">
      <div class="text-xs font-semibold uppercase tracking-widest text-zinc-600">Command Preview</div>
      <div class="flex items-center gap-2">
        <BaseButton
          @click="copyReset"
          size="sm"
          :variant="copiedReset ? 'primary' : 'secondary'"
          title="Copy reset binds command to clipboard"
        >
          <CopyIcon v-if="!copiedReset" name="copy" class="w-3 h-3" />
          <CheckIcon v-else name="check" class="w-3 h-3" />
          {{ copiedReset ? 'Copied!' : 'Reset Binds' }}
        </BaseButton>

        <BaseButton
          @click="copyPreview"
          size="sm"
          :variant="copiedPreview ? 'primary' : 'secondary'"
          title="Copy spectator binds command to clipboard"
        >
          <CopyIcon v-if="!copiedPreview" name="copy" class="w-3 h-3" />
          <CheckIcon v-else name="check" class="w-3 h-3" />
          {{ copiedPreview ? 'Copied!' : 'Copy' }}
        </BaseButton>
      </div>
    </div>
    <pre class="bg-zinc-950 border border-border rounded-lg p-2.5 font-mono text-xs text-zinc-500 leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap break-all">{{ previewCommand }}</pre>
  </div>
</template>
