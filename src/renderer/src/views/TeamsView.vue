<script setup lang="ts">
import { ref } from 'vue';
import BaseModal from '../components/base/BaseModal.vue';
import BaseTable from '../components/base/BaseTable.vue';
import BaseBadge from '../components/base/BaseBadge.vue';
import TeamForm from '../features/teams/components/TeamForm.vue';
import TeamsPageHeader from '../features/teams/components/TeamsPageHeader.vue';
import TeamsBulkBar from '../features/teams/components/TeamsBulkBar.vue';
import HltvTeamModal from '../features/teams/components/HltvTeamModal.vue';
import { useTeamsView } from '../features/teams/composables/useTeamsView';
import { API_URL } from '../index';

const {
  teams, players, isLoading, sortedTeams, tableHeaders,
  sortKey, sortDir, handleSort,
  selectedTeamIds, handleSelectionChange, handleDeleteSelected, handleDeleteAll,
  isModalOpen, isEditing, formData, handleSave, openCreateModal, openEditModal,
  deleteTeam,
} = useTeamsView();

const baseUrl = API_URL.replace('/api', '');

const isHltvModalOpen = ref(false);

const handleHltvExtractSuccess = (extracted: any) => {
  formData.value = {
    name: extracted.name || '',
    shortName: extracted.shortName || extracted.name || '',
    country: extracted.country || '',
    logo: extracted.logo || '',
    extra: {}
  };
  isEditing.value = false;
  isModalOpen.value = true;
};

const getTeamPlayerCount = (teamId: string) => {
  return players.value.filter(p => p.team === teamId).length;
};

const openHltvSearch = (name: string) => {
  const cleanName = String(name || '').trim();
  if (cleanName) {
    window.api.openExternal(`https://www.hltv.org/search?query=${encodeURIComponent(cleanName)}`);
  }
};
</script>

<template>
  <div class="p-6 bg-surface text-zinc-200 min-h-full relative">
    <TeamsPageHeader
      :teams-count="teams.length"
      @delete-all="handleDeleteAll"
      @add="openCreateModal"
      @add-hltv="isHltvModalOpen = true"
    />

    <TeamsBulkBar
      v-if="selectedTeamIds.length > 0"
      :selected-count="selectedTeamIds.length"
      @delete-selected="handleDeleteSelected"
    />

    <BaseTable
      :headers="tableHeaders"
      :items="sortedTeams"
      :is-loading="isLoading"
      :selectable="true"
      :column-toggle="true"
      storage-key="teams-table-columns"
      :sort-key="sortKey"
      :sort-dir="sortDir"
      search-placeholder="Search teams..."
      @edit="openEditModal"
      @delete="deleteTeam"
      @sort="handleSort"
      @selection-change="handleSelectionChange"
    >
      <template #cell-logo="{ item }">
        <div class="size-12 flex items-center justify-center">
          <img v-if="item.logo" :src="`${baseUrl}${item.logo}`" class="w-full h-full object-contain" />
          <span v-else class="text-xs font-bold text-zinc-500">{{ item.shortName }}</span>
        </div>
      </template>

      <template #cell-name="{ item }">
        <div class="font-bold text-text-main flex items-center gap-2">
          <button
            type="button"
            @click.stop="openHltvSearch(item.name)"
            class="hover:text-primary hover:underline transition-colors inline-flex items-center gap-1.5 group/hltv cursor-pointer text-left"
            title="Search team on HLTV"
          >
            <span>{{ item.name }}</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="size-3 text-zinc-500 group-hover/hltv:text-primary transition-colors shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </button>
        </div>
      </template>

      <template #cell-country="{ item }">
        <BaseBadge v-if="item.country">{{ item.country }}</BaseBadge>
        <span v-else class="text-zinc-600 text-xs italic">—</span>
      </template>

      <template #cell-playerCount="{ item }">
        <span class="text-xs text-zinc-300 font-medium px-2 py-0.5 rounded bg-zinc-700/50">
          {{ getTeamPlayerCount(item._id) }}
        </span>
      </template>
    </BaseTable>

    <BaseModal
      :is-open="isModalOpen"
      :title="isEditing ? 'Edit Team' : 'Add Team'"
      form-id="teamForm"
      max-width-class="max-w-xl"
      @close="isModalOpen = false"
      @cancel="isModalOpen = false"
    >
      <TeamForm
        :initial-data="formData"
        :is-editing="isEditing"
        :players="players"
        :existing-teams="teams"
        @submit="handleSave"
      />
    </BaseModal>

    <HltvTeamModal
      :is-open="isHltvModalOpen"
      @close="isHltvModalOpen = false"
      @extract-success="handleHltvExtractSuccess"
    />
  </div>
</template>