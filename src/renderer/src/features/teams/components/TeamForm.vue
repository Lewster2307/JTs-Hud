<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import type { SelectOption } from '@renderer/components/base/BaseSelect.vue';
import BaseInput from '@renderer/components/base/BaseInput.vue';
import BaseSelect from '@renderer/components/base/BaseSelect.vue';
import BaseButton from '@renderer/components/base/BaseButton.vue';
import { countryOptions } from '@renderer/utils/countries';
import { API_URL } from '@renderer/index';

const props = withDefaults(
  defineProps<{
    initialData: any;
    isEditing: boolean;
    players?: any[];
    existingTeams?: any[];
  }>(),
  {
    players: () => [],
    existingTeams: () => []
  }
);
const emit = defineEmits(['submit']);
const form = ref({ ...props.initialData });

const baseUrl = API_URL.replace('/api', '');

const teamPlayers = computed(() => {
  if (!props.isEditing || !props.initialData?._id || !props.players) return [];
  return props.players.filter((p: any) => p.team === props.initialData._id);
});

const imageSource = ref<'file' | 'url'>('file');
const logoFile = ref<File | null>(null);
const logoPreview = ref<string | null>(null);
const imageUrlInput = ref('');
const isDownloading = ref(false);
const urlError = ref<string | null>(null);
const urlSuccess = ref<string | null>(null);
const newlyDownloadedUploads = ref<string[]>([]);

const displayLogoUrl = computed(() => {
  if (logoPreview.value) return logoPreview.value;
  if (!form.value.logo) return null;
  if (form.value.logo.startsWith('http://') || form.value.logo.startsWith('https://')) {
    return form.value.logo;
  }
  return `${baseUrl}${form.value.logo}`;
});

const countrySelectOptions = computed((): SelectOption[] =>
  countryOptions.map(c => ({ value: c.code, label: `${c.name} (${c.code})` }))
);

const isSubmitted = ref(false);
const isNameTouched = ref(false);

const nameError = computed(() => {
  const raw = form.value.name;
  const name = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!name) {
    if (isSubmitted.value || isNameTouched.value) {
      return 'Team name is required';
    }
    return undefined;
  }
  const isDuplicate = props.existingTeams.some(
    (t: any) => t._id !== props.initialData?._id && (t.name || '').trim().toLowerCase() === name
  );
  return isDuplicate ? 'A team with this name already exists' : undefined;
});

watch(() => props.initialData, (newData) => {
  form.value = { ...newData };
  logoPreview.value = null;
  logoFile.value = null;
  imageUrlInput.value = '';
  urlError.value = null;
  urlSuccess.value = null;
  imageSource.value = 'file';
  newlyDownloadedUploads.value = [];
  isSubmitted.value = false;
  isNameTouched.value = false;
}, { deep: true });

const fileInputRef = ref<HTMLInputElement | null>(null);

const onFileChange = (e: Event) => {
  const target = e.target as HTMLInputElement;
  if (target.files?.length) {
    logoFile.value = target.files[0];
    logoPreview.value = URL.createObjectURL(target.files[0]);
    urlError.value = null;
    urlSuccess.value = null;
  }
};

