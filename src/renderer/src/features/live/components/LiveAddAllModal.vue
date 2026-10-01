<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import BaseButton from '@renderer/components/base/BaseButton.vue';
import BaseBadge from '@renderer/components/base/BaseBadge.vue';
import type { GsiPlayer } from '../composables/useLiveView';
import { API_URL } from '../../../index';

export interface PlayerSyncMapping {
  gsiPlayer: GsiPlayer;
  action: 'existing' | 'create' | 'skip';
  targetPlayerId: string | null;
  pullSteamId: boolean;
  pullUsername: boolean;
  username: string;
  isCoach: boolean;
}

const props = defineProps<{
  isOpen: boolean;
  side: 'CT' | 'T' | null;
  teams: any[];
  gsiPlayers: GsiPlayer[];
  dbPlayers: any[];
  initialTeamId?: string;
  isAdding: boolean;
}>();

const emit = defineEmits<{
  close: [];
  confirm: [mappings: PlayerSyncMapping[], teamId: string];
}>();

const baseUrl = API_URL.replace('/api', '');

const selectedTeamId = ref('');
const mappings = ref<PlayerSyncMapping[]>([]);

// Alphabetically sorted teams
const sortedTeams = computed(() => {
  return [...props.teams].sort((a, b) => {
    const nameA = String(a.name || '');
    const nameB = String(b.name || '');
    return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
  });
});

const selectedTeam = computed(() => {
  return props.teams.find((t) => t._id === selectedTeamId.value) || null;
});

// Players belonging to the currently selected team
const teamPlayers = computed(() => {
  if (!selectedTeamId.value) return [];
  return props.dbPlayers.filter((p) => p.team === selectedTeamId.value);
});

// Other players in database
const otherPlayers = computed(() => {
  if (!selectedTeamId.value) return props.dbPlayers;
  return props.dbPlayers.filter((p) => p.team !== selectedTeamId.value);
});

const getTeamPlayerCount = (teamId: string) => {
  return props.dbPlayers.filter((p) => p.team === teamId).length;
};

const getTargetPlayer = (playerId: string | null) => {
  if (!playerId) return null;
  return props.dbPlayers.find((p) => p._id === playerId) || null;
};

// Strips brackets, clan tags, and separators from demo player names for clean matching/creation
const cleanDemoName = (rawName: string): string => {
  if (!rawName) return '';
  let cleaned = rawName.replace(/\[.*?\]|\(.*?\)|\{.*?\}/g, '').trim();
  cleaned = cleaned.replace(/^[A-Za-z0-9_.-]+\s*[|/]\s*/, '').trim();
  return cleaned || rawName;
};

