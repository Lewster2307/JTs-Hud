<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue';
import BaseButton from '../../../components/base/BaseButton.vue';
import BaseInput from '../../../components/base/BaseInput.vue';
import { API_URL } from '../../../index';

const props = defineProps<{
  isOpen: boolean;
  teams: any[];
  playerCount: number;
  selectedTeamId: string | null;
  isAssigning: boolean;
}>();

const emit = defineEmits<{
  'update:selectedTeamId': [value: string];
  close: [];
  confirm: [];
}>();

const baseUrl = API_URL.replace('/api', '');
const searchQuery = ref('');

const filteredTeams = computed(() => {
  const query = searchQuery.value.toLowerCase().trim();
  const list = query
    ? props.teams.filter(team =>
        (team.name || '').toLowerCase().includes(query) ||
        (team.shortName || '').toLowerCase().includes(query)
      )
    : [...props.teams];

  return list.sort((a, b) => {
    const nameA = String(a.name || '');
    const nameB = String(b.name || '');
    return nameA.localeCompare(nameB, undefined, { sensitivity: 'base', numeric: true });
  });
});

const handleKeyDown = (e: KeyboardEvent) => {
  if (!props.isOpen) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    emit('close');
  } else if (e.key === 'Enter') {
    if (props.selectedTeamId !== null && !props.isAssigning) {
      e.preventDefault();
      emit('confirm');
    }
  }
};

watch(() => props.isOpen, (open) => {
  if (open) {
    searchQuery.value = '';
    window.addEventListener('keydown', handleKeyDown);
  } else {
    window.removeEventListener('keydown', handleKeyDown);
  }
}, { immediate: true });

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
});
</script>

<template>
  <div
    v-if="isOpen"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
  >
    <div class="bg-zinc-800 rounded-xl border border-zinc-700 w-full max-w-sm shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
      <!-- Header -->
      <div class="p-5 border-b border-zinc-700 flex justify-between items-center bg-zinc-800/80">
        <div>
          <h2 class="text-lg font-bold text-text-main">Assign to Team</h2>
          <p class="text-xs text-zinc-400 mt-0.5">Assign {{ playerCount }} selected player(s)</p>
        </div>
        <button
          @click="emit('close')"
          class="text-zinc-400 hover:text-text-main transition-colors p-1 rounded-lg hover:bg-zinc-700"
          title="Close (Esc)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Search & Team List -->
      <div class="p-5 space-y-3 overflow-hidden flex flex-col flex-1">
        <BaseInput
          v-model="searchQuery"
          type="search"
          placeholder="Search teams..."
          size="sm"
        />

        <div class="space-y-2 overflow-y-auto flex-1 custom-scrollbar pr-1">
          <!-- Option: No Team -->
          <div
            @click="emit('update:selectedTeamId', '')"
            :class="[
              'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
              selectedTeamId === ''
                ? 'border-primary bg-primary/10 text-text-main'
                : 'border-zinc-700 bg-surface text-zinc-300 hover:border-zinc-500'
            ]"
          >
            <div class="w-8 h-8 rounded bg-zinc-700 flex items-center justify-center text-zinc-400 text-xs font-bold shrink-0">
              —
            </div>
            <div class="flex flex-col min-w-0">
              <span class="font-semibold text-sm">No Team</span>
              <span class="text-[11px] text-zinc-400 truncate">Remove from current team</span>
            </div>
            <svg
              v-if="selectedTeamId === ''"
              xmlns="http://www.w3.org/2000/svg"
              class="h-4 w-4 ml-auto text-primary shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <!-- Team List Options -->
          <div
            v-for="team in filteredTeams"
            :key="team._id"
            @click="emit('update:selectedTeamId', team._id)"
            :class="[
              'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
              selectedTeamId === team._id
                ? 'border-primary bg-primary/10 text-text-main'
                : 'border-zinc-700 bg-surface text-zinc-300 hover:border-zinc-500'
            ]"
          >
            <img
              v-if="team.logo"
              :src="`${baseUrl}${team.logo}`"
              class="w-8 h-8 rounded object-contain bg-zinc-800 shrink-0"
            />
            <div
              v-else
              class="w-8 h-8 rounded bg-zinc-700 flex items-center justify-center text-zinc-400 text-xs font-bold shrink-0"
            >
              ?
            </div>
            <div class="flex flex-col min-w-0">
              <span class="font-semibold text-sm truncate">{{ team.name }}</span>
              <span v-if="team.shortName" class="text-[11px] text-zinc-400 truncate">{{ team.shortName }}</span>
            </div>
            <svg
              v-if="selectedTeamId === team._id"
              xmlns="http://www.w3.org/2000/svg"
              class="h-4 w-4 ml-auto text-primary shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <div v-if="teams.length > 0 && filteredTeams.length === 0" class="text-zinc-500 text-xs text-center py-4">
            No teams match your search.
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="p-4 border-t border-zinc-700 bg-zinc-800/80 flex gap-2.5">
        <BaseButton @click="emit('close')" variant="secondary" class="flex-1 justify-center">
          Cancel
        </BaseButton>
        <BaseButton
          @click="emit('confirm')"
          :disabled="selectedTeamId === null || isAssigning"
          variant="primary"
          class="flex-1 justify-center"
        >
          <svg v-if="isAssigning" class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"></path>
          </svg>
          {{ isAssigning ? 'Assigning...' : 'Assign Team' }}
        </BaseButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: #3f3f46;
  border-radius: 10px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: #52525b;
}
</style>