const downloadFromUrl = async () => {
  const url = imageUrlInput.value.trim();
  if (!url) return;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    urlError.value = 'URL must start with http:// or https://';
    return;
  }

  isDownloading.value = true;
  urlError.value = null;
  urlSuccess.value = null;

  try {
    const res = await fetch(`${API_URL}/uploads/from-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to download image');
    }

    form.value.logo = data.url;
    logoPreview.value = `${baseUrl}${data.url}`;
    logoFile.value = null;
    newlyDownloadedUploads.value.push(data.url);
    urlSuccess.value = 'Image downloaded successfully';
  } catch (err: any) {
    urlError.value = err.message || 'Failed to download image';
  } finally {
    isDownloading.value = false;
  }
};

const removeLogo = async () => {
  if (form.value.logo && form.value.logo.startsWith('/api/uploads/')) {
    const filename = form.value.logo.split('/').pop();
    if (filename && newlyDownloadedUploads.value.includes(form.value.logo)) {
      try {
        await fetch(`${API_URL}/uploads/${filename}`, { method: 'DELETE' });
      } catch {
        /* ignore */
      }
    }
  }

  logoPreview.value = null;
  logoFile.value = null;
  form.value.logo = '';
  imageUrlInput.value = '';
  urlError.value = null;
  urlSuccess.value = null;
  if (fileInputRef.value) fileInputRef.value.value = '';
};

const handleSubmit = async () => {
  isSubmitted.value = true;
  const name = typeof form.value.name === 'string' ? form.value.name.trim() : '';
  if (!name || nameError.value) return;

  if (imageSource.value === 'url' && imageUrlInput.value.trim() && !urlSuccess.value) {
    await downloadFromUrl();
    if (urlError.value) return;
  }

  const cleanForm = {
    ...form.value,
    name: typeof form.value.name === 'string' ? form.value.name.trim() : form.value.name,
    shortName: typeof form.value.shortName === 'string' ? form.value.shortName.trim() : form.value.shortName,
  };
  emit('submit', cleanForm, logoFile.value);
};
</script>

<template>
  <form id="teamForm" @submit.prevent="handleSubmit" class="p-6 space-y-6">

    <!-- Logo + Primary Info -->
    <div class="flex gap-6 items-start">

      <!-- Logo section -->
      <div class="flex flex-col items-center gap-2 shrink-0">
        <div class="w-36 h-36 rounded-xl overflow-hidden border-2 border-zinc-700 bg-surface flex items-center justify-center p-3 relative group">
          <img v-if="displayLogoUrl" :src="displayLogoUrl" class="w-full h-full object-contain" />
          <span v-else class="text-zinc-600 text-6xl font-black select-none">T</span>
          <!-- Delete logo button -->
          <button
            v-if="displayLogoUrl"
            type="button"
            @click="removeLogo"
            class="absolute top-2 right-2 size-6 rounded-full bg-zinc-900/85 hover:bg-red-600 text-zinc-300 hover:text-white flex items-center justify-center transition-colors shadow-md cursor-pointer"
            title="Delete logo"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Mode switcher -->
        <div class="flex w-36 bg-zinc-800 rounded-lg p-0.5 border border-zinc-700 text-xs">
          <button
            type="button"
            class="flex-1 py-1 rounded text-center font-medium transition-colors"
            :class="imageSource === 'file' ? 'bg-zinc-700 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'"
            @click="imageSource = 'file'"
          >
            File
          </button>
          <button
            type="button"
            class="flex-1 py-1 rounded text-center font-medium transition-colors"
            :class="imageSource === 'url' ? 'bg-zinc-700 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'"
            @click="imageSource = 'url'"
          >
            URL
          </button>
        </div>

        <!-- File mode action -->
        <div v-if="imageSource === 'file'" class="w-36 flex flex-col gap-1.5">
          <BaseButton type="button" @click="fileInputRef?.click()" class="w-full justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
            Upload
          </BaseButton>
          <button
            v-if="displayLogoUrl"
            type="button"
            @click="removeLogo"
            class="text-[11px] text-zinc-500 hover:text-red-400 text-center transition-colors py-0.5"
          >
            Remove Logo
          </button>
          <input ref="fileInputRef" type="file" accept="image/*" @change="onFileChange" class="hidden" />
        </div>
      </div>

      <!-- Team Name + Short Name -->
      <div class="flex-1 space-y-4">
        <BaseInput
          v-model="form.name"
          label="Team Name *"
          type="text"
          size="md"
          :error="nameError"
          @blur="isNameTouched = true"
        />
        <BaseInput
          v-model="form.shortName"
          label="Short Name"
          type="text"
          placeholder="e.g. NaVi"
          size="md"
        />
      </div>
    </div>

    <!-- URL input bar when imageSource === 'url' -->
    <div v-if="imageSource === 'url'" class="p-3.5 rounded-lg border border-zinc-700 bg-surface/40 space-y-2">
      <div class="flex items-center justify-between">
        <span class="text-xs font-semibold text-zinc-300">Logo Image URL</span>
        <button
          v-if="displayLogoUrl"
          type="button"
          @click="removeLogo"
          class="text-xs text-zinc-500 hover:text-red-400 transition-colors"
        >
          Remove Logo
        </button>
      </div>
      <div class="flex gap-2">
        <BaseInput
          v-model="imageUrlInput"
          placeholder="Paste image URL (https://...)"
          size="md"
          class="flex-1"
          @keydown.enter.prevent="downloadFromUrl"
        />
        <BaseButton
          type="button"
          variant="primary"
          size="md"
          :disabled="!imageUrlInput.trim() || isDownloading"
          @click="downloadFromUrl"
          class="shrink-0"
        >
          <span v-if="isDownloading">Downloading...</span>
          <span v-else>Download</span>
        </BaseButton>
      </div>
      <p v-if="urlError" class="text-xs text-red-400">{{ urlError }}</p>
      <p v-else-if="urlSuccess" class="text-xs text-emerald-400">{{ urlSuccess }}</p>
      <p v-else class="text-[11px] text-zinc-500">Image will be automatically downloaded and saved locally.</p>
    </div>

    <div class="border-t border-zinc-700/50"></div>

    <!-- Country -->
    <BaseSelect
      v-model="form.country"
      label="Country"
      placeholder="No Country"
      :options="countrySelectOptions"
      size="md"
    />

    <!-- Team Players (Visible when editing) -->
    <div v-if="isEditing" class="space-y-3 pt-2">
      <div class="border-t border-zinc-700/50 pt-4 flex items-center justify-between">
        <div>
          <h3 class="text-xs font-bold uppercase tracking-wider text-zinc-400">Team Players</h3>
          <p class="text-xs text-zinc-500 mt-0.5">Players currently assigned to this team</p>
        </div>
        <span class="text-xs font-semibold px-2 py-0.5 rounded-full bg-zinc-700/60 text-zinc-300">
          {{ teamPlayers.length }} {{ teamPlayers.length === 1 ? 'player' : 'players' }}
        </span>
      </div>

      <div
        v-if="teamPlayers.length === 0"
        class="p-4 rounded-lg border border-dashed border-zinc-700/80 bg-surface/30 text-center text-xs text-zinc-500"
      >
        No players are currently assigned to this team.
      </div>

      <div v-else class="grid grid-cols-1 gap-2 max-h-52 overflow-y-auto pr-1 custom-scrollbar">
        <div
          v-for="player in teamPlayers"
          :key="player._id"
          class="flex items-center justify-between p-2.5 rounded-lg border border-zinc-700/60 bg-surface/50 hover:bg-surface transition-colors"
        >
          <div class="flex items-center gap-3 min-w-0">
            <div class="size-9 rounded-lg overflow-hidden border border-zinc-700 bg-zinc-900 shrink-0 flex items-center justify-center">
              <img v-if="player.avatar" :src="`http://localhost:1349${player.avatar}`" class="size-full object-cover" />
              <span v-else class="text-xs font-bold text-zinc-500">?</span>
            </div>
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="font-bold text-sm text-text-main truncate">{{ player.username }}</span>
                <span v-if="player.isCoach" class="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-900/40 text-red-400 border border-red-800/50">Coach</span>
                <span v-if="player.country" class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-300">{{ player.country }}</span>
              </div>
              <div class="text-xs text-zinc-400 truncate">
                <span v-if="player.firstName || player.lastName">{{ player.firstName }} {{ player.lastName }}</span>
                <span v-if="(player.firstName || player.lastName) && player.steamid" class="mx-1.5 text-zinc-600">•</span>
                <span v-if="player.steamid" class="font-mono text-zinc-500">{{ player.steamid }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

  </form>
</template>