// Normalizes names for fuzzy string comparison
const normalizeName = (name: string): string => {
  return (name || '')
    .toLowerCase()
    .replace(/\[.*?\]|\(.*?\)|\{.*?\}/g, '')
    .replace(/[|\-_/\\#~<>=]/g, ' ')
    .replace(/\s+/g, '')
    .trim();
};

const initMappings = () => {
  const currentTeamPlayers = teamPlayers.value;
  const assignedDbIds = new Set<string>();

  mappings.value = props.gsiPlayers.map((gsi) => {
    // 1. Check for exact Steam ID match in team players
    let match = currentTeamPlayers.find(
      (p) => !assignedDbIds.has(p._id) && p.steamid && p.steamid === gsi.steamid
    );

    // 2. Check for exact Steam ID match in any db player
    if (!match) {
      match = props.dbPlayers.find(
        (p) => !assignedDbIds.has(p._id) && p.steamid && p.steamid === gsi.steamid
      );
    }

    // 3. Check for normalized name match within team players
    if (!match) {
      const cleanGsi = normalizeName(gsi.name);
      if (cleanGsi) {
        match = currentTeamPlayers.find((p) => {
          if (assignedDbIds.has(p._id)) return false;
          const cleanDb = normalizeName(p.username);
          return (
            cleanDb &&
            (cleanDb === cleanGsi ||
              cleanGsi.includes(cleanDb) ||
              cleanDb.includes(cleanGsi))
          );
        });
      }
    }

    if (match) {
      assignedDbIds.add(match._id);
      return {
        gsiPlayer: gsi,
        action: 'existing',
        targetPlayerId: match._id,
        pullSteamId: true,
        pullUsername: false,
        username: match.username,
        isCoach: match.isCoach || false
      };
    }

    // Default to create new player with cleaned name
    return {
      gsiPlayer: gsi,
      action: 'create',
      targetPlayerId: null,
      pullSteamId: true,
      pullUsername: true,
      username: cleanDemoName(gsi.name),
      isCoach: gsi.isCoach || false
    };
  });
};

watch(
  () => props.isOpen,
  (open) => {
    if (open) {
      selectedTeamId.value =
        props.initialTeamId ||
        (props.teams.length > 0 ? sortedTeams.value[0]?._id : '');
      initMappings();
    }
  },
  { immediate: true }
);

watch(selectedTeamId, () => {
  if (props.isOpen) {
    initMappings();
  }
});

const handleMappingChange = (row: PlayerSyncMapping, value: string) => {
  if (value === '__create__') {
    row.action = 'create';
    row.targetPlayerId = null;
    if (!row.username) {
      row.username = cleanDemoName(row.gsiPlayer.name);
    }
    row.pullSteamId = true;
    row.pullUsername = true;
  } else if (value === '__skip__') {
    row.action = 'skip';
    row.targetPlayerId = null;
  } else {
    row.action = 'existing';
    row.targetPlayerId = value;
    const target = getTargetPlayer(value);
    row.username = target ? target.username : '';
    row.pullSteamId = true;
    row.pullUsername = false;
  }
};

const getRowError = (row: PlayerSyncMapping): string | null => {
  if (row.action === 'skip') return null;

  if (row.action === 'create') {
    const raw = row.username;
    const uname = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (!uname) {
      return 'Username is required';
    }
    const dbConflict = props.dbPlayers.find(
      (p) => (p.username || '').trim().toLowerCase() === uname
    );
    if (dbConflict) {
      return `Username "${dbConflict.username}" already exists in database. Choose a unique name or connect to existing player.`;
    }
    const batchConflict = mappings.value.find(
      (m) =>
        m !== row &&
        m.action === 'create' &&
        (m.username || '').trim().toLowerCase() === uname
    );
    if (batchConflict) {
      return `Duplicate username in this batch: "${uname}"`;
    }
  }

  if (row.action === 'existing') {
    if (!row.targetPlayerId) {
      return 'Please select a database player to connect to';
    }
    const duplicateMapping = mappings.value.find(
      (m) =>
        m !== row &&
        m.action === 'existing' &&
        m.targetPlayerId === row.targetPlayerId
    );
    if (duplicateMapping) {
      const target = getTargetPlayer(row.targetPlayerId);
      return `Multiple in-game players mapped to ${target?.username || 'the same player'}`;
    }

    if (row.pullUsername && row.username) {
      const uname = row.username.trim().toLowerCase();
      if (!uname) return 'Username cannot be empty';
      const dbConflict = props.dbPlayers.find(
        (p) =>
          p._id !== row.targetPlayerId &&
          (p.username || '').trim().toLowerCase() === uname
      );
      if (dbConflict) {
        return `Username "${dbConflict.username}" already taken by another player`;
      }
    }
  }

  return null;
};

const hasAnyErrors = computed(() => {
  if (!selectedTeamId.value) return true;
  const activeMappings = mappings.value.filter((m) => m.action !== 'skip');
  if (activeMappings.length === 0) return true;
  return mappings.value.some((m) => !!getRowError(m));
});

const summary = computed(() => {
  const existingCount = mappings.value.filter((m) => m.action === 'existing').length;
  const createCount = mappings.value.filter((m) => m.action === 'create').length;
  const skipCount = mappings.value.filter((m) => m.action === 'skip').length;
  return { existingCount, createCount, skipCount, total: mappings.value.length };
});

const handleConfirm = () => {
  if (hasAnyErrors.value || props.isAdding) return;
  emit('confirm', mappings.value, selectedTeamId.value);
};

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && props.isOpen) {
    emit('close');
  }
};

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <div
    v-if="isOpen"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto"
  >
    <div class="bg-zinc-800 rounded-xl border border-zinc-700 w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col my-auto max-h-[92vh]">
      <!-- Header -->
      <div class="p-5 border-b border-zinc-700 flex justify-between items-center bg-zinc-800/80 shrink-0">
        <div>
          <h2 class="text-xl font-bold text-text-main flex items-center gap-2.5">
            <span>Connect {{ side }} Players with Team</span>
            <BaseBadge :variant="side === 'CT' ? 'blue' : 'amber'">{{ side }}</BaseBadge>
          </h2>
          <p class="text-xs text-zinc-400 mt-1">
            Connect in-game demo players to your team roster, pull Steam IDs, and configure new players without creating duplicates.
          </p>
        </div>
        <button
          @click="emit('close')"
          class="text-zinc-400 hover:text-text-main transition-colors p-1.5 rounded-lg hover:bg-zinc-700/50"
          title="Close (ESC)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Team Selector Bar -->
      <div class="px-6 py-4 border-b border-zinc-700 bg-surface/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
        <div class="flex items-center gap-3">
          <div v-if="selectedTeam?.logo" class="size-8 rounded overflow-hidden shrink-0 flex items-center justify-center bg-zinc-800 border border-zinc-700">
            <img :src="`${baseUrl}${selectedTeam.logo}`" class="w-full h-full object-contain" />
          </div>
          <div>
            <label class="text-xs font-bold text-zinc-300 uppercase tracking-wider block">Target Team</label>
            <span v-if="selectedTeam" class="text-xs text-zinc-400">
              {{ teamPlayers.length }} existing player(s) currently on this team in database
            </span>
          </div>
        </div>

        <div class="w-full sm:w-80">
          <select
            v-model="selectedTeamId"
            class="w-full bg-zinc-900 border border-zinc-700 text-zinc-200 rounded-lg px-3 py-2 text-sm font-semibold focus:outline-none focus:border-primary cursor-pointer transition-colors"
          >
            <option value="" disabled>-- Select a Team --</option>
            <option
              v-for="team in sortedTeams"
              :key="team._id"
              :value="team._id"
            >
              {{ team.name }} ({{ getTeamPlayerCount(team._id) }} players)
            </option>
          </select>
        </div>
      </div>

      <!-- Main Mapping Content Area -->
      <div class="p-6 space-y-4 overflow-y-auto flex-1">
        <div v-if="!selectedTeamId" class="text-center py-12 text-zinc-400 bg-zinc-800/40 rounded-xl border border-dashed border-zinc-700">
          <svg xmlns="http://www.w3.org/2000/svg" class="size-10 mx-auto text-zinc-500 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <div class="font-bold text-zinc-300">Please select a target team</div>
          <div class="text-xs text-zinc-500 mt-1">Choose a team above to display player mappings and pull Steam IDs from the demo.</div>
        </div>

        <div v-else-if="mappings.length === 0" class="text-center py-12 text-zinc-400">
          No players found on {{ side }} in the active game demo.
        </div>

        <div v-else class="space-y-3">
          <div
            v-for="(row, idx) in mappings"
            :key="row.gsiPlayer.steamid"
            :class="[
              'rounded-xl border p-4 transition-colors',
              row.action === 'skip'
                ? 'bg-zinc-800/40 border-zinc-700/40 opacity-60'
                : getRowError(row)
                ? 'bg-red-950/15 border-red-800/70'
                : 'bg-zinc-800 border-zinc-700 hover:border-zinc-600'
            ]"
          >
            <div class="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
              <!-- Left: In-Game (Demo) Player Info -->
              <div class="md:col-span-4 flex flex-col justify-between h-full space-y-2">
                <div>
                  <div class="flex items-center gap-2">
                    <span class="text-xs font-bold text-zinc-400 uppercase tracking-wider">Demo Player #{{ idx + 1 }}</span>
                    <BaseBadge v-if="row.gsiPlayer.inDB" variant="emerald">In DB</BaseBadge>
                    <BaseBadge v-if="row.gsiPlayer.isCoach" variant="red">Coach</BaseBadge>
                  </div>
                  <div class="text-base font-bold text-text-main mt-0.5 truncate" :title="row.gsiPlayer.name">
                    {{ row.gsiPlayer.name }}
                  </div>
                  <div class="mt-1.5 flex items-center gap-1.5">
                    <span class="font-mono text-xs text-zinc-300 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-700/60 select-all">
                      {{ row.gsiPlayer.steamid }}
                    </span>
                  </div>
                </div>
                <div v-if="row.gsiPlayer.stats" class="text-[11px] text-zinc-500">
                  Kills: {{ row.gsiPlayer.stats.kills || 0 }} · Deaths: {{ row.gsiPlayer.stats.deaths || 0 }}
                </div>
              </div>

              <!-- Center Arrow Indicator -->
              <div class="hidden md:flex md:col-span-1 items-center justify-center pt-6 text-zinc-500">
                <svg xmlns="http://www.w3.org/2000/svg" class="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </div>

              <!-- Right: Mapping Action & Data To Pull -->
              <div class="md:col-span-7 space-y-2.5">
                <div>
                  <label class="text-xs font-bold text-zinc-300 uppercase tracking-wider block mb-1">
                    Connect To Database Player
                  </label>
                  <select
                    :value="row.action === 'existing' ? row.targetPlayerId : row.action === 'create' ? '__create__' : '__skip__'"
                    @change="handleMappingChange(row, ($event.target as HTMLSelectElement).value)"
                    class="w-full bg-zinc-900 border border-zinc-700 text-zinc-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-primary cursor-pointer transition-colors"
                  >
                    <option value="__create__">+ Create as New Player</option>
                    <option value="__skip__">Skip / Do Not Import</option>
                    <optgroup v-if="teamPlayers.length > 0" :label="`Roster in ${selectedTeam?.name || 'Selected Team'} (${teamPlayers.length})`">
                      <option v-for="p in teamPlayers" :key="p._id" :value="p._id">
                        {{ p.username }} {{ p.steamid ? `(Steam: ${p.steamid})` : '(No Steam ID)' }}
                      </option>
                    </optgroup>
                    <optgroup v-if="otherPlayers.length > 0" label="Other Database Players">
                      <option v-for="p in otherPlayers" :key="p._id" :value="p._id">
                        {{ p.username }} {{ p.steamid ? `(Steam: ${p.steamid})` : '(No Steam ID)' }}
                      </option>
                    </optgroup>
                  </select>
                </div>

                <!-- Existing Player Configuration -->
                <div v-if="row.action === 'existing'" class="bg-zinc-900/60 p-3 rounded-lg border border-zinc-700/60 space-y-2">
                  <div v-if="getTargetPlayer(row.targetPlayerId)" class="flex items-center gap-2.5 pb-2 border-b border-zinc-800">
                    <img
                      v-if="getTargetPlayer(row.targetPlayerId)?.avatar"
                      :src="`${baseUrl}${getTargetPlayer(row.targetPlayerId)?.avatar}`"
                      class="size-7 rounded-full object-cover shrink-0 border border-zinc-700"
                    />
                    <div v-else class="size-7 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-bold text-zinc-400 shrink-0">
                      {{ (getTargetPlayer(row.targetPlayerId)?.username || '?')[0].toUpperCase() }}
                    </div>
                    <div class="truncate">
                      <span class="text-xs font-bold text-zinc-200">
                        {{ getTargetPlayer(row.targetPlayerId)?.username }}
                      </span>
                      <span v-if="getTargetPlayer(row.targetPlayerId)?.country" class="ml-1.5 text-[10px] text-zinc-400">
                        ({{ getTargetPlayer(row.targetPlayerId)?.country }})
                      </span>
                      <div class="text-[11px] text-zinc-400">
                        Current Steam ID: <code class="font-mono text-zinc-300">{{ getTargetPlayer(row.targetPlayerId)?.steamid || 'None' }}</code>
                      </div>
                    </div>
                  </div>

                  <!-- Data Pull Options for Existing Player -->
                  <div class="space-y-1.5 pt-0.5">
                    <label class="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        v-model="row.pullSteamId"
                        class="size-3.5 rounded border-zinc-600 bg-zinc-700 accent-primary"
                      />
                      <span>Pull Steam ID: <code class="font-mono text-primary font-bold">{{ row.gsiPlayer.steamid }}</code></span>
                    </label>
                    <div
                      v-if="getTargetPlayer(row.targetPlayerId)?.steamid && getTargetPlayer(row.targetPlayerId)?.steamid !== row.gsiPlayer.steamid"
                      class="text-[11px] text-amber-400 pl-5.5 font-medium"
                    >
                      Warning: Will replace existing Steam ID ({{ getTargetPlayer(row.targetPlayerId)?.steamid }})
                    </div>
                    <div
                      v-else-if="getTargetPlayer(row.targetPlayerId)?.steamid === row.gsiPlayer.steamid"
                      class="text-[11px] text-emerald-400/80 pl-5.5"
                    >
                      Already matches player's Steam ID
                    </div>

                    <label class="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        v-model="row.pullUsername"
                        class="size-3.5 rounded border-zinc-600 bg-zinc-700 accent-primary"
                      />
                      <span>Overwrite Username to in-game name ("{{ row.gsiPlayer.name }}")</span>
                    </label>
                    <div v-if="!row.pullUsername" class="text-[11px] text-zinc-400 pl-5.5">
                      Keeps clean database username: <strong>{{ getTargetPlayer(row.targetPlayerId)?.username }}</strong>
                    </div>
                  </div>
                </div>

                <!-- Create New Player Configuration -->
                <div v-else-if="row.action === 'create'" class="bg-zinc-900/60 p-3 rounded-lg border border-zinc-700/60 space-y-2.5">
                  <div>
                    <label class="text-xs font-semibold text-zinc-300 block mb-1">
                      New Player Username <span class="text-red-400">*</span>
                    </label>
                    <input
                      v-model="row.username"
                      type="text"
                      placeholder="Username"
                      class="w-full bg-zinc-800 border rounded px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-primary transition-colors"
                      :class="getRowError(row) ? 'border-red-500' : 'border-zinc-700'"
                    />
                  </div>

                  <div class="flex items-center gap-4 pt-1">
                    <label class="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        v-model="row.pullSteamId"
                        class="size-3.5 rounded border-zinc-600 bg-zinc-700 accent-primary"
                      />
                      <span>Assign Steam ID (<code class="font-mono text-primary font-bold">{{ row.gsiPlayer.steamid }}</code>)</span>
                    </label>

                    <label class="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        v-model="row.isCoach"
                        class="size-3.5 rounded border-zinc-600 bg-zinc-700 accent-primary"
                      />
                      <span>Mark as Coach</span>
                    </label>
                  </div>
                </div>

                <!-- Skip Notice -->
                <div v-else class="text-xs text-zinc-500 italic py-1">
                  This demo player will be skipped. No changes will be made in the database.
                </div>

                <!-- Row Error Message -->
                <div v-if="getRowError(row)" class="text-xs text-red-400 font-medium flex items-center gap-1.5 pt-0.5">
                  <svg xmlns="http://www.w3.org/2000/svg" class="size-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
                  </svg>
                  <span>{{ getRowError(row) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer Bar -->
      <div class="p-4 border-t border-zinc-700 bg-zinc-800/80 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
        <div class="text-xs text-zinc-400">
          <span class="font-bold text-zinc-200">{{ summary.existingCount }}</span> connecting existing,
          <span class="font-bold text-zinc-200">{{ summary.createCount }}</span> creating new,
          <span class="font-bold text-zinc-400">{{ summary.skipCount }}</span> skipped
        </div>

        <div class="flex items-center gap-3 w-full sm:w-auto">
          <BaseButton
            type="button"
            @click="emit('close')"
            variant="secondary"
            class="flex-1 sm:flex-none justify-center"
          >
            Cancel
          </BaseButton>

          <BaseButton
            type="button"
            @click="handleConfirm"
            :disabled="hasAnyErrors || isAdding"
            variant="primary"
            class="flex-1 sm:flex-none justify-center"
          >
            <svg v-if="isAdding" class="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"></path>
            </svg>
            {{ isAdding ? 'Saving...' : `Save & Connect to ${selectedTeam?.name || 'Team'}` }}
          </BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>
