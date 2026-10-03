<script setup lang="ts">
import { ref } from 'vue';
import BaseModal from '../components/base/BaseModal.vue';
import BaseTable from '../components/base/BaseTable.vue';
import BaseBadge from '../components/base/BaseBadge.vue';
import PlayerForm from '../features/players/components/PlayerForm.vue';
import PlayersPageHeader from '../features/players/components/PlayersPageHeader.vue';
import PlayersBulkBar from '../features/players/components/PlayersBulkBar.vue';
import PlayersAssignTeamModal from '../features/players/components/PlayersAssignTeamModal.vue';
import HltvPlayerModal from '../features/players/components/HltvPlayerModal.vue';
import { usePlayersView } from '../features/players/composables/usePlayersView';
import { API_URL } from '../index';

const {
  players, availableTeams, fetchTeams, isPlayersLoading, sortedPlayers, teamMap, tableHeaders,
  sortKey, sortDir, handleSort,
  selectedPlayerIds, handleSelectionChange, handleDeleteSelected, handleDeleteAll,
  isAssignTeamModalOpen, selectedTeamForAssign, isAssigningTeam,
  openAssignTeamModal, handleAssignTeam,
  isModalOpen, isEditing, formData, handleSave, openCreateModal, openEditModal,
  deletePlayer,
} = usePlayersView();

const baseUrl = API_URL.replace('/api', '');
const isHltvModalOpen = ref(false);
const teamWarning = ref('');

const handleOpenCreate = () => {
  teamWarning.value = '';
  openCreateModal();
};

const handleOpenEdit = (player: any) => {
  teamWarning.value = '';
  openEditModal(player);
};

const handleOpenHltv = async () => {
  try {
    await fetchTeams();
  } catch {
    /* ignore */
  }
  isHltvModalOpen.value = true;
};

const handleHltvExtractSuccess = async (extracted: any) => {
  // Always fetch latest teams so newly created teams are immediately available
  try {
    await fetchTeams();
  } catch {
    /* ignore */
  }

  let matchedTeamId = '';
  let warning = '';
  const rawTeam = String(extracted.team || '').trim();
  const lowerRaw = rawTeam.toLowerCase();
  const isNoTeam =
    !rawTeam ||
    rawTeam === '-' ||
    lowerRaw === 'n/a' ||
    lowerRaw === 'none' ||
    lowerRaw === 'no team' ||
    lowerRaw.includes('no team');

  if (rawTeam && !isNoTeam) {
    const clean = lowerRaw;
    const stripped = clean
      .replace(/^team\s+/, '')
      .replace(/\s+clan$/, '')
      .replace(/\s+esports$/, '');

    const found = availableTeams.value.find((t: any) => {
      const tName = String(t.name || '').trim().toLowerCase();
      const tShort = String(t.shortName || '').trim().toLowerCase();
      const tStripped = tName
        .replace(/^team\s+/, '')
        .replace(/\s+clan$/, '')
        .replace(/\s+esports$/, '');
      const tShortStripped = tShort
        .replace(/^team\s+/, '')
        .replace(/\s+clan$/, '')
        .replace(/\s+esports$/, '');

      return (
        tName === clean ||
        tShort === clean ||
        tStripped === stripped ||
        tShortStripped === stripped ||
        (clean.length > 2 && tName.includes(clean)) ||
        (tName.length > 2 && clean.includes(tName))
      );
    });

    if (found && found._id) {
      matchedTeamId = found._id;
    } else {
      warning = `Team "${extracted.team}" from HLTV does not exist in your teams table.`;
    }
  }

  formData.value = {
    username: extracted.username || '',
    firstName: extracted.firstName || '',
    lastName: extracted.lastName || '',
    country: extracted.country || '',
    team: matchedTeamId,
    avatar: extracted.avatar || '',
    isCoach: false,
    steamid: extracted.steamid || '',
    extra: {}
  };

  teamWarning.value = warning;
  isEditing.value = false;
  isModalOpen.value = true;
};

const openSteamProfile = (steamid: string) => {
  const cleanId = String(steamid).trim();
  if (cleanId) {
    window.api.openExternal(`http://steamcommunity.com/profiles/${cleanId}`);
  }
};

const openHltvSearch = (username: string) => {
  const cleanName = String(username || '').trim();
  if (cleanName) {
    window.api.openExternal(`https://www.hltv.org/search?query=${encodeURIComponent(cleanName)}`);
  }
};

