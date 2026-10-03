<script setup lang="ts">
import BaseButton from '../../../components/base/BaseButton.vue';

defineProps<{
  teamsCount: number;
}>();

defineEmits<{
  deleteAll: [];
  add: [];
  addHltv: [];
}>();
</script>

<template>
  <div class="flex justify-between items-center mb-6">
    <div>
      <h1 class="text-2xl font-bold text-text-main tracking-tight">Teams</h1>
      <p class="text-zinc-400 text-sm mt-1">Manage all teams in the database.</p>
    </div>
    <div class="flex gap-3">
      <BaseButton variant="danger" :disabled="teamsCount === 0" @click="$emit('deleteAll')">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
        Delete All
      </BaseButton>
      <BaseButton variant="primary" @click="$emit('addHltv')">
        Extract from HLTV (experimental)
      </BaseButton>
      <BaseButton variant="primary" @click="$emit('add')">
        + Add Team
      </BaseButton>
    </div>
  </div>
</template>
