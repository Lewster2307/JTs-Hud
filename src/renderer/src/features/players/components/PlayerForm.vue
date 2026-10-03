<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import type { SelectOption } from '@renderer/components/base/BaseSelect.vue';
import BaseInput from '@renderer/components/base/BaseInput.vue';
import BaseSelect from '@renderer/components/base/BaseSelect.vue';
import BaseCheckbox from '@renderer/components/base/BaseCheckbox.vue';
import BaseButton from '@renderer/components/base/BaseButton.vue';
import { countryOptions } from '@renderer/utils/countries';
import { API_URL } from '@renderer/index';

const props = withDefaults(
  defineProps<{
    initialData: any;
    teams: any[];
    isEditing: boolean;
    lockSteamId?: boolean;
    existingPlayers?: any[];
    teamWarning?: string;
  }>(),
  {
    existingPlayers: () => [],
    teamWarning: ''
  }
);

const emit = defineEmits(['submit']);
const form = ref({ ...props.initialData });

const baseUrl = API_URL.replace('/api', '');

const imageSource = ref<'file' | 'url'>('file');
const avatarFile = ref<File | null>(null);
const avatarPreview = ref<string | null>(null);
const imageUrlInput = ref('');
const isDownloading = ref(false);
const urlError = ref<string | null>(null);
const urlSuccess = ref<string | null>(null);
const newlyDownloadedUploads = ref<string[]>([]);

const displayAvatarUrl = computed(() => {
  if (avatarPreview.value) return avatarPreview.value;
  if (!form.value.avatar) return null;
  if (form.value.avatar.startsWith('http://') || form.value.avatar.startsWith('https://')) {
    return form.value.avatar;
  }
  return `${baseUrl}${form.value.avatar}`;
});

const isSubmitted = ref(false);
const isUsernameTouched = ref(false);

const usernameError = computed(() => {
  const raw = form.value.username;
  const uname = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!uname) {
    if (isSubmitted.value || isUsernameTouched.value) {
      return 'Username is required';
    }
    return undefined;
  }
  const isDuplicate = props.existingPlayers.some(
    (p: any) => p._id !== props.initialData?._id && (p.username || '').trim().toLowerCase() === uname
  );
  return isDuplicate ? 'A player with this username already exists' : undefined;
});

const steamIdError = computed(() => {
  const raw = form.value.steamid;
  const sid = typeof raw === 'string' ? raw.trim().replace(/\s+/g, '') : '';
  if (!sid) {
    return undefined;
  }
  const currentId = props.initialData?._id;
  const isDuplicate = props.existingPlayers.some(
    (p: any) =>
      p._id !== currentId &&
      typeof p.steamid === 'string' &&
      p.steamid.trim().replace(/\s+/g, '') === sid
  );
  return isDuplicate ? 'A player with this Steam ID already exists' : undefined;
});

watch(() => props.initialData, (newData) => {
  form.value = { ...newData };
  avatarPreview.value = null;
  avatarFile.value = null;
  imageUrlInput.value = '';
  urlError.value = null;
  urlSuccess.value = null;
  imageSource.value = 'file';
  newlyDownloadedUploads.value = [];
  isSubmitted.value = false;
  isUsernameTouched.value = false;
}, { deep: true });

// Convert data to SelectOption[] format
const countrySelectOptions = computed((): SelectOption[] =>
  countryOptions.map(c => ({ value: c.code, label: `${c.name} (${c.code})` }))
);

const teamSelectOptions = computed((): SelectOption[] => {
  const sorted = [...props.teams].sort((a, b) => {
    const nameA = String(a.name || '');
    const nameB = String(b.name || '');
    return nameA.localeCompare(nameB, undefined, { sensitivity: 'base', numeric: true });
  });

  return [
    { value: '', label: 'No Team' },
    ...sorted.map(t => ({ value: t._id, label: t.name || 'Unnamed Team' }))
  ];
});

const fileInputRef = ref<HTMLInputElement | null>(null);

const onFileChange = (e: Event) => {
  const target = e.target as HTMLInputElement;
  if (target.files?.length) {
    avatarFile.value = target.files[0];
    avatarPreview.value = URL.createObjectURL(target.files[0]);
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

    form.value.avatar = data.url;
    avatarPreview.value = `${baseUrl}${data.url}`;
    avatarFile.value = null;
    newlyDownloadedUploads.value.push(data.url);
    urlSuccess.value = 'Image downloaded successfully';
  } catch (err: any) {
    urlError.value = err.message || 'Failed to download image';
  } finally {
    isDownloading.value = false;
  }
};

const removeAvatar = async () => {
  if (form.value.avatar && form.value.avatar.startsWith('/api/uploads/')) {
    const filename = form.value.avatar.split('/').pop();
    if (filename && newlyDownloadedUploads.value.includes(form.value.avatar)) {
      try {
        await fetch(`${API_URL}/uploads/${filename}`, { method: 'DELETE' });
      } catch {
        /* ignore */
      }
    }
  }

  avatarPreview.value = null;
  avatarFile.value = null;
  form.value.avatar = '';
  imageUrlInput.value = '';
  urlError.value = null;
  urlSuccess.value = null;
  if (fileInputRef.value) fileInputRef.value.value = '';
};