</script>

<template>
  <div class="p-6 bg-surface text-zinc-200 min-h-full">
    <PlayersPageHeader
      :players-count="players.length"
      @delete-all="handleDeleteAll"
      @add="handleOpenCreate"
      @add-hltv="handleOpenHltv"
    />

    <PlayersBulkBar
      v-if="selectedPlayerIds.length > 0"
      :selected-count="selectedPlayerIds.length"
      @assign-team="openAssignTeamModal"
      @delete-selected="handleDeleteSelected"
    />

    <BaseTable
      :headers="tableHeaders"
      :items="sortedPlayers"
      :is-loading="isPlayersLoading"
      :selectable="true"
      :column-toggle="true"
      :search-fields="['teamName', 'teamShortName']"
      storage-key="players-table-columns"
      :sort-key="sortKey"
      :sort-dir="sortDir"
      @edit="handleOpenEdit"
      @delete="deletePlayer"
      @sort="handleSort"
      @selection-change="handleSelectionChange"
    >
      <template #cell-avatar="{ item }">
        <div class="size-14">
          <img v-if="item.avatar" :src="`${baseUrl}${item.avatar}`" class="size-12 object-cover" />
        </div>
      </template>

      <template #cell-username="{ item }">
        <div class="font-bold text-text-main flex items-center gap-2">
          <button
            type="button"
            @click.stop="openHltvSearch(item.username)"
            class="hover:text-primary hover:underline transition-colors inline-flex items-center gap-1.5 group/hltv cursor-pointer text-left"
            title="Search player on HLTV"
          >
            <span>{{ item.username }}</span>
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
          <BaseBadge v-if="item.isCoach" variant="red">Coach</BaseBadge>
        </div>
      </template>

      <template #cell-team="{ item }">
        <div v-if="teamMap[item.team]" class="flex items-center gap-2.5">
          <div class="size-10 flex items-center justify-center overflow-hidden shrink-0">
            <img v-if="teamMap[item.team].logo" :src="`${baseUrl}${teamMap[item.team].logo}`" class="w-full h-full object-contain" />
            <span v-else class="text-xs font-bold text-zinc-500">{{ teamMap[item.team].shortName }}</span>
          </div>
        </div>
        <span v-else class="text-zinc-600 italic text-xs">No team</span>
      </template>

      <template #cell-country="{ item }">
        <BaseBadge v-if="item.country">{{ item.country }}</BaseBadge>
        <span v-else class="text-zinc-600 text-xs italic">—</span>
      </template>

      <template #cell-steamid="{ item }">
        <button
          v-if="item.steamid"
          type="button"
          @click.stop="openSteamProfile(item.steamid)"
          class="font-mono text-xs text-zinc-400 hover:text-primary hover:underline select-all transition-colors inline-flex items-center gap-1.5 group/steam cursor-pointer"
          title="Open Steam profile in browser"
        >
          <span>{{ item.steamid }}</span>
          <svg xmlns="http://www.w3.org/2000/svg" class="size-3 text-zinc-500 group-hover/steam:text-primary transition-colors shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </button>
        <span v-else class="text-zinc-600 text-xs italic">—</span>
      </template>
    </BaseTable>

    <BaseModal
      :is-open="isModalOpen"
      :title="isEditing ? 'Edit Player' : 'Add New Player'"
      form-id="playerForm"
      max-width-class="max-w-xl"
      @close="isModalOpen = false"
      @cancel="isModalOpen = false"
    >
      <PlayerForm
        :initial-data="formData"
        :teams="availableTeams"
        :is-editing="isEditing"
        :existing-players="players"
        :team-warning="teamWarning"
        @submit="handleSave"
      />
    </BaseModal>

    <PlayersAssignTeamModal
      :is-open="isAssignTeamModalOpen"
      :teams="availableTeams"
      :player-count="selectedPlayerIds.length"
      v-model:selected-team-id="selectedTeamForAssign"
      :is-assigning="isAssigningTeam"
      @close="isAssignTeamModalOpen = false"
      @confirm="handleAssignTeam"
    />

    <HltvPlayerModal
      :is-open="isHltvModalOpen"
      @close="isHltvModalOpen = false"
      @extract-success="handleHltvExtractSuccess"
    />
  </div>
</template>