// Automatically remove any whitespace from Steam ID
watch(() => form.value.steamid, (val) => {
  if (typeof val === 'string' && /\s/.test(val)) {
    form.value.steamid = val.replace(/\s+/g, '');
  }
});

const handleSubmit = async () => {
  isSubmitted.value = true;
  const username = typeof form.value.username === 'string' ? form.value.username.trim() : '';
  if (!username || usernameError.value || steamIdError.value) return;

  if (imageSource.value === 'url' && imageUrlInput.value.trim() && !urlSuccess.value) {
    await downloadFromUrl();
    if (urlError.value) return;
  }

  const cleanForm = {
    ...form.value,
    steamid: typeof form.value.steamid === 'string' ? form.value.steamid.trim() : form.value.steamid,
    username: typeof form.value.username === 'string' ? form.value.username.trim() : form.value.username,
    firstName: typeof form.value.firstName === 'string' ? form.value.firstName.trim() : form.value.firstName,
    lastName: typeof form.value.lastName === 'string' ? form.value.lastName.trim() : form.value.lastName
  };
  emit('submit', cleanForm, avatarFile.value);
};
</script>

<template>
  <form id="playerForm" @submit.prevent="handleSubmit" class="p-6 space-y-6">

    <!-- Avatar + Primary Identity -->
    <div class="flex gap-6 items-start">

      <!-- Avatar section -->
      <div class="flex flex-col items-center gap-2 shrink-0">
        <div class="w-36 h-36 rounded-xl overflow-hidden border-2 border-zinc-700 bg-surface flex items-center justify-center relative group">
          <img v-if="displayAvatarUrl" :src="displayAvatarUrl" class="w-full h-full object-cover" />
          <span v-else class="text-zinc-600 text-6xl select-none">?</span>
          <!-- Delete avatar button -->
          <button
            v-if="displayAvatarUrl"
            type="button"
            @click="removeAvatar"
            class="absolute top-2 right-2 size-6 rounded-full bg-zinc-900/85 hover:bg-red-600 text-zinc-300 hover:text-white flex items-center justify-center transition-colors shadow-md cursor-pointer"
            title="Delete picture"
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
            v-if="displayAvatarUrl"
            type="button"
            @click="removeAvatar"
            class="text-[11px] text-zinc-500 hover:text-red-400 text-center transition-colors py-0.5"
          >
            Remove Avatar
          </button>
          <input ref="fileInputRef" type="file" accept="image/*" @change="onFileChange" class="hidden" />
        </div>
      </div>

      <!-- Steam ID + Username -->
      <div class="flex-1 space-y-4">
        <BaseInput
          v-model="form.steamid"
          label="Steam ID 64"
          type="text"
          :disabled="lockSteamId"
          :error="steamIdError"
          size="md"
        />
        <BaseInput
          v-model="form.username"
          label="Username *"
          type="text"
          size="md"
          :error="usernameError"
          @blur="isUsernameTouched = true"
        />
      </div>
    </div>

    <!-- URL input bar when imageSource === 'url' -->
    <div v-if="imageSource === 'url'" class="p-3.5 rounded-lg border border-zinc-700 bg-surface/40 space-y-2">
      <div class="flex items-center justify-between">
        <span class="text-xs font-semibold text-zinc-300">Avatar Image URL</span>
        <button
          v-if="displayAvatarUrl"
          type="button"
          @click="removeAvatar"
          class="text-xs text-zinc-500 hover:text-red-400 transition-colors"
        >
          Remove Avatar
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

    <!-- Name row -->
    <div class="grid grid-cols-2 gap-4">
      <BaseInput
        v-model="form.firstName"
        label="First Name"
        type="text"
        size="md"
      />
      <BaseInput
        v-model="form.lastName"
        label="Last Name"
        type="text"
        size="md"
      />
    </div>

    <!-- Country + Team row -->
    <div class="grid grid-cols-2 gap-4">
      <BaseSelect
        v-model="form.country"
        label="Country"
        placeholder="No Country"
        :options="countrySelectOptions"
        size="md"
      />
      <div>
        <BaseSelect
          v-model="form.team"
          label="Team"
          placeholder="No Team"
          :options="teamSelectOptions"
          :searchable="true"
          :clearable="true"
          size="md"
        />
        <p v-if="teamWarning && !form.team" class="text-xs text-amber-400 mt-1.5 flex items-start gap-1.5">
          <svg xmlns="http://www.w3.org/2000/svg" class="size-3.5 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
          </svg>
          <span>{{ teamWarning }}</span>
        </p>
      </div>
    </div>

    <!-- Coach toggle -->
    <div class="p-4 rounded-lg border border-zinc-700 bg-surface/50">
      <div class="flex items-center justify-between">
        <div>
          <span class="text-sm font-semibold text-zinc-200">Set as Coach</span>
          <p class="text-xs text-zinc-500 mt-0.5">Coaches are filtered out (hidden) from the data sent to the HUDs</p>
        </div>
        <BaseCheckbox
          v-model="form.isCoach"
          size="md"
        />
      </div>
    </div>

  </form>
</template>
